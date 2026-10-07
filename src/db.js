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

export default db;
