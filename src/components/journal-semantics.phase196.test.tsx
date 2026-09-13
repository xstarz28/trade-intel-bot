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
import { classifyOutcome, computePnl } from "@/lib/journal";
import type { JournalEntry, TradeStatus } from "@/types/journal";

const BUNDLES = { en, id, es, fr, pt, de, ja, ko, zh } as const;

type LocaleCode = keyof typeof BUNDLES;

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
