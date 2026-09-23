/**
 * Phase 193 — MarketOverviewPanel renders its provenance copy TRANSLATED.
 *
 * THE DEFECT THIS LOCKS DOWN
 *   `market.live`, `market.stale` and `market.unavailable` existed in all nine
 *   locales and every parity guard was green — while the component rendered
 *   the literal English strings "LIVE" and "STALE", plus an English-only
 *   source-transparency legend. The keys showed up in the Phase 193 audit as
 *   "unreferenced", which is what exposed the disconnected consumer.
 *
 *   This is the MISSING CONSUMER category: the translation existed, the
 *   surface existed, the wire between them did not. Deleting the keys would
 *   have "fixed" the audit while leaving non-English users staring at
 *   untranslated claims about how current their market data is.
 *
 * WHY IT MATTERS BEYOND TIDINESS
 *   LIVE / STALE is a data-provenance claim. Under standing invariant 2 a user
 *   must be able to tell observed data from stale data — in their own
 *   language. An untranslated badge is a silent degradation of that promise.
 *
 * These tests render the real component through the real I18nProvider and
 * assert on the DOM, so they fail if the consumer is disconnected again.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { MarketOverviewPanel } from "./MarketOverviewPanel";
import { getAllInstruments } from "@/lib/position-protection/instrument-registry";
import type { LiveInstrumentState } from "@/lib/position-protection/use-live-protection-polling";
import en from "@/lib/i18n/en";
import id from "@/lib/i18n/id";
import ja from "@/lib/i18n/ja";
import de from "@/lib/i18n/de";
import fr from "@/lib/i18n/fr";
import es from "@/lib/i18n/es";
import pt from "@/lib/i18n/pt";
import ko from "@/lib/i18n/ko";
import zh from "@/lib/i18n/zh";

const SYMBOL = getAllInstruments()[0];

function state(over: Partial<LiveInstrumentState>): LiveInstrumentState {
  return {
    instrument: SYMBOL,
    price: 100,
    sourceMode: "LIVE",
    lastUpdateAt: Date.now(),
    success: true,
    provider: "okx",
    ...over,
  } as LiveInstrumentState;
}

function renderPanel(map: Map<string, LiveInstrumentState>) {
  return render(
    <I18nProvider>
      <MarketOverviewPanel livePrices={map} />
    </I18nProvider>,
  );
}

/** Force a locale for the duration of one render. */
function withLocale(locale: string, fn: () => void) {
  const KEY = "xstarz:locale";
  const previous = localStorage.getItem(KEY);
  localStorage.setItem(KEY, locale);
  try {
    fn();
  } finally {
    if (previous === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, previous);
  }
}

describe("193 — the source-transparency legend is localized", () => {
  it("renders the translated legend, not hardcoded English", () => {
    const { container } = renderPanel(new Map());
    expect(container.textContent).toContain(en.market.sourceTransparency);
  });

  it("renders the legend in a non-English locale", () => {
    withLocale("ja", () => {
      const { container } = renderPanel(new Map());
      expect(container.textContent).toContain(ja.market.sourceTransparency);
      // The regression: the English sentence must be gone entirely.
      expect(container.textContent).not.toContain("Source transparency:");
    });
  });

  it("every locale defines a distinct legend (no silent English fallback)", () => {
    const locales = { id, es, pt, fr, de, ja, ko, zh };
    for (const [code, bundle] of Object.entries(locales)) {
      expect(bundle.market.sourceTransparency.length, `${code} legend missing`).toBeGreaterThan(10);
      expect(
        bundle.market.sourceTransparency,
        `${code} legend is the untranslated English string`,
      ).not.toBe(en.market.sourceTransparency);
    }
  });

  it("the legend keeps the LIVE / STALE tokens it explains", () => {
    // The badge itself shows LIVE/STALE, so the legend must still name them
    // or it explains nothing. Translating the tokens away would break it.
    const locales = { en, id, es, pt, fr, de, ja, ko, zh };
    for (const [code, bundle] of Object.entries(locales)) {
      expect(bundle.market.sourceTransparency, `${code}`).toContain("LIVE");
      expect(bundle.market.sourceTransparency, `${code}`).toContain("STALE");
    }
  });
});

