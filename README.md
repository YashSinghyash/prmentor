# PRMentor

A GitHub App that reviews pull requests for students. Instead of handing over the fix, it gives a Socratic hint first and teaches the concept behind each issue.

Everything runs on your machine. GitHub reaches it through a free [smee.io](https://smee.io) tunnel, and the LLM is Groq's free API.

> **Status: Phase 0 (setup).** The app receives pull request webhooks and logs them. Reviewing comes in Phase 1.

## Requirements

- Node.js 20.18+ (22 or 24 recommended)
- A GitHub account and a test repository you own
- A free Groq API key from https://console.groq.com/keys

## Setup

### 1. Install dependencies

```bash
npm install
cp .env.example .env
```

### 2. Create a smee.io channel

1. Open https://smee.io and click **Start a new channel**.
2. Copy the channel URL (looks like `https://smee.io/AbC123xyz`).
3. Put it in `.env` as `WEBHOOK_PROXY_URL`.

Smee relays GitHub's webhooks to `localhost`, so you don't need a public server. Probot starts the smee client for you whenever `WEBHOOK_PROXY_URL` is set; no separate command is needed.

### 3. Create the GitHub App

Go to **GitHub → Settings → Developer settings → GitHub Apps → New GitHub App** (https://github.com/settings/apps/new):

| Field | Value |
| --- | --- |
| GitHub App name | Something unique, e.g. `prmentor-<your-username>` |
| Homepage URL | Any URL, e.g. your repo URL |
| Webhook → Active | ✅ checked |
| Webhook URL | Your smee URL from step 2 |
| Webhook secret | A random string, e.g. the output of `openssl rand -hex 20`. Put the same value in `.env` as `WEBHOOK_SECRET` |

**Repository permissions:**

- **Pull requests:** Read & write
- **Contents:** Read-only
- **Metadata:** Read-only (GitHub selects this automatically)

**Subscribe to events:** check **Pull request**.

**Where can this GitHub App be installed?** "Only on this account" is fine.

Click **Create GitHub App**. On the next page, copy the **App ID** into `.env` as `APP_ID`.

### 4. Generate the private key

1. On the app's settings page, scroll to **Private keys** and click **Generate a private key**. A `.pem` file downloads.
2. Move it into the project folder and rename it:
   ```bash
   mv ~/Downloads/<your-app-name>.*.private-key.pem ./private-key.pem
   ```
3. Make sure `.env` has `PRIVATE_KEY_PATH=./private-key.pem`.

`*.pem` and `.env` are in `.gitignore`. Never commit them.

### 5. Install the app on a test repo

On the app's settings page, click **Install App**, choose your account, select **Only select repositories**, and pick your test repo.

### 6. Add your Groq key

Put your key in `.env` as `GROQ_API_KEY`. To try a different model, change `GROQ_MODEL` (default `openai/gpt-oss-120b`).

## Running

Check that Groq works:

```bash
npm run check:llm
```

Start the app (restarts automatically when you edit files):

```bash
npm run dev
```

Then open, update or reopen a pull request in your test repo. The terminal should print something like:

```
INFO (event): webhook received: pull_request.opened
    repo: "you/test-repo"
    pr: 1
    title: "Add login form"
    author: "you"
    changedFiles: 3
```

If any required variable is missing, the app stops at startup and lists what to fix.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | Start the app and restart it on file changes (`node --watch`) |
| `npm start` | Start the app once |
| `npm run check:llm` | Send a tiny test prompt to Groq and print the reply |

## Project layout

```
src/
  index.js     Probot app: webhook handlers and server start-up
  llm.js       Groq client (chat) and the review(diff) entry point
  config.js    Loads .env and validates required variables
scripts/
  check-llm.js Groq connectivity check
```

## Troubleshooting

- **No log line when a PR opens:** in the app settings, open **Advanced → Recent Deliveries** to see whether GitHub sent the webhook, and check that the smee URL in the app matches `WEBHOOK_PROXY_URL`.
- **`signature does not match`:** `WEBHOOK_SECRET` in `.env` differs from the one in the app settings.
- **Groq `401`:** the API key is wrong. **`404` / model error:** the `GROQ_MODEL` name is wrong or retired; see https://console.groq.com/docs/models.
