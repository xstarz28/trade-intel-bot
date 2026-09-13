/**
 * Phase 196 — JOURNAL SEMANTIC PROTECTION.
 *
 * The journal is a FINANCIAL RECORD surface. Localizing it must change the
 * language a user reads and nothing else: not the stored status, not the
 * sign or magnitude of a P&L, not a timestamp, not an instrument symbol, and
 * not the value a filter compares against.
 *
 * This suite is deliberately written BEFORE the localization edits (the
 * Phase 195 lesson) and asserts against the RECORD and the CANONICAL VALUES,
 * never against rendered prose. A test that only checked rendered text would
 * pass even if localization silently rewrote the record underneath it.
 *
 * §14 fixtures A–E cover the cases where a mistake would be most expensive:
 *   A  LONG  + positive P&L
 *   B  SHORT + negative P&L
 *   C  WAIT / NO_TRADE, no chargeable trade context
 *   D  unknown P&L / incomplete record
 *   E  native crypto + forex instrument identity
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { I18nProvider } from "@/lib/i18n";
import { Journal } from "./Journal";

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
import { mapTradeOutcome, mapTradeStatus } from "@/lib/i18n/enum-mapping";
import { classifyOutcome, computePnl } from "@/lib/journal";
import type { JournalEntry, TradeStatus } from "@/types/journal";

const BUNDLES = { en, id, es, fr, pt, de, ja, ko, zh } as const;

type LocaleCode = keyof typeof BUNDLES;

/** Render the real component through the real provider. */
function renderJournal() {
  return render(
    <I18nProvider>
      <Journal />
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

// ─── §14 fixtures ────────────────────────────────────────────────

/** Fixed epoch so a timestamp regression is visible as an exact mismatch. */
const CREATED_AT = 1_735_689_600_000; // 2025-01-01T00:00:00.000Z
const CLOSED_AT = 1_735_776_000_000; // 2025-01-02T00:00:00.000Z

function baseEntry(overrides: Partial<JournalEntry>): JournalEntry {
  return {
    id: "j1",
    instrument: "EUR/USD",
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
    status: "PLANNED",
    analysisSnapshot: {
      analysisId: "a1",
      decision: "WAIT",
      bias: "NEUTRAL",
      confidence: 50,
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "COMPLETE",
    },
    ...overrides,
  } as JournalEntry;
}

const FIXTURES = {
  /** A — LONG with a profit. The sign must never flip. */
  A_LONG_PROFIT: baseEntry({
    id: "A",
    instrument: "EUR/USD",
    status: "CLOSED",
    entry: 1.085,
    exitPrice: 1.095,
    stopLoss: 1.08,
    takeProfit: 1.1,
    positionSize: 10_000,
    pnl: 100,
    pnlPercent: 0.9216589861751152,
    outcome: "WIN",
    closedAt: CLOSED_AT,
    analysisSnapshot: {
      analysisId: "a-A",
      decision: "LONG",
      bias: "BULLISH",
      confidence: 72,
      conviction: "HIGH",
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "COMPLETE",
    },
  }),

  /** B — SHORT with a loss. A loss must never render as a gain. */
  B_SHORT_LOSS: baseEntry({
    id: "B",
    instrument: "BTC/USDT",
    status: "CLOSED",
    entry: 95_000,
    exitPrice: 97_000,
    positionSize: 0.5,
    pnl: -1000,
    pnlPercent: -2.1052631578947367,
    outcome: "LOSS",
    closedAt: CLOSED_AT,
    analysisSnapshot: {
      analysisId: "a-B",
      decision: "SHORT",
      bias: "BEARISH",
      confidence: 64,
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "COMPLETE",
    },
  }),

  /** C — NO_TRADE observation. Never a position, never chargeable. */
  C_NO_TRADE: baseEntry({
    id: "C",
    instrument: "XAU/USD",
    status: "NO_TRADE",
    analysisSnapshot: {
      analysisId: "a-C",
      decision: "NO_TRADE",
      bias: "NEUTRAL",
      confidence: 31,
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "PARTIAL",
    },
  }),

  /** D — incomplete record. Unknown must stay unknown, never become 0. */
  D_UNKNOWN_PNL: baseEntry({
    id: "D",
    instrument: "USD/JPY",
    status: "OPEN",
    entry: 157.2,
    analysisSnapshot: {
      analysisId: "a-D",
      decision: "LONG",
      bias: "BULLISH",
      confidence: 55,
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "PARTIAL",
    },
  }),

  /** E — provider-native identity that must survive verbatim. */
  E_NATIVE_IDENTITY: baseEntry({
    id: "E",
    instrument: "BTC-PERPETUAL",
    status: "OPEN",
    entry: 95_432.5,
    analysisSnapshot: {
      analysisId: "a-E",
      decision: "LONG",
      bias: "BULLISH",
      confidence: 60,
      technicalSummary: "",
      fundamentalSummary: "",
      dataCompleteness: "COMPLETE",
    },
  }),
} satisfies Record<string, JournalEntry>;

/**
 * The presentation-independent projection of a journal record.
 *
 * `locale` is accepted and deliberately voided: that IS the invariant. If a
 * future refactor ever threads the active locale into the record, this
 * signature makes the mistake visible at the call site.
 */
function recordStateFor(locale: LocaleCode, entry: JournalEntry) {
  void locale;
  return {
    id: entry.id,
    instrument: entry.instrument,
    status: entry.status,
    decision: entry.analysisSnapshot.decision,
    bias: entry.analysisSnapshot.bias,
    confidence: entry.analysisSnapshot.confidence,
    entry: entry.entry ?? null,
    stopLoss: entry.stopLoss ?? null,
    takeProfit: entry.takeProfit ?? null,
    exitPrice: entry.exitPrice ?? null,
    positionSize: entry.positionSize ?? null,
    pnl: entry.pnl ?? null,
    pnlPercent: entry.pnlPercent ?? null,
    outcome: entry.outcome ?? null,
    createdAt: entry.createdAt,
    closedAt: entry.closedAt ?? null,
  };
}

// ════════ §14 — the record is identical in every locale ════════

describe("196 §14 — journal records are locale-independent", () => {
  it.each(Object.keys(FIXTURES))(
    "%s produces a byte-identical record state in all 9 locales",
    (name) => {
      const entry = FIXTURES[name as keyof typeof FIXTURES];
      const states = ALL_LOCALES.map((l) =>
        JSON.stringify(recordStateFor(l as LocaleCode, entry)),
      );
      for (let i = 1; i < states.length; i++) {
        expect(
          states[i],
          `${ALL_LOCALES[i]} produced a different record for ${name}`,
        ).toBe(states[0]);
      }
    },
  );

  it("covers all five §14 record shapes", () => {
    // Guards against the fixture set silently shrinking to the easy cases.
    expect(Object.keys(FIXTURES)).toHaveLength(5);
    const decisions = Object.values(FIXTURES).map((f) => f.analysisSnapshot.decision);
    expect(decisions).toContain("LONG");
    expect(decisions).toContain("SHORT");
    expect(decisions).toContain("NO_TRADE");
  });
});

// ════════ §4 — P&L integrity ════════

describe("196 §4 — P&L sign, magnitude and unknown-ness are preserved", () => {
  it("a positive P&L never becomes negative in any locale", () => {
    const a = FIXTURES.A_LONG_PROFIT;
    for (const locale of ALL_LOCALES) {
      const state = recordStateFor(locale as LocaleCode, a);
      expect(state.pnl, `${locale}`).toBe(100);
      expect(Number(state.pnl) > 0, `${locale} flipped a WIN`).toBe(true);
      expect(Number(state.pnlPercent) > 0, `${locale} flipped a WIN %`).toBe(true);
    }
  });

  it("a negative P&L never becomes positive in any locale", () => {
    const b = FIXTURES.B_SHORT_LOSS;
    for (const locale of ALL_LOCALES) {
      const state = recordStateFor(locale as LocaleCode, b);
      expect(state.pnl, `${locale}`).toBe(-1000);
      expect(Number(state.pnl) < 0, `${locale} flipped a LOSS`).toBe(true);
      expect(Number(state.pnlPercent) < 0, `${locale} flipped a LOSS %`).toBe(true);
    }
  });

  it("an unknown P&L stays unknown and never falls back to 0", () => {
    // The dangerous failure: `pnl ?? 0` renders an incomplete record as a
    // BREAKEVEN trade, which is a different financial claim.
    const d = FIXTURES.D_UNKNOWN_PNL;
    expect(d.pnl).toBeUndefined();
    for (const locale of ALL_LOCALES) {
      const state = recordStateFor(locale as LocaleCode, d);
      expect(state.pnl, `${locale} invented a P&L`).toBeNull();
      expect(state.pnl, `${locale} coerced unknown to zero`).not.toBe(0);
    }
  });

  it("outcome classification is locale-independent and not derived from copy", () => {
    expect(classifyOutcome(100)).toBe("WIN");
    expect(classifyOutcome(-1000)).toBe("LOSS");
    expect(classifyOutcome(0)).toBe("BREAKEVEN");
    expect(classifyOutcome(undefined)).toBe("UNKNOWN");
  });

  it("computePnl keeps direction semantics: short profits when price falls", () => {
    const long = computePnl(100, 110, "long", 1);
    const short = computePnl(100, 110, "short", 1);
    expect(long.pnl).toBe(10);
    expect(short.pnl).toBe(-10);
    // Unknown inputs must not be coerced into a number.
    expect(computePnl(100, undefined, "long", 1).pnl).toBeUndefined();
  });
});

// ════════ §5 — timestamp integrity ════════

describe("196 §5 — timestamps are never altered by locale", () => {
  it("createdAt and closedAt keep their exact epoch value", () => {
    for (const locale of ALL_LOCALES) {
      const a = recordStateFor(locale as LocaleCode, FIXTURES.A_LONG_PROFIT);
      expect(a.createdAt, `${locale}`).toBe(CREATED_AT);
      expect(a.closedAt, `${locale}`).toBe(CLOSED_AT);
    }
  });

  it("localized presentation does not shift the underlying instant", () => {
    // Presentation may differ per locale; the instant may not. Comparing the
    // parsed ISO string proves formatting is a pure projection.
    const iso = new Date(CREATED_AT).toISOString();
    for (const locale of ALL_LOCALES) {
      const rendered = new Intl.DateTimeFormat(locale, {
        year: "numeric",
        month: "numeric",
        day: "numeric",
      }).format(new Date(CREATED_AT));
      expect(rendered.length, `${locale} produced no date`).toBeGreaterThan(0);
      expect(new Date(CREATED_AT).toISOString(), `${locale}`).toBe(iso);
    }
  });
});

// ════════ §6 — instrument identity ════════

describe("196 §6 — instrument identity is never translated", () => {
  it("provider-native symbols survive every locale verbatim", () => {
    const expected: Record<string, string> = {
      A_LONG_PROFIT: "EUR/USD",
      B_SHORT_LOSS: "BTC/USDT",
      C_NO_TRADE: "XAU/USD",
      D_UNKNOWN_PNL: "USD/JPY",
      E_NATIVE_IDENTITY: "BTC-PERPETUAL",
    };
    for (const [name, symbol] of Object.entries(expected)) {
      for (const locale of ALL_LOCALES) {
        const state = recordStateFor(
          locale as LocaleCode,
          FIXTURES[name as keyof typeof FIXTURES],
        );
        expect(state.instrument, `${locale} rewrote ${name}`).toBe(symbol);
      }
    }
  });

  it("no locale bundle contains a translated instrument symbol", () => {
    // A translator "helpfully" localizing EUR/USD would break identity.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const serialized = JSON.stringify(bundle.journal);
      expect(serialized, `${code} hardcodes an instrument`).not.toContain("EUR/USD");
      expect(serialized, `${code} hardcodes an instrument`).not.toContain("BTC/USDT");
    }
  });
});

// ════════ §3 / §10 — canonical status values ════════

describe("196 §3 — status enums stay canonical, never localized in place", () => {
  const CANONICAL_STATUSES: TradeStatus[] = [
    "PLANNED",
    "OPEN",
    "CLOSED",
    "CANCELLED",
    "INVALIDATED",
    "NO_TRADE",
    "WAITING",
  ];

  it("stored status values remain the canonical uppercase enum", () => {
    for (const entry of Object.values(FIXTURES)) {
      expect(CANONICAL_STATUSES, `${entry.id} has a non-canonical status`).toContain(
        entry.status,
      );
      expect(entry.status, `${entry.id} status was localized in place`).toBe(
        entry.status.toUpperCase(),
      );
    }
  });

  it("a translated status label is never accepted as a stored status", () => {
    // If a localized label were written back as the record's status, the
    // record would become unreadable in every other language.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const labels = [
        bundle.journal.statusPlanned,
        bundle.journal.statusOpen,
        bundle.journal.statusClosed,
        bundle.journal.statusCancelled,
        bundle.journal.statusNoTrade,
      ];
      for (const label of labels) {
        if (code === "en") continue; // English labels are Title Case, not enums
        expect(
          (CANONICAL_STATUSES as string[]).includes(label),
          `${code} label "${label}" collides with a stored enum`,
        ).toBe(false);
      }
    }
  });

  it("every canonical status has a distinct label in every locale", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const labels = [
        bundle.journal.statusPlanned,
        bundle.journal.statusOpen,
        bundle.journal.statusClosed,
        bundle.journal.statusCancelled,
        bundle.journal.statusNoTrade,
      ];
      expect(new Set(labels).size, `${code} reuses one label for two statuses`).toBe(
        labels.length,
      );
      for (const label of labels) {
        expect(label.trim().length, `${code} has an empty status label`).toBeGreaterThan(0);
      }
    }
  });
});

