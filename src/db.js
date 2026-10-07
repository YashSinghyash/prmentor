// SQLite storage (better-sqlite3 is synchronous, which keeps the code simple).
// Each issue we post is saved here so the fix can be revealed later,
// and so Phase 3 can build the per-student skill profile from it.

import fs from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import { config } from "./config.js";

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

const db = new Database(config.dbPath);
db.pragma("journal_mode = WAL"); // safer and faster for a server that reads and writes

db.exec(`
  CREATE TABLE IF NOT EXISTS issues (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL UNIQUE, -- GitHub id of our inline comment (the thread root)
    repo       TEXT    NOT NULL,        -- "owner/name"
    pr         INTEGER NOT NULL,
    file       TEXT    NOT NULL,
    line       INTEGER NOT NULL,
    concept    TEXT    NOT NULL,
    severity   TEXT    NOT NULL,
    hint       TEXT    NOT NULL,
    fix        TEXT    NOT NULL,
    revealed   INTEGER NOT NULL DEFAULT 0, -- 0 = hint only, 1 = fix was revealed
    author     TEXT    NOT NULL,        -- the student who opened the PR
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );
`);

// Phase 4: semantic conflicts between two open PRs.
//  - conflicts:        one row per inline conflict comment (so /fix can reveal the resolution)
//  - conflict_checks:  which PR pairs (at which commits) were already compared, so Groq is not called twice
//  - conflict_notices: the one-time note left on the OTHER PR
db.exec(`
  CREATE TABLE IF NOT EXISTS conflicts (
    id         INTEGER PRIMARY KEY AUTOINCREMENT,
    comment_id INTEGER NOT NULL UNIQUE, -- GitHub id of our inline comment on THIS PR
    repo       TEXT    NOT NULL,
    pr         INTEGER NOT NULL,        -- the PR that got the comment
    other_pr   INTEGER NOT NULL,        -- the PR it may clash with
    file       TEXT    NOT NULL,
    line       INTEGER NOT NULL,
    severity   TEXT    NOT NULL,
    summary    TEXT    NOT NULL,        -- what clashes (not shown to the student up front)
    hint       TEXT    NOT NULL,
    fix        TEXT    NOT NULL,
    revealed   INTEGER NOT NULL DEFAULT 0,
    author     TEXT    NOT NULL,
    created_at TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conflict_checks (
    pair_key         TEXT PRIMARY KEY,  -- "owner/repo#12@sha+15@sha", PR numbers sorted
    conflicts_found  INTEGER NOT NULL,
    created_at       TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS conflict_notices (
    repo         TEXT    NOT NULL,
    notified_pr  INTEGER NOT NULL,      -- the PR we left the note on
    mentions_pr  INTEGER NOT NULL,      -- the PR the note talks about
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (repo, notified_pr, mentions_pr)
  );
`);

const insertStmt = db.prepare(`
  INSERT OR REPLACE INTO issues
    (comment_id, repo, pr, file, line, concept, severity, hint, fix, author)
  VALUES
    (@comment_id, @repo, @pr, @file, @line, @concept, @severity, @hint, @fix, @author)
`);

/** Saves several issues at once (all or nothing). */
export const saveIssues = db.transaction((rows) => {
  for (const row of rows) insertStmt.run(row);
});

/** Finds the stored issue for an inline comment id, or undefined. */
export function getIssueByCommentId(commentId) {
  return db.prepare("SELECT * FROM issues WHERE comment_id = ?").get(commentId);
}

export function markRevealed(commentId) {
  db.prepare("UPDATE issues SET revealed = 1 WHERE comment_id = ?").run(commentId);
}

// ---------- conflicts (Phase 4) ----------

const insertConflictStmt = db.prepare(`
  INSERT OR REPLACE INTO conflicts
    (comment_id, repo, pr, other_pr, file, line, severity, summary, hint, fix, author)
  VALUES
    (@comment_id, @repo, @pr, @other_pr, @file, @line, @severity, @summary, @hint, @fix, @author)
`);

export const saveConflicts = db.transaction((rows) => {
  for (const row of rows) insertConflictStmt.run(row);
});

export function getConflictByCommentId(commentId) {
  return db.prepare("SELECT * FROM conflicts WHERE comment_id = ?").get(commentId);
}

export function markConflictRevealed(commentId) {
  db.prepare("UPDATE conflicts SET revealed = 1 WHERE comment_id = ?").run(commentId);
}

export function wasPairChecked(pairKey) {
  return Boolean(db.prepare("SELECT 1 FROM conflict_checks WHERE pair_key = ?").get(pairKey));
}

export function recordPairChecked(pairKey, conflictsFound) {
  db.prepare("INSERT OR REPLACE INTO conflict_checks (pair_key, conflicts_found) VALUES (?, ?)").run(pairKey, conflictsFound);
}

export function wasNoticeSent(repo, notifiedPr, mentionsPr) {
  return Boolean(
    db.prepare("SELECT 1 FROM conflict_notices WHERE repo = ? AND notified_pr = ? AND mentions_pr = ?").get(repo, notifiedPr, mentionsPr)
  );
}

export function recordNoticeSent(repo, notifiedPr, mentionsPr) {
  db.prepare("INSERT OR IGNORE INTO conflict_notices (repo, notified_pr, mentions_pr) VALUES (?, ?, ?)").run(repo, notifiedPr, mentionsPr);
}

export default db;
