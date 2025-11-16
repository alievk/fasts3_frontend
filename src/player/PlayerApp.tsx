import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

if (typeof window !== 'undefined') {
  console.log('[Player] bundle loaded');
}

const SUPPORTED_LOCALES = ['ru', 'en'] as const;
type Locale = (typeof SUPPORTED_LOCALES)[number];

interface ErrorDescriptor {
  key: string;
  params?: Record<string, string | number | ErrorDescriptor | undefined>;
}

type LocaleMessages = Record<string, string>;

const LOCALES_FILE = 'locales.json';

const LOCALE_OPTIONS: { code: Locale; label: string }[] = [
  { code: 'ru', label: 'RU' },
  { code: 'en', label: 'EN' }
];

const DEFAULT_LOCALE: Locale = 'ru';
const LOCALE_STORAGE_KEY = 'torrent_player_locale';

const isLocale = (value: string | null | undefined): value is Locale =>
  Boolean(value && SUPPORTED_LOCALES.includes(value as Locale));

const readInitialLocale = (): Locale => {
  if (typeof window === 'undefined') return DEFAULT_LOCALE;
  try {
    const stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
    if (isLocale(stored)) return stored;
  } catch {
    // ignore
  }
  return DEFAULT_LOCALE;
};

const buildLocalesUrl = (): string => new URL(`../${LOCALES_FILE}`, import.meta.url).toString();

const parseLocalesPayload = (payload: unknown): Map<Locale, LocaleMessages> => {
  const map = new Map<Locale, LocaleMessages>();
  if (!payload || typeof payload !== 'object') {
    return map;
  }
  const record = payload as Record<string, unknown>;
  for (const locale of SUPPORTED_LOCALES) {
    const candidate = record[locale];
    if (!candidate || typeof candidate !== 'object') {
      continue;
    }
    const messages: LocaleMessages = {};
    for (const [key, value] of Object.entries(candidate as Record<string, unknown>)) {
      if (typeof value === 'string') {
        messages[key] = value;
      }
    }
    if (Object.keys(messages).length > 0) {
      map.set(locale, messages);
    }
  }
  return map;
};

class PlayerError extends Error {
  descriptor: ErrorDescriptor;

  constructor(descriptor: ErrorDescriptor) {
    super(descriptor.key);
    this.descriptor = descriptor;
    this.name = 'PlayerError';
  }
}

const describeUnknownError = (error: unknown): ErrorDescriptor => {
  if (error instanceof PlayerError) {
    return error.descriptor;
  }
  if (error instanceof Error) {
    return { key: 'errors.generic', params: { message: error.message } };
  }
  return { key: 'errors.generic', params: { message: String(error) } };
};

type PlayerState =
  | { status: 'loading' }
  | { status: 'error'; error: ErrorDescriptor }
  | { status: 'ready'; url: string; label: string | null };

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

