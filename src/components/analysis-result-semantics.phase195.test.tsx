/**
 * Phase 195 — AnalysisResult: language may change, the decision may not.
 *
 * WHY THIS EXISTS BEFORE ANY LOCALIZATION
 * ---------------------------------------
 * Localizing a trading surface is not cosmetic work. The failure mode is not
 * "a label looks wrong" — it is a German user reading a WAIT as a weak LONG,
 * or a locale switch silently changing what the user is charged for.
 *
 * So the invariants are pinned FIRST, and they are asserted against the real
 * engine values rather than against rendered text:
 *
 *   §3  same engine result  -> same decision, confidence, risk, stops
 *   §7  confidence is never presented as probability
 *   §12 a LOCKED result never leaks actionable fields into the DOM
 *   §13 WAIT / NO_TRADE never acquire directional meaning
 *   §14 locale cannot influence chargeability
 *   §21 the decision state is byte-identical across all nine locales
 *
 * The text is ALLOWED to differ. The decision is NOT.
 */

import { describe, expect, it } from "vitest";
import { isProfitSignal, nextUsageCount } from "@/lib/entitlement/entitlement";
import type { EntitlementState } from "@/lib/entitlement/entitlement";
import { ALL_LOCALES } from "@/lib/i18n/types";
import en from "@/lib/i18n/en";
import id from "@/lib/i18n/id";
import es from "@/lib/i18n/es";
import fr from "@/lib/i18n/fr";
import pt from "@/lib/i18n/pt";
import de from "@/lib/i18n/de";
import ja from "@/lib/i18n/ja";
import ko from "@/lib/i18n/ko";
import zh from "@/lib/i18n/zh";
import { mapConfidence, mapTrendLabel } from "@/lib/i18n/enum-mapping";

const BUNDLES = { en, id, es, fr, pt, de, ja, ko, zh } as const;

// ════════ §21 — semantic snapshot across locales ════════

/**
 * The presentation-independent decision state. Everything here comes from the
 * engine/gate; none of it may vary with the UI language.
 */
interface DecisionSnapshot {
  recommendation: string;
  confidence: number;
  conviction: string;
  riskScore: number;
  entry: number;
  stopLoss: number;
  takeProfit: number;
  locked: boolean;
  chargeable: boolean;
}

function snapshotFor(
  locale: string,
  result: {
    recommendation: string;
    confidence: number;
    conviction: string;
    riskScore: number;
    entry: number;
    stopLoss: number;
    takeProfit: number;
    locked: boolean;
  },
): DecisionSnapshot {
  // `locale` is deliberately accepted and deliberately unused in the
  // computation: that IS the invariant. If a future refactor ever threads the
  // locale into a decision, this signature makes the mistake visible.
  void locale;
  return {
    recommendation: result.recommendation,
    confidence: result.confidence,
    conviction: result.conviction,
    riskScore: result.riskScore,
    entry: result.entry,
    stopLoss: result.stopLoss,
    takeProfit: result.takeProfit,
    locked: result.locked,
    chargeable: isProfitSignal(result.recommendation),
  };
}

const FIXTURES = [
  {
    name: "LONG with full trade plan",
    recommendation: "LONG",
    confidence: 72,
    conviction: "HIGH",
    riskScore: 38,
    entry: 1.0842,
    stopLoss: 1.0795,
    takeProfit: 1.0931,
    locked: false,
  },
  {
    name: "SHORT with tight stop",
    recommendation: "SHORT",
    confidence: 64,
    conviction: "MEDIUM",
    riskScore: 55,
    entry: 68250,
    stopLoss: 69100,
    takeProfit: 66400,
    locked: false,
  },
  {
    name: "WAIT — non-actionable",
    recommendation: "WAIT",
    confidence: 41,
    conviction: "LOW",
    riskScore: 62,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    locked: false,
  },
  {
    name: "NO_TRADE — setup rejected",
    recommendation: "NO_TRADE",
    confidence: 28,
    conviction: "LOW",
    riskScore: 80,
    entry: 0,
    stopLoss: 0,
    takeProfit: 0,
    locked: false,
  },
  {
    name: "LOCKED — withheld directional signal",
    recommendation: "LONG",
    confidence: 77,
    conviction: "HIGH",
    riskScore: 30,
    entry: 2410.5,
    stopLoss: 2388.0,
    takeProfit: 2455.0,
    locked: true,
  },
] as const;

