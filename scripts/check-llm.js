// Connectivity check: sends a tiny prompt to Groq and prints the reply.
// Usage: npm run check:llm

import { config, requireEnv, LLM_VARS } from "../src/config.js";
import { chat } from "../src/llm.js";

requireEnv(LLM_VARS);

console.log(`Model: ${config.groq.model}`);
console.log(`Endpoint: ${config.groq.baseUrl}\n`);

try {
  const started = Date.now();
  const reply = await chat(
    [{ role: "user", content: "Reply with one short sentence confirming you are online." }],
    { maxTokens: 50 }
  );
  console.log(`Reply (${Date.now() - started} ms): ${reply.trim()}`);
  console.log("\nGroq connection OK.");
} catch (err) {
  console.error(`Groq check failed: ${err.message}`);
  process.exit(1);
}
