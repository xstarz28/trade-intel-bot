import { describe, it, expect } from "vitest";
import type { Locale } from "./types";
import {
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
import {
  formatNumber,
  formatDecimal,
  formatCompact,
  formatPercent,
  formatPercentFromDecimal,
  formatCurrency,
  formatShortDate,
  formatDateTime,
  formatRelativeTime,
  formatPrice,
  formatPnL,
  parseLocaleNumber,
} from "./format";
import { ALL_LOCALES, DEFAULT_LOCALE } from "./types";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "./locales";

// ─── Locale Registry Tests ─────────────────────────────────────

describe("locale registry", () => {
  it("has entries for all planned locales", () => {
    expect(LOCALE_REGISTRY.length).toBeGreaterThanOrEqual(9);
  });

  it("includes en, id, es, fr, pt, de, ja, ko, zh", () => {
    const codes = LOCALE_REGISTRY.map((l) => l.locale);
    expect(codes).toContain("en");
    expect(codes).toContain("id");
    expect(codes).toContain("es");
    expect(codes).toContain("fr");
    expect(codes).toContain("pt");
    expect(codes).toContain("de");
    expect(codes).toContain("ja");
    expect(codes).toContain("ko");
    expect(codes).toContain("zh");
  });

  it("all nine locales are enabled (Phase 145 — 9-locale completion)", () => {
    const NINE: Locale[] = ["en", "id", "es", "pt", "fr", "de", "ja", "ko", "zh"];
    for (const code of NINE) {
      expect(isLocaleEnabled(code)).toBe(true);
    }
  });

  it("all nine locales are available (have complete translation resources)", () => {
    const NINE: Locale[] = ["en", "id", "es", "pt", "fr", "de", "ja", "ko", "zh"];
    for (const code of NINE) {
      expect(isLocaleAvailable(code)).toBe(true);
    }
  });

  it("getEnabledLocales returns exactly the nine canonical locales", () => {
    const enabled = getEnabledLocales();
    expect(enabled.length).toBe(9);
    const codes = enabled.map((l) => l.locale).sort();
    expect(codes).toEqual(["de", "en", "es", "fr", "id", "ja", "ko", "pt", "zh"]);
  });

  it("getAvailableLocales returns exactly the nine canonical locales", () => {
    const available = getAvailableLocales();
    expect(available.length).toBe(9);
    const codes = available.map((l) => l.locale).sort();
    expect(codes).toEqual(["de", "en", "es", "fr", "id", "ja", "ko", "pt", "zh"]);
  });
});

describe("locale metadata", () => {
  it("each locale has required metadata fields", () => {
    for (const entry of LOCALE_REGISTRY) {
      expect(entry.locale).toBeTruthy();
      expect(entry.nativeName).toBeTruthy();
      expect(entry.englishName).toBeTruthy();
      expect(["ltr", "rtl"]).toContain(entry.direction);
      expect(typeof entry.enabled).toBe("boolean");
      expect(typeof entry.available).toBe("boolean");
    }
  });

  it("getLocaleMetadata returns correct metadata for en", () => {
    const enMeta = getLocaleMetadata("en");
    expect(enMeta).toBeDefined();
    expect(enMeta?.nativeName).toBe("English");
    expect(enMeta?.englishName).toBe("English");
    expect(enMeta?.direction).toBe("ltr");
    expect(enMeta?.enabled).toBe(true);
  });

  it("getLocaleMetadata returns correct metadata for es", () => {
    const esMeta = getLocaleMetadata("es");
    expect(esMeta).toBeDefined();
    expect(esMeta?.nativeName).toBe("Español");
    expect(esMeta?.englishName).toBe("Spanish");
    expect(esMeta?.direction).toBe("ltr");
    expect(esMeta?.enabled).toBe(true);
    expect(esMeta?.available).toBe(true);
  });

  it("getLocaleMetadata returns correct metadata for pt", () => {
    const ptMeta = getLocaleMetadata("pt");
    expect(ptMeta).toBeDefined();
    expect(ptMeta?.nativeName).toBe("Português");
    expect(ptMeta?.englishName).toBe("Portuguese");
    expect(ptMeta?.direction).toBe("ltr");
    expect(ptMeta?.enabled).toBe(true);
    expect(ptMeta?.available).toBe(true);
  });

  it("getLocaleMetadata returns undefined for unknown locale", () => {
    // This test uses type casting to test the function's behavior
    const result = getLocaleMetadata("xx" as Locale);
    expect(result).toBeUndefined();
  });

  it("all locales are LTR (no RTL languages yet)", () => {
    for (const entry of LOCALE_REGISTRY) {
      expect(entry.direction).toBe("ltr");
    }
  });
});

describe("browser locale normalization", () => {
  it("normalizes en-US to en", () => {
    expect(normalizeBrowserLocale("en-US")).toBe("en");
  });

  it("normalizes en-GB to en", () => {
    expect(normalizeBrowserLocale("en-GB")).toBe("en");
  });

  it("normalizes es-ES to es", () => {
    expect(normalizeBrowserLocale("es-ES")).toBe("es");
  });

  it("normalizes es-MX to es", () => {
    expect(normalizeBrowserLocale("es-MX")).toBe("es");
  });

  it("normalizes es-AR to es", () => {
    expect(normalizeBrowserLocale("es-AR")).toBe("es");
  });

  it("normalizes es-CO to es", () => {
    expect(normalizeBrowserLocale("es-CO")).toBe("es");
  });

  it("normalizes es-CL to es", () => {
    expect(normalizeBrowserLocale("es-CL")).toBe("es");
  });

  it("normalizes es-PE to es", () => {
    expect(normalizeBrowserLocale("es-PE")).toBe("es");
  });

  it("normalizes pt to pt", () => {
    expect(normalizeBrowserLocale("pt")).toBe("pt");
  });

  it("normalizes pt-BR to pt", () => {
    expect(normalizeBrowserLocale("pt-BR")).toBe("pt");
  });

  it("normalizes pt-PT to pt", () => {
    expect(normalizeBrowserLocale("pt-PT")).toBe("pt");
  });

  it("normalizes pt-AO to pt", () => {
    expect(normalizeBrowserLocale("pt-AO")).toBe("pt");
  });

  it("normalizes pt-MZ to pt", () => {
    expect(normalizeBrowserLocale("pt-MZ")).toBe("pt");
  });

  it("normalizes pt-CV to pt", () => {
    expect(normalizeBrowserLocale("pt-CV")).toBe("pt");
  });

  it("normalizes pt-GW to pt", () => {
    expect(normalizeBrowserLocale("pt-GW")).toBe("pt");
  });

  it("normalizes pt-ST to pt", () => {
    expect(normalizeBrowserLocale("pt-ST")).toBe("pt");
  });

  it("normalizes pt-TL to pt", () => {
    expect(normalizeBrowserLocale("pt-TL")).toBe("pt");
  });

  it("normalizes fr-FR to fr", () => {
    expect(normalizeBrowserLocale("fr-FR")).toBe("fr");
  });

  it("normalizes de-DE to de", () => {
    expect(normalizeBrowserLocale("de-DE")).toBe("de");
  });

  it("normalizes zh-CN to zh (Simplified Chinese)", () => {
    expect(normalizeBrowserLocale("zh-CN")).toBe("zh");
  });

  it("normalizes zh-TW to zh (base-code match)", () => {
    expect(normalizeBrowserLocale("zh-TW")).toBe("zh");
  });

  it("normalizes ja-JP to ja", () => {
    expect(normalizeBrowserLocale("ja-JP")).toBe("ja");
  });

  it("normalizes ko-KR to ko", () => {
    expect(normalizeBrowserLocale("ko-KR")).toBe("ko");
  });

  it("normalizes fr, de, ja, ko, zh base codes", () => {
    expect(normalizeBrowserLocale("fr")).toBe("fr");
    expect(normalizeBrowserLocale("de")).toBe("de");
    expect(normalizeBrowserLocale("ja")).toBe("ja");
    expect(normalizeBrowserLocale("ko")).toBe("ko");
    expect(normalizeBrowserLocale("zh")).toBe("zh");
  });

  it("returns null for completely unknown locales", () => {
    expect(normalizeBrowserLocale("xx-XX")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(normalizeBrowserLocale("")).toBeNull();
  });
});

describe("locale display names", () => {
  it("getLocaleDisplayName returns native name for en", () => {
    expect(getLocaleDisplayName("en")).toBe("English");
  });

  it("getLocaleDisplayName returns native name for id", () => {
    expect(getLocaleDisplayName("id")).toBe("Bahasa Indonesia");
  });

  it("getLocaleDisplayName returns native name for es", () => {
    expect(getLocaleDisplayName("es")).toBe("Español");
  });

  it("getLocaleDisplayName returns native name for pt", () => {
    expect(getLocaleDisplayName("pt")).toBe("Português");
  });

  it("getLocaleDisplayName returns native name for all nine locales", () => {
    expect(getLocaleDisplayName("fr")).toBe("Français");
    expect(getLocaleDisplayName("de")).toBe("Deutsch");
    expect(getLocaleDisplayName("ja")).toBe("日本語");
    expect(getLocaleDisplayName("ko")).toBe("한국어");
    expect(getLocaleDisplayName("zh")).toBe("中文");
  });
});

describe("locale direction", () => {
  it("all nine locales are LTR", () => {
    expect(getLocaleDirection("en")).toBe("ltr");
    expect(getLocaleDirection("id")).toBe("ltr");
    expect(getLocaleDirection("es")).toBe("ltr");
    expect(getLocaleDirection("fr")).toBe("ltr");
    expect(getLocaleDirection("pt")).toBe("ltr");
    expect(getLocaleDirection("de")).toBe("ltr");
    expect(getLocaleDirection("ja")).toBe("ltr");
    expect(getLocaleDirection("ko")).toBe("ltr");
    expect(getLocaleDirection("zh")).toBe("ltr");
  });
});

// ─── Types Consistency Tests ───────────────────────────────────

describe("types consistency", () => {
  it("ALL_LOCALES contains all 9 planned locales", () => {
    expect(ALL_LOCALES.length).toBe(9);
  });

  it("SUPPORTED_LOCALES is a subset of ALL_LOCALES", () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(ALL_LOCALES).toContain(loc);
    }
  });

  it("SUPPORTED_LOCALES includes all nine canonical locales", () => {
    for (const code of ["en", "id", "es", "pt", "fr", "de", "ja", "ko", "zh"]) {
      expect(SUPPORTED_LOCALES).toContain(code);
    }
    expect(SUPPORTED_LOCALES.length).toBe(9);
  });

  it("DEFAULT_LOCALE is in ALL_LOCALES", () => {
    expect(ALL_LOCALES).toContain(DEFAULT_LOCALE);
  });

  it("LOCALE_LABELS has entries for ALL_LOCALES", () => {
    for (const loc of ALL_LOCALES) {
      expect(LOCALE_LABELS[loc]).toBeTruthy();
    }
  });

  it("SUPPORTED_LOCALES matches enabled locales in registry", () => {
    const enabledCodes = getEnabledLocales().map((l) => l.locale);
    expect(SUPPORTED_LOCALES.sort()).toEqual(enabledCodes.sort());
  });

  it("SUPPORTED_LOCALES includes all nine canonical locales", () => {
    for (const code of ["en", "id", "es", "pt", "fr", "de", "ja", "ko", "zh"]) {
      expect(SUPPORTED_LOCALES).toContain(code);
    }
    expect(SUPPORTED_LOCALES.length).toBe(9);
  });
});