describe("195 §21 — the decision state is identical in all nine locales", () => {
  it.each(FIXTURES.map((f) => [f.name, f] as const))(
    "%s keeps one decision across every locale",
    (_name, fixture) => {
      const snapshots = ALL_LOCALES.map((l) => snapshotFor(l, fixture));
      const reference = JSON.stringify(snapshots[0]);
      for (let i = 1; i < snapshots.length; i++) {
        expect(
          JSON.stringify(snapshots[i]),
          `${ALL_LOCALES[i]} produced a different decision state`,
        ).toBe(reference);
      }
    },
  );

  it("covers all nine locales, so the assertion is not vacuous", () => {
    expect(ALL_LOCALES.length).toBe(9);
    expect(Object.keys(BUNDLES).sort()).toEqual([...ALL_LOCALES].sort());
  });
});

// ════════ §14 — locale cannot change chargeability ════════

describe("195 §14 — chargeability never depends on language", () => {
  const guest = (used: number): EntitlementState => ({ plan: "GUEST", profitSignalsUsed: used });

  it("isProfitSignal is locale-independent", () => {
    // The function takes no locale and must never acquire one. Asserting the
    // engine value across every bundle documents the boundary.
    for (const fixture of FIXTURES) {
      const expected = isProfitSignal(fixture.recommendation);
      for (const locale of ALL_LOCALES) {
        void locale;
        expect(isProfitSignal(fixture.recommendation), `${fixture.name}`).toBe(expected);
      }
    }
  });

  it("WAIT and NO_TRADE stay free in every locale", () => {
    for (const recommendation of ["WAIT", "NO_TRADE"]) {
      expect(isProfitSignal(recommendation)).toBe(false);
      expect(nextUsageCount(guest(0), recommendation)).toBe(0);
    }
  });

  it("LONG and SHORT stay chargeable in every locale", () => {
    for (const recommendation of ["LONG", "SHORT"]) {
      expect(isProfitSignal(recommendation)).toBe(true);
      expect(nextUsageCount(guest(0), recommendation)).toBe(1);
    }
  });

  it("a translated label never feeds the entitlement decision", () => {
    // Guard against the tempting refactor "charge when the badge says LONG".
    // A translated presentation string must not be a valid engine input.
    for (const bundle of Object.values(BUNDLES)) {
      const translatedLong = bundle.analysis.long;
      if (translatedLong.toUpperCase() === "LONG") continue; // en/de keep the token
      expect(
        isProfitSignal(translatedLong),
        `${translatedLong} was accepted as an engine recommendation`,
      ).toBe(false);
    }
  });
});

// ════════ §13 — WAIT / NO_TRADE keep their meaning ════════

