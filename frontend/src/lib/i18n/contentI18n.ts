// Content-script-safe i18n accessor (NO React).
//
// Content scripts can't use the useI18n() hook / I18nProvider, but they still
// need localized strings that react to language changes. This reuses the same
// translation objects and the chrome.storage-backed languageSettingsService so
// a content script stays in sync with the dashboard's language selection.
//
// Importing the translation *objects* (not the React index.tsx) keeps React out
// of the content bundle.

import { enTranslations } from "./translations/en";
import type { TranslationsType } from "./translations/en";
import { zhTranslations } from "./translations/zh";
import { jaTranslations } from "./translations/ja";
import { koTranslations } from "./translations/ko";
import { withEnglishFallback } from "./mergeTranslations";
import type { SupportedLocale } from "./locales";
import {
  getLanguageSettings,
  subscribeLanguageSettings,
} from "../services/languageSettingsService";

// Same widened, string-leaf shape used by the React i18n provider.
export type Translations = TranslationsType;

// Layer every locale over English so an incomplete translation file falls back
// to English strings instead of crashing a content script on a missing key.
const TRANSLATIONS: Record<SupportedLocale, Translations> = {
  en: enTranslations,
  zh: withEnglishFallback(zhTranslations),
  ja: withEnglishFallback(jaTranslations),
  ko: withEnglishFallback(koTranslations),
};

/** Resolve the current translations once (defaults to English on any failure). */
export async function getContentTranslations(): Promise<Translations> {
  try {
    const { locale } = await getLanguageSettings();
    return TRANSLATIONS[locale] ?? enTranslations;
  } catch {
    return enTranslations;
  }
}

/**
 * Subscribe to live language changes. Calls back with the new translations
 * whenever the user switches language. Returns an unsubscribe function.
 */
export function onLocaleChange(
  listener: (t: Translations, locale: SupportedLocale) => void,
): () => void {
  return subscribeLanguageSettings((settings) => {
    listener(TRANSLATIONS[settings.locale] ?? enTranslations, settings.locale);
  });
}
