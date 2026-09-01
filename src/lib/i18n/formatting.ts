/**
 * Locale-aware formatting helpers for the trading intelligence application.
 *
 * These helpers wrap Intl.NumberFormat and Intl.DateTimeFormat for
 * consistent locale-aware display of financial data.
 *
 * Important: Financial values remain mathematically identical regardless of locale.
 * Only the display format changes (decimal separators, grouping, etc.).
 *
 * No external dependencies.
 */

/**
 * Format a number using the browser's locale-aware formatting.
 * Uses the current locale for grouping and decimal separators.
 */
export function formatNumber(
  value: number,
  options?: {
    decimals?: number;
    locale?: string;
    style?: "decimal" | "percent" | "currency";
    currency?: string;
  },
): string {
  const { decimals = 2, locale, style = "decimal", currency } = options ?? {};
  try {
    return new Intl.NumberFormat(locale ?? navigator.language, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      style,
      currency,
    }).format(value);
  } catch {
    return value.toFixed(decimals);
  }
}

/**
 * Format a percentage value (e.g., 5.25 → "5.25%").
 */
export function formatPercent(
  value: number,
  options?: { decimals?: number; locale?: string },
): string {
  return formatNumber(value, {
    decimals: options?.decimals ?? 2,
    locale: options?.locale,
    style: "percent",
  });
}

/**
 * Format a currency value.
 */
export function formatCurrency(
  value: number,
  options?: { decimals?: number; locale?: string; currency?: string },
): string {
  return formatNumber(value, {
    decimals: options?.decimals ?? 2,
    locale: options?.locale,
    style: "currency",
    currency: options?.currency ?? "USD",
  });
}

/**
 * Format a price value — commonly used for financial instruments.
 * Handles very large and very small numbers appropriately.
 */
export function formatPrice(
  value: number,
  options?: { locale?: string; maxDecimals?: number },
): string {
  const { locale, maxDecimals } = options ?? {};
  // Determine appropriate decimal places based on magnitude
  let decimals = 2;
  if (Math.abs(value) >= 1000) decimals = 2;
  else if (Math.abs(value) >= 1) decimals = 4;
  else if (Math.abs(value) >= 0.01) decimals = 6;
  else decimals = 8;

  const finalDecimals = maxDecimals !== undefined ? Math.min(decimals, maxDecimals) : decimals;

  try {
    return new Intl.NumberFormat(locale ?? navigator.language, {
      minimumFractionDigits: 2,
      maximumFractionDigits: finalDecimals,
    }).format(value);
  } catch {
    return value.toFixed(finalDecimals);
  }
}

/**
 * Format a date in a locale-aware manner.
 */
export function formatDate(
  date: Date | number,
  options?: {
    locale?: string;
    style?: "short" | "medium" | "long" | "full";
  },
): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const { locale, style = "medium" } = options ?? {};

  const formatOptions: Intl.DateTimeFormatOptions = (() => {
    switch (style) {
      case "short":
        return { dateStyle: "short" } as Intl.DateTimeFormatOptions;
      case "medium":
        return { year: "numeric", month: "short", day: "numeric" } as Intl.DateTimeFormatOptions;
      case "long":
        return { year: "numeric", month: "long", day: "numeric" } as Intl.DateTimeFormatOptions;
      case "full":
        return {
          year: "numeric",
          month: "long",
          day: "numeric",
          weekday: "long",
        } as Intl.DateTimeFormatOptions;
      default:
        return { year: "numeric", month: "short", day: "numeric" } as Intl.DateTimeFormatOptions;
    }
  })();

  try {
    return new Intl.DateTimeFormat(locale ?? navigator.language, formatOptions).format(d);
  } catch {
    return d.toLocaleDateString();
  }
}

/**
 * Format a time in a locale-aware manner.
 */
export function formatTime(
  date: Date | number,
  options?: { locale?: string; includeSeconds?: boolean },
): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const { locale, includeSeconds } = options ?? {};

  try {
    return new Intl.DateTimeFormat(locale ?? navigator.language, {
      hour: "2-digit",
      minute: "2-digit",
      ...(includeSeconds ? { second: "2-digit" } : {}),
    }).format(d);
  } catch {
    return d.toLocaleTimeString();
  }
}

/**
 * Format a relative time (e.g., "2 minutes ago", "3 hours ago").
 * Returns a translated string — the caller should use t() for the template.
 */
export function formatRelativeTime(
  date: Date | number,
): { value: number; unit: Intl.RelativeTimeFormatUnit } {
  const d = typeof date === "number" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return { value: 0, unit: "second" };
  if (diffSec < 3600) return { value: Math.floor(diffSec / 60), unit: "minute" };
  if (diffSec < 86400) return { value: Math.floor(diffSec / 3600), unit: "hour" };
  return { value: Math.floor(diffSec / 86400), unit: "day" };
}

/**
 * Format a compact large number (e.g., 1200 → "1.2K", 1500000 → "1.5M").
 */
export function formatCompactNumber(
  value: number,
  options?: { locale?: string },
): string {
  try {
    return new Intl.NumberFormat(options?.locale ?? navigator.language, {
      notation: "compact",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
    if (Math.abs(value) >= 1_000) return `${(value / 1_000).toFixed(1)}K`;
    return value.toString();
  }
}