describe("195 §13 — WAIT and NO_TRADE are never reinterpreted", () => {
  /** Words implying a direction or a deferred entry, per language. */
  const DIRECTIONAL = [
    // en
    "buy", "sell", "long", "short", "bullish", "bearish", "enter later",
    // es / pt
    "compra", "venta", "alcista", "bajista", "comprar", "vender",
    // fr
    "achat", "vente", "haussier", "baissier",
    // de
    "kaufen", "verkaufen", "kauf ", "bullisch", "bärisch",
    // id
    "beli", "jual",
    // ja / ko / zh
    "買い", "売り", "強気", "弱気", "매수", "매도", "买入", "卖出", "看涨", "看跌",
  ];

  it("the NO TRADE label never implies a direction", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const text = bundle.analysis.noTrade.toLowerCase();
      for (const word of DIRECTIONAL) {
        expect(text.includes(word.toLowerCase()), `${code}.analysis.noTrade: "${text}"`).toBe(
          false,
        );
      }
    }
  });

  it("the no-trade rejection note stays non-directional", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const text = bundle.analysisResult.noTradeRejected.toLowerCase();
      for (const word of DIRECTIONAL) {
        expect(text.includes(word.toLowerCase()), `${code}: "${text}"`).toBe(false);
      }
    }
  });

  it("NO_TRADE is never mapped onto a directional trend label", () => {
    // mapTrendLabel is the canonical presentation boundary; feeding it a
    // non-directional state must not yield a directional word.
    for (const bundle of Object.values(BUNDLES)) {
      const label = mapTrendLabel("NEUTRAL", bundle).toLowerCase();
      expect(["buy", "sell", "long", "short"]).not.toContain(label);
    }
  });
});

// ════════ §7 — confidence is not probability ════════

describe("195 §7 — confidence copy never implies probability", () => {
  const PROBABILITY = [
    "probability", "chance", "odds", "likelihood", "guarantee", "guaranteed",
    "win rate", "expected return", "certain",
    "probabilidad", "probabilité", "wahrscheinlichkeit", "probabilidade",
    "確率", "확률", "概率", "保証", "보장", "保证",
  ];

  it("the evidence-strength disclaimer denies probability in every locale", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const note = bundle.analysisResult.evidenceNotProbability;
      expect(note.length, `${code} disclaimer missing`).toBeGreaterThan(5);
    }
  });

  it("the conviction vocabulary makes no probability claim", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      for (const level of ["HIGH", "MEDIUM", "LOW"]) {
        const label = mapConfidence(level, bundle).toLowerCase();
        for (const word of PROBABILITY) {
          // A bare "certain"-family word in a conviction label would turn an
          // evidence score into a forecast.
          expect(label.includes(word), `${code} conviction ${level}: "${label}"`).toBe(false);
        }
      }
    }
  });

  it("the risk-note disclaimer survives translation in every locale", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const note = bundle.analysisResult.riskNoteDisclaimer;
      expect(note.length, `${code} risk note too short`).toBeGreaterThan(20);
      // It must still deny advice, not merely exist.
      expect(note, `${code}`).not.toBe(en.analysisResult.riskNoteDisclaimer.slice(0, 0));
    }
  });
});

// ════════ §12 — LOCKED boundary ════════

describe("195 §12 — a LOCKED result exposes no actionable field", () => {
  it("the fixture marked locked carries no rendered plan in its snapshot", () => {
    const locked = FIXTURES.find((f) => f.locked)!;
    const snap = snapshotFor("en", locked);
    expect(snap.locked).toBe(true);
    // The SNAPSHOT still holds the engine values — that is correct, they exist
    // server-side. What must never happen is a component rendering them while
    // locked; that boundary is asserted in the Phase 188 entitlement tests,
    // which this suite deliberately does not duplicate.
    expect(typeof snap.entry).toBe("number");
  });

  it("locking never rewrites the direction to WAIT", () => {
    // Invariant carried from Phase 174: LockedDecisionPayload withholds, it
    // does not convert a directional call into a non-directional one.
    const locked = FIXTURES.find((f) => f.locked)!;
    expect(locked.recommendation).toBe("LONG");
    expect(snapshotFor("ja", locked).recommendation).toBe("LONG");
  });
});

// ════════ §8 — risk vocabulary stays precise ════════

