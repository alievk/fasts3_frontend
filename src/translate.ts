import type { BotTranslations } from './types.js';
import botTranslationsData from './locales/bot.json' with { type: 'json' };

export const PRIMARY_LOCALE = 'ru';
export type TranslationParams = Record<string, string | number>;

let translations: BotTranslations = botTranslationsData as BotTranslations;

export const setTranslations = (t: BotTranslations): void => {
  translations = t;
};

export const isSupportedLocale = (locale?: string): locale is string =>
  Boolean(locale && Object.prototype.hasOwnProperty.call(translations, locale));

const normalizeValue = (value: string | string[]): string =>
  Array.isArray(value) ? value.join('') : value;

const resolveTemplate = (locale: string, key: string): string | undefined => {
  const value = translations[locale]?.[key];
  return value === undefined ? undefined : normalizeValue(value);
};

const formatTemplate = (template: string, params?: TranslationParams): string =>
  template.replace(/\{([^}]+)\}/g, (_match, token: string) => {
    const value = params?.[token.trim()];
    return value === undefined ? '' : String(value);
  });

export const translate = (key: string, locale: string, params?: TranslationParams): string => {
  const template = resolveTemplate(locale, key) ?? resolveTemplate(PRIMARY_LOCALE, key) ?? key;
  return formatTemplate(template, params);
};

export const resolveLocale = (locale: string | null | undefined): string =>
  locale && isSupportedLocale(locale) ? locale : PRIMARY_LOCALE;

export const getAvailableLocales = (): string[] =>
  Object.keys(translations).filter(isSupportedLocale);

