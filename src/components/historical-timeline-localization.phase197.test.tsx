/**
 * Phase 197 — HISTORICAL TIMELINE SEMANTIC PROTECTION.
 *
 * The historical timeline is an EVIDENCE surface: it tells a trader what the
 * engine believed before, what it believes now, and therefore whether a thesis
 * is degrading. Localizing it must change the language and nothing else — not
 * which fields are marked as changed, not the direction of a transition, and
 * not the instrument identity.
 *
 * Three defects motivated this suite, and only ONE of them was visible to the
 * shared hardcoded-copy detector:
 *
 *   1. (detector-visible)  Six caption strings — "Current:", "Previous:",
 *      "Changed:", "Also:", "Evidence:", "changed".
 *   2. (detector-BLIND)    The comparison table's `label` values lived inside
 *      an ARRAY LITERAL, and its `previous`/`current` values rendered RAW
 *      ENUMS, so a Japanese user saw "HIGHER_HIGHS_HIGHER_LOWS".
 *   3. (detector-BLIND)    `event.description` is English prose built with
 *      template literals in a lib file and rendered verbatim in all nine
 *      locales.
 *
 * Defect 3 carries a hard constraint: `description` is PERSISTED and asserted
 * byte-for-byte by the Phase 90/91 persistence tests, so it must be localized
 * at RENDER time from the event's structured fields, never rewritten at the
 * source. These tests pin that constraint in both directions.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { cleanup, render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { HistoricalTimelineView } from "./HistoricalTimeline";

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
import {
  mapMomentumValue,
  mapStructureValue,
  mapThesisHealth,
  mapVolatilityValue,
} from "@/lib/i18n/enum-mapping";
import {
  compareSnapshots,
  detectChanges,
  generateSummary,
} from "@/lib/position-protection/historical-intelligence";
import type {
  HistoricalEvent,
  HistoricalTimeline,
  IntelligenceSnapshot,
} from "@/lib/position-protection/historical-intelligence";

const BUNDLES = { en, id, es, fr, pt, de, ja, ko, zh } as const;
type LocaleCode = keyof typeof BUNDLES;

/** Fixed epoch so a timestamp regression shows up as an exact mismatch. */
const T0 = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z
const T1 = 1_735_776_000_000; // 2025-01-02T00:00:00.000Z

function snapshot(overrides: Partial<IntelligenceSnapshot> = {}): IntelligenceSnapshot {
  return {
    timestamp: T0,
    positionId: "p1",
    instrument: "BTC/USDT",
    side: "LONG",
    thesisState: "HEALTHY",
    evidenceQuality: "STRONG_EVIDENCE",
    marketRegime: "TRENDING_UP",
    h1Trend: "BULLISH",
    m15Trend: "BULLISH",
    m5Trend: "BULLISH",
    mtfAlignment: "ALIGNED",
    momentum: "POSITIVE",
    volatility: "NORMAL",
    structure: "HIGHER_HIGHS_HIGHER_LOWS",
    supportingCount: 3,
    conflictingCount: 1,
    invalidationCondition: "—",
    watchNext: "—",
    dataAvailability: "SUFFICIENT",
    ...overrides,
  } as IntelligenceSnapshot;
}

/** A degraded "current" snapshot: every localized field differs from the base. */
function degraded(): IntelligenceSnapshot {
  return snapshot({
    timestamp: T1,
    thesisState: "DETERIORATING",
    marketRegime: "RANGING",
    h1Trend: "BEARISH",
    m15Trend: "BEARISH",
    m5Trend: "NEUTRAL",
    momentum: "OVERBOUGHT",
    volatility: "EXPANDED",
    structure: "LOWER_HIGHS_LOWER_LOWS",
  });
}

function event(overrides: Partial<HistoricalEvent> = {}): HistoricalEvent {
  return {
    timestamp: T1,
    eventType: "THESIS_CHANGE",
    description: "Thesis: HEALTHY → DETERIORATING",
    previousState: "HEALTHY",
    currentState: "DETERIORATING",
    category: "THESIS",
    strength: "STRONG",
    ...overrides,
  };
}

function timeline(overrides: Partial<HistoricalTimeline> = {}): HistoricalTimeline {
  return {
    positionId: "p1",
    events: [event()],
    latestSnapshot: degraded(),
    previousSnapshot: snapshot(),
    summary: generateSummary(snapshot(), degraded(), [event()]),
    ...overrides,
  };
}

