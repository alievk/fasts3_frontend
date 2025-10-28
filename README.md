# Torrent Frontend Toolkit

Multi-channel frontend for the torrent downloader stack. The shared TypeScript service layer powers:

- An Ink 6 CLI (`npm run cli`) for search/queue management.
- A Telegram bot (`npm run bot`) that mirrors the same job state.
- A Fastify redirect server (`npm run redirect-server`) backed by SQLite for durable presigned shortcuts.
- Utility scripts to register/list presigned links and a lightweight browser player (`public/player`) that consumes redirect metadata.

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
| `npm run redirect-server` | Serve presigned shortcuts and admin endpoints on the configured host/port. |
| `npm run register-presign <btih> <url> <expires>` | Manually register or refresh a redirect entry (expires accepts seconds or ISO timestamp). |
| `npm run list-presigns` | Inspect active shortcuts via the admin API. |
| `npm run build` | Type-check and emit compiled JS to `dist/`. |
| `npm run lint` | TypeScript strictness check (`tsc --noEmit`). |

All runtime scripts load configuration from `loadConfig()` so the same `.env` drives CLI, bot, and redirect services.

## CLI Experience

```bash
npm run cli
```

- Main menu exposes **Search**, **Jobs**, and **Exit**.
- Type a query and press Enter to search; select a result to start a download job.
- Jobs list displays progress, size, and status. Selecting a job opens detail view with delete/back actions.
- Completed jobs expose their redirect URL, direct S3 link (when available), and allow copying the link with the `c` shortcut.
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

## Redirect Server & Presigned Shortcuts

```bash
npm run redirect-server
```

- Stores shortcut state in SQLite (`TORRENT_REDIRECT_DB_PATH`) and exposes admin/user endpoints for creating and following presigned link shortcuts.
- `DownloadService.syncJob()` registers or refreshes shortcuts automatically when jobs complete, provided the redirect server is reachable.

See `docs/redirect_server.md` for detailed API documentation and operational guidance.

## Browser Player

The static player lives in `public/player/index.html` and hydrates against `dist/player/main.js` (emitted by `npm run build`). Launch it with:

- `?videoUrl=<https-url>` – direct HTTP(S) media link to stream in the browser.
- Quick local hosting: `npm run serve-player` (wraps `npx http-server`) exposes the repo root at `http://localhost:8080`, so `/public/player/` and `/dist/player/main.js` load correctly.

Host `public/` behind a static web server (or integrate with the redirect server) to let users stream or download files without exposing raw S3 URLs.

## Data & Persistence

- Jobs: JSON file at `TORRENT_CLI_STATE_PATH` (default `.cache/torrent-cli/jobs.json`) written atomically.
- Redirect registry: SQLite database at `TORRENT_REDIRECT_DB_PATH`.
- Cached presigns/redirect metadata refresh automatically when the presigned link is within five minutes of expiry.

Delete the cache files if you need a clean slate; directories are created on demand.

## Documentation & Further Work

- REST API contract: `docs/backend_spec.md`
- Ink/service architecture notes: `docs/plan.md`
- Redirect operations guide: `docs/redirect_server.md`
- Setup notes: `docs/notes.md`

Planned improvements include smarter polling/backoff, richer CLI shortcuts, and packaging the shared service layer for reuse by additional frontends.
