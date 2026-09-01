/**
 * i18n — Lightweight internationalization for Freebuff Trading Intelligence.
 *
 * Architecture:
 * - React Context for language state
 * - Typed translation resources per locale
 * - localStorage persistence
 * - Browser locale detection with English fallback
 * - Missing-key fallback to English
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
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_LABELS } from "./types";
import en from "./en";
import id from "./id";

// ─── Resource registry ─────────────────────────────────────────
const RESOURCES: Record<Locale, Translations> = { en, id };

// ─── localStorage helpers ──────────────────────────────────────
const STORAGE_KEY = "freebuff:locale";

function readPersistedLocale(): Locale | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw && isLocale(raw)) return raw;
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
    const base = lang.split("-")[0].toLowerCase();
    if (isLocale(base)) return base;
  }
  return DEFAULT_LOCALE;
}

function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as string[]).includes(value);
}

// ─── Resolve initial locale ────────────────────────────────────
function resolveInitialLocale(): Locale {
  return readPersistedLocale() ?? detectBrowserLocale();
}

// ─── Context ───────────────────────────────────────────────────
interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: Translations;
  /** Raw key lookup — returns translated string or the key itself as fallback. */
  tx: (key: string) => string;
  /** Translate with interpolation: txi("positions.count", { count: 4 }) → "4 positions" */
  txi: (key: string, vars?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue | null>(null);

// ─── Provider ──────────────────────────────────────────────────
export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(resolveInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    persistLocale(next);
  }, []);

  const t = RESOURCES[locale] ?? RESOURCES[DEFAULT_LOCALE];

  /**
   * Dot-path key lookup: tx("nav.analysis") → t.nav.analysis
   * Falls back to English, then returns the raw key.
   */
  const tx = useCallback(
    (key: string): string => {
      const enResource = RESOURCES[DEFAULT_LOCALE];
      // Try current locale first
      const currentVal = getNestedValue(t, key);
      if (currentVal !== undefined) return currentVal;
      // Fallback to English
      const enVal = getNestedValue(enResource, key);
      if (enVal !== undefined) return enVal;
      // Return key itself as last resort
      return key;
    },
    [t],
  );

  /**
   * Translate with interpolation: txi("positions.count", { count: 4 })
   * Supports {var} placeholders in translation strings.
   */
  const txi = useCallback(
    (key: string, vars?: Record<string, string | number>): string => {
      let translated = tx(key);
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          translated = translated.replace(new RegExp(`\{${k}\}`, "g"), String(v));
        }
      }
      return translated;
    },
    [tx],
  );

  const value = useMemo<I18nContextValue>(
    () => ({ locale, setLocale, t, tx, txi }),
    [locale, setLocale, t, tx, txi],
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
export { SUPPORTED_LOCALES, LOCALE_LABELS, DEFAULT_LOCALE };
