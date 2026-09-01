/**
 * Locale Registry — centralized metadata for all supported and planned languages.
 *
 * Architecture:
 * - Each locale has structured metadata (native name, English name, direction, enabled status)
 * - Only enabled locales appear in the language selector
 * - Adding a new language requires:
 *   1. Add locale code to LocaleMeta type
 *   2. Add entry to LOCALE_REGISTRY
 *   3. Create translation resource file (e.g., es.ts)
 *   4. Register resource in i18n/index.ts RESOURCES map
 *   5. Set enabled: true when translations are complete
 *
 * No external dependencies.
 */

export interface LocaleMeta {
  /** BCP-47 language code (e.g., "en", "id", "es") */
  code: string;
  /** Native language name (e.g., "English", "Bahasa Indonesia", "Español") */
  nativeName: string;
  /** English display name (e.g., "English", "Indonesian", "Spanish") */
  englishName: string;
  /** Text direction */
  direction: "ltr" | "rtl";
  /** Whether this locale is enabled for user selection */
  enabled: boolean;
  /** Whether translations are considered production-ready */
  productionReady: boolean;
}

/**
 * Centralized registry of all known locales.
 * Enabled locales appear in the language selector.
 * To add a new language: add an entry here, create the translation file,
 * register it in RESOURCES, and set enabled/productionReady when ready.
 */
export const LOCALE_REGISTRY: Record<string, LocaleMeta> = {
  en: {
    code: "en",
    nativeName: "English",
    englishName: "English",
    direction: "ltr",
    enabled: true,
    productionReady: true,
  },
  id: {
    code: "id",
    nativeName: "Bahasa Indonesia",
    englishName: "Indonesian",
    direction: "ltr",
    enabled: true,
    productionReady: true,
  },
  es: {
    code: "es",
    nativeName: "Español",
    englishName: "Spanish",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  fr: {
    code: "fr",
    nativeName: "Français",
    englishName: "French",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  pt: {
    code: "pt",
    nativeName: "Português",
    englishName: "Portuguese",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  de: {
    code: "de",
    nativeName: "Deutsch",
    englishName: "German",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  ja: {
    code: "ja",
    nativeName: "日本語",
    englishName: "Japanese",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  ko: {
    code: "ko",
    nativeName: "한국어",
    englishName: "Korean",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  zh: {
    code: "zh",
    nativeName: "中文",
    englishName: "Chinese",
    direction: "ltr",
    enabled: false,
    productionReady: false,
  },
  ar: {
    code: "ar",
    nativeName: "العربية",
    englishName: "Arabic",
    direction: "rtl",
    enabled: false,
    productionReady: false,
  },
};

/** Get all enabled locale codes */
export function getEnabledLocaleCodes(): string[] {
  return Object.values(LOCALE_REGISTRY)
    .filter((m) => m.enabled)
    .map((m) => m.code);
}

/** Get all production-ready locale codes */
export function getProductionReadyLocaleCodes(): string[] {
  return Object.values(LOCALE_REGISTRY)
    .filter((m) => m.productionReady)
    .map((m) => m.code);
}

/** Get metadata for a locale, or undefined if not in registry */
export function getLocaleMeta(code: string): LocaleMeta | undefined {
  return LOCALE_REGISTRY[code];
}

/** Check if a locale code is in the registry */
export function isKnownLocale(code: string): boolean {
  return code in LOCALE_REGISTRY;
}

/** Get the display label for a locale (native name) */
export function getLocaleLabel(code: string): string {
  return LOCALE_REGISTRY[code]?.nativeName ?? code;
}

/** Get all locale codes that should appear in the language selector */
export function getSelectableLocales(): LocaleMeta[] {
  return Object.values(LOCALE_REGISTRY).filter((m) => m.enabled);
}

/** Get text direction for a locale */
export function getTextDirection(code: string): "ltr" | "rtl" {
  return LOCALE_REGISTRY[code]?.direction ?? "ltr";
}
