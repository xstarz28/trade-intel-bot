/**
 * Phase 300 runtime-integration fix — the COMPLETE timeframe matrix and the
 * style→timeframe policy, as pure configuration contracts.
 *
 * Production finding being locked down: the UI exposed M15/H1/H4/D1/W1 only,
 * scalping claimed M15/H1 as SETUP timeframes, and M30 did not exist anywhere
 * — so the product model (SCALPING M1/M5, INTRADAY M15/M30/H1, SWING
 * H4/D1/W1) was unimplementable. This suite pins the corrected matrix, the
 * style policy, the per-style MTF chain derivation, and — critically — that
 * the FROZEN positional ladder (M15/H1/H4/D1/W1 chains) is byte-identical to
 * `buildChain`, i.e. no analytical rule moved.
 *
 * No analytical methodology is defined or changed here: these are selection
 * policies over REAL provider timeframes.
 */

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { TIMEFRAMES } from "../analysis-engine";
import type { Timeframe } from "../../types/analysis";
import {
  STYLE_MTF_CONTEXT,
  STYLE_PROFILES,
  adaptSetupTimeframe,
} from "../trading-style";
import { buildChain, buildStyleMtfChain, TF_LADDER } from "./mtf";
import { mapCcxtTimeframe } from "../discovery/ccxt-live";
import { mapTwelveDataInterval } from "./universal/live/twelve-data-protocol";

/** Compile-time guard: the type itself must carry all eight rungs. */
const FULL_MATRIX: readonly Timeframe[] = [
  "M1",
  "M5",
  "M15",
  "M30",
  "H1",
  "H4",
  "D1",
  "W1",
];

describe("Phase 300b — complete timeframe matrix", () => {
  it("the UI-facing TIMEFRAMES list exposes exactly M1…W1, in ladder order", () => {
    expect(TIMEFRAMES.map((tf) => tf.value)).toEqual([...FULL_MATRIX]);
  });

  it("every matrix entry has a distinct, non-empty label", () => {
    const labels = TIMEFRAMES.map((tf) => tf.label);
    expect(labels.every((l) => l.length > 0)).toBe(true);
    expect(new Set(labels).size).toBe(TIMEFRAMES.length);
  });

  it("M30 exists as a Timeframe and is accepted by the persisted-record validation list", () => {
    const tf: Timeframe = "M30";
    expect(tf).toBe("M30");
    // from-db-record validates persisted timeframes against its own list;
    // an M30 record must be recognized, not downgraded to the H1 default.
    const src = readFileSync("src/lib/analysis/from-db-record.ts", "utf8");
    expect(src).toMatch(/TIMEFRAMES[^\n]*"M30"/);
  });

  it("the frozen positional ladder is unchanged (analytical checkpoint)", () => {
    expect(TF_LADDER).toEqual(["M15", "H1", "H4", "D1", "W1"]);
  });
});

describe("Phase 300b — style → allowed setup timeframe policy", () => {
  it("SCALPING executes on M1/M5 only; M15/H1 are context, not setups", () => {
    expect(STYLE_PROFILES.scalping.allowedSetupTfs).toEqual(["M1", "M5"]);
    expect(STYLE_PROFILES.scalping.fallbackTf).toBe("M5");
  });

  it("INTRADAY spans M15/M30/H1; H4 is higher-timeframe context", () => {
    expect(STYLE_PROFILES.intraday.allowedSetupTfs).toEqual(["M15", "M30", "H1"]);
    expect(STYLE_PROFILES.intraday.fallbackTf).toBe("M15");
  });

  it("SWING is unchanged: H4/D1/W1", () => {
    expect(STYLE_PROFILES.swing.allowedSetupTfs).toEqual(["H4", "D1", "W1"]);
    expect(STYLE_PROFILES.swing.fallbackTf).toBe("H4");
  });

  it("in-horizon requests never fall back", () => {
    expect(adaptSetupTimeframe("scalping", "M5")).toEqual({
      timeframe: "M5",
      fallbackApplied: false,
    });
    expect(adaptSetupTimeframe("intraday", "M30")).toEqual({
      timeframe: "M30",
      fallbackApplied: false,
    });
    expect(adaptSetupTimeframe("swing", "W1")).toEqual({
      timeframe: "W1",
      fallbackApplied: false,
    });
  });

  it("out-of-horizon requests fall back through the EXISTING policy — and the fallback is DISCLOSED", () => {
    const scalpingM15 = adaptSetupTimeframe("scalping", "M15");
    expect(scalpingM15.fallbackApplied).toBe(true);
    expect(scalpingM15.timeframe).toBe("M5");
    expect(scalpingM15.reason).toContain("M5");

    const intradayM1 = adaptSetupTimeframe("intraday", "M1");
    expect(intradayM1.fallbackApplied).toBe(true);
    expect(intradayM1.timeframe).toBe("M15");
    expect(intradayM1.reason).toContain("M15");

    const swingM30 = adaptSetupTimeframe("swing", "M30");
    expect(swingM30.fallbackApplied).toBe(true);
    expect(swingM30.timeframe).toBe("H4");
  });
});