describe("193 — the source badge is localized", () => {
  it("a live feed renders the translated LIVE label", () => {
    const map = new Map([[SYMBOL, state({ sourceMode: "LIVE", price: 100 })]]);
    const { container } = renderPanel(map);
    expect(container.textContent).toContain(en.market.live);
  });

  it("a stale feed renders the translated STALE label", () => {
    const map = new Map([[SYMBOL, state({ sourceMode: "STALE", price: 100 })]]);
    const { container } = renderPanel(map);
    expect(container.textContent).toContain(en.market.stale);
  });

  it("the badge renders the LOCALE's word, not the English token", () => {
    // NON-VACUOUS BY CONSTRUCTION.
    //
    // `en.market.live` is literally "LIVE", so asserting it in English passes
    // whether or not the component reads from `t`. Phase 194 added LIVE/STALE
    // to the detector's TECHNICAL_TOKENS (they are product notation), which
    // legitimately stopped the static guard from flagging a hardcoded badge —
    // and that silently removed the only thing catching mutation M6.
    //
    // Japanese and Chinese DO translate these words, so a hardcoded English
    // badge is observable at runtime. This test is the behavioural
    // replacement for the static check.
    withLocale("ja", () => {
      const map = new Map([[SYMBOL, state({ sourceMode: "LIVE", price: 100 })]]);
      renderPanel(map);
      // Scope to the BADGE: the legend deliberately keeps the LIVE/STALE
      // tokens it explains, so a whole-container check would be ambiguous.
      const badges = screen.getAllByLabelText(ja.market.live);
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0].textContent).toBe(ja.market.live);
      expect(badges[0].textContent).not.toBe("LIVE");
    });
  });

  it("a stale feed renders the locale's STALE word", () => {
    withLocale("ja", () => {
      const map = new Map([[SYMBOL, state({ sourceMode: "STALE", price: 100 })]]);
      renderPanel(map);
      const badges = screen.getAllByLabelText(ja.market.stale);
      expect(badges.length).toBeGreaterThan(0);
      expect(badges[0].textContent).toBe(ja.market.stale);
      expect(badges[0].textContent).not.toBe("STALE");
    });
  });

  it("the accessible name is localized too", () => {
    // An English aria-label beside translated visible text is the exact
    // accessibility defect §7 forbids.
    withLocale("zh", () => {
      const map = new Map([[SYMBOL, state({ sourceMode: "UNAVAILABLE", price: 0 })]]);
      renderPanel(map);
      expect(screen.getAllByLabelText(zh.market.unavailable).length).toBeGreaterThan(0);
    });
  });

  it("the badge exposes an accessible name for the unavailable case", () => {
    // "—" is meaningless to a screen reader; the aria-label carries the word.
    const map = new Map([[SYMBOL, state({ sourceMode: "UNAVAILABLE", price: 0 })]]);
    renderPanel(map);
    expect(screen.getAllByLabelText(en.market.unavailable).length).toBeGreaterThan(0);
  });

  it("an unavailable feed still shows no fabricated price", () => {
    // Guards the Phase 166 invariant while we are in this component.
    const map = new Map([[SYMBOL, state({ sourceMode: "UNAVAILABLE", price: 0 })]]);
    const { container } = renderPanel(map);
    expect(container.textContent).not.toContain("NaN");
  });
});

describe("193 — the keys this surface depends on exist everywhere", () => {
  it("all nine locales define live/stale/unavailable/sourceTransparency", () => {
    const locales = { en, id, es, pt, fr, de, ja, ko, zh };
    for (const [code, bundle] of Object.entries(locales)) {
      for (const key of ["live", "stale", "unavailable", "sourceTransparency"] as const) {
        expect(bundle.market[key], `${code}.market.${key}`).toBeTruthy();
      }
    }
  });

  it("the retired system.* duplicates are gone from every locale", () => {
    // Phase 193 removed five superseded uppercase variants. If one comes back
    // in a single locale, parity guards would catch the count — this catches
    // the intent.
    const locales = { en, id, es, pt, fr, de, ja, ko, zh };
    for (const [code, bundle] of Object.entries(locales)) {
      const system = bundle.system as unknown as Record<string, unknown>;
      for (const removed of ["stale", "unavailable", "updated", "intelligence", "alerts"]) {
        expect(system[removed], `${code}.system.${removed} was reintroduced`).toBeUndefined();
      }
      // …while the replacements must still be present.
      for (const kept of ["staleLabel", "unavailableLabel", "updatedLabel"]) {
        expect(system[kept], `${code}.system.${kept} went missing`).toBeTruthy();
      }
    }
  });
});
