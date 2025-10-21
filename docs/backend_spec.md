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
- `magnet` (string, required). Validation should ensure proper `magnet:?` prefix.
- `label` (string, optional): client display name.

**Response 202:**
```json
{
  "job_id": "job-1f6bf62b-2f6c-4a72-b7c8-4df5971e2b5b",
  "status": "queued",
  "created_at": "2025-10-13T15:12:31.123Z"
}
```

- `status` must be one of `queued | downloading | completed | error`.
- Respond with `409` if the magnet already has an active job.

### 4. Get Job Status
`GET /api/jobs/{job_id}`

**Response 200:**
```json
{
  "job_id": "job-1f6bf62b-2f6c-4a72-b7c8-4df5971e2b5b",
  "status": "downloading",
  "progress": 0.42,
  "updated_at": "2025-10-13T15:24:01.591Z",
  "error": null
}
```

Field notes:
- `progress` in `[0,1]`, may be `null` if unknown.
- No download link is returned; clients must call `/api/jobs/{job_id}/presign_link` to fetch a presigned URL once the job is completed.
- `error` string recommended when `status == "error"`.

Error cases:
- `404` when job_id is unknown or expired (CLI will treat as orphan and remove locally).

### 5. Get Job Presigned Link
`GET /api/jobs/{job_id}/presign_link`

Purpose: obtain an HTTPS presigned link for the first uploaded torrent file. Returns `404` if the job is unfinished or stored locally.

**Response 200:**
```json
{
  "job_id": "job-1f6bf62b-2f6c-4a72-b7c8-4df5971e2b5b",
  "bucket": "torrent-downloads",
  "key": "jobs/job-1f6bf62b/files/000_readme.txt",
  "s3_url": "https://s3.amazonaws.com/torrent-downloads/jobs/...",
  "expires_in": 900
}
```

- `expires_in` matches the server-side presign window (seconds).
- Return `503` with error payload when presigning is disabled or fails.

### 6. Delete Job
`DELETE /api/jobs/{job_id}`

Purpose: allow clients to cancel jobs and clean up storage.

**Response 200:**
```json
{
  "deleted": true
}
```

- Return `204` if you prefer no body.
- If job is already gone, respond with `404` so clients can remove it locally as well.

## Behavioural Expectations
- Backend should persist job history at least long enough for clients to reconnect and sync status.
- When a download completes, upload all torrent files to S3, then expose the presign endpoint for clients that need a direct download link.
- Downloads should transition through `queued -> downloading -> completed` (or `error`). Progress should increase monotonically when known.
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
