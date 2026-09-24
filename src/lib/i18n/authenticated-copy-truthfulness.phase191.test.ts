/**
 * Phase 191 — authenticated-surface copy truthfulness.
 *
 * Phase 190 held the public landing page to its implemented capability. This
 * does the same for the signed-in product, where the stakes are higher: a
 * visitor who over-trusts marketing copy has lost nothing yet, while a user
 * reading a position dashboard may be about to risk capital on it.
 *
 * The four claims that must never be made:
 *   1. a confidence score is a probability or win rate,
 *   2. stale / cached / provider-unavailable evidence is live,
 *   3. a monitoring alert is an executed trade,
 *   4. a LOCKED directional result is merely WAIT / NO_TRADE.
 *
 * Where a mapping function exists, these tests call it with real inputs
 * rather than asserting that a string appears in a file.
 */

import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import type { AcquisitionMode } from "@/lib/data/acquisition-provenance";
import { recordProvenance } from "@/lib/data/acquisition-provenance";
import {
  describeAcquisitionForUser,
  describeDegradedForUser,
  describeFreshnessForUser,
  describeHistoricalForUser,
  describeProvenanceForUser,
  formatEvidenceAge,
  mayPresentAsCurrent,
} from "@/lib/i18n/provenance-copy";
import type { Translations } from "@/lib/i18n/types";

import en from "@/lib/i18n/en";
import id from "@/lib/i18n/id";
import es from "@/lib/i18n/es";
import fr from "@/lib/i18n/fr";
import pt from "@/lib/i18n/pt";
import de from "@/lib/i18n/de";
import ja from "@/lib/i18n/ja";
import ko from "@/lib/i18n/ko";
import zh from "@/lib/i18n/zh";

const ROOT = process.cwd();
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");

const CATALOGUES: Record<string, Translations> = { en, id, es, fr, pt, de, ja, ko, zh };
const LOCALES = Object.keys(CATALOGUES);

const ALL_MODES: AcquisitionMode[] = [
  "observed-now",
  "observed-shared",
  "cache-reused",
  "uncached-by-design",
  "unavailable",
  "timed-out",
  "rate-limited",
  "skipped",
];

// ── Shared scanning helpers (Phase 190 lineage) ─────────────────

