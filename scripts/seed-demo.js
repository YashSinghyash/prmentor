// Fills data/demo.db with believable fake history so the dashboard can be demoed.
// Usage:  npm run seed
//         DB_PATH=data/demo.db npm run dev
//
// It ONLY ever writes to data/demo.db, and refuses to run if that path would be the real database.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const demoPath = path.join(root, "data", "demo.db");
const realPath = path.join(root, "data", "prmentor.db");

if (path.resolve(demoPath) === path.resolve(realPath)) {
  console.error("Refusing to seed: target is the real database.");
  process.exit(1);
}

// Start from an empty file so running the seed twice gives the same result.
// (WAL side files are removed too; SQLite recreates them.)
fs.mkdirSync(path.dirname(demoPath), { recursive: true });
for (const suffix of ["", "-wal", "-shm", "-journal"]) fs.rmSync(demoPath + suffix, { force: true });

// db.js opens whatever config.dbPath says, so point it at the demo file BEFORE importing.
process.env.DB_PATH = demoPath;
const { default: db, saveIssues } = await import("../src/db.js");

// ---------- the story ----------
// Weeks go oldest -> newest (index 5 = this week). Each entry is { concept: count }.
// aisha-k is the headline student: null-check is her weak area, and it improves.
const HISTORY = {
  "aisha-k": [
    { "null-check": 4, "sql-injection": 3, "hardcoded-secret": 2, "input-validation": 2, "error-handling": 1 },
    { "null-check": 4, "sql-injection": 2, "input-validation": 2, "error-handling": 2, "hardcoded-secret": 1 },
    { "null-check": 3, "sql-injection": 1, "input-validation": 2, "error-handling": 1 },
    { "null-check": 3, "input-validation": 2, "error-handling": 1, "off-by-one": 1 },
    { "null-check": 2, "input-validation": 1, "error-handling": 1 },
    { "null-check": 1, "input-validation": 1 },
  ],
  "ben-torres": [
    { "sql-injection": 4, xss: 3, "hardcoded-secret": 2, "input-validation": 1 },
    { "sql-injection": 3, xss: 3, "input-validation": 2, "hardcoded-secret": 1 },
    { "sql-injection": 3, xss: 2, "input-validation": 1 },
    { "sql-injection": 2, xss: 2, "auth-check": 1 },
    { "sql-injection": 1, xss: 1, "input-validation": 1 },
    { xss: 1, "sql-injection": 1 },
  ],
  "chloe-w": [
    { "off-by-one": 2, "resource-leak": 2, "error-handling": 1 },
    { "off-by-one": 1, "resource-leak": 2 },
    { "off-by-one": 1, "error-handling": 1 },
    { "resource-leak": 1 },
    { other: 1 },
    {},
  ],
  "dev-patel": [
    {},
    {},
    { "error-handling": 3, "null-check": 2, "race-condition": 1 },
    { "error-handling": 3, "null-check": 1, "command-injection": 1 },
    { "error-handling": 2, "null-check": 1 },
    { "error-handling": 1 },
  ],
};

const REPOS = ["cs101-demo/todo-api", "cs101-demo/blog-app", "cs101-demo/chat-server"];

const SEVERITY = {
  "sql-injection": "high",
  "command-injection": "high",
  xss: "high",
  "hardcoded-secret": "high",
  "auth-check": "high",
  "null-check": "medium",
  "input-validation": "medium",
  "error-handling": "medium",
  "off-by-one": "medium",
  "race-condition": "medium",
  "resource-leak": "low",
  other: "low",
};

const FILES = {
  "sql-injection": ["src/db/users.js", "src/routes/search.js"],
  "command-injection": ["src/utils/export.js"],
  xss: ["src/views/comments.js", "public/app.js"],
  "hardcoded-secret": ["src/config.js", "src/mailer.js"],
  "null-check": ["src/services/profile.js", "src/routes/orders.js"],
  "input-validation": ["src/routes/signup.js", "src/routes/todos.js"],
  "error-handling": ["src/services/payment.js", "src/api/client.js"],
  "off-by-one": ["src/utils/paginate.js", "src/utils/array.js"],
  "resource-leak": ["src/files/upload.js"],
  "race-condition": ["src/services/counter.js"],
  "auth-check": ["src/routes/admin.js"],
  other: ["src/utils/misc.js"],
};

