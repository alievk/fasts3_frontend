# Torrent Backend API Specification (v0.1)

## Overview
A minimal REST API that supports the current CLI frontend. Future frontends (web, Telegram bot) will reuse the same contract. All responses must be JSON.

## Authentication
- Use HTTP header `Authorization: Bearer <token>` for every request.
- API should respond with `401 Unauthorized` when the header is missing or invalid.

## Base URL
Assume deployments under `https://<host>/api`. Paths below use this base.

## Endpoints

### 1. Health Check
`GET /api/health`

**Purpose:** Allow clients to validate connectivity/UI boot.

**Response 200:**
```json
{
  "status": "ok",
  "version": "1.0.0"
}
```

### 2. Search Torrents
`GET /api/search`

**Query Params:**
- `query` (string, required): search keywords.
- `limit` (int, optional, default 5, max 10).

**Response 200:**
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

- Empty array when nothing matches.
- Return `400` on invalid query (e.g., blank or >256 chars).

### 3. Create Download Job
`POST /api/jobs`

**Request Body:**
```json
{
  "magnet": "magnet:?xt=urn:btih:...",
  "label": "Ubuntu Noble 24.04 Desktop"
}
```
- `magnet` (string, required). Validation ensures a proper `magnet:?` prefix and extracts the BTIH.
- `label` (string, optional): client display name (latest value wins if reused).

**Response 202:**
```json
{
  "job_id": "b47ab4d3f3a841c9a0e4c6ccf0a2f89f",
  "btih": "1f6bf62b2f6c4a72b7c84df5971e2b5b7c84df5",
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

- `status` must be one of `queued | downloading | uploading | completed | error`.
- When a torrent with the same BTIH was previously uploaded, the response comes back immediately with `status: "completed"` and the cached `s3_bucket`/`s3_object_key` instead of queuing a duplicate download.
- `manifest` is a location hint, not the manifest payload. When the worker stores the job locally it is the filesystem path (e.g. `/app/data/jobs/<btih>/manifest.json`). After an S3 upload it switches to the object key (e.g. `jobs/<btih>/manifest.json`). Fetch the actual manifest JSON via the presign endpoint.
- Each POST generates a new `job_id` (UUIDv4). Multiple job IDs can point at the same BTIH when several clients request the same torrent.

### 4. Get Job Status
`GET /api/jobs/{job_id}`

**Response 200:**
```json
{
  "job_id": "b47ab4d3f3a841c9a0e4c6ccf0a2f89f",
  "btih": "1f6bf62b2f6c4a72b7c84df5971e2b5b7c84df5",
  "status": "downloading",
  "progress": 0.42,
  "status_updated_at": "2025-10-13T15:24:01.591Z",
  "manifest": null,
  "error": null,
  "s3_bucket": null,
  "s3_object_key": null,
  "s3_url": null,
  "s3_url_expires_at": null
}
```

Field notes:
- `progress` in `[0,1]`, may be `null` if unknown.
- `s3_bucket`, `s3_object_key`, and `manifest` populate once the upload finishes (cached BTIHs return them immediately).
- The presign endpoint still returns the actual manifest/content; treat `manifest` here as a pointer only.
- No download link is returned; clients must call `/api/jobs/{job_id}/presign_link` to fetch a presigned URL once the job is completed.
- `error` string recommended when `status == "error"`.
- `status_updated_at` reflects the last transition time persisted in Redis.

Error cases:
- `404` when `job_id` is unknown or has been deleted (CLI will treat as orphan and remove locally).

### 5. Get Job Presigned Link
`GET /api/jobs/{job_id}/presign_link`

Purpose: obtain an HTTPS presigned link for the first uploaded torrent file. Returns `404` if the job is unfinished or stored locally.

**Response 200:**
```json
{
  "job_id": "b47ab4d3f3a841c9a0e4c6ccf0a2f89f",
  "btih": "1f6bf62b2f6c4a72b7c84df5971e2b5b7c84df5",
  "bucket": "torrent-downloads",
  "key": "jobs/1f6bf62b2f6c4a72b7c84df5971e2b5b7c84df5/files/000_readme.txt",
  "s3_url": "https://s3.amazonaws.com/torrent-downloads/jobs/...",
  "expires_at": "2025-10-13T15:24:01.591Z",
  "short_url": "http://torrent.example/redirect?job_id=b47ab4d3f3a841c9a0e4c6ccf0a2f89f"
}
```

- `expires_at` is the UTC timestamp when the link becomes invalid.
- `short_url` is a backend-managed helper link for clients that prefer shorter URLs.
- Return `503` with error payload when presigning is disabled or fails.

### 6. Delete Job
`DELETE /api/jobs/{job_id}`

Purpose: cancel queued or running jobs and clean up storage.

**Response 202:**
```json
{
  "deleted": true
}
```

- Cancelling is idempotent for the first call: queued jobs are removed from the worker queue immediately; active downloads are interrupted and Transmission is stopped before scratch data is removed.
- After a successful cancellation, `GET /api/jobs/{job_id}` responds with `404` once the delete marker is set.
- Repeating `DELETE` on the same `job_id` returns `404` to signal the job is already gone.
- Cancelling any job ID invalidates the shared BTIH download for all clients and removes the ID from the jobs cache.
- Return `404` when the job never existed.

## Behavioural Expectations
- Backend should persist job history at least long enough for clients to reconnect and sync status.
- When a download completes, upload all torrent files to S3, then expose the presign endpoint for clients that need a direct download link.
- Downloads should transition through `queued -> downloading -> uploading -> completed` (or `error`). Progress should increase monotonically when known.
- Searching and job management should be idempotent; repeating identical requests should not create duplicates.

## Pagination & Bulk Sync (Future Work)
- Once implemented, add `GET /api/jobs?since=<ISO8601>` returning an array of job summaries. The CLI service layer already has room for this but does not depend on it yet.

## Error Format
For non-2xx responses, return JSON in the form:
```json
{
  "error": "short-code",
  "message": "Human readable explanation"
}
```

## Rate Limiting
- If rate limits are required, return `429` with a `Retry-After` header. Clients will surface the error and ask the user to retry later.

## Timeouts
- Keep requests responsive (<30s). For long-running job creation, return `202` immediately and track progress asynchronously.
