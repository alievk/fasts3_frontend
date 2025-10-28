# Redirect Server Guide

## Purpose
- Serve stable, human-friendly shortcuts for presigned S3 downloads.
- Persist active shortcuts in SQLite so restarts do not invalidate links.
- Expose `/presigned/:btih` for browser redirects and `/presigned/:btih/info` for metadata consumers.

## Runtime Basics
- Launch with `npm run redirect-server`; host/port come from `TORRENT_REDIRECT_HOST` and `TORRENT_REDIRECT_PORT` (default `0.0.0.0:8787`).
- Shortcut state is stored in `TORRENT_REDIRECT_DB_PATH` (default `.cache/torrent-cli/presigned.db`). Delete the file to clear the registry.
- Key endpoints:
  - `GET /health` — readiness probe.
  - `GET /admin/presigned` — list active shortcuts (`npm run list-presigns` wraps this).
  - `POST /admin/presigned` — create or refresh a shortcut.
  - `DELETE /admin/presigned/:btih` — remove a shortcut.

## How Shortcuts Are Registered
- `DownloadService.syncJob` refreshes presigned URLs for completed jobs when the cached link is missing or within five minutes of expiry (see `src/downloadService.ts`).
- The poller revisits completed jobs missing redirect metadata, so restored downloads pick up shortcuts automatically.
- After retrieving a presign (`/presign_link`), the service calls `POST /admin/presigned` and caches `redirectUrl`/`redirectExpiresAt` with the job.
- Clients obtain the base URL from `TORRENT_REDIRECT_BASE_URL` (default `http://127.0.0.1:8787`) via `loadConfig()`; override it with a publicly reachable host when sharing links.

## Common Issues
- **Server offline or unreachable.** The registration request fails; check logs for `Failed to register redirect…` and restart the service.
- **Incorrect base URL.** If the base URL is not reachable by consumers (e.g. still `127.0.0.1`), redirects work only on the host machine. Update `TORRENT_REDIRECT_BASE_URL` to the deployed address.
- **Backend cannot presign.** When `/presign_link` returns 404/503 the redirect refresh keeps the previous S3 link; inspect the backend and retry or use `npm run register-presign <btih> <url> <expires>`.
- **Presign expired.** Redirect metadata is based on the underlying S3 expiry; `/presigned/:btih` returns `410` once the link lapses. Trigger a new presign to refresh.

## Debug Checklist
- Ping the server: `curl http://127.0.0.1:8787/health`.
- List shortcuts: `npm run list-presigns`.
- Inspect the SQLite cache: `sqlite3 .cache/torrent-cli/presigned.db 'select * from redirects;'`.
- Watch CLI/bot logs for `DownloadService` errors indicating failed registrations.
- Manually register a shortcut if automation is blocked: `npm run register-presign <btih> <url> <expires>`.