// Short placeholder hint/fix text (the columns are NOT NULL).
const HINT = {
  "sql-injection": "What happens if this value contains a quote character?",
  "command-injection": "Who controls the string passed to the shell here?",
  xss: "What if a user's name contains a script tag?",
  "hardcoded-secret": "What happens to this key once the repo is public?",
  "null-check": "What does this return when the record doesn't exist?",
  "input-validation": "What if the request body is empty or the wrong type?",
  "error-handling": "What happens to the caller when this call fails?",
  "off-by-one": "Trace the loop by hand: which index runs last?",
  "resource-leak": "Is this file closed on every path, including errors?",
  "race-condition": "What if two requests run this at the same moment?",
  "auth-check": "Who is allowed to call this route?",
  other: "Walk through this line with an unusual input. What breaks?",
};

// Small deterministic random generator so the demo data is the same every run.
function mulberry32(seed) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = mulberry32(2024);
const pick = (list) => list[Math.floor(rand() * list.length)];

/** "YYYY-MM-DD HH:MM:SS" in UTC, the same format SQLite's datetime('now') uses. */
const sqlDate = (d) => d.toISOString().slice(0, 19).replace("T", " ");

// ---------- build rows ----------
const now = new Date();
const DAY = 86400000;
// Monday 00:00 UTC of the current week
const thisMonday = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
thisMonday.setTime(thisMonday.getTime() - ((now.getUTCDay() + 6) % 7) * DAY);

const rows = [];
let commentId = 9000000;

for (const [author, weeks] of Object.entries(HISTORY)) {
  const repo = REPOS[Object.keys(HISTORY).indexOf(author) % REPOS.length];
  weeks.forEach((concepts, w) => {
    const weekStart = thisMonday.getTime() - (weeks.length - 1 - w) * 7 * DAY;
    // Students ask for the answer less often as they improve: ~70% early, ~25% now.
    const revealChance = 0.7 - 0.09 * w;
    let prInWeek = 0;

    for (const [concept, count] of Object.entries(concepts)) {
      for (let i = 0; i < count; i++) {
        // random time within the week, never in the future
        const when = Math.min(weekStart + rand() * 7 * DAY, now.getTime() - 60000);
        // mostly the usual severity, occasionally one step off
        let severity = SEVERITY[concept];
        if (rand() < 0.15) severity = severity === "high" ? "medium" : "low";

        rows.push({
          comment_id: commentId++,
          repo,
          pr: 1 + w * 2 + (prInWeek++ % 2),
          file: pick(FILES[concept]),
          line: 5 + Math.floor(rand() * 115),
          concept,
          severity,
          hint: HINT[concept],
          fix: `Demo fix for ${concept}.`,
          author,
          created_at: sqlDate(new Date(when)),
          revealed: rand() < revealChance ? 1 : 0,
        });
      }
    }
  });
}

// saveIssues does not set created_at/revealed, so insert these demo rows directly.
const insert = db.prepare(`
  INSERT INTO issues (comment_id, repo, pr, file, line, concept, severity, hint, fix, revealed, author, created_at)
  VALUES (@comment_id, @repo, @pr, @file, @line, @concept, @severity, @hint, @fix, @revealed, @author, @created_at)
`);
db.transaction(() => rows.forEach((r) => insert.run(r)))();
void saveIssues; // imported only so db.js creates the schema; the real insert is above

const summary = db
  .prepare("SELECT author, COUNT(*) AS issues, SUM(revealed) AS revealed FROM issues GROUP BY author ORDER BY issues DESC")
  .all();
console.log(`Seeded ${rows.length} fake issues into ${path.relative(process.cwd(), demoPath)}`);
console.table(summary);
console.log("Run the dashboard on it with:\n  DB_PATH=data/demo.db npm run dev\nthen open http://localhost:3000/dashboard");
db.close();
