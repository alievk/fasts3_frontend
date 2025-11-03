# Torrent Frontend Toolkit

Multi-channel frontend for the torrent downloader stack. The shared TypeScript service layer powers:

- An Ink 6 CLI (`npm run cli`) for search/queue management.
- A Telegram bot (`npm run bot`) that mirrors the same job state.
- A lightweight browser player (`public/player`) that streams completed jobs.

The backend contract lives in `docs/backend_spec.md`.

## Prerequisites

- Node.js 20+ (Ink 6 and `tsx` require the current LTS toolchain).
- npm (bundled with Node).

## Installation

```bash
npm install
cp .env.example .env
# edit .env with your API endpoint, token, and optional overrides
```

Environment variables are documented inline in `.env.example`; copy it and adjust values for your deployment.

## Core Scripts

| Command | Purpose |
| --- | --- |
| `npm run cli` | Start the Ink CLI via `tsx src/cli.tsx`. |
| `npm run bot` | Launch the Telegram bot (requires `TORRENT_TELEGRAM_BOT_TOKEN`). |
| `npm run build` | Type-check and emit compiled JS to `dist/`. |
| `npm run lint` | TypeScript strictness check (`tsc --noEmit`). |

All runtime scripts load configuration from `loadConfig()` so the same `.env` drives the CLI and bot.

## CLI Experience

```bash
npm run cli
```

- Main menu exposes **Search**, **Jobs**, and **Exit**.
- Type a query and press Enter to search; select a result to start a download job.
- Jobs list displays progress, size, and status. Selecting a job opens detail view with delete/back actions.
- Completed jobs expose the backend-provided download link (short URL or direct S3) and allow copying it with the `c` shortcut.
- Errors surface at the bottom of the UI; fix configuration or backend issues and retry with Enter.

Local state persists under `TORRENT_CLI_STATE_PATH`, so jobs survive restarts. The poller keeps queued/downloading jobs in sync and refreshes presigned links as they near expiry.

## Telegram Bot

```bash
export TORRENT_TELEGRAM_BOT_TOKEN=<bot-token>
npm run bot
```

- `ensureBootstrapped()` loads cached jobs, performs a backend health check, and starts the shared poller.
- `/search <query>` responds with paginated inline buttons; tapping a result triggers download creation.
- `/jobs` lists known jobs with detail/delete actions; updates broadcast to active chats.
- Redirect links surface automatically once the backend exposes a presigned URL.

The bot uses the same job store and download service as the CLI, so both interfaces remain consistent.

## Browser Player

The static player lives in `public/player/index.html` and hydrates against `dist/player/main.js` (emitted by `npm run build`). Launch it with:

- `?job_id=<uuid>` – fetches job detail from the backend, refreshes the presigned link if necessary, and streams it directly.
- `?videoUrl=<https-url>` – direct HTTP(S) media link to stream in the browser.
- Quick local hosting: `npm run serve-player` (wraps `npx http-server`) exposes the repo root at `http://localhost:8080`, so `/public/player/` and `/dist/player/main.js` load correctly.

Host `public/` behind a static web server to let users stream or download files without exposing raw S3 URLs.

## Data & Persistence

- Jobs: JSON file at `TORRENT_CLI_STATE_PATH` (default `.cache/torrent-cli/jobs.json`) written atomically.
- Cached presigns refresh automatically when the presigned link is within five minutes of expiry.

Delete the cache files if you need a clean slate; directories are created on demand.

## Documentation & Further Work

- REST API contract: `docs/backend_spec.md`
- Ink/service architecture notes: `docs/plan.md`
- Setup notes: `docs/notes.md`

Planned improvements include smarter polling/backoff, richer CLI shortcuts, and packaging the shared service layer for reuse by additional frontends.