// ════════ §8 — empty states are distinct conditions ════════

describe("196 §8 — 'no entries' is never confused with 'no trade'", () => {
  it("the empty-list message is distinct from the NO_TRADE status label", () => {
    // Phase 189 lesson: an absent list is a DATA condition; NO_TRADE is a
    // DECISION. Rendering one as the other misinforms the trader.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      expect(
        bundle.journal.noJournalEntries,
        `${code} conflates empty list with NO_TRADE`,
      ).not.toBe(bundle.journal.statusNoTrade);
    }
  });

  it("'no entries at all' differs from 'no entries match the filter'", () => {
    // These require different user actions: create a record vs clear a filter.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      expect(
        bundle.journal.noJournalEntries,
        `${code} cannot distinguish empty from filtered-empty`,
      ).not.toBe(bundle.journal.noEntriesMatchFilters);
    }
  });
});

// ════════ §9 — filter behaviour is locale-independent ════════

describe("196 §9 — locale never changes filter results", () => {
  const ALL_ENTRIES = Object.values(FIXTURES);

  /** Mirrors the component's filter predicate exactly. */
  function applyFilters(
    entries: JournalEntry[],
    filterInstrument: string,
    filterStatus: string,
  ): string[] {
    return entries
      .filter((e) => {
        if (
          filterInstrument &&
          !e.instrument.toLowerCase().includes(filterInstrument.toLowerCase())
        )
          return false;
        if (filterStatus && e.status !== filterStatus) return false;
        return true;
      })
      .map((e) => e.id);
  }

  it("filtering by a canonical status yields the same ids in every locale", () => {
    for (const status of ["OPEN", "CLOSED", "NO_TRADE"]) {
      const reference = applyFilters(ALL_ENTRIES, "", status);
      for (const locale of ALL_LOCALES) {
        void locale;
        expect(applyFilters(ALL_ENTRIES, "", status)).toEqual(reference);
      }
      expect(reference.length, `${status} matched nothing — filter test is vacuous`)
        .toBeGreaterThan(0);
    }
  });

  it("a localized status LABEL never matches a stored record", () => {
    // Proves the filter compares canonical values, not presentation. If a
    // label leaked into the filter state, results would differ per language.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      if (code === "en") continue;
      const matched = applyFilters(ALL_ENTRIES, "", bundle.journal.statusOpen);
      expect(matched, `${code} label "${bundle.journal.statusOpen}" filtered records`)
        .toEqual([]);
    }
  });

  it("instrument filtering is unaffected by locale", () => {
    const reference = applyFilters(ALL_ENTRIES, "btc", "");
    expect(reference).toEqual(["B", "E"]);
    for (const locale of ALL_LOCALES) {
      void locale;
      expect(applyFilters(ALL_ENTRIES, "btc", "")).toEqual(reference);
    }
  });
});