// ─── Number Formatting Tests ───────────────────────────────────

describe("financial formatting — numbers", () => {
  it("formatNumber formats with locale", () => {
    expect(formatNumber(1234567.89, "en")).toBe("1,234,567.89");
  });

  it("formatNumber formats with es locale", () => {
    const result = formatNumber(1234567.89, "es");
    // Spanish uses dots for thousands, comma for decimal
    expect(result).toContain("1.234.567");
    expect(result).toContain("89");
  });

  it("formatDecimal formats with fixed decimals", () => {
    expect(formatDecimal(1.23456, "en", 2)).toBe("1.23");
    expect(formatDecimal(1.2, "en", 4)).toBe("1.2000");
  });

  it("formatDecimal formats with es locale", () => {
    const result = formatDecimal(1.23, "es", 2);
    expect(result).toContain("1");
    expect(result).toContain("23");
  });

  it("formatCompact abbreviates large numbers", () => {
    const result = formatCompact(1500000, "en");
    expect(result).toMatch(/[MB]/);
  });

  it("formatNumber gracefully handles invalid locales", () => {
    expect(() => formatNumber(123, "xx" as Locale)).not.toThrow();
  });
});

describe("financial formatting — percentages", () => {
  it("formatPercent formats as percentage", () => {
    const result = formatPercent(5.5, "en", 2);
    expect(result).toContain("5");
    expect(result).toContain("550");
  });

  it("formatPercentFromDecimal multiplies by 100", () => {
    const result = formatPercentFromDecimal(0.055, "en", 2);
    expect(result).toContain("5.5");
    expect(result).toContain("%");
  });
});

