import { createContext, useContext, useEffect, useState, useCallback } from "react";
import type { ReactNode } from "react";
import type { SupportedLocale } from "./locales";
import { enTranslations } from "./translations/en";
import type { TranslationsType } from "./translations/en";
import { zhTranslations } from "./translations/zh";
import { jaTranslations } from "./translations/ja";
import { koTranslations } from "./translations/ko";
import { withEnglishFallback } from "./mergeTranslations";
import { detectAndSetLanguage, setLanguage, subscribeLanguageSettings } from "../services/languageSettingsService";

// Translation registration point. To add a language: create translations/<code>.ts
// (mirroring en.ts) and add one line here. The Record<SupportedLocale, …> type forces
// this map to stay complete, and the rest of the locale wiring lives in ./locales.
export type Translations = TranslationsType;

// Every locale is layered over English so an incomplete translation file falls
// back to English strings instead of crashing the UI on a missing nested key.
const translationsByLocale: Record<SupportedLocale, Translations> = {
  en: enTranslations,
  zh: withEnglishFallback(zhTranslations),
  ja: withEnglishFallback(jaTranslations),
  ko: withEnglishFallback(koTranslations),
};

interface I18nContextValue {
  locale: SupportedLocale;
  t: Translations;
  setLocale: (locale: SupportedLocale) => Promise<void>;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<SupportedLocale>("en");
  const [t, setT] = useState<Translations>(enTranslations);

  useEffect(() => {
    let cancelled = false;

    // detectAndSetLanguage 首次安装时检测浏览器语言并写入 storage；
    // 如果用户已手动选择过语言（userOverridden=true），则直接返回用户偏好。
    detectAndSetLanguage()
      .then((resolvedLocale) => {
        if (cancelled) return;
        setLocaleState(resolvedLocale);
        setT(translationsByLocale[resolvedLocale]);
      })
      .catch(() => {});

    const unsubscribe = subscribeLanguageSettings((settings) => {
      if (cancelled) return;
      setLocaleState(settings.locale);
      setT(translationsByLocale[settings.locale]);
    });

    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  const changeLocale = useCallback(async (newLocale: SupportedLocale) => {
    await setLanguage(newLocale);
    setLocaleState(newLocale);
    setT(translationsByLocale[newLocale]);
  }, []);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale: changeLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within I18nProvider");
  return ctx;
}