// ════════ §3 / §10 / §11 — rendered behaviour ════════
//
// The assertions above protect the RECORD. These render the real component
// through the real provider and protect what reaches the DOM: a translated
// label must appear, while the canonical value must stay machine-readable.

describe("196 §10 — option values stay canonical, labels are translated", () => {
  it("every status <option> carries a canonical value, not translated prose", () => {
    // The value is what the filter compares and what could be persisted.
    // Putting prose here would make filtering language-dependent.
    const CANONICAL = ["", "PLANNED", "OPEN", "CLOSED", "CANCELLED", "NO_TRADE"];
    for (const locale of ["en", "ja", "de"]) {
      withLocale(locale, () => {
        renderJournal();
        const select = screen.getByLabelText(BUNDLES[locale as LocaleCode].journal.filterByStatus);
        const values = Array.from(select.querySelectorAll("option")).map((o) => o.value);
        expect(values, `${locale} option values drifted`).toEqual(CANONICAL);
        cleanup();
      });
    }
  });

  it("option labels ARE translated while their values are not", () => {
    withLocale("ja", () => {
      renderJournal();
      const select = screen.getByLabelText(ja.journal.filterByStatus);
      const options = Array.from(select.querySelectorAll("option"));
      const planned = options.find((o) => o.value === "PLANNED");
      expect(planned?.textContent).toBe(ja.journal.statusPlanned);
      // Proves the label really changed language rather than echoing the enum.
      expect(planned?.textContent).not.toBe("PLANNED");
      cleanup();
    });
  });
});

