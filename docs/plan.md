# Ink CLI Frontend Plan

## Goals & Scope
- Provide a reusable service layer that communicates with the torrent backend via REST.
- Keep business logic sharable across future Telegram bot and web clients by keeping Ink components thin.
- Support torrent search, job creation, progress polling, presigned link retrieval, and persisted local state so downloads survive CLI restarts.

## Backend REST API Contract

- The definitive API description lives in `docs/backend_spec.md`. Update that file when the server contract changes.
- The CLI assumes:
  - Tokens come from `TORRENT_API_TOKEN` (optional); a placeholder is used when none is provided.
  - Requests use `config.apiBaseUrl` as the origin/prefix.
  - Download links are fetched via `/jobs/{id}/presign_link`; `GET /jobs/{id}` omits them.
  - `404` responses for jobs signal local cleanup/orphan removal.

## Service Layer Architecture

### Modules
1. `config.ts`
   - Loads environment defaults (`TORRENT_API_URL`, `TORRENT_API_TOKEN`, `TORRENT_CLI_POLL_MS`, `TORRENT_CLI_STATE_PATH`) and returns `Config`.
   - Ensures polling interval never drops below one second.
2. `apiClient.ts`
   - Wraps `fetch` with JSON parsing, timeout control, and error normalization.
   - Exposes `search`, `createJob`, `getJob`, `deleteJob`, `health`, `getJobPresignedLink`.
   - Normalizes snake_case payloads into camelCase TypeScript models.
3. `jobStore.ts`
   - Persists jobs under `.cache/torrent-cli/jobs.json` by default.
   - Performs atomic writes (temp file + rename) and keeps an in-memory cache for subsequent reads.
4. `downloadService.ts`
   - Event-driven orchestrator built on `EventEmitter`.
   - Responsibilities: initialize from `jobStore`, call API actions, persist updates, propagate events (`ready`, `jobUpdated`, `jobRemoved`, `error`).
   - `syncAll` polls in-progress jobs (`queued`/`downloading`). `syncJob` handles orphan cleanup on 404 and fetches presigned links for completed jobs when needed.
5. `poller.ts`
   - Simple interval manager that invokes `downloadService.syncAll()` until stopped.
6. `types.ts`
   - Shared interfaces for API responses, stored jobs, and configuration.

### Event Strategy
- `DownloadService` emits domain events consumed by hooks so Ink components react to changes without owning business logic.
- Errors raised by API calls are forwarded through the `error` event so UI surfaces them consistently.

## Ink CLI Wiring

### Service Context & Hooks
- `ServiceProvider` loads config, constructs the API client, job store, download service, and poller, then exposes them via React context.
- `useServices()` supplies the context; components throw if used outside the provider.
- `useJobs()` subscribes to `DownloadService` events, triggers initialization/health/sync, starts the poller, and keeps local jobs/error state.
- `useSearch()` manages the query string, executes searches through the service, and stores the latest results/errors.

### Components & Navigation
- `<App>` is the top-level Ink component. It manages a simple history stack with screens: `menu`, `search`, `jobs`, `jobDetail`.
- `<SearchPane>` renders the query input and search results list; on selection it delegates to `DownloadService.startDownload`.
- Jobs view and detail view are defined inline within `App` (`JobsScreen`, `JobDetailScreen`) using `ink-select-input` for interaction.
- Job detail supports deleting a job from the menu and copying the S3 link via the `c` shortcut when available (clipboard support provided by `clipboardy`).
- A standalone `<JobTracker>` component exists for possible reuse but is not currently part of the main navigation flow.

### User Flow
1. `App` mounts, `useJobs()` initializes the download service, loads saved jobs, performs a health check, and kicks off polling.
2. Users start at the main menu. Arrow keys navigate screens; Enter confirms selection.
3. In the search screen, typing a query and pressing Enter triggers `downloadService.search`. Selecting a result calls `startDownload`, optimistic job creation, and navigates to job detail.
4. The jobs list screen displays stored jobs; selecting one opens details and triggers an immediate `syncJob`.
5. `syncAll` runs on the poller cadence for in-progress jobs. Completed jobs retain their last known state unless explicitly refreshed (e.g., detail view).
6. Deletion attempts remove the job locally even if the backend request fails; a 404 from the backend also causes local cleanup.

## Persistence Strategy
- Jobs persist in JSON:
  ```json
  {
    "jobs": {
      "job-uuid": {
        "label": "Ubuntu Noble Desktop",
        "createdAt": "ISO8601",
        "lastKnownStatus": "downloading",
        "lastSyncedAt": "ISO8601",
        "progress": 0.42,
        "s3Url": null
      }
    }
  }
  ```
- `TORRENT_CLI_STATE_PATH` overrides the default location. Writes are atomic and directories are created on demand.
- **Critical:** JSON persistence will not scale beyond small single-user workloads. Plan a migration to a proper database (SQLite/Postgres/Redis) with concurrency control, indexing, and retention policies before onboarding high user volumes.

## Error Handling & Resilience
- Requests time out after 10s; aborted calls surface as user-visible errors.
- API errors are normalized using response JSON when possible and bubbled via `DownloadService`.
- The poller runs at a fixed interval supplied by config; no retry/backoff is implemented yet.
- Unknown status strings from the backend throw during normalization, guarding against unexpected schema drift.

## Extensibility Notes
- The modular service layer allows reuse across other frontends; hooks and components consume only the exported interfaces.
- Clipboard logic is isolated to the job detail screen so non-TTY environments can stub or no-op if needed.
- Future work can replace the inline jobs UI with the existing `JobTracker` component or share the service layer as an npm package.
