// LLM client. Groq exposes an OpenAI-compatible API, so a plain fetch to
// /chat/completions is enough; no SDK needed. To switch providers later,
// only this file should have to change.

import { config } from "./config.js";

/**
 * Sends a chat request and returns the reply text.
 * `messages` uses the OpenAI format: [{ role: "system" | "user", content: "..." }]
 */
export async function chat(messages, { temperature = 0.2, maxTokens = 512 } = {}) {
  const res = await fetch(`${config.groq.baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${config.groq.apiKey}`,
    },
    body: JSON.stringify({
      model: config.groq.model,
      messages,
      temperature,
      max_tokens: maxTokens,
    }),
  });

  if (!res.ok) {
    // Groq returns a JSON error body; include it so failures are easy to diagnose.
    const body = await res.text();
    throw new Error(`LLM request failed (${res.status} ${res.statusText}): ${body}`);
  }

  const data = await res.json();
  return data.choices?.[0]?.message?.content ?? "";
}

/**
 * Reviews a PR diff. PLACEHOLDER for Phase 0: the real prompt and
 * structured output (issues, concept tags, hints) come in Phase 1.
 */
export async function review(diff) {
  void diff; // unused until Phase 1
  return { issues: [] };
}