function renderAt(locale: string, tl: HistoricalTimeline) {
  const KEY = "xstarz:locale";
  const previous = localStorage.getItem(KEY);
  localStorage.setItem(KEY, locale);
  try {
    return render(
      <I18nProvider>
        <HistoricalTimelineView timeline={tl} />
      </I18nProvider>,
    );
  } finally {
    if (previous === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, previous);
  }
}

/** Canonical enum spellings that must NEVER reach a non-English screen. */
const RAW_ENUM_LEAKS = [
  "HIGHER_HIGHS_HIGHER_LOWS",
  "LOWER_HIGHS_LOWER_LOWS",
  "HIGHER HIGHS HIGHER LOWS",
  "LOWER HIGHS LOWER LOWS",
  "DETERIORATING",
  "OVERBOUGHT",
  "EXPANDED",
  "TRENDING_UP",
  "STRONG_EVIDENCE",
] as const;

describe("Phase 197 — timeline captions are localized", () => {
  it("renders the six former hardcoded captions from the dictionary", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(locale, timeline());
      const text = container.textContent ?? "";

      expect(text).toContain(t.timeline.currentLabel);
      expect(text).toContain(t.timeline.previousLabel);
      expect(text).toContain(t.protection.changedLabel);
      cleanup();
    }
  });

  it("every locale supplies a non-empty value for the new timeline keys", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      expect(t.timeline.currentLabel.trim().length).toBeGreaterThan(0);
      expect(t.timeline.alsoLabel.trim().length).toBeGreaterThan(0);
    }
  });
});

describe("Phase 197 — comparison values are translated, not raw enums", () => {
  it("does not leak canonical enum spellings into non-English locales", () => {
    for (const locale of ALL_LOCALES) {
      if (locale === "en") continue;
      const { container } = renderAt(locale, timeline());
      const text = container.textContent ?? "";
      for (const leak of RAW_ENUM_LEAKS) {
        expect(
          text.includes(leak),
          `${locale} leaked raw enum ${leak}`,
        ).toBe(false);
      }
      cleanup();
    }
  });

  it("renders each structure state as its locale-specific label", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(locale, timeline());
      const text = container.textContent ?? "";
      // Explicit expected constant — not a cross-locale self-comparison,
      // which cannot detect a wrong value (Phase 196 lesson M3).
      expect(text).toContain(mapStructureValue("LOWER_HIGHS_LOWER_LOWS", t));
      expect(text).toContain(mapMomentumValue("OVERBOUGHT", t));
      expect(text).toContain(mapVolatilityValue("EXPANDED", t));
      expect(text).toContain(mapThesisHealth("DETERIORATING", t));
      cleanup();
    }
  });

  it("mapper output differs from the canonical enum in every non-English locale", () => {
    for (const locale of ALL_LOCALES) {
      if (locale === "en") continue;
      const t = BUNDLES[locale as LocaleCode];
      // Asserting a mapper is *called* is not asserting it *translates*
      // (Phase 196 lesson M13).
      expect(mapStructureValue("HIGHER_HIGHS_HIGHER_LOWS", t))
        .not.toBe("HIGHER_HIGHS_HIGHER_LOWS");
      expect(mapMomentumValue("OVERBOUGHT", t)).not.toBe("OVERBOUGHT");
      expect(mapVolatilityValue("EXPANDED", t)).not.toBe("EXPANDED");
    }
  });

  it("keeps instrument identity untranslated across all locales", () => {
    // The instrument appears in the INITIAL_ANALYSIS sentence, so use that event.
    const initial = event({
      eventType: "INITIAL_ANALYSIS",
      description: "Initial analysis: BTC/USDT LONG — HEALTHY",
      previousState: "—",
      currentState: "HEALTHY",
      category: "ANALYSIS",
    });
    for (const locale of ALL_LOCALES) {
      const { container } = renderAt(
        locale,
        timeline({ events: [initial], summary: generateSummary(null, snapshot(), [initial]) }),
      );
      expect(container.textContent ?? "").toContain("BTC/USDT");
      cleanup();
    }
  });
});