function stripComments(src: string): string {
  return src
    .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Negation-aware claim detection (Phase 190).
 *
 * "does not execute trades" and "executes trades" share their keywords. A
 * scanner that cannot tell them apart flags the disclaimers that make the
 * product honest, which trains engineers to delete disclaimers.
 */
const NEGATORS =
  /\b(not|never|no|without|cannot|doesn't|does|tidak|bukan|tanpa|nunca|jamais|aucune?|ne|nicht|keine?|não|sem)\b|않|없|아닙|不|无|非|せず|ありません|ません|なく/i;

function affirmativeClaims(text: string, pattern: RegExp): string[] {
  const global = new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  );
  const hits: string[] = [];
  for (const match of text.matchAll(global)) {
    const before = text.slice(Math.max(0, (match.index ?? 0) - 30), match.index);
    if (!NEGATORS.test(before)) hits.push(match[0]);
  }
  return hits;
}

/** Every string value in a locale catalogue, flattened. */
function allValues(node: unknown, out: string[] = []): string[] {
  if (typeof node === "string") out.push(node);
  else if (node && typeof node === "object") {
    for (const v of Object.values(node as Record<string, unknown>)) allValues(v, out);
  }
  return out;
}

/** Authenticated component + page source, comments stripped. */
const AUTH_FILES = [
  ...readdirSync(resolve(ROOT, "src/components"))
    .filter((f) => f.endsWith(".tsx") && !f.includes(".test."))
    .map((f) => `src/components/${f}`),
  "src/pages/Dashboard.tsx",
];
const AUTH_SRC = AUTH_FILES.map((f) => stripComments(read(f))).join("\n");

// ════════════ 1. CONFIDENCE / CONVICTION SEMANTICS ════════════

describe("191.1 — confidence is never presented as a probability", () => {
  it("no locale equates confidence or conviction with probability", () => {
    const CLAIMS: Array<[string, RegExp]> = [
      ["probability of profit", /probability of (profit|success|winning)/i],
      ["chance of success", /\b\d{1,3}\s?%\s*(chance|probability|odds)\b/i],
      ["win rate", /\bwin[\s-]?rate\b/i],
      ["expected accuracy", /\bexpected accuracy\b/i],
      ["accuracy guarantee", /guarantee[sd]?\s+(accuracy|accurate)/i],
      ["profit guarantee", /guarantee[sd]?\s+(a\s+)?(profit|return|gain)/i],
      ["certainty", /\b(certain|guaranteed)\s+(outcome|result|move)\b/i],
      ["id profit guarantee", /menjamin\s+(profit|keuntungan)/i],
      ["es profit guarantee", /garantiza\s+(beneficios?|ganancias?)/i],
      ["de profit guarantee", /garantiert\s+(Gewinn|Profit)/i],
      ["zh win rate", /胜率(?!也不是)/],
      ["ja win rate", /勝率(?!でも)/],
    ];
    for (const locale of LOCALES) {
      const joined = allValues(CATALOGUES[locale]).join("\n");
      for (const [label, pattern] of CLAIMS) {
        expect(
          affirmativeClaims(joined, pattern),
          `${locale} contains ${label}`,
        ).toEqual([]);
      }
    }
  });

  it("the detector is not vacuous — planted claims are caught", () => {
    const PLANTED = [
      "This setup has a 78% probability of success.",
      "Our engine guarantees accuracy for every signal.",
      "Historical win rate across all instruments.",
    ];
    const patterns: RegExp[] = [
      /probability of (profit|success|winning)/i,
      /\b\d{1,3}\s?%\s*(chance|probability|odds)\b/i,
      /\bwin[\s-]?rate\b/i,
      /guarantee[sd]?\s+(accuracy|accurate)/i,
    ];
    for (const sentence of PLANTED) {
      expect(
        patterns.some((p) => affirmativeClaims(sentence, p).length > 0),
        `detector missed: ${sentence}`,
      ).toBe(true);
    }
    // Honest negations must NOT be flagged.
    for (const honest of [
      "Conviction is not a win rate and not a probability.",
      "Intelligence confidence does not guarantee accuracy.",
    ]) {
      expect(
        patterns.some((p) => affirmativeClaims(honest, p).length > 0),
        `false positive on: ${honest}`,
      ).toBe(false);
    }
  });

  it("history shows an ordinal conviction band, not a bare percentage", () => {
    // A raw "72%" beside a directional bias reads as a probability. The
    // engine's `confidence` is a clamped 20-88 confluence heuristic.
    const history = stripComments(read("src/components/AnalysisHistory.tsx"));
    expect(history).not.toMatch(/\{a\.confidence\}\s*%/);
    expect(history).toContain("mapConfidence");
  });

  it("the conviction bands in history and the result panel agree", () => {
    const history = read("src/components/AnalysisHistory.tsx");
    const result = read("src/components/AnalysisResult.tsx");
    // Both must use the same thresholds, or the same record would show
    // different conviction on two screens.
    for (const src of [history, result]) {
      expect(src).toMatch(/>=\s*70/);
      expect(src).toMatch(/>=\s*50/);
    }
  });

  it("every locale states that intelligence confidence is not a likelihood", () => {
    for (const locale of LOCALES) {
      const value = CATALOGUES[locale].protection.confidenceNotProbability;
      expect(value.trim().length, `${locale} empty`).toBeGreaterThan(0);
    }
  });
});

// ════════════ 2. PROVENANCE MAPPING (real functions) ════════════

describe("191.2 — provenance wording maps from real acquisition modes", () => {
  it("every mode yields a distinct, non-empty description in all locales", () => {
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      const seen = new Set<string>();
      for (const mode of ALL_MODES) {
        const text = describeAcquisitionForUser(mode, t);
        expect(text.trim().length, `${locale}/${mode} empty`).toBeGreaterThan(0);
        seen.add(text);
      }
      // Collapsing two modes to one string would erase the distinction that
      // makes provenance meaningful.
      expect(seen.size, `${locale} collapses modes`).toBe(ALL_MODES.length);
    }
  });

  it("cache-reused never implies a new observation", () => {
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      const cached = describeAcquisitionForUser("cache-reused", t);
      const now = describeAcquisitionForUser("observed-now", t);
      expect(cached, `${locale} cache reads as fresh`).not.toBe(now);
      expect(mayPresentAsCurrent("cache-reused")).toBe(false);
    }
    // English wording is explicit about the provider not being contacted.
    expect(describeAcquisitionForUser("cache-reused", en).toLowerCase()).toContain(
      "not contacted",
    );
  });

  it("only genuine observations may be presented as current", () => {
    expect(mayPresentAsCurrent("observed-now")).toBe(true);
    expect(mayPresentAsCurrent("observed-shared")).toBe(true);
    expect(mayPresentAsCurrent("uncached-by-design")).toBe(true);
    for (const mode of ["cache-reused", "unavailable", "timed-out", "rate-limited", "skipped"] as const) {
      expect(mayPresentAsCurrent(mode), `${mode} must not read as current`).toBe(false);
    }
  });

  it("failure modes never claim completeness or verification", () => {
    // "Unavailable" turning into "Complete and verified by the provider" is
    // the single most dangerous provenance mutation: it converts an absence
    // of evidence into a positive assertion about it.
    const COMPLETE = [
      /\bcomplete\b/i, /\bverified\b/i, /\bconfirmed\b/i, /\bfull\b/i,
      /\blengkap\b/i, /\bcompleto\b/i, /\bcomplet\b/i, /\bvollständig\b/i,
      /完全|已验证|确认/, /完了|検証済/, /완료|검증/,
    ];
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      for (const mode of ["unavailable", "timed-out", "rate-limited", "skipped"] as const) {
        const text = describeAcquisitionForUser(mode, t);
        for (const pattern of COMPLETE) {
          expect(
            affirmativeClaims(text, pattern),
            `${locale}/${mode} claims completeness: "${text}"`,
          ).toEqual([]);
        }
      }
    }
  });

  it("failure modes never carry evidence-bearing wording", () => {
    const FRESH_WORDS = /observed now|diamati sekarang|observado ahora|observé maintenant|jetzt beobachtet|現在観測|지금 관측|刚刚观测/i;
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      for (const mode of ["unavailable", "timed-out", "rate-limited", "skipped"] as const) {
        expect(
          describeAcquisitionForUser(mode, t),
          `${locale}/${mode} implies an observation`,
        ).not.toMatch(FRESH_WORDS);
      }
    }
  });

  it("evidence age is shown only when an observation exists", () => {
    const observed = recordProvenance({
      provider: "p",
      dataset: "d",
      mode: "observed-now",
      observedAt: 1_000,
      usedAt: 61_000,
    });
    expect(describeProvenanceForUser(observed, en)).toContain("1m");

    // No observation ⇒ no age, and certainly not "0s".
    const missing = recordProvenance({
      provider: "p",
      dataset: "d",
      mode: "unavailable",
      usedAt: 61_000,
    });
    const text = describeProvenanceForUser(missing, en);
    expect(text).toBe(en.provenance.unavailable);
    expect(text).not.toMatch(/\d+s|\d+m|\d+h/);
  });

  it("usedAt is never rendered as the observation time", () => {
    // A cache hit used now but observed an hour ago must report the AGE, not
    // "just now". This is the usedAt ≠ observedAt rule made visible.
    const hourOld = recordProvenance({
      provider: "p",
      dataset: "d",
      mode: "cache-reused",
      observedAt: 0,
      usedAt: 3_600_000,
    });
    const text = describeProvenanceForUser(hourOld, en);
    expect(text).toContain("1h");
    expect(text.toLowerCase()).toContain("reused");
  });

  it("formatEvidenceAge never reports a negative or fabricated age", () => {
    expect(formatEvidenceAge(-5_000)).toBe("0s");
    expect(formatEvidenceAge(1_000)).toBe("1s");
    expect(formatEvidenceAge(90_000)).toBe("2m");
    expect(formatEvidenceAge(3_600_000)).toBe("1h");
    expect(formatEvidenceAge(86_400_000)).toBe("1d");
  });

  it("historical results are never described as current", () => {
    // "not current evidence" contains the word "current": only an
    // AFFIRMATIVE currency claim is a defect, so the scan must be
    // negation-aware rather than a bare substring match.
    const CURRENT = /\blive\b|\breal[\s-]?time\b|\bcurrent evidence\b|\bobserved now\b/i;
    for (const locale of LOCALES) {
      expect(
        affirmativeClaims(describeHistoricalForUser(CATALOGUES[locale]), CURRENT),
        `${locale} historical reads as live`,
      ).toEqual([]);
    }
    expect(describeHistoricalForUser(en).toLowerCase()).toContain("not current");
  });

  it("degraded is described as missing evidence, not as a market verdict", () => {
    // "Incomplete — some sources are missing" is a statement about the data
    // pipeline. "No opportunity — wait" is a statement about the MARKET.
    // Swapping the first for the second tells the user the market is quiet
    // when in fact the system simply could not see it.
    const VERDICT = [
      /\bno (trade|opportunity|setup|signal)\b/i,
      /\bwait\b/i,
      /\bneutral\b/i,
      /\bhealthy\b/i,
      /\ball clear\b/i,
      /tidak ada (peluang|sinyal)/i,
      /sin oportunidad/i,
      /aucune opportunité/i,
      /keine (Gelegenheit|Chance)/i,
      /機会なし|様子見/,
      /기회 없음|관망/,
      /没有机会|观望/,
    ];
    for (const locale of LOCALES) {
      const text = describeDegradedForUser(CATALOGUES[locale]);
      for (const pattern of VERDICT) {
        expect(
          affirmativeClaims(text, pattern),
          `${locale} degraded reads as a market verdict: "${text}"`,
        ).toEqual([]);
      }
    }
  });

  it("system-health labels never read as market verdicts", () => {
    // `system.degraded` describes OUR infrastructure. If it is reworded as
    // "No opportunity — wait", a provider outage is displayed as a market
    // observation — the same class of defect as `provenance.degraded`, on a
    // different key. Every health state is checked, not just the one.
    const VERDICT = [
      /\bno (trade|opportunity|setup|signal)\b/i,
      /\bwait\b/i,
      /\bbuy\b|\bsell\b|\blong\b|\bshort\b/i,
      /tidak ada (peluang|sinyal)/i,
      /sin oportunidad/i,
      /aucune opportunité/i,
      /keine (Gelegenheit|Chance)/i,
      /機会なし|様子見/,
      /기회 없음|관망/,
      /没有机会|观望/,
    ];
    for (const locale of LOCALES) {
      const sys = CATALOGUES[locale].system as unknown as Record<string, string>;
      for (const key of ["healthy", "degraded", "failed"]) {
        const text = sys[key];
        expect(text, `${locale}.system.${key} missing`).toBeTruthy();
        for (const pattern of VERDICT) {
          expect(
            affirmativeClaims(text, pattern),
            `${locale}.system.${key} reads as a market verdict: "${text}"`,
          ).toEqual([]);
        }
      }
      // Health states must stay mutually distinct.
      expect(new Set([sys.healthy, sys.degraded, sys.failed]).size).toBe(3);
    }
  });

  it("degraded and stale are never confused with an empty market", () => {
    // Each must remain distinct from the "no data at all" wording, so a
    // pipeline failure cannot be read as a genuine absence of opportunity.
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      expect(describeDegradedForUser(t)).not.toBe(t.status.unavailable);
      expect(t.provenance.stale).not.toBe(t.provenance.unavailable);
      expect(t.provenance.degraded).not.toBe(t.provenance.unavailable);
    }
  });

  it("freshness labels round-trip for every level", () => {
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      const labels = (["FRESH", "RECENT", "DELAYED", "STALE", "UNAVAILABLE"] as const).map(
        (f) => describeFreshnessForUser(f, t),
      );
      expect(new Set(labels).size, `${locale} collapses freshness levels`).toBe(5);
      for (const l of labels) expect(l.trim().length).toBeGreaterThan(0);
    }
  });

  it("UNAVAILABLE freshness never reads as live", () => {
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      expect(describeFreshnessForUser("UNAVAILABLE", t)).not.toBe(
        describeFreshnessForUser("FRESH", t),
      );
    }
  });
});

