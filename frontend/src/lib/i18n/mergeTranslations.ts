// English-fallback merge for locale tables.
//
// Non-English locale files may be incomplete (e.g. a newly added feature only
// has en/zh strings yet). Reading a missing nested key at runtime would throw
// (`Cannot read properties of undefined`) and blank the whole UI. Merging every
// locale on top of English guarantees a complete shape: translated keys win,
// anything missing falls back to the English string instead of crashing.
//
// Pure and React-free so content scripts can use it too.

import { enTranslations } from "./translations/en";
import type { TranslationsType } from "./translations/en";

export type Translations = TranslationsType;

function deepMerge(base: unknown, override: unknown): unknown {
  if (override === undefined || override === null) return base;
  if (Array.isArray(base)) {
    // Arrays are replaced wholesale when the locale provides one, else kept.
    return Array.isArray(override) ? override : base;
  }
  if (base && typeof base === "object") {
    const result: Record<string, unknown> = {};
    const baseObj = base as Record<string, unknown>;
    const overrideObj =
      override && typeof override === "object"
        ? (override as Record<string, unknown>)
        : {};
    for (const key of Object.keys(baseObj)) {
      result[key] = deepMerge(baseObj[key], overrideObj[key]);
    }
    return result;
  }
  return override;
}

/**
 * Returns a complete translation table by layering the given locale over the
 * English base. Missing keys fall back to English so the UI never crashes on an
 * incomplete locale.
 */
export function withEnglishFallback(locale: unknown): Translations {
  return deepMerge(enTranslations, locale) as Translations;
}
