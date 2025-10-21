# Torrent CLI

Minimal Ink-based CLI that follows the structure from `.llm/plan.md` while calling the REST API described in `.llm/backend_spec.md`. Built with Ink 6 / React 18.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the CLI in watch mode:
   ```bash
   npm run cli
   ```

> **Note:** Configure `TORRENT_API_URL` (defaults to `https://mock.torrent-service.local`) and `TORRENT_API_TOKEN` for authenticated requests. Jobs persist locally under `.cache/torrent-cli/jobs.json` (override with `TORRENT_CLI_STATE_PATH`). Ink 6 requires Node.js 20+.

## Telegram Bot

1. Export your bot token along with the existing API variables:
   ```bash
   export TORRENT_TELEGRAM_BOT_TOKEN=<bot-token>
   ```
2. Launch the bot:
   ```bash
   npm run bot
   ```

The bot reuses the shared service layer, so job state stays in sync with the CLI (same cache path, polling, and backend configuration).

- `/search <query>` — search torrents and start downloads from inline results.
- `/jobs` — list saved jobs with buttons to view details or delete them.

## Current Behaviour

- Search for torrents by typing a query and pressing `Enter`; results come from the configured backend.
- Select a torrent to create a download job. Jobs appear in the tracker with progress as the backend updates them.
- Polling refreshes each job automatically; completed jobs show the provided S3 link.
- Use arrow keys to highlight a job and press `D` to delete it locally and on the backend.

## Next Steps

- Add smarter polling/backoff once backend limits and error patterns are clearer.
- Share the service layer (`downloadService`, `jobStore`) with incoming Telegram and web frontends.
- Polish the Ink UI with richer status messaging and shortcuts (open S3 link, retry actions).
