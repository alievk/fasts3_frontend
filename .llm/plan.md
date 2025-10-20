# Ink CLI Frontend Plan

## Goals & Scope
- Provide a reusable service layer that communicates with the torrent backend via a REST API.
- Keep Ink components thin so logic can be shared with future Telegram bot and web app frontends.
- Support keyword search, result selection, job tracking, polling for download progress, and surfacing S3 links.
- Persist known jobs locally to recover state across CLI sessions and discard orphaned entries after a status check.

## Backend REST API Draft

### Authentication
- Assume API key or token passed via `Authorization: Bearer <token>` header. CLI reads token from env (`TORRENT_API_TOKEN`) or config file.

### Endpoints
1. `GET /health`
   - Purpose: quick connectivity check on startup.
   - Response: `{ "status": "ok", "version": "1.2.0" }`.

2. `GET /search?query=<keywords>&limit=5`
   - Purpose: find torrents on rutracker proxy.
   - Response: array of results:  
     ```json
     [
       {
         "id": "rutracker-123456",
         "title": "Ubuntu Noble 24.04 Desktop",
         "size_bytes": 3512729600,
         "seeders": 1520,
         "leechers": 90,
         "magnet": "magnet:?xt=urn:btih:..."
       }
     ]
     ```

3. `POST /jobs`
   - Body: `{ "magnet": "<magnet-link>", "label": "<optional display name>" }`.
   - Response: `{ "job_id": "job-uuid", "status": "queued", "created_at": "ISO8601" }`.

4. `GET /jobs/{job_id}`
   - Response:  
     ```json
     {
       "job_id": "job-uuid",
       "status": "queued" | "downloading" | "completed" | "error",
       "progress": 0.42,
       "s3_url": "https://bucket.s3.../job-uuid/",
       "updated_at": "ISO8601",
       "error": null
     }
     ```

5. `GET /jobs?since=<iso8601>`
   - Optional bulk fetch for syncing; returns array of job summaries similar to `GET /jobs/{id}`.

6. `DELETE /jobs/{job_id}`
   - Purpose: clean up server-side if user abandons a job.
   - Response: `{ "deleted": true }`.

### Status Semantics
- `progress` is 0–1 float; absent or `null` when unknown.
- `s3_url` present only when `status === "completed"`.
- Jobs older than retention window may return 404; CLI should remove them locally.

## Service Layer Architecture

### Modules
1. `config.ts`
   - Resolve API base URL, auth token, polling interval, and storage path.
2. `apiClient.ts`
   - Thin wrapper on `fetch` with JSON parsing, error normalization, retry on 5xx.
   - Expose methods: `search(query)`, `createJob(magnet, label)`, `getJob(jobId)`, `deleteJob(jobId)`.
   - Optional `listJobs(since)` helper can be added when the backend ships the bulk status endpoint; the CLI currently exercises per-job fetches to keep the surface minimal.
3. `jobStore.ts`
   - Manage persisted job metadata in `.cache/torrent-cli/jobs.json` by default (override with `TORRENT_CLI_STATE_PATH`).
   - APIs: `loadJobs()`, `saveJobs(jobs)`, `upsert(job)`, `remove(jobId)`.
4. `downloadService.ts`
   - Orchestrate workflows: `search`, `startDownload`, `syncJob(jobId)`, `syncAll()`, implicit orphan cleanup when `syncJob` sees a 404.
   - Emits domain events (e.g., `jobUpdated`, `jobRemoved`) consumable by CLI and other frontends.
5. `poller.ts`
   - Poll known jobs on a fixed interval; uses `downloadService.syncAll()` via `setInterval`.
6. `types.ts`
   - Shared TypeScript interfaces/enums for API payloads and domain models.

### Event Strategy
- Use Node `EventEmitter` or a minimal RxJS-like subject to broadcast job updates.
- Ink subscribes to events; other frontends can reuse the same service layer.

## Ink CLI Wiring

### Component Tree
- `<App>`: top-level orchestrator; loads config, initializes services, and provides context.
- `<SearchPane>`: input box + results list; leverages `downloadService.search`.
- `<JobTracker>`: displays active/past jobs inline; listens to poller events and handles deletion via keyboard shortcut.

### Hooks/Context
- `useServiceContext` exposing `config`, `downloadService`, `poller`.
- `useJobs()` hook that converts event stream to Ink state (subscribes/unsubscribes on mount).
- `useSearch()` hook managing query string, pending state, and result list.

### User Flow
1. Load persisted jobs, hit `/health` once.
2. Show search prompt; on submit, display results and allow navigation (Ink `useInput` for arrow keys + enter).
3. On selection, call `downloadService.startDownload`, add job to store, optimistic status `queued`.
4. Poller ticks every N seconds to refresh job statuses; completed jobs display S3 link.
5. User may press shortcut (e.g., `d`) to delete a job locally; CLI calls `DELETE /jobs/{id}` then purges store entry.
6. Orphan detection: on startup, for each stored job not returned by backend (404), mark as orphan and auto-remove unless user restores.

## Persistence Strategy
- Store JSON like:
  ```json
  {
    "jobs": {
      "job-uuid": {
        "label": "Ubuntu Noble Desktop",
        "created_at": "ISO8601",
        "last_known_status": "downloading",
        "last_synced_at": "ISO8601"
      }
    }
  }
  ```
- Write atomically (temp file + rename) to avoid corruption.
- Allow overriding path via env `TORRENT_CLI_STATE_PATH`.

## Error Handling & Resilience
- Distinguish network errors vs API validation vs backend job errors.
- Surface errors in the main UI message area while keeping input responsive.
- Poller currently runs at a fixed cadence; evaluate backoff once backend limits require it.
- CLI should handle backend returning unknown status fields gracefully by logging and ignoring.

## Extensibility Notes
- Service layer exported as NPM package or workspace module to reuse across Telegram bot/web.
- Keep Ink-specific UI code isolated; avoid business logic in components.
- Future frontends can reuse `downloadService` and `jobStore` directly or wrap them with framework-specific adapters.