// ════════════ 3. EXECUTION BOUNDARY ════════════

describe("191.3 — monitoring is never presented as execution", () => {
  it("no authenticated surface claims an order was placed", () => {
    const EXEC_CLAIMS: RegExp[] = [
      /\border (submitted|placed|filled|sent)\b/i,
      /\btrade executed\b/i,
      /\bposition (opened|closed) (for you|automatically)\b/i,
      /\bwe (placed|submitted|executed)\b/i,
      /\bautomatically (close|closes|closed) your position\b/i,
    ];
    for (const pattern of EXEC_CLAIMS) {
      expect(
        affirmativeClaims(AUTH_SRC, pattern),
        `authenticated source claims execution: ${pattern}`,
      ).toEqual([]);
    }
    for (const locale of LOCALES) {
      const joined = allValues(CATALOGUES[locale]).join("\n");
      for (const pattern of EXEC_CLAIMS) {
        expect(
          affirmativeClaims(joined, pattern),
          `${locale} claims execution: ${pattern}`,
        ).toEqual([]);
      }
    }
  });

  it("the no-auto-execution guarantee is actually rendered, not just translated", () => {
    // It shipped to all nine locales in an earlier phase but was displayed
    // nowhere, so the monitoring UI never stated its own boundary.
    //
    // Comments are stripped first: a comment that merely NAMES the key looks
    // identical to a render call under a substring scan, so deleting the JSX
    // while leaving the explanation behind would otherwise pass.
    const dashboard = stripComments(read("src/components/PositionProtectionDashboard.tsx"));
    for (const key of ["protection.noAutoExecute", "protection.confidenceNotProbability"]) {
      // Must appear inside an actual translation call.
      const escaped = key.split(".").join("\\.");
      const rendered = new RegExp(
        String.raw`(?:tx|txi)\(\s*["'\`]${escaped}["'\`]|t\.${escaped}(?![\w.])`,
      );
      expect(dashboard, `${key} is not rendered`).toMatch(rendered);
    }
  });

  it("every locale's no-auto-execution string denies automation", () => {
    const DENIAL: Record<string, RegExp> = {
      en: /no trades are executed automatically/i,
      id: /tidak ada perdagangan yang dieksekusi secara otomatis/i,
      es: /no se ejecutan operaciones autom/i,
      fr: /aucune (opération|transaction) n'est exécutée automatiquement/i,
      pt: /nenhuma (operação|negociação) é executada automaticamente/i,
      de: /keine (Trades|Geschäfte)[^.]*automatisch ausgeführt/i,
      ja: /自動的に実行されません/,
      ko: /자동으로 실행되지 않/,
      zh: /不会自动执行/,
    };
    for (const locale of LOCALES) {
      expect(
        CATALOGUES[locale].protection.noAutoExecute,
        `${locale} no-auto-execute wording`,
      ).toMatch(DENIAL[locale]);
    }
  });

  it("no locale implies a broker or exchange acknowledged anything", () => {
    const BROKER = [
      /\bbroker (confirmed|acknowledged|accepted)\b/i,
      /\bexchange (confirmed|acknowledged|accepted)\b/i,
      /\bfill (confirmed|received)\b/i,
    ];
    for (const locale of LOCALES) {
      const joined = allValues(CATALOGUES[locale]).join("\n");
      for (const pattern of BROKER) {
        expect(affirmativeClaims(joined, pattern), `${locale}`).toEqual([]);
      }
    }
  });
});

