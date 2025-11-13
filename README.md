# Torrent Frontend Toolkit

## About

Frontend for searching, downloading and watching films legally via fast S3 infrastructure. It has command line interface, Telegram bot and web player.

It searches torrents and uploads them on S3 storage. User can download a film using S3 HTTPS link, stream it online and broadcast via AirPlay. It's written on Node.js 20+ runtime with a TypeScript codebase executed via tsx. The CLI is built on Ink 6 with React 19. Telegram bot layer is powered by telegraf, reusing the same service context as the CLI.

The shared TypeScript service layer powers:

- An Ink 6 CLI (`npm run cli`) for search/queue management. The CLI runs in admin mode and can inspect jobs created by every Telegram user.
- A Telegram bot (`npm run bot`) that lets individual users manage their own jobs.

The backend contract lives in `docs/backend_spec.md`.

## Docker Quick Start

Docker Compose is the recommended way to run the bot and player without installing Node on the host.

```bash
cp .env.example .env
# edit .env with your API endpoint, token, and optional overrides
docker compose up -d            # or: make up
```

- `docker compose logs -f telegram-bot` (or `make logs S=telegram-bot`) tails the bot.
- `docker compose logs -f player` exposes player logs; the UI is at http://localhost:8080.
- `docker compose down` (or `make down`) stops and removes the containers.

Compose mounts the workspace and runs `npm install` inside each service, so code edits on the host are reflected immediately.

## Prerequisites

Skip this section if you use Docker; it's only required for manual host deployments.

- Node.js 20+ (Ink 6 and `tsx` require the current LTS toolchain).
- npm (bundled with Node).

## Installation

```bash
npm install
cp .env.example .env
# edit .env with your API endpoint, token, and optional overrides
```

Environment variables are documented inline in `.env.example`; copy it and adjust values for your deployment. Add secrets such as `TORRENT_TELEGRAM_BOT_TOKEN` to `.env` (or export them) before running any scripts.

### Install npm

```
curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.nvm/nvm.sh
nvm install --lts   # installs current LTS Node and the matching npm
nvm use --lts
```

## Core Scripts

| Command | Purpose |
| --- | --- |
| `npm run cli` | Start the Ink CLI via `tsx src/cli.tsx`. |
| `npm run bot` | Launch the Telegram bot (requires `TORRENT_TELEGRAM_BOT_TOKEN`). |
| `npm run test` | Run the full TypeScript test suite via `tsx --test`. |
| `npm run build` | Type-check and emit compiled JS to `dist/`. |
| `npm run lint` | TypeScript strictness check (`tsc --noEmit`). |

All runtime scripts load configuration from `loadConfig()` so the same `.env` drives the CLI and bot.

## Usage

- CLI: run `npm run cli` for interactive search and download management.
- Telegram bot: export `TORRENT_TELEGRAM_BOT_TOKEN` and run `npm run bot` to expose the same job state via Telegram chats.
