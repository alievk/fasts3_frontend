# Torrent CLI (Mocked)

Minimal Ink-based CLI that follows the structure from `.llm/plan.md` while mocking all backend interactions. The goal is to validate flow and refine the plan before wiring the real REST API. Built with Ink 6 / React 18.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```
2. Run the CLI in watch mode:
   ```bash
   npm run dev
   ```

> **Note:** Network calls are mocked via `MockApiClient`. Jobs persist locally under `.cache/torrent-cli/jobs.json` (override with `TORRENT_CLI_STATE_PATH`). Ink 6 requires Node.js 20+ to run the CLI.

## Current Behaviour

- Search for torrents by typing a query and pressing `Enter`. A mocked result set is displayed.
- Select a torrent to simulate job creation. Downloads appear in the tracker with evolving progress.
- Polling updates each job automatically; completed jobs show an S3-style link.
- Use arrow keys to highlight a job and press `D` to delete it locally and via the mock backend.

## Next Steps

- Replace `MockApiClient` with real REST implementation described in `.llm/plan.md`.
- Extend job polling backoff and error handling once real error codes are available.
- Share the service layer (`downloadService`, `jobStore`) with incoming Telegram and web frontends.