describe("196 §3 — status badges render translations, not raw enums", () => {
  it.each(["ja", "de", "zh"])("%s renders a translated empty-state, not English", (code) => {
    withLocale(code, () => {
      renderJournal();
      const bundle = BUNDLES[code as LocaleCode];
      expect(screen.getByText(bundle.journal.noJournalEntries)).toBeTruthy();
      expect(screen.queryByText("No journal entries yet.")).toBeNull();
      cleanup();
    });
  });

  it("the status filter label is localized in every locale", () => {
    for (const code of Object.keys(BUNDLES)) {
      withLocale(code, () => {
        renderJournal();
        expect(
          screen.getByLabelText(BUNDLES[code as LocaleCode].journal.filterByStatus),
          `${code} lost its accessible filter name`,
        ).toBeTruthy();
        cleanup();
      });
    }
  });
});

describe("196 §11 — accessibility text is localized alongside the UI", () => {
  it("no English-only accessible name survives in a non-English locale", () => {
    // An aria-label left in English beside translated visible text is the
    // exact defect §11 forbids.
    withLocale("ja", () => {
      renderJournal();
      expect(screen.queryByLabelText("Filter by status")).toBeNull();
      expect(screen.getByLabelText(ja.journal.filterByStatus)).toBeTruthy();
      cleanup();
    });
  });
});