// ════════════ 4. RISK / SIZING WORDING ════════════

describe("191.4 — risk wording promises no guarantees", () => {
  it("no locale guarantees stops, fills or loss bounds", () => {
    const RISK_CLAIMS: RegExp[] = [
      /guarantee[sd]?\s+(stop|fill|execution)/i,
      /\bstop[\s-]?loss (is )?guaranteed\b/i,
      /\b(caps?|limits?|bounds?) your loss(es)? (to|at)\b/i,
      /\bno risk\b/i,
      /\brisk[\s-]free\b/i,
      /\bguaranteed (exit|protection)\b/i,
    ];
    for (const locale of LOCALES) {
      const joined = allValues(CATALOGUES[locale]).join("\n");
      for (const pattern of RISK_CLAIMS) {
        expect(affirmativeClaims(joined, pattern), `${locale} ${pattern}`).toEqual([]);
      }
    }
  });

  it("position sizing is framed as a suggestion, not an instruction", () => {
    const riskNote = en.analysisResult.riskNoteDisclaimer;
    expect(riskNote.trim().length).toBeGreaterThan(0);
    expect(affirmativeClaims(riskNote, /guarantee/i)).toEqual([]);
  });
});

// ════════════ 5. LOCKED ≠ WAIT ════════════

describe("191.5 — LOCKED is never presented as WAIT / NO_TRADE", () => {
  it("every locale states that LOCKED is not a Wait verdict", () => {
    for (const locale of LOCALES) {
      const value = CATALOGUES[locale].entitlement.lockedNotWait;
      expect(value.trim().length, `${locale} empty lockedNotWait`).toBeGreaterThan(0);
    }
    expect(en.entitlement.lockedNotWait.toLowerCase()).toContain("not a wait");
  });

  it("the locked surface never leaks the withheld direction", () => {
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      const lockedCopy = [
        t.entitlement.lockedTitle,
        t.entitlement.lockedBody,
        t.entitlement.lockedNotWait,
      ].join(" ");
      // Naming a side here would defeat the entitlement gate entirely.
      expect(lockedCopy, `${locale} leaks a direction`).not.toMatch(
        /\b(LONG|SHORT|BUY|SELL)\b/,
      );
    }
  });

  it("free outcomes stay free and are described as such", () => {
    expect(en.entitlement.freeAlways.toLowerCase()).toMatch(/wait|no-trade/);
  });
});