export const PlayerApp: React.FC = () => {
  const [playerState, setPlayerState] = useState<PlayerState>({ status: 'loading' });
  const [locale, setLocale] = useState<Locale>(() => readInitialLocale());
  const [messages, setMessages] = useState<LocaleMessages | null>(null);
  const [localeLoadError, setLocaleLoadError] = useState<string | null>(null);
  const runtimeConfig = useMemo(() => readRuntimeConfig(), []);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const localeCache = useRef<Map<Locale, LocaleMessages>>(new Map());

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      // ignore
    }
  }, [locale]);

  useEffect(() => {
    let cancelled = false;
    const cached = localeCache.current.get(locale);
    if (cached) {
      setMessages(cached);
      setLocaleLoadError(null);
      return;
    }

    setMessages(null);
    const controller = new AbortController();
    setLocaleLoadError(null);

    const load = async (): Promise<void> => {
      try {
        const response = await fetch(buildLocalesUrl(), { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
        const payload = await response.json();
        const parsed = parseLocalesPayload(payload);
        parsed.forEach((value, code) => {
          localeCache.current.set(code, value);
        });
        const resolved = localeCache.current.get(locale);
        if (!cancelled) {
          if (resolved) {
            setMessages(resolved);
            setLocaleLoadError(null);
          } else {
            setLocaleLoadError(`Locale ${locale} missing in payload.`);
          }
        }
      } catch (error) {
        if (cancelled) return;
        console.error('[Player] failed to load locales', error);
        setLocaleLoadError(error instanceof Error ? error.message : String(error));
      }
    };

    void load();

    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [locale]);

  const renderDescriptor = useCallback(
    (descriptor: ErrorDescriptor): string => {
      if (!messages) return descriptor.key;
      const template = messages[descriptor.key];
      if (!template) return descriptor.key;
      if (!descriptor.params) return template;
      return template.replace(/\{\{(\w+)\}\}/g, (_, token) => {
        const value = descriptor.params?.[token];
        if (value === undefined || value === null) {
          return '';
        }
        if (typeof value === 'object' && 'key' in value) {
          return renderDescriptor(value as ErrorDescriptor);
        }
        return String(value);
      });
    },
    [messages]
  );

  const translate = useCallback(
    (key: string, params?: Record<string, string | number | ErrorDescriptor | undefined>): string =>
      renderDescriptor({ key, params }),
    [renderDescriptor]
  );

  const displayLabel = useMemo(() => {
    if (playerState.status !== 'ready') return null;
    const v = typeof playerState.label === 'string' ? playerState.label.trim() : '';
    return v.length > 0 ? v : null;
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
        throw new PlayerError({ key: 'errors.videoUrlMissing' });
      }

      try {
        const normalized = new URL(trimmed);
        if (!['http:', 'https:'].includes(normalized.protocol)) {
          throw new PlayerError({ key: 'errors.videoUrlProtocol' });
        }
        return normalized.toString();
      } catch (error) {
        if (error instanceof PlayerError) {
          throw error;
        }
        throw new PlayerError({
          key: 'errors.videoUrlInvalid',
          params: { message: error instanceof Error ? error.message : String(error) }
        });
      }
    };

    const resolveApiBase = (): string => {
      if (runtimeConfig.apiBaseUrl) {
        try {
          const normalized = new URL(runtimeConfig.apiBaseUrl);
          return normalized.toString().replace(/\/$/, '');
        } catch (error) {
          throw new PlayerError({
            key: 'errors.runtimeApiInvalid',
            params: { message: error instanceof Error ? error.message : String(error) }
          });
        }
      }

      try {
        const fallback = new URL('/api', window.location.origin);
        return fallback.toString().replace(/\/$/, '');
      } catch (error) {
        throw new PlayerError({
          key: 'errors.apiBaseResolutionFailed',
          params: { message: error instanceof Error ? error.message : String(error) }
        });
      }
    };

    const fetchJson = async (endpoint: URL): Promise<unknown> => {
      console.log('[Player] fetching', endpoint.toString());
      const headers: Record<string, string> = {};
      let response: Response;
      try {
        response = await fetch(endpoint.toString(), { headers });
      } catch (error) {
        console.error('[Player] network error while fetching', endpoint.toString(), error);
        throw new PlayerError({
          key: 'errors.fetchNetwork',
          params: {
            path: endpoint.pathname,
            message: error instanceof Error ? error.message : String(error)
          }
        });
      }

      if (response.status === 404) {
        throw new PlayerError({ key: 'errors.jobNotFound' });
      }

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new PlayerError({
          key: 'errors.requestFailed',
          params: {
            status: String(response.status),
            body: body ? ` — ${body}` : ''
          }
        });
      }

      if (response.status === 204) {
        return undefined;
      }

      try {
        return await response.json();
      } catch (error) {
        throw new PlayerError({
          key: 'errors.responseParsing',
          params: {
            path: endpoint.pathname,
            message: error instanceof Error ? error.message : String(error)
          }
        });
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

    const fetchJobDownloadUrl = async (
      jobId: string,
      apiBase: string
    ): Promise<{ url: string; label: string | null }> => {
      const normalizedBase = apiBase.replace(/\/$/, '');
      const detailEndpoint = new URL(`jobs/${encodeURIComponent(jobId)}`, `${normalizedBase}/`);
      const payload = (await fetchJson(detailEndpoint)) as Record<string, unknown> | undefined;

      if (!payload || typeof payload !== 'object') {
        throw new PlayerError({ key: 'errors.jobDetailsUnavailable' });
      }

      const status = typeof payload.status === 'string' ? payload.status : 'unknown';
      if (status === 'error') {
        const message =
          typeof payload.error === 'string' && payload.error.trim().length > 0
            ? payload.error.trim()
            : null;
        if (message) {
          throw new PlayerError({ key: 'errors.jobFailedWithReason', params: { reason: message } });
        }
        throw new PlayerError({ key: 'errors.jobFailedGeneric' });
      }

      if (status !== 'completed') {
        throw new PlayerError({ key: 'errors.jobNotReady', params: { jobId, status } });
      }

      const shortUrl = extractUrl(payload.short_url ?? null);
      const label =
        typeof payload.label === 'string' && payload.label.trim().length > 0 ? payload.label.trim() : null;
      if (shortUrl) return { url: shortUrl, label };

      throw new PlayerError({ key: 'errors.missingRedirect' });
    };

    let cancelled = false;

    const setReady = (url: string, label: string | null) => {
      if (!cancelled) {
        setPlayerState({
          status: 'ready',
          url,
          label
        });
        console.log('[Player] ready with url', url);
      }
    };

    const setError = (descriptor: ErrorDescriptor) => {
      if (!cancelled) {
        setPlayerState({
          status: 'error',
          error: descriptor
        });
        console.error('[Player] error state', descriptor);
      }
    };

    const run = async (): Promise<void> => {
      if (jobIdParam) {
        try {
          const apiBase = resolveApiBase();
          const { url, label } = await fetchJobDownloadUrl(jobIdParam, apiBase);
          setReady(url, label);
          return;
        } catch (error) {
          if (rawUrl.length > 0) {
            console.warn('[Player] job lookup failed, attempting fallback videoUrl', error);
            try {
              const fallback = resolveVideoUrl(rawUrl);
              setReady(fallback, null);
              return;
            } catch (fallbackError) {
              console.error('[Player] fallback videoUrl failed', fallbackError);
              setError(
                {
                  key: 'errors.jobResolveWithFallback',
                  params: {
                    jobId: jobIdParam,
                    primary: describeUnknownError(error),
                    fallback: describeUnknownError(fallbackError)
                  }
                }
              );
              return;
            }
          }

          console.error('[Player] job resolution failed without fallback', error);
          setError({
            key: 'errors.jobResolve',
            params: {
              jobId: jobIdParam,
              error: describeUnknownError(error)
            }
          });
          return;
        }
      }

      if (rawUrl.length > 0) {
        try {
          const normalized = resolveVideoUrl(rawUrl);
          setReady(normalized, null);
        } catch (error) {
          console.error('[Player] invalid videoUrl parameter', error);
          setError(describeUnknownError(error));
        }
        return;
      }

      setError({ key: 'errors.jobOrUrlMissing' });
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
      let descriptor: ErrorDescriptor = { key: 'errors.videoPlaybackFailed' };
      if (error) {
        switch (error.code) {
          case error.MEDIA_ERR_ABORTED:
            descriptor = { key: 'errors.videoPlaybackAborted' };
            break;
          case error.MEDIA_ERR_NETWORK:
            descriptor = { key: 'errors.videoPlaybackNetwork' };
            break;
          case error.MEDIA_ERR_DECODE:
            descriptor = { key: 'errors.videoPlaybackDecode' };
            break;
          case error.MEDIA_ERR_SRC_NOT_SUPPORTED:
            descriptor = { key: 'errors.videoPlaybackUnsupported' };
            break;
          default:
            descriptor = { key: 'errors.videoPlaybackUnknown' };
        }
      }
      console.error('[Player] video error', { code: error?.code, message: error?.message });
      setPlayerState({
        status: 'error',
        error: descriptor
      });
    };

    video.addEventListener('loadedmetadata', onLoaded);
    video.addEventListener('error', onError);

    return () => {
      video.removeEventListener('loadedmetadata', onLoaded);
      video.removeEventListener('error', onError);
    };
  }, [playerState]);

  // Do not guess media type from URL; backend link lacks filename.

  useEffect(() => {
    if (!messages) {
      document.title = 'Video Player';
      return;
    }
    if (playerState.status === 'ready' && displayLabel) {
      document.title = translate('title.withLabel', {
        label: displayLabel,
        title: translate('title.base')
      });
    } else {
      document.title = translate('title.base');
    }
  }, [playerState, displayLabel, messages, translate]);

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
      order: 2;
      width: min(100%, 960px);
      text-align: left;
      align-self: center;
    }

    .page__toolbar {
      width: 100%;
      display: flex;
      justify-content: flex-end;
    }

    .locale-switch {
      display: inline-flex;
      gap: 4px;
      padding: 4px;
      border-radius: 999px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
    }

    .locale-switch__button {
      border: none;
      background: transparent;
      color: #f5f5f7;
      padding: 4px 12px;
      border-radius: 999px;
      font-size: 12px;
      font-weight: 600;
      cursor: pointer;
      transition: background 0.2s ease-in-out, color 0.2s ease-in-out;
    }

    .locale-switch__button--active {
      background: #1f6feb;
      color: #ffffff;
    }

    .locale-switch__button:focus-visible {
      outline: 2px solid rgba(31, 111, 235, 0.6);
      outline-offset: 1px;
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
      order: 1;
      width: min(100%, 960px);
      display: flex;
      flex-direction: column;
      gap: 12px;
    }

    video {
      width: 100%;
      aspect-ratio: 16 / 9;
      display: block;
      background: #000;
      border-radius: 16px;
      border: 1px solid rgba(255, 255, 255, 0.1);
      overflow: hidden;
      object-fit: contain;
    }

    .actions {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      justify-content: flex-end;
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

  if (!messages) {
    return (
      <div className="page">
        <style>{styles}</style>
        <div className={`message${localeLoadError ? ' message--error' : ''}`}>
          {localeLoadError ? `Failed to load locales (${locale}). ${localeLoadError}` : 'Loading language…'}
        </div>
      </div>
    );
  }

  if (playerState.status === 'loading') {
    return (
      <div className="page">
        <style>{styles}</style>
        <div className="message">{translate('messages.loading')}</div>
      </div>
    );
  }

  if (playerState.status === 'error') {
    return (
      <div className="page">
        <style>{styles}</style>
        <div className="message message--error">{renderDescriptor(playerState.error)}</div>
      </div>
    );
  }

  

  return (
    <div className="page">
      <style>{styles}</style>
      <div className="page__toolbar">
        <div className="locale-switch" role="group" aria-label={translate('locale.label')}>
          {LOCALE_OPTIONS.map((option) => (
            <button
              key={option.code}
              type="button"
              className={`locale-switch__button${locale === option.code ? ' locale-switch__button--active' : ''}`}
              onClick={() => {
                if (locale !== option.code) {
                  setLocale(option.code);
                }
              }}
              aria-pressed={locale === option.code}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <header className="page__header">
        {displayLabel ? <h1>{displayLabel}</h1> : null}
        <p>{translate('page.tagline')}</p>
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
          <source src={playerState.url} />
        </video>
        <div className="actions">
          <a className="button" href={playerState.url} download rel="noopener" target="_blank">
            {translate('buttons.download')}
          </a>
        </div>
      </section>
    </div>
  );
};
