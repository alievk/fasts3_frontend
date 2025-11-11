# Torrent Backend API Specification (v0.1)

Compact reference for the orchestrator REST API. All responses are JSON unless noted.

## Auth & Base URL
- Base path: `https://<host>/api`.
- Send `Authorization: Bearer <token>` on every `/api` request **except** `GET /api/jobs/{job_id}` (public poll endpoint).
- Missing/invalid tokens return `401`.

## Endpoint Matrix
| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/health` | Yes | Connectivity & version. |
| GET | `/api/search` | Yes | Torrent lookup. |
| POST | `/api/jobs` | Yes | Create download job. |
| GET | `/api/jobs/{job_id}` | No | Job status (single job only). |
| GET | `/api/jobs/{job_id}/presign_link` | Yes | Returns S3 link once job completed. |
| DELETE | `/api/jobs/{job_id}` | Yes | Cancel job + purge metadata. |
| GET | `/redirect?job_id=...` | No | 302 redirect to the stored `s3_url` after presign. |

## Endpoints

### Health
`GET /api/health`

Response `200`:
```json
{"status": "ok", "version": "0.1.0"}
```
`version` is `Settings.app_version`.

### Search
`GET /api/search?query=<text>&limit=<1-100>`

- `query` trimmed, 1–256 chars.
- `limit` default 5.
- Validation errors surface as FastAPI `422` responses.

Response `200`: array of `SearchItem` objects:
```json
{
  "id": "rutracker-123456",
  "title": "Ubuntu 24.04",
  "size_bytes": 3512729600,
  "seeders": 1520,
  "leechers": 90,
  "magnet": "magnet:?xt=urn:btih:..."
}
```
Empty array when nothing matches.

### Create Job
`POST /api/jobs`

Request body:
```json
{
  "magnet": "magnet:?xt=urn:btih:...",
  "label": "optional name"
}
```
- `magnet` must start with `magnet:?`, include a BTIH, ≤4096 chars.
- `label` optional, ≤256 chars.

Response `202`: `JobResponse`
```json
{
  "job_id": "4nVP9sQ1aX",
  "btih": "1f6b…df5",
  "status": "queued",
  "status_updated_at": "2025-10-13T15:12:31.123Z",
  "progress": null,
  "manifest": null,
  "error": null,
  "s3_bucket": null,
  "s3_object_key": null,
  "s3_url": null,
  "s3_url_expires_at": null
}
```
- `status` ∈ `queued | downloading | uploading | completed | error`.
- If the BTIH already exists in the SQLite torrent cache, the job is materialized immediately as `completed` with cached `s3_bucket`/`s3_object_key` and `progress = 1.0`.
- `manifest` points to a manifest location (filesystem path before upload, S3 key afterwards); fetch real content via the presign flow.
- Every call yields a new `job_id` (10-char nanoid using a URL-safe alphabet) even for duplicate BTIHs.

### Get Job
`GET /api/jobs/{job_id}` – public.

Response `200`: same `JobResponse` schema as above. Notes:
- `progress` is `null` or a clamp in `[0,1]`.
- `status_updated_at`, `s3_url_expires_at` are ISO 8601 timestamps with `Z`.
- `s3_bucket`/`s3_object_key` appear after upload; `s3_url`/`s3_url_expires_at` appear after a presign request succeeds.
- `error` contains the worker-provided reason when `status == "error"`.

Errors:
- `404` when the job ID never existed or was deleted.

### Presign Link
`GET /api/jobs/{job_id}/presign_link`

Response `200`:
```json
{
  "job_id": "4nVP9sQ1aX",
  "btih": "1f6b…df5",
  "bucket": "torrent-downloads",
  "key": "jobs/…/files/000_readme.txt",
  "s3_url": "https://s3.amazonaws.com/…",
  "expires_at": "2025-10-13T15:24:01.591Z",
  "short_url": "https://app.example/redirect?job_id=4nVP9sQ1aX"
}
```

- Only available once the job is `completed` **and** `s3_bucket` + `s3_object_key` are populated; otherwise `404`.
- `expires_at` is an ISO timestamp computed as `_utc_now() + presigner.expires_in`.
- `short_url` points to the `/redirect` helper route (base taken from `Settings.redirect_base_url`).
- Missing presigner or signing failures return `503` with `{"error": "presign_unavailable", ...}`.
- Success also writes `s3_url`/`s3_url_expires_at` back into the job record so future status polls can show them.

### Delete Job
`DELETE /api/jobs/{job_id}`

Response `202`:
```json
{"deleted": true}
```

- Removes the Redis job hash, marks the queue entry as deleted, and drops the row from the SQLite index.
- The first successful delete makes subsequent status polls return `404`.
- Repeating `DELETE` (after the row is gone) returns `404`.

### Redirect Helper
`GET /redirect?job_id=<id>` – unauthenticated helper used by `short_url`.

- Looks up the job, refreshes store data, and checks that `status == "completed"`, `s3_url` is present, and `s3_url_expires_at > now`.
- Returns `302` to the stored `s3_url` when valid; otherwise `404` with `{"error": "not_found", ...}`.

## Behaviour
- Jobs typically move `queued → downloading → uploading → completed` (or `error`). Progress rises monotonically when reported.
- Cached BTIHs skip the queue and reuse stored S3 artifacts.
- Presigned links are the only way to obtain `s3_url`; `redirect` simply reuses that link.
- Searching and job management endpoints are idempotent; repeating the same call returns consistent data.

## Error Payload
Every non-2xx response conforms to:
```json
{"error": "short-code", "message": "Human readable explanation"}
```

## Rate Limits & Timeouts
- If rate limiting is enabled, reply with `429` + `Retry-After`.
- Long-running work should respond quickly (≤30 s) and rely on asynchronous job polling.
