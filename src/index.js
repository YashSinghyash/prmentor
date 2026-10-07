// PRMentor entry point: validates config, then starts the Probot server.
// Probot reads APP_ID, PRIVATE_KEY_PATH, WEBHOOK_SECRET, WEBHOOK_PROXY_URL
// and PORT from the environment, and starts the smee tunnel when
// WEBHOOK_PROXY_URL is set.

import { pathToFileURL } from "node:url";
import { run } from "probot";
import { requireEnv, GITHUB_VARS, LLM_VARS } from "./config.js";

const PR_EVENTS = ["pull_request.opened", "pull_request.synchronize", "pull_request.reopened"];

/** The Probot app: registers webhook handlers. */
export default function app(probot) {
  probot.on(PR_EVENTS, async (context) => {
    const { action, pull_request: pr, repository } = context.payload;

    // changed_files is included in the webhook payload, so no extra API call is needed.
    context.log.info(
      {
        repo: repository.full_name,
        pr: pr.number,
        title: pr.title,
        author: pr.user.login,
        changedFiles: pr.changed_files,
      },
      `webhook received: pull_request.${action}`
    );
  });

  probot.log.info("PRMentor is listening for pull_request events");
}

// Only start the server when this file is run directly (not when imported by tests later).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  requireEnv([...GITHUB_VARS, ...LLM_VARS]);
  run(app);
}
