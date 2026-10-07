// Loads environment variables from .env and checks that the required ones exist.
// Every other file reads settings from here instead of touching process.env directly.

import fs from "node:fs";
import dotenv from "dotenv";

// quiet: true stops dotenv from printing its own banner on every start.
dotenv.config({ quiet: true });

// Variables the GitHub App server needs. Probot itself also reads these names.
export const GITHUB_VARS = ["APP_ID", "PRIVATE_KEY_PATH", "WEBHOOK_SECRET", "WEBHOOK_PROXY_URL"];

// Variables the LLM client needs.
export const LLM_VARS = ["GROQ_API_KEY"];

export const config = {
  appId: process.env.APP_ID,
  privateKeyPath: process.env.PRIVATE_KEY_PATH,
  webhookSecret: process.env.WEBHOOK_SECRET,
  webhookProxyUrl: process.env.WEBHOOK_PROXY_URL,
  port: Number(process.env.PORT) || 3000,
  groq: {
    apiKey: process.env.GROQ_API_KEY,
    baseUrl: process.env.GROQ_BASE_URL || "https://api.groq.com/openai/v1",
    model: process.env.GROQ_MODEL || "openai/gpt-oss-120b",
  },
};

/**
 * Exits the process with a readable message if any of `names` are missing.
 * Failing fast here is easier to debug than a cryptic error deep inside Probot.
 */
export function requireEnv(names) {
  const missing = names.filter((name) => !process.env[name] || !process.env[name].trim());
  const problems = missing.map((name) => `  - ${name} is not set`);

  // A path that is set but points nowhere is a common mistake, so check it too.
  const keyPath = process.env.PRIVATE_KEY_PATH;
  if (names.includes("PRIVATE_KEY_PATH") && keyPath && !fs.existsSync(keyPath)) {
    problems.push(`  - PRIVATE_KEY_PATH points to "${keyPath}", but that file does not exist`);
  }

  if (problems.length > 0) {
    console.error("\n[PRMentor] Configuration error:\n" + problems.join("\n"));
    console.error("\nCopy .env.example to .env and fill in the values (see README.md).\n");
    process.exit(1);
  }
}
