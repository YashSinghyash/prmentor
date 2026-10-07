// Orchestrates one PR review: fetch files -> build prompt -> ask the LLM -> post to GitHub.

import { buildDiff } from "./diff.js";
import { review, LLMError } from "./llm.js";
import { saveIssues } from "./db.js";

// In-memory cache keyed by "owner/repo@headSha". Webhooks can be delivered twice,
// and the same commit should never cost two Groq calls. It resets when the app restarts.
// We store the Promise itself, so two simultaneous deliveries share one in-flight review.
const reviewCache = new Map();
const MAX_CACHE_ENTRIES = 200;

const MAX_COMMENTS = 10;
const SEVERITY_ICON = { high: "🔴", medium: "🟠", low: "🟡" };

/** True for dependabot, github-actions, and this app itself (all have type "Bot"). */
export function isBot(user) {
  return user?.type === "Bot" || user?.login?.endsWith("[bot]");
}

/** Entry point called from the webhook handler. Never throws. */
export async function handlePullRequest(context) {
  const { pull_request: pr, repository } = context.payload;
  const log = context.log;

  if (isBot(pr.user)) {
    log.info(`Skipping PR #${pr.number}: authored by bot ${pr.user.login}`);
    return;
  }

  const key = `${repository.full_name}@${pr.head.sha}`;
  if (reviewCache.has(key)) {
    log.info(`Already reviewed (or reviewing) ${key}, skipping duplicate`);
    return;
  }

  const job = reviewPullRequest(context);
  reviewCache.set(key, job);
  if (reviewCache.size > MAX_CACHE_ENTRIES) {
    reviewCache.delete(reviewCache.keys().next().value); // drop the oldest entry
  }

  try {
    await job;
  } catch (err) {
    // Failed reviews are removed from the cache so a later push or redelivery can retry.
    reviewCache.delete(key);
    if (err instanceof LLMError && err.kind === "rate_limit") {
      log.warn(`Groq rate limit reached; review of ${key} skipped. ${err.message}`);
    } else if (err instanceof LLMError && err.kind === "bad_json") {
      log.warn(`Model output was not valid JSON; nothing posted for ${key}. ${err.message}`);
    } else {
      log.error({ err }, `Review of ${key} failed; nothing posted`);
    }
  }
}

async function reviewPullRequest(context) {
  const { pull_request: pr, repository } = context.payload;
  const { octokit, log } = context;
  const repo = context.repo(); // { owner, repo }

  // 1. All changed files (paginate handles PRs with more than 100 files).
  const files = await octokit.paginate(octokit.rest.pulls.listFiles, {
    ...repo,
    pull_number: pr.number,
    per_page: 100,
  });

  // 2-3. Filter and size-limit the diff.
  const { diffText, note, validLines, skipped } = buildDiff(files);
  if (skipped.length) log.info(`Skipped ${skipped.length} file(s): ${skipped.join("; ")}`);

  if (!diffText) {
    log.info(`PR #${pr.number}: nothing reviewable in the diff`);
    await postReview(octokit, repo, pr, "No reviewable code changes found in this PR (only lockfiles, generated or binary files).", []);
    return;
  }

  // 4. Ask the LLM. Throws on rate limit / bad JSON, so nothing is posted in that case.
  log.info(`Reviewing PR #${pr.number} (${diffText.length} chars of diff)`);
  const { issues } = await review(diffText, note);

  // Drop issues pointing at files/lines that are not in the diff: GitHub would reject
  // the whole review if even one inline comment had an invalid line.
  const seen = new Set();
  const comments = [];
  const posted = []; // the issues behind each comment
  for (const issue of issues) {
    const lines = validLines.get(issue.file);
    const dedupeKey = `${issue.file}:${issue.line}:${issue.concept}`;
    if (!lines || !lines.has(issue.line)) {
      log.warn(`Dropping issue on ${issue.file}:${issue.line} (line not in diff)`);
      continue;
    }
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    comments.push({
      path: issue.file,
      line: issue.line,
      side: "RIGHT", // RIGHT = the new version of the file
      body: formatComment(issue),
    });
    posted.push(issue); // same order as `comments`, used to match ids below
    if (comments.length >= MAX_COMMENTS) break;
  }

  // 5. Post ONE review.
  const summary =
    comments.length > 0
      ? `PRMentor found ${comments.length} thing${comments.length === 1 ? "" : "s"} worth a look. See the inline comments.`
      : "PRMentor reviewed this PR and found no bugs or security issues. Nice work!";
  const { data: createdReview } = await postReview(octokit, repo, pr, summary + (note ? `\n\n_${note}_` : ""), comments);
  log.info(`Posted review on PR #${pr.number} with ${comments.length} inline comment(s)`);

  // 6. Remember each issue by its comment id so "/fix" can reveal the answer later.
  // The review is already public at this point, so a storage problem is logged, not thrown
  // (throwing would drop the cache entry and cause a duplicate review on redelivery).
  if (comments.length > 0) {
    try {
      await storeIssues(octokit, repo, pr, repository.full_name, createdReview.id, posted);
    } catch (err) {
      log.error({ err }, "Review was posted but saving issues failed; /fix will not work for it");
    }
  }
}

/**
 * createReview does not return the ids of the inline comments, so we list the
 * review's comments and match them to our issues. GitHub returns them in the
 * order we sent them; we double-check the file path to be safe.
 */
async function storeIssues(octokit, repo, pr, fullName, reviewId, issues) {
  const created = await octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
    ...repo,
    pull_number: pr.number,
    review_id: reviewId,
    per_page: 100,
  });

  const rows = [];
  issues.forEach((issue, i) => {
    const comment = created[i];
    if (!comment || comment.path !== issue.file) return; // mismatch: skip rather than store wrong data
    rows.push({
      comment_id: comment.id,
      repo: fullName,
      pr: pr.number,
      file: issue.file,
      line: issue.line,
      concept: issue.concept,
      severity: issue.severity,
      hint: issue.hint,
      fix: issue.fix,
      author: pr.user.login,
    });
  });
  saveIssues(rows);
}

function formatComment(issue) {
  const icon = SEVERITY_ICON[issue.severity] ?? "";
  const badge = issue.severity.charAt(0).toUpperCase() + issue.severity.slice(1);
  const learnUrl = `https://learn.microsoft.com/en-us/search/?terms=${encodeURIComponent(issue.learnQuery)}`;
  return [
    `${icon} **${badge}** · \`${issue.concept}\``,
    "",
    issue.hint,
    "",
    `📚 [Learn more on Microsoft Learn](${learnUrl})`,
    "",
    "Reply `/fix` to reveal the full solution.",
  ].join("\n");
}

function postReview(octokit, repo, pr, body, comments) {
  return octokit.rest.pulls.createReview({
    ...repo,
    pull_number: pr.number,
    commit_id: pr.head.sha, // pin comments to the commit we reviewed
    event: "COMMENT", // comment only; never approve or request changes
    body,
    comments,
  });
}
