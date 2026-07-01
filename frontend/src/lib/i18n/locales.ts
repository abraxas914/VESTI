// ──────────────────────────────────────────────────────────────────────────
// Locale registry — the single source of truth for every supported language.
//
// TO ADD A NEW LANGUAGE (e.g. Korean "ko"):
//   1. Add its code to SUPPORTED_LOCALES below.
//      → TypeScript will then force you to fill LOCALE_META[code] here AND
//        register its translations in i18n/index.tsx (both are Record<SupportedLocale, …>).
//   2. Add the LOCALE_META[code] entry (native name, date tag, LLM language, aliases).
//   3. Create translations/<code>.ts (mirror en.ts) and register it in i18n/index.tsx.
//
// Everything else — the language switcher options, date/number formatting, and the
// language the LLM writes summaries/weekly/answers in — derives automatically from here.
// ──────────────────────────────────────────────────────────────────────────

export const SUPPORTED_LOCALES = ["en", "zh", "ja", "ko"] as const;
export type SupportedLocale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: SupportedLocale = "en";

export interface LocaleMeta {
  /** Shown in the language switcher, written in the language's own script. */
  nativeName: string;
  /** BCP-47 tag for Intl date/number formatting (toLocaleString, etc.). */
  dateTag: string;
  /** How to name this language inside an LLM output-language instruction. */
  llmLanguage: string;
  /** Browser / BCP-47 codes that should resolve to this locale. */
  aliases: readonly string[];
}

export const LOCALE_META: Record<SupportedLocale, LocaleMeta> = {
  en: {
    nativeName: "English",
    dateTag: "en-US",
    llmLanguage: "natural English",
    aliases: ["en", "en-US", "en-GB", "en-CA", "en-AU"],
  },
  zh: {
    nativeName: "中文",
    dateTag: "zh-CN",
    llmLanguage: "natural Chinese (自然中文)",
    aliases: ["zh", "zh-CN", "zh-TW", "zh-HK", "zh-SG"],
  },
  ja: {
    nativeName: "日本語",
    dateTag: "ja-JP",
    llmLanguage: "natural Japanese (自然な日本語)",
    aliases: ["ja", "ja-JP"],
  },
  ko: {
    nativeName: "한국어",
    dateTag: "ko-KR",
    llmLanguage: "natural Korean (자연스러운 한국어)",
    aliases: ["ko", "ko-KR"],
  },
};

const LOCALE_ALIASES: Record<string, SupportedLocale> = Object.fromEntries(
  SUPPORTED_LOCALES.flatMap((code) =>
    LOCALE_META[code].aliases.map((alias) => [alias, code] as const)
  )
);

export function resolveLocale(raw: string): SupportedLocale {
  if (SUPPORTED_LOCALES.includes(raw as SupportedLocale)) return raw as SupportedLocale;
  if (LOCALE_ALIASES[raw]) return LOCALE_ALIASES[raw];
  const prefix = raw.split("-")[0];
  if (SUPPORTED_LOCALES.includes(prefix as SupportedLocale)) return prefix as SupportedLocale;
  if (LOCALE_ALIASES[prefix]) return LOCALE_ALIASES[prefix];
  return DEFAULT_LOCALE;
}

export function getBrowserLanguage(): string {
  // Access chrome via globalThis (not the bare global) so this file compiles
  // without @types/chrome — e.g. under the leaner eval tsconfig. Runtime behavior
  // is unchanged: inside the extension globalThis.chrome is present.
  const chromeApi = (
    globalThis as unknown as {
      chrome?: { i18n?: { getUILanguage?: () => string } };
    }
  ).chrome;
  const uiLanguage = chromeApi?.i18n?.getUILanguage?.();
  if (uiLanguage) return uiLanguage;
  const nav = (globalThis as unknown as { navigator?: { language?: string } })
    .navigator;
  return nav?.language || "en";
}

/** Native display name for the language switcher (e.g. "日本語"). */
export function getLocaleNativeName(locale: SupportedLocale): string {
  return LOCALE_META[locale].nativeName;
}

/** BCP-47 tag for Intl date/number formatting (e.g. "ja-JP"). */
export function getLocaleDateTag(locale: SupportedLocale): string {
  return LOCALE_META[locale].dateTag;
}

/** Language name to drop into an LLM instruction (e.g. "natural Japanese (自然な日本語)"). */
export function getLlmLanguageName(locale: SupportedLocale): string {
  return LOCALE_META[locale].llmLanguage;
}

/** A complete output-language directive for LLM system/user prompts. */
export function buildLlmOutputDirective(locale: SupportedLocale): string {
  return `Write the user-facing answer in ${LOCALE_META[locale].llmLanguage}, unless the user explicitly requests another language.`;
}

/**
 * Pick a locale-specific value from a small table, falling back to English.
 * `en` is required so there is always a graceful fallback when a language has
 * not been translated for a given string yet.
 */
export function pickLocale<T>(
  locale: SupportedLocale,
  table: { en: T } & Partial<Record<SupportedLocale, T>>
): T {
  return table[locale] ?? table.en;
}
