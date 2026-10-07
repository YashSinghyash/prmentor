// LLM client. Groq exposes an OpenAI-compatible API, so a plain fetch to
// /chat/completions is enough; no SDK needed. To switch providers later,
// only this file should have to change.

import { config } from "./config.js";
import { REVIEW_SYSTEM_PROMPT, buildReviewUserPrompt } from "./prompts.js";

/** Error with a `kind` so callers can tell rate limits from bad output. */
export class LLMError extends Error {
  constructor(message, kind, status) {
    super(message);
    this.name = "LLMError";
    this.kind = kind; // "rate_limit" | "http" | "bad_json"
    this.status = status;
  }
}

/**
 * Sends a chat request and returns the reply text.
 * `messages` uses the OpenAI format: [{ role: "system" | "user", content: "..." }]
 */
export async function chat(messages, { temperature = 0.2, maxTokens = 512, json = false, extra = {} } = {}) {
  const body = {
    model: config.groq.model,
    messages,
    temperature,
    max_tokens: maxTokens,
    ...extra,
  };
  // JSON mode: the API guarantees the reply is a JSON object.
  if (json) body.response_format = { type: "json_object" };

  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groq.apiKey}`,
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    // Groq returns a JSON error body; include it so failures are easy to diagnose.
    const text = await res.text();
    if (res.status === 429) {
      const wait = res.headers.get("retry-after");
      throw new LLMError(
        `Groq rate limit hit (429)${wait ? `, retry after ${wait}s` : ""}. ${text}`,
        "rate_limit",
        429
      );
    }
    throw new LLMError(`LLM request failed (${res.status} ${res.statusText}): ${text}`, "http", res.status);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Pulls a JSON object out of model output. Reasoning models sometimes add
 * text or ```json fences around the answer, so we try a straight parse first,
 * then fall back to the first balanced {...} block in the text.
 */
export function extractJson(text) {
  if (!text) throw new Error("empty reply");
  const cleaned = text.replace(/```(?:json)?/gi, "").trim();

  try {
    return JSON.parse(cleaned);
  } catch {
    // fall through to the scan below
  }

  // Scan for a balanced {...}, skipping braces that appear inside strings.
  for (let start = cleaned.indexOf("{"); start !== -1; start = cleaned.indexOf("{", start + 1)) {
    let depth = 0;
    let inString = false;
    for (let i = start; i < cleaned.length; i++) {
      const ch = cleaned[i];
      if (inString) {
        if (ch === "\\") i++; // skip the escaped character
        else if (ch === '"') inString = false;
      } else if (ch === '"') inString = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          return JSON.parse(cleaned.slice(start, i + 1));
        } catch {
          break; // not valid JSON, try the next "{"
        }
      }
    }
  }
  throw new Error("no valid JSON object found in reply");
}

const SEVERITIES = ["high", "medium", "low"];

/** Keeps only well-formed issues and fixes up small mistakes (e.g. "42" as a string). */
function cleanIssues(raw) {
  if (!Array.isArray(raw)) return [];
  const issues = [];
  for (const i of raw) {
    const line = Number(i?.line);
    if (typeof i?.file !== "string" || !Number.isInteger(line)) continue;
    if (typeof i?.message !== "string" || !i.message.trim()) continue;
    const severity = String(i.severity || "").toLowerCase();
    issues.push({
      file: i.file.trim(),
      line,
      severity: SEVERITIES.includes(severity) ? severity : "medium",
      concept: typeof i.concept === "string" && i.concept.trim() ? i.concept.trim() : "code quality",
      message: i.message.trim(),
    });
  }
  return issues;
}

/**
 * Reviews a diff and returns { issues: [{ file, line, severity, concept, message }] }.
 * `diff` is the annotated diff text; `note` says what was left out.
 * Throws LLMError on rate limits, HTTP errors, or unparseable output.
 */
export async function review(diff, note = "") {
  const reply = await chat(
    [
      { role: "system", content: REVIEW_SYSTEM_PROMPT },
      { role: "user", content: buildReviewUserPrompt(diff, note) },
    ],
    {
      json: true,
      // gpt-oss is a reasoning model: its "thinking" tokens count toward this limit,
      // so it needs far more than the visible answer alone would.
      maxTokens: 6000,
      // "low" keeps reasoning short, which saves tokens and rate limit.
      extra: { reasoning_effort: "low" },
    }
  );

  let parsed;
  try {
    parsed = extractJson(reply);
  } catch (err) {
    throw new LLMError(`Model returned unparseable output (${err.message}): ${reply.slice(0, 200)}`, "bad_json");
  }
  return { issues: cleanIssues(parsed.issues) };
}
