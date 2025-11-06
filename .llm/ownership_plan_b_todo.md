Plan B — Client Registry Service + SQLite Adapter (To‑Do)
=======================================================

Prep & Schema
-------------
- [ ] Confirm final SQLite file location (default: `.cache/torrent-cli/clients.sqlite`) and ensure parent directories are created lazily.
- [ ] Finalize `clientId` format guidelines for each frontend (Telegram = `telegram:<chatId>`, CLI/web TBD) and add to docs.
- [ ] Define DB schema: `clients` (client_id PK, transport, metadata, created_at, updated_at) and `jobs` (job_id PK, client_id FK, label, btih, status, progress, size_bytes, links, timestamps).
- [ ] Decide on required indices (e.g., `jobs_client_id_idx`, `jobs_status_idx`) and migration strategy (auto-create tables if missing, no legacy migrations per rules).

Registry Interface
------------------
- [ ] Introduce `ClientRegistry` interface in `src/clientRegistry.ts` describing methods:
  - `registerClient(clientId, transportMeta)`
  - `listJobs(clientId)`
  - `getJob(jobId)`
  - `bindJobToClient(job, clientId)`
  - `updateJob(jobId, partial)`
  - `deleteJob(jobId)`
  - `getNotificationTargets(jobId)`
- [ ] Add supporting TypeScript types for stored job snapshots (mirroring backend job fields + ownership metadata) and client transport descriptors.
- [ ] Provide an in-memory implementation for tests to keep bot stateless under unit testing.

SQLite Implementation
---------------------
- [ ] Add dependency for SQLite driver (e.g., `better-sqlite3`) and wire it into package.json.
- [ ] Implement `SQLiteClientRegistry` with lazy connection, PRAGMA setup, and table creation.
- [ ] Ensure upserts/retries are wrapped in small helper methods; include serialization helpers for optional JSON blobs (e.g., metadata).
- [ ] Expose health check / close methods to allow graceful shutdown hooks.

Frontend Integration (Bot First)
--------------------------------
- [ ] Replace `JobStore` usage inside `DownloadService` with registry calls (`listJobs`, `bindJobToClient`, `updateJob`, `deleteJob`), making sure job ownership persists across restarts.
- [ ] Update Telegram command handlers to resolve `clientId` per request, then:
  - `/jobs`: fetch jobs via `registry.listJobs(clientId)`
  - Job actions (`job:`, `refresh:`, `delete:`): authorize using registry lookups
  - Job creation: `bindJobToClient` right after `createJob`
- [ ] Revise completion/removal/error notifications to fetch owner targets via `registry.getNotificationTargets(jobId)` instead of broadcasting.
- [ ] Maintain search sessions in memory but tag them with `clientId` for clarity (even though results stay per chat).

Future Frontend Hooks
---------------------
- [ ] Document how CLI/web frontends should import the registry module and use the same `clientId` semantics.
- [ ] Provide helper factory (e.g., `createClientRegistry(config)`) to centralize path/config handling so other frontends reuse it.
- [ ] Outline strategy for swapping SQLite with Mongo later (keep interface stable, move logic into adapter).

Operational & Testing
---------------------
- [ ] Add configuration knobs (.env) for registry DB path if needed.
- [ ] Write integration tests covering job lifecycle (create → sync → complete → delete) via in-memory registry.
- [ ] Add basic smoke test for SQLite adapter (table creation, CRUD).
- [ ] Update README/docs to explain ownership tracking flow and new dependency.
