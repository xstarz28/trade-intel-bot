/**
 * Locale Registry — Centralized metadata for all supported languages.
 *
 * This registry defines:
 * - Locale codes
 * - Native language names
 * - English display names
 * - Text direction (ltr/rtl)
 * - Enabled status (only enabled locales appear in the selector)
 * - Translation resource availability
 *
 * To add a new language:
 * 1. Create src/lib/i18n/{locale}.ts with the Translations interface
 * 2. Add the locale here with enabled: true
 * 3. Import and register it in src/lib/i18n/index.ts
 * 4. Add tests for key parity
 */

import type { Locale } from "./types";

// ─── Locale Metadata ───────────────────────────────────────────

export interface LocaleMetadata {
  /** BCP 47 language code */
  locale: Locale;
  /** Native language name (as displayed to native speakers) */
  nativeName: string;
  /** English display name */
  englishName: string;
  /** Text direction */
  direction: "ltr" | "rtl";
  /** Whether this locale is production-ready and selectable */
  enabled: boolean;
  /** Whether translation resources are fully loaded */
  available: boolean;
}

// ─── Locale Registry ───────────────────────────────────────────

export const LOCALE_REGISTRY: LocaleMetadata[] = [
  // ─── Enabled (production-ready) ───────────────────────────
  {
    locale: "en",
    nativeName: "English",
    englishName: "English",
    direction: "ltr",
    enabled: true,
    available: true,
  },
  {
    locale: "id",
    nativeName: "Bahasa Indonesia",
    englishName: "Indonesian",
    direction: "ltr",
    enabled: true,
    available: true,
  },

  // ─── Planned (not yet enabled) ────────────────────────────
  {
    locale: "es",
    nativeName: "Español",
    englishName: "Spanish",
    direction: "ltr",
    enabled: true,
    available: true,
  },
  {
    locale: "fr",
    nativeName: "Français",
    englishName: "French",
    direction: "ltr",
    enabled: false,
    available: false,
  },
  {
    locale: "pt",
    nativeName: "Português",
    englishName: "Portuguese",
    direction: "ltr",
    enabled: false,
    available: false,
  },
  {
    locale: "de",
    nativeName: "Deutsch",
    englishName: "German",
    direction: "ltr",
    enabled: false,
    available: false,
  },
  {
    locale: "ja",
    nativeName: "日本語",
    englishName: "Japanese",
    direction: "ltr",
    enabled: false,
    available: false,
  },
  {
    locale: "ko",
    nativeName: "한국어",
    englishName: "Korean",
    direction: "ltr",
    enabled: false,
    available: false,
  },
  {
    locale: "zh",
    nativeName: "中文",
    englishName: "Chinese",
    direction: "ltr",
    enabled: false,
    available: false,
  },
];

// ─── Derived Constants (single source of truth) ───────────────

/**
 * All enabled locale codes, derived from the registry.
 * This is the canonical source — types.ts re-exports it for consumers.
 */
export const SUPPORTED_LOCALES: Locale[] = LOCALE_REGISTRY
  .filter((l) => l.enabled)
  .map((l) => l.locale);

/**
 * Native display labels for all locales, derived from the registry.
 * Used by the language selector.
 */
export const LOCALE_LABELS: Record<Locale, string> = Object.fromEntries(
  LOCALE_REGISTRY.map((l) => [l.locale, l.nativeName]),
) as Record<Locale, string>;

// ─── Helpers ───────────────────────────────────────────────────

/** Get metadata for a specific locale */
export function getLocaleMetadata(locale: Locale): LocaleMetadata | undefined {
  return LOCALE_REGISTRY.find((l) => l.locale === locale);
}

/** Get all enabled locales */
export function getEnabledLocales(): LocaleMetadata[] {
  return LOCALE_REGISTRY.filter((l) => l.enabled);
}

/** Get all available locales (have translation resources loaded) */
export function getAvailableLocales(): LocaleMetadata[] {
  return LOCALE_REGISTRY.filter((l) => l.available);
}

/** Check if a locale is enabled */
export function isLocaleEnabled(locale: Locale): boolean {
  return LOCALE_REGISTRY.some((l) => l.locale === locale && l.enabled);
}

/** Check if a locale has translation resources available */
export function isLocaleAvailable(locale: Locale): boolean {
  return LOCALE_REGISTRY.some((l) => l.locale === locale && l.available);
}

/**
 * Normalize a browser locale string to a supported locale code.
 *
 * Examples:
 * - "en-US" → "en"
 * - "fr-FR" → "fr" (if enabled)
 * - "pt-BR" → "pt" (if enabled)
 * - "zh-CN" → "zh" (if enabled)
 * - "ja-JP" → "ja" (if enabled)
 * - "ko-KR" → "ko" (if enabled)
 * - "de-DE" → "de" (if enabled)
 * - "es-ES" → "es" (if enabled)
 *
 * Returns null if no supported locale is found.
 */
export function normalizeBrowserLocale(browserLocale: string): Locale | null {
  // Extract the base language code (before the hyphen)
  const base = browserLocale.split("-")[0].toLowerCase();

  // Check if this base code maps to a supported locale
  const match = LOCALE_REGISTRY.find((l) => l.locale === base);
  if (match && match.enabled) {
    return match.locale;
  }

  return null;
}

/**
 * Get the display name for a locale (native name preferred).
 */
export function getLocaleDisplayName(locale: Locale): string {
  const meta = getLocaleMetadata(locale);
  return meta?.nativeName ?? locale;
}

/**
 * Get the text direction for a locale.
 */
export function getLocaleDirection(locale: Locale): "ltr" | "rtl" {
  const meta = getLocaleMetadata(locale);
  return meta?.direction ?? "ltr";
}