describe("Phase 300b — style MTF context policy", () => {
  it("matches the product model exactly", () => {
    expect(STYLE_MTF_CONTEXT.scalping).toEqual({
      setup: ["M1", "M5"],
      context: ["M15", "H1"],
    });
    expect(STYLE_MTF_CONTEXT.intraday).toEqual({
      setup: ["M15", "M30", "H1"],
      context: ["M30", "H1", "H4"],
    });
    expect(STYLE_MTF_CONTEXT.swing).toEqual({
      setup: ["H4", "D1", "W1"],
      context: ["D1", "W1"],
    });
  });
});

describe("Phase 300b — buildStyleMtfChain: frozen chains are byte-identical", () => {
  for (const tf of TF_LADDER) {
    it(`buildStyleMtfChain delegates "${tf}" to buildChain unchanged, for every style`, () => {
      for (const style of ["scalping", "intraday", "swing"]) {
        expect(buildStyleMtfChain(style, tf)).toEqual(buildChain(tf));
      }
    });
  }

  it("INTRADAY M15 keeps its frozen chain: macro H4, structure H1", () => {
    expect(buildStyleMtfChain("intraday", "M15")).toEqual([
      { timeframe: "H4", role: "macro" },
      { timeframe: "H1", role: "structure" },
    ]);
  });

  it("INTRADAY H1 keeps its frozen chain: macro D1, structure H4, trigger M15", () => {
    expect(buildStyleMtfChain("intraday", "H1")).toEqual([
      { timeframe: "D1", role: "macro" },
      { timeframe: "H4", role: "structure" },
      { timeframe: "M15", role: "trigger" },
    ]);
  });
});

describe("Phase 300b — buildStyleMtfChain: previously standalone setups get real chains", () => {
  it("SCALPING M5 → macro H1, structure M15, trigger M1 (all REAL, style-scoped)", () => {
    expect(buildStyleMtfChain("scalping", "M5")).toEqual([
      { timeframe: "H1", role: "macro" },
      { timeframe: "M15", role: "structure" },
      { timeframe: "M1", role: "trigger" },
    ]);
  });

  it("SCALPING M1 → macro M15, structure M5, no trigger below", () => {
    expect(buildStyleMtfChain("scalping", "M1")).toEqual([
      { timeframe: "M15", role: "macro" },
      { timeframe: "M5", role: "structure" },
    ]);
  });

  it("INTRADAY M30 → macro H4, structure H1, trigger M15", () => {
    expect(buildStyleMtfChain("intraday", "M30")).toEqual([
      { timeframe: "H4", role: "macro" },
      { timeframe: "H1", role: "structure" },
      { timeframe: "M15", role: "trigger" },
    ]);
  });

  it("a timeframe outside the style chain stays standalone — honestly empty, never invented", () => {
    // M30 is not part of the scalping chain.
    expect(buildStyleMtfChain("scalping", "M30")).toEqual([]);
  });

  it("an unknown style string normalizes through the existing resolveStyle policy (intraday default)", () => {
    expect(buildStyleMtfChain("something-else", "M30")).toEqual(
      buildStyleMtfChain("intraday", "M30"),
    );
  });
});

describe("Phase 300b — provider mapping covers the full matrix", () => {
  it("ccxt mapping: every matrix token maps to its native interval, no silent fallback", () => {
    expect(mapCcxtTimeframe("M1")).toBe("1m");
    expect(mapCcxtTimeframe("M5")).toBe("5m");
    expect(mapCcxtTimeframe("M15")).toBe("15m");
    expect(mapCcxtTimeframe("M30")).toBe("30m");
    expect(mapCcxtTimeframe("H1")).toBe("1h");
    expect(mapCcxtTimeframe("H4")).toBe("4h");
    expect(mapCcxtTimeframe("D1")).toBe("1d");
    expect(mapCcxtTimeframe("W1")).toBe("1w");
    // An unknown token stays undefined — the caller must refuse, not guess.
    expect(mapCcxtTimeframe("M2")).toBeUndefined();
  });

  it("Twelve Data mapping: every matrix token maps to a real provider interval (M30 was missing)", () => {
    expect(mapTwelveDataInterval("M1")).toBe("1min");
    expect(mapTwelveDataInterval("M5")).toBe("5min");
    expect(mapTwelveDataInterval("M15")).toBe("15min");
    expect(mapTwelveDataInterval("M30")).toBe("30min");
    expect(mapTwelveDataInterval("H1")).toBe("1h");
    expect(mapTwelveDataInterval("H4")).toBe("4h");
    expect(mapTwelveDataInterval("D1")).toBe("1day");
    expect(mapTwelveDataInterval("W1")).toBe("1week");
  });
});
