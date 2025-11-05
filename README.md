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

The static player lives in `public/player/index.html` and hydrates against `dist/player/main.js` (emitted by `npm run build`). To use it:

1. From the repo root run `npm run serve-player` and keep the process running. The helper script loads `.env`, writes `public/player/runtime-config.js` with `TORRENT_API_URL`, then serves the repository via `http://localhost:8080` so `/public/player/` and `/dist/player/main.js` resolve correctly.
2. Open the player with one of the supported query parameters:
   - `?job_id=<uuid>` – fetches job detail from the backend, uses the provided `s3_url` when valid, and falls back to the backend-managed `short_url`. Example: `http://localhost:8080/public/player/?job_id=330cb12ff57c46f0b43f6b17727b3b84` (replace the host with your deployment, e.g. `http://ec2-16-170-209-29.eu-north-1.compute.amazonaws.com:8080/public/player/?job_id=...`).
   - `?videoUrl=<https-url>` – direct HTTP(S) media link to stream in the browser. Example: `http://localhost:8080/public/player/?videoUrl=https%3A%2F%2Fexample.com%2Ffile.mp4`.

The player always prefers the runtime configuration and no longer reads `apiBase` query parameters; override the API base by editing `.env` before launching `npm run serve-player`.

Browser support matches the underlying media codecs: MP4/H.264 generally works everywhere, while containers such as MKV may require downloading the file and playing it locally.

Host `public/` behind a static web server to let users stream or download files without exposing raw S3 URLs.

For production deployments, you can serve the static assets behind an authenticated reverse proxy if you need additional access control (see `docs/player_proxy.md`).

## Data & Persistence

- Jobs: JSON file at `TORRENT_CLI_STATE_PATH` (default `.cache/torrent-cli/jobs.json`) written atomically.
- Cached presigns refresh automatically when the presigned link is within five minutes of expiry.

Delete the cache files if you need a clean slate; directories are created on demand.

## Documentation & Further Work

- REST API contract: `docs/backend_spec.md`
- Ink/service architecture notes: `docs/plan.md`
- Setup notes: `docs/notes.md`

Planned improvements include smarter polling/backoff, richer CLI shortcuts, and packaging the shared service layer for reuse by additional frontends.