describe("Phase 197 — localization must not alter change detection", () => {
  it("marks exactly the fields whose RAW enum values differ", () => {
    // Same-thesis / different-structure pair: only structure changed.
    const prev = snapshot();
    const curr = snapshot({ structure: "LOWER_HIGHS_LOWER_LOWS" });

    for (const locale of ALL_LOCALES) {
      const { container } = renderAt(
        locale,
        timeline({ previousSnapshot: prev, latestSnapshot: curr, events: [] }),
      );
      const t = BUNDLES[locale as LocaleCode];
      // The amber "changed" marker is rendered once per changed field.
      const markers = Array.from(container.querySelectorAll("span")).filter(
        (el) => el.textContent === t.protection.changedLabel,
      );
      expect(markers.length, `${locale} changed-marker count`).toBe(1);
      cleanup();
    }
  });

  it("does not mark a field as changed when only the translation differs", () => {
    // Identical snapshots => zero changed fields in every locale.
    const same = snapshot();
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(
        locale,
        timeline({ previousSnapshot: same, latestSnapshot: snapshot(), events: [] }),
      );
      const markers = Array.from(container.querySelectorAll("span")).filter(
        (el) => el.textContent === t.protection.changedLabel,
      );
      expect(markers.length, `${locale} false-positive change`).toBe(0);
      cleanup();
    }
  });

  it("keeps the lib comparison engine operating on canonical enums", () => {
    // The component must not have pushed translation down into the engine.
    const fields = compareSnapshots(snapshot(), degraded());
    const structure = fields.find((f) => f.label === "Structure");
    expect(structure?.previous).toBe("HIGHER_HIGHS_HIGHER_LOWS");
    expect(structure?.current).toBe("LOWER_HIGHS_LOWER_LOWS");
    expect(structure?.changed).toBe(true);
  });
});

describe("Phase 197 — event descriptions are localized at render time", () => {
  it("does not render the stored English description in other locales", () => {
    for (const locale of ALL_LOCALES) {
      if (locale === "en") continue;
      const { container } = renderAt(locale, timeline());
      expect(
        (container.textContent ?? "").includes("Thesis: HEALTHY → DETERIORATING"),
        `${locale} rendered the stored English description`,
      ).toBe(false);
      cleanup();
    }
  });

  it("renders the transition with translated endpoints and a preserved arrow", () => {
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(locale, timeline());
      const text = container.textContent ?? "";
      expect(text).toContain(
        `${t.trader.thesisLabel}: ${mapThesisHealth("HEALTHY", t)} → ${mapThesisHealth("DETERIORATING", t)}`,
      );
      cleanup();
    }
  });

  it("localizes the INITIAL_ANALYSIS event without losing instrument or side", () => {
    const initial = event({
      eventType: "INITIAL_ANALYSIS",
      description: "Initial analysis: BTC/USDT LONG — HEALTHY",
      previousState: "—",
      currentState: "HEALTHY",
      category: "ANALYSIS",
    });
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      const { container } = renderAt(
        locale,
        timeline({ events: [initial], latestSnapshot: snapshot() }),
      );
      const text = container.textContent ?? "";
      expect(text).toContain("BTC/USDT");
      expect(text).toContain(t.timeline.initialAnalysis);
      expect(text).toContain(t.analysis.long);
      cleanup();
    }
  });

  it("falls back to the stored description rather than inventing copy", () => {
    // The evidence-shift event encodes counts ("3S/1C"), which have no
    // structured enum equivalent. Declining to localize is correct; silently
    // rendering a wrong sentence would not be.
    const shift = event({
      eventType: "EVIDENCE_CHANGE",
      description: "Evidence shift: +2 supporting, +0 conflicting",
      previousState: "1S/1C",
      currentState: "3S/1C",
      category: "EVIDENCE",
    });
    const { container } = renderAt("ja", timeline({ events: [shift] }));
    expect(container.textContent ?? "").toContain(
      "Evidence shift: +2 supporting, +0 conflicting",
    );
    cleanup();
  });

  it("never mutates the persisted description field", () => {
    // Phase 90/91 assert this byte-for-byte; rendering must be read-only.
    const ev = event();
    const before = ev.description;
    renderAt("ja", timeline({ events: [ev] }));
    expect(ev.description).toBe(before);
    cleanup();
  });
});

