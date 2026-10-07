// Local skill dashboard: one HTML page plus three read-only JSON endpoints.
// Probot 14 has no Express, so this is a plain Node (req, res) handler that
// index.js registers with addHandler. It returns true when it handled the
// request and false otherwise, so Probot's other handlers still run.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import db from "./db.js";
import { learnUrl } from "./concepts.js";

const PAGE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "dashboard.html");
const WEEKS_SHOWN = 12;

// ---------- queries ----------

/** Every author with how many issues they have had. */
function getStudents() {
  return db
    .prepare(
      `SELECT author, COUNT(*) AS issues, SUM(revealed) AS revealed, MAX(created_at) AS last_issue
       FROM issues GROUP BY author ORDER BY issues DESC, author`
    )
    .all();
}

/** The latest issues, optionally for one author. */
function getRecent(author) {
  const where = author ? "WHERE author = ?" : "";
  const sql = `SELECT comment_id, repo, pr, file, line, author, concept, severity, revealed, created_at
               FROM issues ${where} ORDER BY created_at DESC, id DESC LIMIT 20`;
  return author ? db.prepare(sql).all(author) : db.prepare(sql).all();
}

/** Everything the dashboard needs about one student. */
function getSkills(author) {
  const totals = db
    .prepare("SELECT COUNT(*) AS total, COALESCE(SUM(revealed), 0) AS revealed FROM issues WHERE author = ?")
    .get(author);

  // `recent` counts the last 30 days; SQLite stores booleans as 0/1, so SUM works.
  const concepts = db
    .prepare(
      `SELECT concept, COUNT(*) AS count,
              SUM(created_at >= datetime('now', '-30 days')) AS recent
       FROM issues WHERE author = ? GROUP BY concept ORDER BY count DESC, concept`
    )
    .all(author)
    .map((c) => ({ ...c, learnUrl: learnUrl(c.concept) }));

  const severity = { high: 0, medium: 0, low: 0 };
  const sevRows = db
    .prepare("SELECT severity, COUNT(*) AS count FROM issues WHERE author = ? GROUP BY severity")
    .all(author);
  for (const r of sevRows) severity[r.severity] = r.count;

  return {
    author,
    total: totals.total,
    revealed: totals.revealed,
    revealRate: totals.total ? totals.revealed / totals.total : 0,
    concepts,
    severity,
    weekly: getWeekly(author),
    weakAreas: getWeakAreas(concepts),
  };
}

/** Top 3 concepts: by the last 30 days if there is any, otherwise by all-time count. */
function getWeakAreas(concepts) {
  // "other" is too vague to be a useful weak area, so skip it unless it is all we have.
  const usable = concepts.filter((c) => c.concept !== "other");
  const pool = usable.length ? usable : concepts;
  const hasRecent = pool.some((c) => c.recent > 0);

  const ranked = [...pool]
    .sort((a, b) => (hasRecent ? b.recent - a.recent || b.count - a.count : b.count - a.count))
    .filter((c) => !hasRecent || c.recent > 0)
    .slice(0, 3);

  return ranked.map((c) => {
    const n = hasRecent ? c.recent : c.count;
    const noun = n === 1 ? "bug" : "bugs";
    return {
      concept: c.concept,
      count: n,
      learnUrl: c.learnUrl,
      sentence: hasRecent
        ? `You've had ${n} ${c.concept} ${noun} in the last 30 days.`
        : `You've had ${n} ${c.concept} ${noun} so far.`,
    };
  });
}

/** Issues per week (week starts Monday), with empty weeks filled in as 0 so the line is continuous. */
function getWeekly(author) {
  const rows = db
    .prepare(
      `SELECT date(created_at, 'weekday 0', '-6 days') AS week, COUNT(*) AS count
       FROM issues WHERE author = ? GROUP BY week ORDER BY week`
    )
    .all(author);
  if (rows.length === 0) return [];

  const counts = new Map(rows.map((r) => [r.week, r.count]));
  const DAY = 86400000;
  const thisWeek = db.prepare("SELECT date('now', 'weekday 0', '-6 days') AS w").get().w;
  const end = Date.parse(`${thisWeek}T00:00:00Z`);
  const firstIssue = Date.parse(`${rows[0].week}T00:00:00Z`);
  const start = Math.max(firstIssue, end - (WEEKS_SHOWN - 1) * 7 * DAY);

  const weekly = [];
  for (let t = start; t <= end; t += 7 * DAY) {
    const week = new Date(t).toISOString().slice(0, 10);
    weekly.push({ week, count: counts.get(week) || 0 });
  }
  return weekly;
}

// ---------- routing ----------

function sendJson(res, status, data) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(data));
}

export function dashboardHandler(req, res) {
  if (req.method !== "GET" && req.method !== "HEAD") return false;

  const url = new URL(req.url, "http://localhost");
  const route = url.pathname.replace(/\/+$/, "") || "/";

  try {
    if (route === "/dashboard") {
      // Read on every request so edits to the HTML show up on refresh without a restart.
      const html = fs.readFileSync(PAGE_PATH, "utf8");
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(html);
      return true;
    }
    if (route === "/api/students") {
      sendJson(res, 200, getStudents());
      return true;
    }
    if (route === "/api/recent") {
      sendJson(res, 200, getRecent(url.searchParams.get("author")));
      return true;
    }
    const skills = route.match(/^\/api\/students\/([^/]+)\/skills$/);
    if (skills) {
      sendJson(res, 200, getSkills(decodeURIComponent(skills[1])));
      return true;
    }
  } catch (err) {
    // Malformed URL escapes or a database problem: answer with an error instead of crashing.
    console.error("Dashboard error:", err.message);
    sendJson(res, err instanceof URIError ? 400 : 500, { error: "dashboard request failed" });
    return true;
  }
  return false;
}