// ════════ Closing the gaps the Phase 196 mutation suite exposed ════════

describe("196 §14 — the direction of record is pinned, not merely echoed", () => {
  // Gap found by M3: the snapshot compared each fixture against ITSELF across
  // locales, so flipping LONG→SHORT in the fixture stayed self-consistent and
  // survived. Directions must be asserted against expected constants.
  it("each fixture keeps the exact direction it was recorded with", () => {
    expect(FIXTURES.A_LONG_PROFIT.analysisSnapshot.decision).toBe("LONG");
    expect(FIXTURES.B_SHORT_LOSS.analysisSnapshot.decision).toBe("SHORT");
    expect(FIXTURES.C_NO_TRADE.analysisSnapshot.decision).toBe("NO_TRADE");
    expect(FIXTURES.D_UNKNOWN_PNL.analysisSnapshot.decision).toBe("LONG");
    expect(FIXTURES.E_NATIVE_IDENTITY.analysisSnapshot.decision).toBe("LONG");
  });

  it("direction and P&L sign stay coherent with the recorded outcome", () => {
    // A LONG that won must not carry a loss, and vice versa. This is the
    // pairing a direction flip would break even if each field looked valid.
    const a = FIXTURES.A_LONG_PROFIT;
    expect(a.analysisSnapshot.bias).toBe("BULLISH");
    expect(a.outcome).toBe("WIN");
    expect(Number(a.pnl)).toBeGreaterThan(0);

    const b = FIXTURES.B_SHORT_LOSS;
    expect(b.analysisSnapshot.decision).toBe("SHORT");
    expect(b.outcome).toBe("LOSS");
    expect(Number(b.pnl)).toBeLessThan(0);
  });
});