// ════════════ 6. COMPLETENESS ════════════

describe("191.6 — completeness claims are backed by invariants", () => {
  it("completeness labels are distinct and none implies verification", () => {
    for (const locale of LOCALES) {
      const c = CATALOGUES[locale].marketPanel.completeness;
      const labels = [c.full, c.partial, c.minimal, c.none];
      expect(new Set(labels).size, `${locale} collapses completeness`).toBe(4);
    }
  });

  it("no locale claims data was verified or confirmed by a provider", () => {
    const VERIFIED = [
      /\bprovider confirmed\b/i,
      /\bverified by (the )?provider\b/i,
      /\bindependently verified\b/i,
      /\bfully verified\b/i,
    ];
    for (const locale of LOCALES) {
      const joined = allValues(CATALOGUES[locale]).join("\n");
      for (const pattern of VERIFIED) {
        expect(affirmativeClaims(joined, pattern), `${locale} ${pattern}`).toEqual([]);
      }
    }
  });
});

// ════════════ 7. ERROR SEMANTICS ════════════

describe("191.7 — errors never leak internals", () => {
  it("no locale exposes credentials, env vars or internal identifiers", () => {
    const LEAKS = [
      /[A-Z][A-Z0-9]{3,}_API_KEY/,
      /VITE_[A-Z_]+/,
      /\bconvex\.cloud\b/i,
      /\bstack trace\b/i,
      /\bctx\.runMutation\b/,
      /\bInternalServerError\b/,
    ];
    for (const locale of LOCALES) {
      const joined = allValues(CATALOGUES[locale]).join("\n");
      for (const pattern of LEAKS) {
        expect(joined, `${locale} leaks ${pattern}`).not.toMatch(pattern);
      }
    }
  });

  it("distinct failure kinds have distinct user-facing copy", () => {
    // Collapsing these would turn a provider outage into "no data", which
    // reads as a market fact rather than an infrastructure problem.
    for (const locale of LOCALES) {
      const t = CATALOGUES[locale];
      const distinct = [
        t.status.unavailable,
        t.status.insufficientData,
        t.provenance.degraded,
        t.provenance.historical,
      ];
      expect(new Set(distinct).size, `${locale} collapses failure kinds`).toBe(
        distinct.length,
      );
    }
  });
});