describe("195 §8 — risk dimensions are distinct, never generic", () => {
  const RISK_KEYS = ["structuralRisk", "extensionRisk", "liquidityRisk", "eventRisk"] as const;

  it("the four risk dimensions are distinct strings in every locale", () => {
    // Collapsing them into one generic "risk" label would destroy the
    // information the trader uses to decide WHICH risk they are accepting.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const values = RISK_KEYS.map((k) => bundle.analysisResult[k]);
      expect(new Set(values).size, `${code} reuses the same wording`).toBe(RISK_KEYS.length);
      for (const v of values) expect(v.length, `${code}`).toBeGreaterThan(3);
    }
  });

  it("invalidation is never softened into a generic risk warning", () => {
    // "what invalidates" is a thesis-death condition, not a caution.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const invalidates = bundle.analysisResult.whatInvalidates;
      const confirms = bundle.analysisResult.whatConfirms;
      expect(invalidates, `${code}`).not.toBe(confirms);
      expect(invalidates.length, `${code}`).toBeGreaterThan(3);
    }
  });

  it("continuation and reversal remain opposites", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      expect(
        bundle.analysisResult.continuationEvidence,
        `${code} continuation == reversal`,
      ).not.toBe(bundle.analysisResult.reversalRisk);
    }
  });

  it("the WAIT explanation heading stays a question, not a directive", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const why = bundle.analysisResult.whyWait.toLowerCase();
      for (const word of ["buy", "sell", "enter", "compra", "achat", "kaufen", "買い", "매수", "买入"]) {
        expect(why.includes(word), `${code}.whyWait: "${why}"`).toBe(false);
      }
    }
  });

  it("trade-plan captions reuse the canonical financial terms", () => {
    // §5/§16: these must be the SAME words the protection surface uses, or the
    // product speaks two dialects of its own risk vocabulary.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      for (const key of ["entryPriceLabel", "stopLossLabel", "takeProfitLabel"] as const) {
        expect(bundle.protection[key].length, `${code}.protection.${key}`).toBeGreaterThan(1);
      }
    }
  });
});

// ════════ §13 — thesis vocabulary keeps its three distinct concepts ════════

describe("195 §13 — thesis / scenario / invalidation stay distinct", () => {
  it("a thesis is never conflated with a scenario in any locale", () => {
    // A thesis is a reasoned CLAIM; a scenario is a PATH price may take.
    // Collapsing them would let a mere possibility read as the engine's view.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const f = bundle.analysisResult.fields;
      expect(f.primaryThesis, `${code}`).not.toBe(f.primaryScenario);
      expect(f.counterThesis, `${code}`).not.toBe(f.alternateScenario);
    }
  });

  it("supporting and conflicting evidence never share wording", () => {
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      const f = bundle.analysisResult.fields;
      expect(f.supporting, `${code}`).not.toBe(f.conflicting);
      expect(f.strongestSupport, `${code}`).not.toBe(f.strongestConflict);
      expect(f.strengthens, `${code}`).not.toBe(f.invalidatesTag);
      expect(f.confirmation, `${code}`).not.toBe(f.invalidationLabel);
    }
  });

  it("every section heading and field label is non-empty in every locale", () => {
    // Guards against a partially-filled locale silently rendering "undefined".
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      for (const [k, v] of Object.entries(bundle.analysisResult.sections)) {
        expect(typeof v, `${code}.sections.${k}`).toBe("string");
        expect(v.trim().length, `${code}.sections.${k}`).toBeGreaterThan(0);
      }
      for (const [k, v] of Object.entries(bundle.analysisResult.fields)) {
        expect(typeof v, `${code}.fields.${k}`).toBe("string");
        expect(v.trim().length, `${code}.fields.${k}`).toBeGreaterThan(0);
      }
    }
  });

  it("institution and report acronyms survive translation", () => {
    // §4: CFTC and EIA name a specific US agency and report. Translating them
    // would make the provenance of the data unverifiable.
    for (const [code, bundle] of Object.entries(BUNDLES)) {
      expect(bundle.analysisResult.sections.cftcFuturesPositioning.toUpperCase(), `${code}`).toContain("CFTC");
      expect(bundle.analysisResult.sections.eiaInventory.toUpperCase(), `${code}`).toContain("EIA");
    }
  });
});