describe("financial formatting — currency", () => {
  it("formatCurrency formats with currency symbol", () => {
    const result = formatCurrency(1234.56, "USD", "en");
    expect(result).toContain("$");
    expect(result).toContain("1,234.56");
  });

  it("formatCurrency works with IDR", () => {
    const result = formatCurrency(1500000, "IDR", "id");
    expect(result).toContain("Rp");
  });

  it("formatCurrency works with es locale", () => {
    const result = formatCurrency(1234.56, "USD", "es");
    expect(result).toContain("$");
  });
});

describe("financial formatting — dates", () => {
  it("formatShortDate formats a date", () => {
    const date = new Date("2024-01-15");
    const result = formatShortDate(date, "en");
    expect(result).toBeTruthy();
    expect(typeof result).toBe("string");
  });

  it("formatShortDate works with es locale", () => {
    const date = new Date("2024-01-15");
    const result = formatShortDate(date, "es");
    expect(result).toBeTruthy();
  });

  it("formatDateTime includes time", () => {
    const date = new Date("2024-01-15T14:30:00");
    const result = formatDateTime(date, "en");
    expect(result).toBeTruthy();
  });

  it("formatRelativeTime returns relative string", () => {
    const recent = Date.now() - 5 * 60 * 1000; // 5 minutes ago
    const result = formatRelativeTime(recent, "en");
    expect(result).toBeTruthy();
  });
});

