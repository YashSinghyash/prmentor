// Handles replies on our inline comments: "/fix" or "show fix" reveals the stored solution.
// This works for both review issues (Phase 2) and semantic-conflict comments (Phase 4).

import { getIssueByCommentId, markRevealed, getConflictByCommentId, markConflictRevealed } from "./db.js";
import { isBot } from "./reviewer.js";

// "/fix" at the start of the reply, or the phrase "show fix" anywhere (case-insensitive).
const FIX_REQUEST = /^\s*\/fix\b|show\s+fix/i;

/**
 * Finds what we stored for a comment thread, whatever kind it is.
 * Returns { row, heading, markRevealed } or undefined if the thread is not ours.
 */
function findStored(commentId) {
  const issue = getIssueByCommentId(commentId);
  if (issue) {
    return { row: issue, heading: `🔓 **Full solution** · \`${issue.concept}\``, markRevealed };
  }
  const conflict = getConflictByCommentId(commentId);
  if (conflict) {
    return {
      row: conflict,
      heading: `🔓 **Suggested resolution** · conflict with #${conflict.other_pr}`,
      markRevealed: markConflictRevealed,
    };
  }
  return undefined;
}

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
    const stored = findStored(comment.in_reply_to_id);
    if (!stored) return;
    const { row } = stored;

    if (row.revealed) {
      log.info(`Fix for comment ${row.comment_id} was already revealed, not posting again`);
      return;
    }

    await context.octokit.rest.pulls.createReplyForReviewComment({
      ...context.repo(),
      pull_number: pr.number,
      comment_id: row.comment_id,
      body: `${stored.heading}\n\n${row.fix}`,
    });

    // Mark it only after the reply succeeded, so a failed post can be retried.
    stored.markRevealed(row.comment_id);
    log.info(`Revealed fix for ${row.repo}#${row.pr} ${row.file}:${row.line} to ${comment.user.login}`);
  } catch (err) {
    log.error({ err }, "Could not reveal the fix");
  }
}
