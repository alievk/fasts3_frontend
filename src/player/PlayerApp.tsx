import React, { useEffect, useMemo, useRef, useState } from 'react';

if (typeof window !== 'undefined') {
  console.log('[Player] bundle loaded');
}

type PlayerState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; url: string };

type PlayerRuntimeConfig = {
  apiBaseUrl?: string;
};

const readRuntimeConfig = (): PlayerRuntimeConfig => {
  if (typeof window === 'undefined') {
    return {};
  }

  const globalValue = (window as typeof window & { __TORRENT_PLAYER_CONFIG__?: unknown }).__TORRENT_PLAYER_CONFIG__;
  if (!globalValue || typeof globalValue !== 'object') {
    return {};
  }

  const candidate = globalValue as Record<string, unknown>;
  const apiBaseUrl =
    typeof candidate.apiBaseUrl === 'string' && candidate.apiBaseUrl.trim().length > 0
      ? candidate.apiBaseUrl.trim()
      : undefined;

  return { apiBaseUrl };
};

const extractFileMetadata = (url: string): { filename: string; extension: string | null; mimeType: string | null } => {
  const fallback = { filename: 'Video', extension: null, mimeType: null };
  try {
    const parsed = new URL(url);
    const segments = parsed.pathname.split('/');
    const candidate = segments[segments.length - 1] ?? '';
    const filename = candidate.length > 0 ? decodeURIComponent(candidate) : 'Video';
    const extension = filename.includes('.') ? filename.split('.').pop()?.toLowerCase() ?? null : null;
    const mimeType = (() => {
      switch (extension) {
        case 'mp4':
          return 'video/mp4';
        case 'webm':
          return 'video/webm';
        case 'mov':
          return 'video/quicktime';
        case 'mkv':
          return 'video/x-matroska';
        case 'avi':
          return 'video/x-msvideo';
        default:
          return null;
      }
    })();
    return { filename, extension, mimeType };
  } catch {
    return fallback;
  }
};

const filenameFromUrl = (url: string): string => {
  return extractFileMetadata(url).filename;
};

const guessMimeType = (url: string): string | null => {
  return extractFileMetadata(url).mimeType;
};

const isProbablyUnsupported = (url: string): boolean => {
  const { extension } = extractFileMetadata(url);
  if (!extension) {
    return false;
  }
  return extension !== 'mp4';
};

export const PlayerApp: React.FC = () => {
  const [playerState, setPlayerState] = useState<PlayerState>({ status: 'loading' });
  const runtimeConfig = useMemo(() => readRuntimeConfig(), []);
  const videoRef = useRef<HTMLVideoElement | null>(null);

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

    console.log('[Player] query params', {
      jobId: jobIdParam || null,
      videoUrl: rawUrl || null
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
      if (runtimeConfig.apiBaseUrl) {
        try {
          const normalized = new URL(runtimeConfig.apiBaseUrl);
          return normalized.toString().replace(/\/$/, '');
        } catch (error) {
          throw new Error(
            `Invalid runtime apiBase: ${error instanceof Error ? error.message : String(error)}`
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
      const detailEndpoint = new URL(`jobs/${encodeURIComponent(jobId)}`, `${normalizedBase}/`);
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

      const s3Url = extractUrl(payload.s3_url ?? null);
      const expiresAt = typeof payload.s3_url_expires_at === 'string' ? payload.s3_url_expires_at : null;
      const shortUrl = extractUrl(payload.short_url ?? null);

      if (s3Url && (!expiresAt || !isExpired(expiresAt))) {
        return s3Url;
      }

      if (s3Url && expiresAt && isExpired(expiresAt)) {
        console.warn('[Player] s3_url expired at', expiresAt);
      }

      if (shortUrl) {
        console.log('[Player] falling back to short_url');
        return shortUrl;
      }

      if (s3Url) {
        throw new Error('Download link expired. Try again later.');
      }

      throw new Error('Backend did not provide a downloadable URL.');
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
  }, [runtimeConfig]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || playerState.status !== 'ready') {
      return;
    }

    const onLoaded = (): void => {
      console.log('[Player] metadata loaded', {
        duration: Number.isFinite(video.duration) ? video.duration : null,
        readyState: video.readyState
      });
    };

    const onError = (): void => {
      const error = video.error;
      let message = 'Video playback failed.';
      if (error) {
        switch (error.code) {
          case error.MEDIA_ERR_ABORTED:
            message = 'Playback aborted.';
            break;
          case error.MEDIA_ERR_NETWORK:
            message = 'Network error while streaming the video.';
            break;
          case error.MEDIA_ERR_DECODE:
            message = 'Browser could not decode this video format.';
            break;
          case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
            message = 'Video format not supported by this browser.';
            break;
          default:
            message = 'Unknown playback error.';
        }
      }
      console.error('[Player] video error', { code: error?.code, message: error?.message });
      setPlayerState({
        status: 'error',
        message: `${message} Use the download button to save the file locally.`
      });
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
  }, [playerState]);

  const mediaType = useMemo(() => {
    if (playerState.status === 'ready') {
      return guessMimeType(playerState.url);
    }
    return null;
  }, [playerState]);

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

  const showFormatWarning = playerState.status === 'ready' && isProbablyUnsupported(playerState.url);

  return (
    <div className="page">
      <style>{styles}</style>
      <header className="page__header">
        <h1>{displayName}</h1>
        <p>Stream, download for offline viewing, or AirPlay in Safari.</p>
      </header>
      <section className="player">
        <video
          ref={videoRef}
          key={playerState.url}
          controls
          playsInline
          x-webkit-airplay="allow"
          preload="metadata"
          poster=""
        >
          <source src={playerState.url} type={mediaType ?? undefined} />
        </video>
        <div className="actions">
          {showFormatWarning ? (
            <div className="message message--note">
              This file may not play in the browser. Use the download button if playback does not start.
            </div>
          ) : null}
          <a className="button" href={playerState.url} download rel="noopener" target="_blank">
            Download
          </a>
        </div>
      </section>
    </div>
  );
};
