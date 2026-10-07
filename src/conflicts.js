// Phase 4: semantic conflict detection between open PRs.
//
// Two PRs can merge cleanly in Git and still break each other (for example, one changes
// what getUser() returns while the other still uses the old return value). For the PR
// that just changed ("this PR") we compare it with the other open PRs, cheaply filter out
// pairs that cannot interact, and ask the LLM about the rest.

import { buildDiff } from "./diff.js";
import { findOverlap } from "./overlap.js";
import { checkConflict, LLMError } from "./llm.js";
import { isBot } from "./reviewer.js";
import { saveConflicts, wasPairChecked, recordPairChecked, wasNoticeSent, recordNoticeSent } from "./db.js";

const MAX_OTHER_PRS = 5; // most recently updated open PRs to compare against
const PER_PR_CHARS = 6000; // each side gets half of the usual 12k prompt budget
const SEVERITY_ICON = { high: "🔴", medium: "🟠", low: "🟡" };

// Pairs being compared right now. The DB remembers finished pairs; this stops two
// simultaneous webhooks from comparing the same pair twice.
const inFlight = new Set();

/** Entry point called after the normal review. Never throws. */
export async function handleConflicts(context) {
  const { pull_request: pr } = context.payload;
  if (isBot(pr.user)) return;

  try {
    await detectConflicts(context);
  } catch (err) {
    context.log.error({ err }, `Conflict detection for PR #${pr.number} failed; nothing posted`);
  }
}

/** Same key whichever PR triggers the check: sorted PR numbers plus both head commits. */
function pairKey(fullName, a, b) {
  const [lo, hi] = a.number < b.number ? [a, b] : [b, a];
  return `${fullName}#${lo.number}@${lo.head.sha}+${hi.number}@${hi.head.sha}`;
}

async function detectConflicts(context) {
  const { pull_request: pr, repository } = context.payload;
  const { octokit, log } = context;
  const repo = context.repo();
  const fullName = repository.full_name;

  // 1. Other open PRs: newest activity first, no bots, same base branch (PRs headed for
  //    different branches will not be merged together), at most 5.
  const { data: open } = await octokit.rest.pulls.list({
    ...repo,
    state: "open",
    sort: "updated",
    direction: "desc",
    per_page: 30,
  });
  const others = open
    .filter((p) => p.number !== pr.number && !isBot(p.user) && p.base.ref === pr.base.ref)
    .slice(0, MAX_OTHER_PRS);

  if (others.length === 0) {
    log.info(`PR #${pr.number}: no other open PRs to compare with`);
    return;
  }

  // This PR's diff is loaded once, and only if some pair needs it.
  let mine;
  const getMine = async () => {
    if (!mine) {
      const files = await listFiles(octokit, repo, pr.number);
      mine = { files, built: buildDiff(files, PER_PR_CHARS) };
    }
    return mine;
  };

  for (const other of others) {
    const key = pairKey(fullName, pr, other);
    if (inFlight.has(key) || wasPairChecked(key)) {
      log.info(`PR #${pr.number} vs #${other.number}: already compared at these commits, skipping`);
      continue;
    }

    inFlight.add(key);
    try {
      await comparePair({ context, pr, other, key, fullName, getMine });
    } catch (err) {
      // Nothing is recorded on failure, so a later push or redelivery can try again.
      if (err instanceof LLMError && err.kind === "rate_limit") {
        log.warn(`Groq rate limit reached; skipping remaining conflict checks for PR #${pr.number}. ${err.message}`);
        return;
      }
      if (err instanceof LLMError && err.kind === "bad_json") {
        log.warn(`Model output was not valid JSON for PR #${pr.number} vs #${other.number}; nothing posted. ${err.message}`);
      } else {
        log.error({ err }, `Conflict check PR #${pr.number} vs #${other.number} failed; nothing posted`);
      }
    } finally {
      inFlight.delete(key);
    }
  }
}

function listFiles(octokit, repo, number) {
  return octokit.paginate(octokit.rest.pulls.listFiles, { ...repo, pull_number: number, per_page: 100 });
}

