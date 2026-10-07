// Handles replies on our inline comments: "/fix" or "show fix" reveals the stored solution.

import { getIssueByCommentId, markRevealed } from "./db.js";
import { isBot } from "./reviewer.js";

// "/fix" at the start of the reply, or the phrase "show fix" anywhere (case-insensitive).
const FIX_REQUEST = /^\s*\/fix\b|show\s+fix/i;

/** Entry point for pull_request_review_comment.created. Never throws. */
export async function handleReviewComment(context) {
  const { comment, pull_request: pr } = context.payload;
  const log = context.log;

  try {
    // Ignore bots, which includes this app's own comments (so we never reply to ourselves).
    if (isBot(comment.user)) return;

    // Not a reply at all: nothing to reveal.
    // GitHub always points in_reply_to_id at the first comment of the thread,
    // which is the one we posted, so we can look it up directly.
    if (!comment.in_reply_to_id) return;

    if (!FIX_REQUEST.test(comment.body || "")) return;

    // If the thread was not started by us, there is no row and we stay silent.
    const issue = getIssueByCommentId(comment.in_reply_to_id);
    if (!issue) return;

    if (issue.revealed) {
      log.info(`Fix for comment ${issue.comment_id} was already revealed, not posting again`);
      return;
    }

    await context.octokit.rest.pulls.createReplyForReviewComment({
      ...context.repo(),
      pull_number: pr.number,
      comment_id: issue.comment_id,
      body: `🔓 **Full solution** · \`${issue.concept}\`\n\n${issue.fix}`,
    });

    // Mark it only after the reply succeeded, so a failed post can be retried.
    markRevealed(issue.comment_id);
    log.info(`Revealed fix for ${issue.repo}#${issue.pr} ${issue.file}:${issue.line} to ${comment.user.login}`);
  } catch (err) {
    log.error({ err }, "Could not reveal the fix");
  }
}
