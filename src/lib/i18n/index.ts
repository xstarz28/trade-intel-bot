/**
 * i18n — Lightweight internationalization for Freebuff Trading Intelligence.
 *
 * Architecture:
 * - React Context for language state
 * - Typed translation resources per locale
 * - Centralized locale registry with metadata
 * - localStorage persistence
 * - Browser locale detection with English fallback
 * - Missing-key fallback to English
 * - Locale-aware formatting helpers
 *
 * No external dependencies.
 */
import React, {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
} from "react";
import type { Locale, Translations } from "./types";
import { DEFAULT_LOCALE, ALL_LOCALES } from "./types";
import en from "./en";
import id from "./id";
import es from "./es";
import {
  SUPPORTED_LOCALES,
  LOCALE_REGISTRY,
  getLocaleMetadata,
  getEnabledLocales,
  normalizeBrowserLocale,
  getLocaleDisplayName,
  getLocaleDirection,
} from "./locales";

// ─── Resource registry ─────────────────────────────────────────

/** Lazy-loaded resource map — only loads enabled locales */
const RESOURCE_MAP: Record<string, Translations> = {
  en,
  id,
  es,
};

/**
 * Get translation resource for a locale.
 * Falls back to English if the locale's resources are not loaded.
 */
function getResource(locale: Locale): Translations {
  return RESOURCE_MAP[locale] ?? RESOURCE_MAP[DEFAULT_LOCALE];
}

// ─── localStorage helpers ──────────────────────────────────────

const STORAGE_KEY = "freebuff:locale";

function readPersistedLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isSupportedLocale(raw)) return raw;
  } catch {
    // localStorage unavailable (SSR, private mode, etc.)
  }
  return null;
}

function persistLocale(locale: Locale): void {
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {
    // ignore
  }
}

// ─── Browser locale detection ──────────────────────────────────

function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;

  const langs = navigator.languages ?? [navigator.language];

  for (const lang of langs) {
    // Try exact match first (e.g., "en")
    const exact = lang.split("-")[0].toLowerCase();
    if (isSupportedLocale(exact)) return exact;

    // Try normalized match through registry
    const normalized = normalizeBrowserLocale(lang);
    if (normalized) return normalized;
  }

  return DEFAULT_LOCALE;
}

function isSupportedLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}



// ─── Resolve initial locale ────────────────────────────────────

function resolveInitialLocale(): Locale {
  const persisted = readPersistedLocale();
  if (persisted) return persisted;

  const detected = detectBrowserLocale();
  return detected;
}

// ─── Context ───────────────────────────────────────────────────

export interface I18nContextValue {
  /** Current locale code */
  locale: Locale;
  /** Set the active locale */
  setLocale: (locale: Locale) => void;
  /** Translation resource for the current locale */
  t: Translations;
  /**
   * Dot-path key lookup: tx("nav.analysis") → t.nav.analysis
   * Falls back to English, then returns the raw key.
   */
  tx: (key: string) => string;
  /**
   * Translate with interpolation: txi("positions.count", { count: 4 })
   * Supports {var} placeholders in translation strings.
   */
  txi: (key: string, vars?: Record<string, string | number>) => string;
  /** Get metadata for the current locale */
  getLocaleInfo: () => { displayName: string; direction: "ltr" | "rtl" };
  /** Get all enabled locales for the selector */
  getEnabledLocales: () => Locale[];
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    // Only allow setting enabled locales
    if (isSupportedLocale(next)) {
      setLocaleState(next);
      persistLocale(next);
    }
  }, []);

  const t = getResource(locale);

  /**
   * Dot-path key lookup with strengthened fallback:
   * 1. Current locale
   * 2. English (always available)
   * 3. Raw key as last resort
   */
  const tx = useCallback(
    (key: string): string => {
      const enResource = RESOURCE_MAP[DEFAULT_LOCALE];

      // Try current locale first
      const currentVal = getNestedValue(t, key);
      if (currentVal !== undefined) return currentVal;

      // Fallback to English
      const enVal = getNestedValue(enResource, key);
      if (enVal !== undefined) return enVal;

      // Return key itself as last resort (never undefined/crash)
      return key;
    },
    [t],
  );

  /**
   * Translate with interpolation.
   * Supports {var} placeholders in translation strings.
   */
  const txi = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let translated = tx(key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          translated = translated.replace(new RegExp(`\\{${k}\\}`, "g"), String(v));
        }
      }
      return translated;
    },
    [tx],
  );

  const getLocaleInfo = useCallback(() => ({
    displayName: getLocaleDisplayName(locale),
    direction: getLocaleDirection(locale),
  }), [locale]);

  const getEnabledLocalesList = useCallback(() => {
    return getEnabledLocales().map((l) => l.locale);
  }, []);

  const value = useMemo<I18nContextValue>(
    () => ({
      locale,
      setLocale,
      t,
      tx,
      txi,
      getLocaleInfo,
      getEnabledLocales: getEnabledLocalesList,
    }),
    [locale, setLocale, t, tx, txi, getLocaleInfo, getEnabledLocalesList],
  );

  return React.createElement(I18nContext.Provider, { value }, children);
}

// ─── Hook ──────────────────────────────────────────────────────

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used within <I18nProvider>");
  return ctx;
}

// ─── Utility: nested key lookup ────────────────────────────────

function getNestedValue(obj: unknown, path: string): string | undefined {
  const parts = path.split(".");
  let current: unknown = obj;
  for (const part of parts) {
    if (current === null || current === undefined || typeof current !== "object")
      return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return typeof current === "string" ? current : undefined;
}

// ─── Re-exports ────────────────────────────────────────────────

export type { Locale, Translations };
export {
  ALL_LOCALES,
  DEFAULT_LOCALE,
} from "./types";
export {
  SUPPORTED_LOCALES,
  LOCALE_LABELS,
  LOCALE_REGISTRY,
  getLocaleMetadata,
  getEnabledLocales,
  getAvailableLocales,
  isLocaleEnabled,
  isLocaleAvailable,
  normalizeBrowserLocale,
  getLocaleDisplayName,
  getLocaleDirection,
} from "./locales";
export type { LocaleMetadata } from "./locales";
export {
  formatNumber,
  formatDecimal,
  formatCompact,
  formatPercent,
  formatPercentFromDecimal,
  formatCurrency,
  formatDate,
  formatShortDate,
  formatDateTime,
  formatRelativeTime,
  formatPrice,
  formatPnL,
  parseLocaleNumber,
} from "./format";