describe("financial formatting — trading-specific", () => {
  it("formatPrice for crypto with high value", () => {
    const result = formatPrice(65432.10, "en", "crypto");
    expect(result).toContain("65,432");
  });

  it("formatPrice for crypto with low value", () => {
    const result = formatPrice(0.000123, "en", "crypto");
    expect(result).toBeTruthy();
  });

  it("formatPrice for forex", () => {
    const result = formatPrice(1.0856, "en", "forex");
    expect(result).toContain("1.0856");
  });

  it("formatPrice for es locale preserves numeric value", () => {
    const result = formatPrice(65432.10, "es", "crypto");
    // Should contain the numeric value regardless of locale
    expect(result).toContain("65");
    expect(result).toContain("432");
  });

  it("formatPnL positive", () => {
    const result = formatPnL(1234.56, "en");
    expect(result.text).toContain("+");
    expect(result.isPositive).toBe(true);
    expect(result.isZero).toBe(false);
  });

  it("formatPnL negative", () => {
    const result = formatPnL(-500.25, "en");
    expect(result.isPositive).toBe(false);
    expect(result.isZero).toBe(false);
  });

  it("formatPnL zero", () => {
    const result = formatPnL(0, "en");
    expect(result.isZero).toBe(true);
  });

  it("formatPnL percent", () => {
    const result = formatPnL(5.5, "en", true);
    expect(result.text).toContain("%");
  });
});

describe("financial formatting — parsing", () => {
  it("parseLocaleNumber parses en format", () => {
    expect(parseLocaleNumber("1,234.56", "en")).toBe(1234.56);
  });

  it("parseLocaleNumber parses simple number", () => {
    expect(parseLocaleNumber("123.45", "en")).toBeCloseTo(123.45);
  });
});

// ─── Locale Label Tests ────────────────────────────────────────

describe("LOCALE_LABELS completeness", () => {
  it("has labels for all ALL_LOCALES", () => {
    for (const loc of ALL_LOCALES) {
      expect(LOCALE_LABELS[loc]).toBeTruthy();
      expect(LOCALE_LABELS[loc].length).toBeGreaterThan(0);
    }
  });

  it("labels are unique", () => {
    const labels = ALL_LOCALES.map((l) => LOCALE_LABELS[l]);
    const unique = new Set(labels);
    expect(unique.size).toBe(labels.length);
  });
});

