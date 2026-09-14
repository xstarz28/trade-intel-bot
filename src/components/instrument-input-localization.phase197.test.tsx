/**
 * Phase 197 — INSTRUMENT INPUT localization & canonical-value protection.
 *
 * This form chooses what the engine analyses. Its <SelectItem> values are
 * canonical `InstrumentType` enums routed to provider adapters, so the label a
 * user reads must be translated while the value sent to the backend must not.
 * Translating the value would silently ask a provider for an asset class that
 * does not exist.
 *
 * Two of the findings here were invisible to the shared detector: the two
 * `$`-prefixed terminal headings, and the trading-style buttons that rendered
 * raw lowercase enum values.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { InstrumentInput } from "./InstrumentInput";

import en from "@/lib/i18n/en";
import id from "@/lib/i18n/id";
import es from "@/lib/i18n/es";
import fr from "@/lib/i18n/fr";
import pt from "@/lib/i18n/pt";
import de from "@/lib/i18n/de";
import ja from "@/lib/i18n/ja";
import ko from "@/lib/i18n/ko";
import zh from "@/lib/i18n/zh";
import { ALL_LOCALES } from "@/lib/i18n/types";
import { mapHorizon } from "@/lib/i18n/enum-mapping";
import { TRADING_STYLES } from "@/lib/trading-style";

const BUNDLES = { en, id, es, fr, pt, de, ja, ko, zh } as const;
type LocaleCode = keyof typeof BUNDLES;

/** The canonical InstrumentType values the backend understands. */
const CANONICAL_TYPES = ["forex", "crypto", "stock", "commodity"] as const;

function renderAt(locale: string) {
  const KEY = "xstarz:locale";
  const previous = localStorage.getItem(KEY);
  localStorage.setItem(KEY, locale);
  try {
    return render(
      <I18nProvider>
        <InstrumentInput onAnalyze={() => {}} isAnalyzing={false} />
      </I18nProvider>,
    );
  } finally {
    if (previous === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, previous);
  }
}

describe("Phase 197 — instrument-type values stay canonical", () => {
  it("keeps every SelectItem value as the untranslated enum", () => {
    // Radix renders options into a portal only when open, so assert the source
    // contract directly: a translated `value` must never appear.
    const source = readSource();
    for (const type of CANONICAL_TYPES) {
      expect(source).toContain(`<SelectItem value="${type}">`);
    }
  });

  it("never interpolates a translation into a value attribute", () => {
    const source = readSource();
    const valueAttrs = source.match(/value="\{[^}]*\}"/g) ?? [];
    expect(valueAttrs).toEqual([]);
    expect(source).not.toMatch(/value=\{t\./);
  });

  it("exposes a distinct translated label for each type in every locale", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const labels = [
        t.entryForm.typeForex,
        t.entryForm.typeCrypto,
        t.entryForm.typeStock,
        t.entryForm.typeCommodity,
      ];
      for (const label of labels) {
        expect(label.trim().length, `${locale} empty type label`).toBeGreaterThan(0);
      }
      // A collision would make two asset classes indistinguishable in the menu.
      expect(new Set(labels).size, `${locale}: duplicate type labels`).toBe(4);
    }
  });
});

describe("Phase 197 — terminal headings are localized", () => {
  it("renders both headings from the dictionary, keeping the $ prompt", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(locale);
      const text = container.textContent ?? "";
      expect(text).toContain(t.entryForm.newAnalysisHeading);
      expect(text).toContain(t.entryForm.instrumentsHeading);
      // The "$" is terminal decoration and must survive localization.
      expect(text).toContain("$");
      cleanup();
    }
  });

  it("does not render the English headings in other locales", () => {
    for (const locale of ALL_LOCALES) {
      if (locale === "en") continue;
      const t = BUNDLES[locale as LocaleCode];
      if (t.entryForm.newAnalysisHeading === "new-analysis") continue;
      const { container } = renderAt(locale);
      expect(container.textContent ?? "").not.toContain("$ new-analysis");
      cleanup();
    }
  });
});

describe("Phase 197 — trading style buttons are translated", () => {
  it("renders each style through the shared horizon mapper", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(locale);
      const text = container.textContent ?? "";
      for (const style of TRADING_STYLES) {
        expect(text).toContain(mapHorizon(style.toUpperCase(), t));
      }
      cleanup();
    }
  });

  it("does not leak the raw lowercase enum in locales that translate it", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(locale);
      const text = container.textContent ?? "";
      for (const style of TRADING_STYLES) {
        const translated = mapHorizon(style.toUpperCase(), t);
        if (translated.toLowerCase() === style) continue; // legitimately identical
        expect(text, `${locale} leaked raw ${style}`).not.toContain(style);
      }
      cleanup();
    }
  });

  it("keeps the canonical style value in the click handler", () => {
    // The button must submit `st`, not its translation.
    const source = readSource();
    expect(source).toContain('update("tradingStyle", st)');
  });
});

describe("Phase 197 — instrument identity is never translated", () => {
  it("renders provider-native symbols verbatim in every locale", () => {
    for (const locale of ALL_LOCALES) {
      const { container } = renderAt(locale);
      const text = container.textContent ?? "";
      expect(text).toContain("EUR/USD");
      expect(text).toContain("BTC/USD");
      expect(text).toContain("XAU/USD");
      cleanup();
    }
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(
    resolve(process.cwd(), "src/components/InstrumentInput.tsx"),
    "utf8",
  );
}