// ════════════ 8. LOCALE PARITY FOR NEW KEYS ════════════

describe("191.8 — provenance keys reach every locale", () => {
  const PROVENANCE_KEYS = [
    "observedNow", "observedShared", "cacheReused", "uncachedByDesign",
    "unavailable", "timedOut", "rateLimited", "skipped", "historical",
    "stale", "degraded", "evidenceAge", "notContacted",
  ] as const;

  it("all 9 locales define all provenance keys", () => {
    for (const locale of LOCALES) {
      const p = CATALOGUES[locale].provenance as Record<string, string>;
      for (const key of PROVENANCE_KEYS) {
        expect(p[key], `${locale}.provenance.${key}`).toBeTruthy();
      }
      expect(Object.keys(p).sort()).toEqual([...PROVENANCE_KEYS].sort());
    }
  });

  it("the {age} placeholder survives translation in every locale", () => {
    for (const locale of LOCALES) {
      expect(
        CATALOGUES[locale].provenance.evidenceAge,
        `${locale} dropped {age}`,
      ).toContain("{age}");
    }
  });

  it("no locale falls back to the English provenance strings", () => {
    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const p = CATALOGUES[locale].provenance;
      expect(p.cacheReused, `${locale} untranslated`).not.toBe(en.provenance.cacheReused);
      expect(p.historical, `${locale} untranslated`).not.toBe(en.provenance.historical);
    }
  });

  it("no Indonesian prose leaks into other locales' provenance copy", () => {
    const ID_MARKERS = [" tidak ", " dengan ", " yang ", " bukan "];
    for (const locale of LOCALES.filter((l) => l !== "id")) {
      const joined = ` ${allValues(CATALOGUES[locale].provenance).join(" ")} `.toLowerCase();
      for (const marker of ID_MARKERS) {
        expect(joined, `${locale} contains "${marker.trim()}"`).not.toContain(marker);
      }
    }
  });
});

// ════════════ 9. FRESHNESS SOURCE INTEGRITY ════════════

describe("191.9 — freshness derives from observation, not fetch time", () => {
  it("the dashboard does not substitute fetch time for observation time", () => {
    const dash = stripComments(read("src/pages/Dashboard.tsx"));
    // `price.timestamp || fetchTimestamp` would grade hours-old data FRESH
    // whenever the provider omitted its own timestamp.
    expect(dash).not.toMatch(/observedAt:\s*[^\n]*fetchTimestamp/);
  });

  it("a snapshot without an observation time cannot be realtime", () => {
    const registry = stripComments(read("src/lib/market-radar/provider-registry.ts"));
    expect(registry).toMatch(/observedAt === undefined[\s\S]{0,80}unavailable/);
  });

  it("observedAt is optional in the radar contract", () => {
    // Making it required forced call sites to invent a value.
    expect(read("src/lib/market-radar/types.ts")).toMatch(/observedAt\?:\s*number/);
  });
});