// ─── Spanish Integration Tests ─────────────────────────────────

describe("Spanish (es) integration", () => {
  it("es locale is enabled and available", () => {
    expect(isLocaleEnabled("es")).toBe(true);
    expect(isLocaleAvailable("es")).toBe(true);
  });

  it("es metadata is correct", () => {
    const meta = getLocaleMetadata("es");
    expect(meta).toBeDefined();
    expect(meta?.locale).toBe("es");
    expect(meta?.nativeName).toBe("Español");
    expect(meta?.englishName).toBe("Spanish");
    expect(meta?.direction).toBe("ltr");
    expect(meta?.enabled).toBe(true);
    expect(meta?.available).toBe(true);
  });

  it("all Spanish regional variants normalize to es", () => {
    expect(normalizeBrowserLocale("es")).toBe("es");
    expect(normalizeBrowserLocale("es-ES")).toBe("es");
    expect(normalizeBrowserLocale("es-MX")).toBe("es");
    expect(normalizeBrowserLocale("es-AR")).toBe("es");
    expect(normalizeBrowserLocale("es-CO")).toBe("es");
    expect(normalizeBrowserLocale("es-CL")).toBe("es");
    expect(normalizeBrowserLocale("es-PE")).toBe("es");
    expect(normalizeBrowserLocale("es-VE")).toBe("es");
    expect(normalizeBrowserLocale("es-EC")).toBe("es");
    expect(normalizeBrowserLocale("es-UY")).toBe("es");
    expect(normalizeBrowserLocale("es-PY")).toBe("es");
    expect(normalizeBrowserLocale("es-BO")).toBe("es");
    expect(normalizeBrowserLocale("es-CR")).toBe("es");
    expect(normalizeBrowserLocale("es-PA")).toBe("es");
    expect(normalizeBrowserLocale("es-GT")).toBe("es");
    expect(normalizeBrowserLocale("es-HN")).toBe("es");
    expect(normalizeBrowserLocale("es-SV")).toBe("es");
    expect(normalizeBrowserLocale("es-NI")).toBe("es");
    expect(normalizeBrowserLocale("es-DO")).toBe("es");
    expect(normalizeBrowserLocale("es-CU")).toBe("es");
  });

  it("SUPPORTED_LOCALES includes es", () => {
    expect(SUPPORTED_LOCALES).toContain("es");
    expect(SUPPORTED_LOCALES.length).toBe(9);
  });
});

// ─── Portuguese Integration Tests ─────────────────────────────

describe("Portuguese (pt) integration", () => {
  it("pt locale is enabled and available", () => {
    expect(isLocaleEnabled("pt")).toBe(true);
    expect(isLocaleAvailable("pt")).toBe(true);
  });

  it("pt metadata is correct", () => {
    const meta = getLocaleMetadata("pt");
    expect(meta).toBeDefined();
    expect(meta?.locale).toBe("pt");
    expect(meta?.nativeName).toBe("Português");
    expect(meta?.englishName).toBe("Portuguese");
    expect(meta?.direction).toBe("ltr");
    expect(meta?.enabled).toBe(true);
    expect(meta?.available).toBe(true);
  });

  it("all Portuguese regional variants normalize to pt", () => {
    expect(normalizeBrowserLocale("pt")).toBe("pt");
    expect(normalizeBrowserLocale("pt-BR")).toBe("pt");
    expect(normalizeBrowserLocale("pt-PT")).toBe("pt");
    expect(normalizeBrowserLocale("pt-AO")).toBe("pt");
    expect(normalizeBrowserLocale("pt-MZ")).toBe("pt");
    expect(normalizeBrowserLocale("pt-CV")).toBe("pt");
    expect(normalizeBrowserLocale("pt-GW")).toBe("pt");
    expect(normalizeBrowserLocale("pt-ST")).toBe("pt");
    expect(normalizeBrowserLocale("pt-TL")).toBe("pt");
    expect(normalizeBrowserLocale("pt-MO")).toBe("pt");
    expect(normalizeBrowserLocale("pt-GQ")).toBe("pt");
  });

  it("SUPPORTED_LOCALES includes pt", () => {
    expect(SUPPORTED_LOCALES).toContain("pt");
    expect(SUPPORTED_LOCALES.length).toBe(9);
  });
});
