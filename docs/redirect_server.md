# Redirect Server Guide

## Purpose
- Serve stable, human-friendly shortcuts for presigned S3 downloads.
- Persist active shortcuts in SQLite so restarts do not invalidate links.
- Expose `/presigned/:btih` for browser redirects and `/presigned/:btih/info` for metadata consumers.

## Runtime Basics
- Launch with `npm run redirect-server`; host/port come from `TORRENT_REDIRECT_HOST` and `TORRENT_REDIRECT_PORT` (default `0.0.0.0:8787`).
- Shortcut state is stored in `TORRENT_REDIRECT_DB_PATH` (default `.cache/torrent-cli/presigned.db`). Delete the file to clear the registry.
- Scripts:
  - `npm run list-presigns` -> `GET /admin/presigned`
  - `npm run register-presign <btih> <url> <expires>` -> `POST /admin/presigned`
- CORS headers are emitted automatically, so the web player can query `/presigned/*` from a different origin/port.

## How Shortcuts Are Registered
- `DownloadService.syncJob` refreshes presigned URLs for completed jobs when the cached link is missing or within five minutes of expiry (see `src/downloadService.ts`).
- The poller revisits completed jobs missing redirect metadata, so restored downloads pick up shortcuts automatically.
- After retrieving a presign (`/presign_link`), the service calls `POST /admin/presigned` and caches `redirectUrl`/`redirectExpiresAt` with the job.
- Clients obtain the base URL from `TORRENT_REDIRECT_BASE_URL` (default `http://127.0.0.1:8787`) via `loadConfig()`; override it with a publicly reachable host when sharing links.

## HTTP API

| Method & Path | Description | Notes |
| --- | --- | --- |
| `GET /health` | Liveness/readiness probe. | Returns `{ "status": "ok", "registrySize": <number> }`. |
| `GET /admin/presigned` | List all cached shortcuts. | Used by `npm run list-presigns`. Each entry contains `btih`, `url`, `expiresAt`, `createdAt`. |
| `POST /admin/presigned` | Register or refresh a shortcut. | Body accepts `btih`, `url`, and either `expiresIn` (seconds) or `expiresAt` (ISO timestamp). Returns 400 on validation errors, 201 with persisted metadata on success. |
| `DELETE /admin/presigned/:btih` | Remove a shortcut. | Returns 204 when removed, 404 if the entry does not exist. |
| `GET /presigned/:btih/info` | Inspect metadata without redirecting. | Returns 200 with `status`, `btih`, `url`, `expiresAt`, `createdAt`. Responds 404 when missing and 410 when expired. |
| `GET /presigned/:btih` | Follow the shortcut. | Responds with HTTP 302 to the active presigned URL. Returns 404 when missing, 410 when expired. |

### Typical flow
1. Backend completes a job and exposes `/api/jobs/{btih}/presign_link`.
2. `DownloadService` retrieves the presign, then calls `POST /admin/presigned`.
3. A client hits `/presigned/:btih` to follow the 302 redirect, or `/presigned/:btih/info` for metadata.

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
