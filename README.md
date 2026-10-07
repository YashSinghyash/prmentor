# PRMentor

A GitHub App that reviews pull requests for students. Instead of handing over the fix, it gives a Socratic hint first and teaches the concept behind each issue.

Everything runs on your machine. GitHub reaches it through a free [smee.io](https://smee.io) tunnel, and the LLM is Groq's free API.

> **Status: Phase 3 (skill dashboard).** The app reviews PRs and posts inline *hints* (not answers). Reply `/fix` to reveal the full solution. A local dashboard shows each student's weak areas.

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

**Subscribe to events:** check **Pull request** and **Pull request review comment** (the second one lets the app see your `/fix` replies).

> Already created the app in an earlier phase? Open the app's settings → **Permissions & events** → **Subscribe to events**, tick **Pull request review comment**, and save. No new permissions are needed (replying in a thread uses *Pull requests: Read & write*), so you don't have to re-approve the installation.

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
| `npm run seed` | Create `data/demo.db` with fake history for the dashboard |

## How teaching mode works

1. Open a PR. PRMentor posts one review with inline comments. Each comment shows a severity badge, a concept tag (like `sql-injection`), a Socratic hint, and a Microsoft Learn link.
2. Think about the hint and try fixing it yourself.
3. Stuck? Reply `/fix` (or "show fix") in that comment's thread. PRMentor replies with the full explanation and corrected code.

Issues and fixes are stored in a local SQLite file, `data/prmentor.db` (ignored by git). Delete it to start fresh.

## Skill dashboard

With the app running (`npm run dev`), open **http://localhost:3000/dashboard**. It reads `data/prmentor.db` and shows, per student: the top 3 weak areas (last 30 days) with Microsoft Learn links, issues per concept, issues per week, how often the full answer was revealed, and the latest issues with links to each PR. It refreshes itself every 15 seconds.

It is served by the same process as the webhook, on `localhost` only. There is no login, so don't set `HOST=0.0.0.0` unless you want others on your network to see it. Chart.js loads from a CDN, so the charts need internet access.

JSON endpoints: `GET /api/students`, `GET /api/students/:author/skills`, `GET /api/recent` (optionally `?author=name`).

### Demo data

To show the dashboard without real PRs, fill a separate database with fake history (4 students, 6 weeks, improving over time):

```bash
npm run seed
DB_PATH=data/demo.db npm run dev
```

`npm run seed` only writes `data/demo.db` and recreates it from scratch each time; it never touches `data/prmentor.db`. Run `npm run dev` without `DB_PATH` to go back to real data. (The PR links in demo data point at made-up repos.)

## Project layout

```
src/
  index.js     Probot app: webhook handlers and server start-up
  reviewer.js  Fetches the diff, calls the LLM, posts the review, saves issues
  fix.js       Handles "/fix" replies and reveals the stored solution
  llm.js       Groq client (chat) and the review(diff) entry point
  prompts.js   The system prompt (edit this to change review behaviour)
  concepts.js  The fixed list of concept tags
  diff.js      Filters files and builds the size-limited diff prompt
  db.js        SQLite storage (data/prmentor.db, or DB_PATH)
  dashboard.js Dashboard page and JSON endpoints
  dashboard.html The dashboard page (HTML + Chart.js from a CDN)
  config.js    Loads .env and validates required variables
scripts/
  check-llm.js Groq connectivity check
  seed-demo.js Fills data/demo.db with fake history
```

## Troubleshooting

- **No log line when a PR opens:** in the app settings, open **Advanced → Recent Deliveries** to see whether GitHub sent the webhook, and check that the smee URL in the app matches `WEBHOOK_PROXY_URL`.
- **`signature does not match`:** `WEBHOOK_SECRET` in `.env` differs from the one in the app settings.
- **Groq `401`:** the API key is wrong. **`404` / model error:** the `GROQ_MODEL` name is wrong or retired; see https://console.groq.com/docs/models.
