import React, { useEffect, useMemo, useState } from 'react';

const REDIRECT_BASE_URL = 'http://ec2-16-170-209-29.eu-north-1.compute.amazonaws.com:8787';

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
    const btihParam = params.get('btih')?.trim() ?? '';
    const rawUrl = params.get('videoUrl')?.trim() ?? '';

    console.log('[Player] query params', { btih: btihParam || null, videoUrl: rawUrl || null });

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

    const resolvePresignedUrl = async (btih: string): Promise<string> => {
      const baseUrl = REDIRECT_BASE_URL;
      let endpoint: URL;

      try {
        endpoint = new URL(`/presigned/${encodeURIComponent(btih)}/info`, baseUrl);
      } catch (error) {
        console.error('[Player] failed to compose presigned endpoint', error);
        throw new Error(
          `Invalid redirect base URL: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      console.log('[Player] fetching presigned info', endpoint.toString());

      let response: Response;
      try {
        response = await fetch(endpoint.toString());
      } catch (error) {
        console.error('[Player] network error while fetching presigned info', error);
        throw new Error(`Network error while fetching presigned link: ${error instanceof Error ? error.message : String(error)}`);
      }

      if (!response.ok) {
        console.error('[Player] presigned lookup failed', response.status, response.statusText);
        throw new Error(`Presigned link lookup failed with status ${response.status}`);
      }

      let payload: unknown;
      try {
        payload = await response.json();
      } catch (error) {
        throw new Error(`Failed to parse presigned response: ${error instanceof Error ? error.message : String(error)}`);
      }

      const urlFromResponse =
        payload && typeof (payload as { url?: unknown }).url === 'string'
          ? (payload as { url: string }).url
          : undefined;

      if (!urlFromResponse) {
        console.error('[Player] presigned payload missing url', payload);
        throw new Error('Presigned response is missing url field.');
      }

      try {
        const normalized = new URL(urlFromResponse);
        if (!['http:', 'https:'].includes(normalized.protocol)) {
          console.error('[Player] invalid protocol in presigned url', normalized.toString());
          throw new Error('Presigned url must be an HTTP or HTTPS link.');
        }
        console.log('[Player] presigned url resolved', normalized.toString());
        return normalized.toString();
      } catch (error) {
        if (error instanceof Error && error.message === 'Presigned url must be an HTTP or HTTPS link.') {
          throw error;
        }
        throw new Error(`Invalid presigned url: ${error instanceof Error ? error.message : String(error)}`);
      }
    };

    const asMessage = (error: unknown): string => (error instanceof Error ? error.message : String(error));

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
      if (btihParam) {
        try {
          const resolved = await resolvePresignedUrl(btihParam);
          setReady(resolved);
          return;
        } catch (error) {
          if (rawUrl.length > 0) {
            console.warn('[Player] btih lookup failed, attempting fallback videoUrl', error);
            try {
              const fallback = resolveVideoUrl(rawUrl);
              setReady(fallback);
              return;
            } catch (fallbackError) {
              console.error('[Player] fallback videoUrl failed', fallbackError);
              setError(
                `Unable to resolve btih ${btihParam}: ${asMessage(error)}. Fallback videoUrl failed: ${asMessage(fallbackError)}`
              );
              return;
            }
          }

          console.error('[Player] btih resolution failed without fallback', error);
          setError(`Unable to resolve btih ${btihParam}: ${asMessage(error)}`);
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

      setError('Missing required btih or videoUrl parameter.');
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
