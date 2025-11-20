/**
 * i18n Hook
 * 
 * Provides translation function and locale management
 */

import { useState, useEffect, useCallback } from "react";
import { translations, type Locale, type Translations } from "./locales.js";

const STORAGE_KEY = "indexerchain_locale";

/**
 * Get initial locale from localStorage or browser language
 */
function getInitialLocale(): Locale {
  if (typeof localStorage !== "undefined") {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved === "zh" || saved === "en") {
      return saved;
    }
  }
  
  // Detect browser language
  if (typeof navigator !== "undefined") {
    const lang = navigator.language.toLowerCase();
    if (lang.startsWith("zh")) {
      return "zh";
    }
  }
  
  return "en"; // Default to English
}

/**
 * Format translation string with placeholders
 * Example: format("Hello {name}", { name: "World" }) => "Hello World"
 */
function format(template: string, params: Record<string, string | number>): string {
  let result = template;
  for (const [key, value] of Object.entries(params)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, "g"), String(value));
  }
  return result;
}

/**
 * Get nested translation value
 * Example: get(t, "mining.title") => t.mining.title
 */
function get(t: Translations, path: string): string {
  const parts = path.split(".");
  let value: any = t;
  for (const part of parts) {
    value = value?.[part];
    if (value === undefined) {
      return path;
    }
  }
  return typeof value === "string" ? value : path;
}

export function useI18n() {
  const [locale, setLocaleState] = useState<Locale>(getInitialLocale);

  // Save locale to localStorage when it changes
  useEffect(() => {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem(STORAGE_KEY, locale);
    }
  }, [locale]);

  const setLocale = useCallback((newLocale: Locale) => {
    setLocaleState(newLocale);
  }, []);

  const t = translations[locale];

  /**
   * Translation function
   * @param path - Translation key path (e.g., "mining.title")
   * @param params - Optional parameters for string formatting
   */
  const translate = useCallback(
    (path: string, params?: Record<string, string | number>): string => {
      const text = get(t, path);
      if (params) {
        return format(text, params);
      }
      return text;
    },
    [t]
  );

  return {
    locale,
    setLocale,
    t: translate,
    translations: t,
  };
}

