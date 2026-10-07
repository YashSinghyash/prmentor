// Helpers that turn GitHub's file list into a size-limited prompt,
// and that track which lines of each file are actually part of the diff.

export const MAX_DIFF_CHARS = 12000;

// Files we never want to review.
const SKIP_PATTERNS = [
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|coverage|vendor)\//,
  /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|composer\.lock|Gemfile\.lock|poetry\.lock|Cargo\.lock)$/,
  /\.min\.(js|css)$/,
  /\.(map|snap|lock)$/,
  /\.(png|jpe?g|gif|svg|ico|webp|pdf|zip|gz|tar|woff2?|ttf|eot|mp[34]|mov|jar|class|exe|dll|so|bin)$/i,
  /\.generated\.|\.pb\.go$|_pb2\.py$/,
];

/** Returns a reason string if the file should be skipped, or null if it should be reviewed. */
export function skipReason(file) {
  if (file.status === "removed") return "deleted";
  // GitHub omits `patch` for binary files and for very large diffs.
  if (!file.patch) return "no patch (binary or too large)";
  if (SKIP_PATTERNS.some((re) => re.test(file.filename))) return "lockfile/generated/minified/binary";
  return null;
}

/**
 * Walks a unified-diff patch and returns:
 *  - text:  the patch with new-file line numbers added to every line
 *  - lines: Set of new-file line numbers that appear in the diff (added + context)
 * GitHub only accepts inline comments on those lines.
 */
export function annotatePatch(patch) {
  const lines = new Set();
  const out = [];
  let newLine = 0;

  for (const raw of patch.split("\n")) {
    // Hunk header looks like: @@ -10,6 +12,8 @@  (12 = first new line number)
    const hunk = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
    if (hunk) {
      newLine = Number(hunk[1]);
      out.push(raw);
    } else if (raw.startsWith("\\")) {
      continue; // "\ No newline at end of file"
    } else if (raw.startsWith("-")) {
      out.push(`     - ${raw.slice(1)}`); // removed: no new-file line number
    } else {
      const marker = raw.startsWith("+") ? "+" : " ";
      lines.add(newLine);
      out.push(`${String(newLine).padStart(4)} ${marker} ${raw.slice(1)}`);
      newLine++;
    }
  }
  return { text: out.join("\n"), lines };
}

/**
 * Picks which files fit in the prompt (smallest first, so many small files beat one huge one).
 * Returns { diffText, note, validLines } where validLines maps filename -> Set of commentable lines.
 */
export function buildDiff(files, maxChars = MAX_DIFF_CHARS) {
  const skipped = [];
  const candidates = [];

  for (const file of files) {
    const reason = skipReason(file);
    if (reason) skipped.push(`${file.filename} (${reason})`);
    else candidates.push({ filename: file.filename, ...annotatePatch(file.patch) });
  }

  candidates.sort((a, b) => a.text.length - b.text.length);

  const validLines = new Map();
  const parts = [];
  let used = 0;

  for (const c of candidates) {
    const block = `### File: ${c.filename}\n${c.text}\n`;
    if (used + block.length > maxChars) {
      skipped.push(`${c.filename} (too large for the size limit)`);
      continue;
    }
    parts.push(block);
    validLines.set(c.filename, c.lines);
    used += block.length;
  }

  const note = skipped.length ? `These files were not included: ${skipped.join(", ")}.` : "";
  return { diffText: parts.join("\n"), note, validLines, skipped };
}