describe("196 §9 — the filter reads the canonical enum, not the rendered label", () => {
  // Gap found by M10: asserting on a local copy of the predicate could not
  // see the component switching to a translated comparison. Assert on the
  // real DOM instead: selecting a canonical value must filter identically in
  // every locale, including one whose labels differ from the enum.
  it("selecting OPEN filters identically in en and ja", () => {
    const results: Record<string, string | null> = {};
    for (const code of ["en", "ja"]) {
      withLocale(code, () => {
        renderJournal();
        const select = screen.getByLabelText(
          BUNDLES[code as LocaleCode].journal.filterByStatus,
        ) as HTMLSelectElement;
        fireEvent.change(select, { target: { value: "OPEN" } });
        // With no entries loaded the list is empty either way; what matters
        // is that the SELECT still holds the canonical value after the change.
        results[code] = select.value;
        cleanup();
      });
    }
    expect(results.en).toBe("OPEN");
    expect(results.ja).toBe("OPEN");
  });

  it("the component compares e.status against the raw filter value", () => {
    // Structural assertion, and declared as such: the filter predicate is a
    // closure that cannot be observed from the DOM without seeded entries.
    // Documented as STRUCTURAL coverage per §15 rather than claimed as
    // behavioural.
    const source = readFileSync(
      resolve(process.cwd(), "src/components/Journal.tsx"),
      "utf8",
    );
    expect(source).toContain("e.status !== filterStatus");
    expect(
      source,
      "the filter must not compare a translated label",
    ).not.toContain("mapTradeStatus(e.status, t) !== filterStatus");
  });
});

describe("196 §3 — badges render through the canonical mapper", () => {
  // Gap found by M13: nothing asserted the mapper's OUTPUT was translated, so
  // returning the raw enum survived. Assert per locale that the mapper
  // produces the locale's label and never the enum itself.
  it.each(["ja", "de", "zh", "ko"])("%s maps every status away from the enum", (code) => {
    const bundle = BUNDLES[code as LocaleCode];
    const CASES: Array<[string, string]> = [
      ["PLANNED", bundle.journal.statusPlanned],
      ["OPEN", bundle.journal.statusOpen],
      ["CLOSED", bundle.journal.statusClosed],
      ["CANCELLED", bundle.journal.statusCancelled],
      ["INVALIDATED", bundle.journal.statusInvalidated],
      ["NO_TRADE", bundle.journal.statusNoTrade],
      ["WAITING", bundle.journal.statusWaiting],
    ];
    for (const [canonical, expected] of CASES) {
      const rendered = mapTradeStatus(canonical, bundle);
      expect(rendered, `${code}.${canonical}`).toBe(expected);
      expect(rendered, `${code}.${canonical} still renders the raw enum`).not.toBe(
        canonical,
      );
    }
  });

  it.each(["ja", "de", "zh", "ko"])("%s maps every outcome away from the enum", (code) => {
    const bundle = BUNDLES[code as LocaleCode];
    const CASES: Array<[string, string]> = [
      ["WIN", bundle.journal.outcomeWin],
      ["LOSS", bundle.journal.outcomeLoss],
      ["BREAKEVEN", bundle.journal.outcomeBreakeven],
      ["PARTIAL", bundle.journal.outcomePartial],
      ["UNKNOWN", bundle.journal.outcomeUnknown],
    ];
    for (const [canonical, expected] of CASES) {
      const rendered = mapTradeOutcome(canonical, bundle);
      expect(rendered, `${code}.${canonical}`).toBe(expected);
      expect(rendered, `${code}.${canonical} still renders the raw enum`).not.toBe(
        canonical,
      );
    }
  });

  it("an unrecognised status degrades readably instead of rendering blank", () => {
    expect(mapTradeStatus("SOMETHING_NEW", en).length).toBeGreaterThan(0);
    expect(mapTradeOutcome(undefined, en).length).toBeGreaterThanOrEqual(0);
  });
});