async function comparePair({ context, pr, other, key, fullName, getMine }) {
  const { octokit, log } = context;
  const repo = context.repo();

  const myDiff = await getMine();
  const otherFiles = await listFiles(octokit, repo, other.number);

  // 2. Cheap pre-filter: no shared file and no shared function name means no Groq call.
  const overlap = findOverlap(myDiff.files, otherFiles);
  if (overlap.sameFiles.length === 0 && overlap.sharedNames.length === 0) {
    log.info(`PR #${pr.number} vs #${other.number}: no overlap, skipping LLM`);
    recordPairChecked(key, 0);
    return;
  }

  const otherBuilt = buildDiff(otherFiles, PER_PR_CHARS);
  if (!myDiff.built.diffText || !otherBuilt.diffText) {
    recordPairChecked(key, 0);
    return;
  }

  // 3. Ask the LLM, telling it why the pair was picked.
  log.info(
    `PR #${pr.number} vs #${other.number}: overlap found (${[...overlap.sameFiles, ...overlap.sharedNames].join(", ")}), asking the LLM`
  );
  const { conflicts } = await checkConflict({
    thisNumber: pr.number,
    otherNumber: other.number,
    thisDiff: myDiff.built.diffText,
    otherDiff: otherBuilt.diffText,
    note: describeOverlap(overlap),
  });

  if (conflicts.length === 0) {
    log.info(`PR #${pr.number} vs #${other.number}: no semantic conflict`);
    recordPairChecked(key, 0);
    return;
  }

  // 4. Post ONE review on this PR with an inline comment per conflict.
  const comments = conflicts.map((c) => {
    const { file, line } = anchorInDiff(c, myDiff.built.validLines);
    return { path: file, line, side: "RIGHT", body: formatConflictComment(c, other) };
  });
  const { data: review } = await octokit.rest.pulls.createReview({
    ...repo,
    pull_number: pr.number,
    commit_id: pr.head.sha,
    event: "COMMENT",
    body:
      `⚠️ **Possible semantic conflict with #${other.number}**\n\n` +
      `Git can merge these two open PRs cleanly, but they may still clash in behaviour. ` +
      `See the inline comment${comments.length === 1 ? "" : "s"} below.`,
    comments,
  });
  log.info(`Posted ${comments.length} conflict comment(s) on PR #${pr.number} (vs #${other.number})`);

  // 5. Remember each conflict by comment id so "/fix" can reveal the resolution.
  try {
    await storeConflicts({ octokit, repo, fullName, pr, other, review, conflicts, comments });
  } catch (err) {
    log.error({ err }, "Conflict review was posted but saving it failed; /fix will not work for it");
  }

  // 6. One short note on the other PR (once per pair, and never allowed to fail the check).
  await notifyOtherPr({ octokit, repo, fullName, pr, other, log });

  recordPairChecked(key, conflicts.length);
}

function describeOverlap({ sameFiles, sharedNames }) {
  const parts = [];
  if (sameFiles.length) parts.push(`both PRs change ${sameFiles.join(", ")}`);
  if (sharedNames.length) parts.push(`one PR uses a name the other defines: ${sharedNames.join(", ")}`);
  return parts.join("; ");
}

/**
 * GitHub only accepts inline comments on lines that are in the diff. If the model's
 * line is not valid, snap to the closest valid line in the same file, and failing that
 * to the first changed line of this PR. A real conflict is never dropped for a bad line number.
 */
function anchorInDiff(conflict, validLines) {
  const lines = validLines.get(conflict.file);
  if (lines?.has(conflict.line)) return { file: conflict.file, line: conflict.line };

  if (lines && lines.size > 0) {
    let best = null;
    for (const l of lines) if (best === null || Math.abs(l - conflict.line) < Math.abs(best - conflict.line)) best = l;
    return { file: conflict.file, line: best };
  }

  const [file, fileLines] = validLines.entries().next().value;
  return { file, line: Math.min(...fileLines) };
}

function formatConflictComment(conflict, other) {
  const icon = SEVERITY_ICON[conflict.severity] ?? "";
  return [
    `⚠️ **Possible semantic conflict with #${other.number}** ${icon} (${conflict.severity})`,
    "",
    conflict.hint,
    "",
    `🔗 Other PR: [#${other.number} ${other.title}](${other.html_url})`,
    "",
    "Reply `/fix` to reveal the suggested resolution.",
  ].join("\n");
}

/** createReview does not return comment ids, so list the review's comments and match by order and path. */
async function storeConflicts({ octokit, repo, fullName, pr, other, review, conflicts, comments }) {
  const created = await octokit.paginate(octokit.rest.pulls.listCommentsForReview, {
    ...repo,
    pull_number: pr.number,
    review_id: review.id,
    per_page: 100,
  });

  const rows = [];
  conflicts.forEach((c, i) => {
    const comment = created[i];
    if (!comment || comment.path !== comments[i].path) return; // mismatch: skip rather than store wrong data
    rows.push({
      comment_id: comment.id,
      repo: fullName,
      pr: pr.number,
      other_pr: other.number,
      file: comments[i].path,
      line: comments[i].line,
      severity: c.severity,
      summary: c.summary,
      hint: c.hint,
      fix: c.fix,
      author: pr.user.login,
    });
  });
  saveConflicts(rows);
}

async function notifyOtherPr({ octokit, repo, fullName, pr, other, log }) {
  try {
    if (wasNoticeSent(fullName, other.number, pr.number)) return;
    await octokit.rest.issues.createComment({
      ...repo,
      issue_number: other.number, // PR comments use the issues API
      body:
        `👋 Heads up from PRMentor: #${pr.number} (${pr.title}) changes code that overlaps with this PR. ` +
        `Git can merge the two cleanly, but they may conflict in behaviour. ` +
        `I left a hint on #${pr.number}. It is worth coordinating before either one merges.`,
    });
    recordNoticeSent(fullName, other.number, pr.number);
  } catch (err) {
    log.warn({ err }, `Could not post the note on PR #${other.number}`);
  }
}
