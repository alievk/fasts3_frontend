import React, { useEffect, useMemo, useState } from 'react';

if (typeof window !== 'undefined') {
  console.log('[Player] bundle loaded');
}

type PlayerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string };

const filenameFromUrl = (url: string): string => {
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    const candidate = segments[segments.length - 1] ?? '';
    if (candidate.length === 0) {
      return 'Video';
    }
    return decodeURIComponent(candidate);
  } catch {
    return 'Video';
  }
};

export const PlayerApp: React.FC = () => {
  const [playerState, setPlayerState] = useState<PlayerState>({ status: 'loading' });

  const displayName = useMemo(() => {
    if (playerState.status === 'ready') {
      return filenameFromUrl(playerState.url);
    }
    return 'Video Player';
  }, [playerState]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobIdParam = params.get('job_id')?.trim() ?? params.get('jobId')?.trim() ?? '';
    const rawUrl = params.get('videoUrl')?.trim() ?? '';
    const apiBaseParam = params.get('apiBase')?.trim() ?? params.get('api_base')?.trim() ?? '';
    const tokenParam = params.get('token')?.trim() ?? '';

    console.log('[Player] query params', {
      jobId: jobIdParam || null,
      videoUrl: rawUrl || null,
      apiBase: apiBaseParam || null
    });

    const resolveVideoUrl = (value: string): string => {
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new Error('Missing required videoUrl parameter.');
      }

      try {
        const normalized = new URL(trimmed);
        if (!['http:', 'https:'].includes(normalized.protocol)) {
          throw new Error('videoUrl must be an HTTP or HTTPS link.');
        }
        return normalized.toString();
      } catch (error) {
        if (error instanceof Error && error.message === 'videoUrl must be an HTTP or HTTPS link.') {
          throw error;
        }
        throw new Error(`Invalid videoUrl parameter: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    const resolveApiBase = (): string => {
      const trimmed = apiBaseParam || '';
      if (trimmed) {
        try {
          const normalized = new URL(trimmed);
          return normalized.toString().replace(/\/$/, '');
        } catch (error) {
          throw new Error(
            `Invalid apiBase parameter: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      }

      try {
        const fallback = new URL('/api', window.location.origin);
        return fallback.toString().replace(/\/$/, '');
      } catch (error) {
        throw new Error(
          `Failed to determine API base URL: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    const asMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

    const fetchJson = async (endpoint: URL): Promise<unknown> => {
      console.log('[Player] fetching', endpoint.toString());
      const headers: Record<string, string> = {};
      if (tokenParam) {
        headers.Authorization = `Bearer ${tokenParam}`;
      }

      let response: Response;
      try {
        response = await fetch(endpoint.toString(), { headers });
      } catch (error) {
        console.error('[Player] network error while fetching', endpoint.toString(), error);
        throw new Error(
          `Network error while fetching ${endpoint.pathname}: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      if (response.status === 404) {
        throw new Error('Job not found.');
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(
          `Request failed with status ${response.status}${body ? ` — ${body}` : ''}`
        );
      }

      if (response.status === 204) {
        return undefined;
      }

      try {
        return await response.json();
      } catch (error) {
        throw new Error(
          `Failed to parse response from ${endpoint.pathname}: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    };

    const extractUrl = (value: unknown): string | null => {
      if (!value || typeof value !== 'string') {
        return null;
      }
      try {
        const normalized = new URL(value);
        if (!['http:', 'https:'].includes(normalized.protocol)) {
          return null;
        }
        return normalized.toString();
      } catch {
        return null;
      }
    };

    const isExpired = (value: string | null): boolean => {
      if (!value) {
        return true;
      }
      const expires = Date.parse(value);
      return Number.isNaN(expires) || expires <= Date.now();
    };

    const fetchJobDownloadUrl = async (jobId: string, apiBase: string): Promise<string> => {
      const normalizedBase = apiBase.replace(/\/$/, '');
      const detailEndpoint = new URL(`/jobs/${encodeURIComponent(jobId)}`, `${normalizedBase}/`);
      const payload = (await fetchJson(detailEndpoint)) as Record<string, unknown> | undefined;

      if (!payload || typeof payload !== 'object') {
        throw new Error('Job details unavailable.');
      }

      const status = typeof payload.status === 'string' ? payload.status : 'unknown';
      if (status === 'error') {
        const message =
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error
            : 'Job failed.';
        throw new Error(message);
      }

      if (status !== 'completed') {
        throw new Error(`Job ${jobId} is ${status}. Try again later.`);
      }

      let downloadUrl = extractUrl(payload.s3_url ?? null);
      let expiresAt = typeof payload.s3_url_expires_at === 'string' ? payload.s3_url_expires_at : null;

      if (!downloadUrl || isExpired(expiresAt)) {
        const presignEndpoint = new URL(`/jobs/${encodeURIComponent(jobId)}/presign_link`, `${normalizedBase}/`);
        const presign = (await fetchJson(presignEndpoint)) as Record<string, unknown> | undefined;
        downloadUrl = extractUrl(presign?.s3_url ?? null);
        expiresAt = typeof presign?.expires_at === 'string' ? presign.expires_at : null;
      }

      if (!downloadUrl) {
        throw new Error('Backend did not provide a downloadable URL.');
      }

      if (expiresAt) {
        console.log('[Player] download link expires at', expiresAt);
      }

      return downloadUrl;
    };

    let cancelled = false;

    const setReady = (url: string) => {
      if (!cancelled) {
        setPlayerState({
          status: 'ready',
          url
        });
        console.log('[Player] ready with url', url);
      }
    };

    const setError = (message: string) => {
      if (!cancelled) {
        setPlayerState({
          status: 'error',
          message
        });
        console.error('[Player] error state', message);
      }
    };

    const run = async (): Promise<void> => {
      if (jobIdParam) {
        try {
          const apiBase = resolveApiBase();
          const resolved = await fetchJobDownloadUrl(jobIdParam, apiBase);
          setReady(resolved);
          return;
        } catch (error) {
          if (rawUrl.length > 0) {
            console.warn('[Player] job lookup failed, attempting fallback videoUrl', error);
            try {
              const fallback = resolveVideoUrl(rawUrl);
              setReady(fallback);
              return;
            } catch (fallbackError) {
              console.error('[Player] fallback videoUrl failed', fallbackError);
              setError(
                `Unable to resolve job ${jobIdParam}: ${asMessage(error)}. Fallback videoUrl failed: ${asMessage(fallbackError)}`
              );
              return;
            }
          }

          console.error('[Player] job resolution failed without fallback', error);
          setError(`Unable to resolve job ${jobIdParam}: ${asMessage(error)}`);
          return;
        }
      }

      if (rawUrl.length > 0) {
        try {
          const normalized = resolveVideoUrl(rawUrl);
          setReady(normalized);
        } catch (error) {
          console.error('[Player] invalid videoUrl parameter', error);
          setError(asMessage(error));
        }
        return;
      }

      setError('Missing required job_id or videoUrl parameter.');
    };

    void run();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (playerState.status === 'ready') {
      document.title = `${filenameFromUrl(playerState.url)} • Video Player`;
    } else {
      document.title = 'Video Player';
    }
  }, [playerState]);

  const styles = `
    :root {
      color-scheme: dark light;
    }

    *, *::before, *::after {
      box-sizing: border-box;
    }

    html, body {
      margin: 0;
      padding: 0;
      height: 100%;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
      background: #0b0b0f;
      color: #f5f5f7;
    }

    body {
      display: flex;
      align-items: center;
      justify-content: center;
    }

    #root {
      width: 100%;
      height: 100%;
    }

    .page {
      height: 100%;
      width: 100%;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: min(5vw, 32px);
      gap: 16px;
    }

    .page__header {
      text-align: center;
    }

    .page__header h1 {
      margin: 0;
      font-size: clamp(18px, 3vw, 26px);
    }

    .page__header p {
      margin: 8px 0 0;
      font-size: clamp(14px, 2vw, 16px);
      color: #adb5bd;
    }

    .player {
      width: min(100%, 1000px);
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    video {
      width: 100%;
      flex: 1;
      background: #000;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      overflow: hidden;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
    }

    .button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: 12px 20px;
      border-radius: 12px;
      background: #1f6feb;
      color: white;
      text-decoration: none;
      font-weight: 600;
      font-size: 15px;
      border: none;
      cursor: pointer;
      transition: background 0.2s ease-in-out;
    }

    .button:focus-visible {
      outline: 2px solid rgba(31, 111, 235, 0.6);
      outline-offset: 3px;
    }

    .button:hover {
      background: #1a5dc7;
    }

    .message {
      max-width: 480px;
      text-align: center;
      padding: 24px;
      border-radius: 16px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .message--error {
      border-color: rgba(255, 102, 102, 0.3);
      background: rgba(255, 102, 102, 0.1);
      color: #ff8282;
    }

    .message--note {
      border-color: rgba(88, 166, 255, 0.25);
      background: rgba(88, 166, 255, 0.1);
      color: #8cbcff;
    }

    @media (max-width: 600px) {
      .page {
        padding: 16px;
      }

      .button {
        flex: 1 1 100%;
        justify-content: center;
      }
    }
  `;

  if (playerState.status === 'loading') {
    return (
      <div className="page">
        <style>{styles}</style>
        <div className="message">Loading…</div>
      </div>
    );
  }

  if (playerState.status === 'error') {
    return (
      <div className="page">
        <style>{styles}</style>
        <div className="message message--error">{playerState.message}</div>
      </div>
    );
  }

  return (
    <div className="page">
      <style>{styles}</style>
      <header className="page__header">
        <h1>{displayName}</h1>
        <p>Stream a presigned file, download for offline viewing, or AirPlay in Safari.</p>
      </header>
      <section className="player">
        <video
          key={playerState.url}
          controls
          playsInline
          x-webkit-airplay="allow"
          preload="metadata"
          poster=""
        >
          <source src={playerState.url} />
        </video>
        <div className="actions">
          <a className="button" href={playerState.url} download rel="noopener" target="_blank">
            Download
          </a>
        </div>
      </section>
    </div>
  );
};
