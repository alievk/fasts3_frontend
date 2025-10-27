import React, { useCallback, useEffect, useMemo, useState } from 'react';

type PlayerState =
  | { status: 'loading' }
  | { status: 'error'; message: string; url?: string }
  | { status: 'ready'; url: string; jobId?: string; expiresAt?: string };

const validateS3Url = (rawValue: string | null): PlayerState => {
  if (!rawValue || rawValue.trim().length === 0) {
    return { status: 'error', message: 'Missing required s3Url parameter.' };
  }

  try {
    const normalized = new URL(rawValue);
    if (!['https:', 'http:'].includes(normalized.protocol)) {
      return { status: 'error', message: 's3Url must be an HTTP or HTTPS link.' };
    }
    return { status: 'ready', url: normalized.toString() };
  } catch (error) {
    return {
      status: 'error',
      message: `Invalid s3Url parameter: ${error instanceof Error ? error.message : String(error)}`
    };
  }
};

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
  const [playbackError, setPlaybackError] = useState<string | null>(null);

  const displayName = useMemo(() => {
    if (playerState.status === 'ready') {
      return filenameFromUrl(playerState.url);
    }
    if (playerState.status === 'error' && playerState.url) {
      return filenameFromUrl(playerState.url);
    }
    return 'S3 Player';
  }, [playerState]);

  const checkS3Link = useCallback(
    async (
      url: string
    ): Promise<
      | { ok: true }
      | { ok: false; reason: 'http'; status: number; statusText: string }
      | { ok: false; reason: 'network' }
    > => {
      try {
        const response = await fetch(url, { method: 'HEAD', mode: 'cors' });
        if (response.ok || response.status === 405) {
          return { ok: true };
        }
        return {
          ok: false,
          reason: 'http',
          status: response.status,
          statusText: response.statusText ?? 'Error'
        };
      } catch {
        return { ok: false, reason: 'network' };
      }
    },
    []
  );

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const jobId = params.get('jobId');
    const directUrlParam = params.get('s3Url');

    if (jobId) {
      let cancelled = false;
      const load = async () => {
        setPlayerState({ status: 'loading' });
        try {
          const infoResponse = await fetch(`/presigned/${encodeURIComponent(jobId)}/info`, {
            headers: { Accept: 'application/json' }
          });

          if (cancelled) {
            return;
          }

          if (infoResponse.status === 404) {
            setPlayerState({
              status: 'error',
              message: 'No shortcut is registered for this job. Ask the owner to generate a fresh link.'
            });
            return;
          }

          if (infoResponse.status === 410) {
            const payload = await infoResponse.json().catch<Partial<{ expiresAt: string }>>(() => ({}));
            const expiresAt = payload?.expiresAt
              ? ` (expired at ${new Date(payload.expiresAt).toLocaleString()})`
              : '';
            setPlayerState({
              status: 'error',
              message: `This streaming shortcut has expired${expiresAt}. Request a new link.`
            });
            return;
          }

          if (!infoResponse.ok) {
            const body = await infoResponse.text().catch(() => '');
            throw new Error(body || `Failed to load shortcut metadata (HTTP ${infoResponse.status}).`);
          }

          const payload = (await infoResponse.json()) as {
            status: 'ready';
            jobId: string;
            url?: string;
            expiresAt?: string;
            createdAt?: string;
          };

          if (cancelled) {
            return;
          }

          if (!payload.url) {
            setPlayerState({
              status: 'error',
              message: 'Shortcut metadata is missing the streaming URL. Request a new link.'
            });
            return;
          }

          const availability = await checkS3Link(payload.url);
          if (cancelled) {
            return;
          }

          if (!availability.ok) {
            const message =
              availability.reason === 'http'
                ? `Shortcut is registered, but the file responded with ${availability.status} ${availability.statusText}. Ask the owner to regenerate the presigned link.`
                : 'Shortcut is registered, but the browser cannot reach the S3 file. It may have been removed or the network is blocking it.';

            setPlayerState({
              status: 'error',
              message,
              url: payload.url
            });
            return;
          }

          setPlaybackError(null);
          setPlayerState({
            status: 'ready',
            url: payload.url,
            jobId: payload.jobId,
            expiresAt: payload.expiresAt
          });
        } catch (error) {
          if (cancelled) {
            return;
          }
          setPlayerState({
            status: 'error',
            message:
              error instanceof Error
                ? error.message || 'Failed to load shortcut metadata. Try refreshing the page.'
                : 'Failed to load shortcut metadata. Try refreshing the page.'
          });
        }
      };

      void load();
      return () => {
        cancelled = true;
      };
    }

    const fallback = validateS3Url(directUrlParam);
    setPlayerState(fallback);
  }, [checkS3Link]);

  useEffect(() => {
    if (playerState.status === 'ready') {
      document.title = `${filenameFromUrl(playerState.url)} • S3 Player`;
    } else if (playerState.status === 'error' && playerState.url) {
      document.title = `${filenameFromUrl(playerState.url)} • S3 Player`;
    } else {
      document.title = 'S3 Player';
    }
  }, [playerState]);

  const diagnosePlaybackFailure = useCallback(
    async (url: string) => {
      const result = await checkS3Link(url);
      if (!result.ok) {
        if (result.reason === 'http') {
          setPlaybackError(
            `Playback failed. The file responded with ${result.status} ${result.statusText}. Try downloading the video instead.`
          );
          return;
        }
        setPlaybackError('Playback failed. The browser could not reach the S3 file. Try downloading the video instead.');
        return;
      }
      setPlaybackError('Playback failed even though the file is reachable. Try downloading the video instead.');
    },
    [checkS3Link]
  );

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
        {playerState.url && (
          <div className="actions">
            <a className="button" href={playerState.url} download rel="noopener" target="_blank">
              Download
            </a>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="page">
      <style>{styles}</style>
      <header className="page__header">
        <h1>{displayName}</h1>
        <p>Stream directly from S3, download for offline viewing, or AirPlay in Safari.</p>
      </header>
      <section className="player">
        <video
          key={playerState.url}
          controls
          playsInline
          x-webkit-airplay="allow"
          preload="metadata"
          poster=""
          onError={() => {
            void diagnosePlaybackFailure(playerState.url);
          }}
          onPlay={() => setPlaybackError(null)}
        >
          <source src={playerState.url} />
        </video>
        {playbackError && <div className="message message--error">{playbackError}</div>}
        {playerState.expiresAt && (
          <div className="message message--note">Shortcut expires at {new Date(playerState.expiresAt).toLocaleString()}.</div>
        )}
        <div className="actions">
          <a className="button" href={playerState.url} download rel="noopener" target="_blank">
            Download
          </a>
        </div>
      </section>
    </div>
  );
};
