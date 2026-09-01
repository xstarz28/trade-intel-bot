/**
 * Locale-aware financial formatting helpers.
 *
 * These helpers use the browser's Intl API to format numbers, percentages,
 * currencies, and dates according to the user's locale.
 *
 * IMPORTANT: Financial values remain mathematically identical regardless of locale.
 * Only the display representation changes.
 *
 * Examples:
 * - 1000.50 → "1,000.50" (en) or "1.000,50" (de)
 * - 0.05 → "5.00%" (en) or "5,00 %" (fr)
 * - $1000 → "$1,000.00" (en) or "1.000,00 $" (fr)
 */

import type { Locale } from "./types";

// ─── Number Formatting ─────────────────────────────────────────

/**
 * Format a number according to locale.
 * @param value - The number to format
 * @param locale - The locale code
 * @param options - Additional Intl.NumberFormat options
 */
export function formatNumber(
  value: number,
  locale: Locale = "en",
  options?: Intl.NumberFormatOptions,
): string {
  try {
    return new Intl.NumberFormat(locale, options).format(value);
  } catch {
    // Fallback to en if locale is not supported by Intl
    return new Intl.NumberFormat("en", options).format(value);
  }
}

/**
 * Format a number with a fixed number of decimal places.
 */
export function formatDecimal(
  value: number,
  locale: Locale = "en",
  decimals: number = 2,
): string {
  return formatNumber(value, locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a large number with abbreviated suffixes (K, M, B).
 */
export function formatCompact(
  value: number,
  locale: Locale = "en",
): string {
  try {
    return new Intl.NumberFormat(locale, {
      notation: "compact",
      compactDisplay: "short",
      maximumFractionDigits: 1,
    }).format(value);
  } catch {
    return formatNumber(value, locale);
  }
}

// ─── Percentage Formatting ─────────────────────────────────────

/**
 * Format a percentage value.
 * @param value - The percentage value (e.g., 5.5 for 5.5%)
 * @param locale - The locale code
 * @param decimals - Number of decimal places
 */
export function formatPercent(
  value: number,
  locale: Locale = "en",
  decimals: number = 2,
): string {
  return formatNumber(value, locale, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format a decimal as a percentage (multiply by 100).
 * @param value - The decimal value (e.g., 0.055 for 5.5%)
 * @param locale - The locale code
 * @param decimals - Number of decimal places
 */
export function formatPercentFromDecimal(
  value: number,
  locale: Locale = "en",
  decimals: number = 2,
): string {
  return formatNumber(value * 100, locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }) + "%";
}

// ─── Currency Formatting ───────────────────────────────────────

/**
 * Format a number as currency.
 * @param value - The amount
 * @param currency - ISO 4217 currency code (e.g., "USD", "IDR", "EUR")
 * @param locale - The locale code
 */
export function formatCurrency(
  value: number,
  currency: string = "USD",
  locale: Locale = "en",
): string {
  return formatNumber(value, locale, {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// ─── Date/Time Formatting ──────────────────────────────────────

/**
 * Format a date according to locale.
 * @param date - Date object or timestamp
 * @param locale - The locale code
 * @param options - Additional Intl.DateTimeFormat options
 */
export function formatDate(
  date: Date | number,
  locale: Locale = "en",
  options?: Intl.DateTimeFormatOptions,
): string {
  const d = typeof date === "number" ? new Date(date) : date;
  try {
    return new Intl.DateTimeFormat(locale, options).format(d);
  } catch {
    return new Intl.DateTimeFormat("en", options).format(d);
  }
}

/**
 * Format a date as a short date (e.g., "1/15/2024" or "15/1/2024").
 */
export function formatShortDate(
  date: Date | number,
  locale: Locale = "en",
): string {
  return formatDate(date, locale, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
  });
}

/**
 * Format a date with time.
 */
export function formatDateTime(
  date: Date | number,
  locale: Locale = "en",
): string {
  return formatDate(date, locale, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Format a relative time (e.g., "2 hours ago", "3 days ago").
 */
export function formatRelativeTime(
  date: Date | number,
  locale: Locale = "en",
): string {
  const d = typeof date === "number" ? new Date(date) : date;
  const now = Date.now();
  const diffMs = now - d.getTime();
  const diffSec = Math.floor(diffMs / 1000);
  const diffMin = Math.floor(diffSec / 60);
  const diffHr = Math.floor(diffMin / 60);
  const diffDay = Math.floor(diffHr / 24);

  try {
    const rtf = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });

    if (diffSec < 60) return rtf.format(-diffSec, "second");
    if (diffMin < 60) return rtf.format(-diffMin, "minute");
    if (diffHr < 24) return rtf.format(-diffHr, "hour");
    if (diffDay < 30) return rtf.format(-diffDay, "day");
    return formatShortDate(d, locale);
  } catch {
    // Fallback to English
    if (diffSec < 60) return `${diffSec}s ago`;
    if (diffMin < 60) return `${diffMin}m ago`;
    if (diffHr < 24) return `${diffHr}h ago`;
    return `${diffDay}d ago`;
  }
}

// ─── Price Formatting (Trading-specific) ───────────────────────

/**
 * Format a trading price with appropriate precision.
 * Crypto prices may need different precision than forex or stocks.
 */
export function formatPrice(
  value: number,
  locale: Locale = "en",
  assetClass?: string,
): string {
  // Determine appropriate decimal places based on asset class
  let decimals = 2;
  if (assetClass === "crypto") {
    if (value >= 1000) decimals = 2;
    else if (value >= 1) decimals = 4;
    else decimals = 6;
  } else if (assetClass === "forex") {
    decimals = value >= 100 ? 2 : value >= 1 ? 4 : 5;
  }

  return formatNumber(value, locale, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format PnL (profit and loss) with sign and color class.
 * Returns formatted string and whether it's positive/negative.
 */
export function formatPnL(
  value: number,
  locale: Locale = "en",
  isPercent: boolean = false,
): { text: string; isPositive: boolean; isZero: boolean } {
  const isPositive = value > 0;
  const isZero = value === 0;
  const sign = isPositive ? "+" : "";

  if (isPercent) {
    return {
      text: `${sign}${formatNumber(value, locale, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}%`,
      isPositive,
      isZero,
    };
  }

  return {
    text: `${sign}${formatNumber(value, locale, {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`,
    isPositive,
    isZero,
  };
}

// ─── Number Parsing (Locale-aware) ─────────────────────────────

/**
 * Parse a locale-formatted number string back to a number.
 * Handles both comma-as-decimal and period-as-decimal formats.
 */
export function parseLocaleNumber(
  value: string,
  locale: Locale = "en",
): number {
  // Create a formatter to determine the locale's decimal separator
  const formatted = new Intl.NumberFormat(locale, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(1.1);

  const decimalSep = formatted.charAt(1); // "1.x1" → the separator is at index 1

  // Replace the locale's thousands separator and decimal separator
  // with standard ones
  const normalized = value
    .replace(new RegExp(`[${thousandSep(locale)}]`, "g"), "")
    .replace(decimalSep, ".");

  return parseFloat(normalized);
}

/** Get the thousands separator for a locale */
function thousandSep(locale: Locale): string {
  const formatted = new Intl.NumberFormat(locale).format(1234567.8);
  // The thousands separator is the character that is NOT a digit or decimal
  return formatted.replace(/[0-9.]/g, "").charAt(0);
}
