## TODO
- Investigate adding 5xx retry/backoff logic to `apiClient` to improve resilience against transient failures.
- Evaluate whether `DownloadService.syncAll` should refresh completed/error jobs periodically to surface late-arriving metadata.
- Decide whether to integrate the standalone `JobTracker` component into the primary Ink navigation or remove it if redundant.