describe("Phase 197 — time formatting follows the app locale", () => {
  it("binds the event clock to the active locale, not the host default", () => {
    const source = readSource();
    expect(source).toContain("toLocaleTimeString(locale");
    expect(source).not.toContain("toLocaleTimeString([]");
  });
});

function readSource(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { readFileSync } = require("node:fs") as typeof import("node:fs");
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { resolve } = require("node:path") as typeof import("node:path");
  return readFileSync(
    resolve(process.cwd(), "src/components/HistoricalTimeline.tsx"),
    "utf8",
  );
}

describe("Phase 197 — the persisted record is frozen", () => {
  it("pins the exact English description the engine writes", () => {
    // Discovered by mutation M9: Phase 90/91 only use descriptions as
    // round-trip FIXTURES, so nothing actually pinned the string the engine
    // emits. Rewriting the template at the source would silently invalidate
    // every already-persisted row while every test stayed green. The UI
    // localizes this string at render time precisely so it never has to change.
    const events = detectChanges(snapshot(), degraded());
    const thesis = events.find((e) => e.category === "THESIS");
    expect(thesis?.description).toBe("Thesis: HEALTHY → DETERIORATING");

    const regime = events.find((e) => e.category === "REGIME");
    expect(regime?.description).toBe("Regime: TRENDING_UP → RANGING");

    const h1 = events.find((e) => e.category === "H1");
    expect(h1?.description).toBe("H1: BULLISH → BEARISH");
  });

  it("keeps structured fields in step with the English sentence", () => {
    // interpretationParts must describe the same facts as `interpretation`,
    // otherwise the localized UI and the English logs would disagree.
    const summary = generateSummary(snapshot(), degraded(), []);
    expect(summary.interpretation).toContain("H1 shifted from BULLISH to BEARISH");
    const kinds = summary.interpretationParts.map((p) => p.kind);
    expect(kinds).toContain("TIMEFRAME_SHIFT");
    expect(kinds).toContain("REGIME_SHIFT");
    expect(kinds).toContain("EVIDENCE_SUPPORTING_LEADS");
  });
});

describe("Phase 197 — change detection can never be driven by translations", () => {
  it("computes `changed` from raw enums in the component source", () => {
    // Mutation M4 rewrote `changed` to compare TRANSLATED strings. It survived
    // behaviourally because no two enum values currently share a translation —
    // an EQUIVALENT MUTANT today, but a latent defect: the first time a
    // translator gives two states the same wording, a real change would stop
    // being flagged. This is declared STRUCTURAL coverage, not behavioural.
    const source = readSource();
    const changedExprs = source.match(/changed: [^,\n]+/g) ?? [];
    expect(changedExprs.length).toBeGreaterThan(0);
    for (const expr of changedExprs) {
      expect(expr, `change detection must not call a mapper: ${expr}`)
        .not.toMatch(/map[A-Z]/);
    }
  });

  it("keeps every mapped value distinct within each enum domain and locale", () => {
    // The invariant that makes M4 equivalent. Asserted explicitly so that
    // breaking it fails loudly here instead of silently degrading the UI.
    const domains: Array<[(v: string, t: typeof en) => string, string[]]> = [
      [mapStructureValue, [
        "HIGHER_HIGHS_HIGHER_LOWS", "LOWER_HIGHS_LOWER_LOWS",
        "HIGHER_HIGH_LOWER_LOW", "LOWER_HIGH_HIGHER_LOW", "INSUFFICIENT_DATA",
      ]],
      [mapMomentumValue, ["OVERBOUGHT", "OVERSOLD", "POSITIVE", "NEGATIVE", "NEUTRAL"]],
      [mapVolatilityValue, ["EXPANDED", "COMPRESSED", "NORMAL"]],
      [mapThesisHealth, ["HEALTHY", "STABLE", "CAUTION", "DETERIORATING", "INVALIDATED"]],
    ];
    for (const locale of ALL_LOCALES) {
      const t = BUNDLES[locale as LocaleCode];
      for (const [mapper, values] of domains) {
        const rendered = values.map((v) => mapper(v, t));
        expect(
          new Set(rendered).size,
          `${locale}: two states share one translation -> ${rendered.join(" | ")}`,
        ).toBe(values.length);
      }
    }
  });
});
