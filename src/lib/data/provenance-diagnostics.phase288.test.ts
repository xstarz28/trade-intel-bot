/**
 * Phase 288 — a leg that produced no evidence keeps its OWN reason.
 *
 * Before this phase every leg computed a precise failure reason (a 429 with the
 * provider's credit text, a credential rejection, an empty provider series, an
 * unmapped identity) and `legFromFailure` then dropped it: `LegDiagnostic` had
 * no field for it and `legFromFailure` accepted only `status`/`category`. Every
 * surface — including the deployed runtime smoke — could therefore only say
 * "unavailable", which made a rate limit indistinguishable from a missing
 * credential from an unmapped instrument.
 *
 * These tests pin the contract: the reason survives, it is credential-redacted
 * and bounded, it is NEVER attached to a leg that answered, and the operator
 * log line carries it too.
 */
import { describe, it, expect } from "vitest";
import {
  boundedLegReason,
  redactDiagnosticText,
  formatLeg,
  legFromCache,
  legFromFailure,
  LEG_REASON_MAX_CHARS,
  type LegDiagnostic,
} from "./provenance-diagnostics";

const FAILED = { status: "failed" as const, category: "rate-limit" as const };

describe("phase 288 — failing legs keep their reason", () => {
  it("records the leg's own reason verbatim", () => {
    const leg = legFromFailure({
      provider: "twelve-data",
      dataset: "ohlcv",
      outcome: FAILED,
      reason: "[429] You have reached the API credits limit (8 credits used)",
    });
    expect(leg.reason).toBe("[429] You have reached the API credits limit (8 credits used)");
    expect(leg.acquired).toBe(false);
    expect(leg.mode).toBe("rate-limited");
  });

  it("keeps a credential-free provider message unchanged", () => {
    const leg = legFromFailure({
      provider: "crypto-fundamentals",
      dataset: "crypto-fundamentals",
      outcome: { status: "failed", category: "unavailable" },
      reason:
        "this asset has no verified DeFiLlama chain mapping in the repository — no slug is guessed",
    });
    expect(leg.reason).toContain("no slug is guessed");
  });

  it("redacts credential-shaped fragments and collapses whitespace", () => {
    const leg = legFromFailure({
      provider: "tickatlas",
      dataset: "calendar",
      outcome: { status: "failed", category: "network" },
      reason: "rejected: https://api.example.com/calendar?apikey=SECRET123\n\tretry later",
    });
    expect(leg.reason).not.toContain("SECRET123");
    expect(leg.reason).not.toMatch(/\s{2,}/);
    expect(leg.reason).toContain("retry later");
  });

  it("bounds a long reason instead of returning the whole body", () => {
    const leg = legFromFailure({
      provider: "eia",
      dataset: "inventories",
      outcome: { status: "failed", category: "invalid-response" },
      reason: "x".repeat(LEG_REASON_MAX_CHARS * 3),
    });
    expect(leg.reason).toBeDefined();
    expect(leg.reason!.length).toBeLessThanOrEqual(LEG_REASON_MAX_CHARS);
    expect(leg.reason!.endsWith("\u2026")).toBe(true);
  });

  it("omits the field when no reason was supplied, and never invents one", () => {
    const leg = legFromFailure({
      provider: "cftc",
      dataset: "cot",
      outcome: { status: "failed", category: "unavailable" },
    });
    expect(leg.reason).toBeUndefined();
    expect("reason" in leg).toBe(false);
  });

  it("omits a blank reason (empty text is not an explanation)", () => {
    const blank = boundedLegReason("   \n  ");
    expect(blank).toBeUndefined();
    expect(boundedLegReason(undefined)).toBeUndefined();
    expect(boundedLegReason(42)).toBeUndefined();
  });

  it("never attaches a reason to a leg that produced data", () => {
    // A successful leg is described by its data; a stray reason string would
    // blur acquired/attached/used, which the diagnostic contract keeps apart.
    const leg = legFromCache({
      provider: "twelve-data",
      dataset: "ohlcv",
      acquisition: "observed-now",
      observedAt: 1_700_000_000_000,
    });
    expect(leg.acquired).toBe(true);
    expect(leg.reason).toBeUndefined();
  });

  it("shows the reason in the operator log line", () => {
    const leg: LegDiagnostic = legFromFailure({
      provider: "coinglass",
      dataset: "derivatives",
      outcome: { status: "failed", category: "unavailable" },
      reason: "AUTH_ERROR ([401] missing credential)",
    });
    const line = formatLeg(leg);
    expect(line).toContain("coinglass/derivatives");
    expect(line).toContain("AUTH_ERROR ([401] missing credential)");
  });
});

describe("phase 288 — redaction removes the VALUE, not just the key name", () => {
  it("masks a key/value pair whose value is not itself credential-shaped", () => {
    const text = redactDiagnosticText("unauthorized (apikey=SHOULDNEVERAPPEAR)");
    expect(text).not.toContain("SHOULDNEVERAPPEAR");
  });

  it("masks the query, header and colon forms", () => {
    for (const raw of [
      "https://api.example.com/x?apikey=VALUEONE",
      "Authorization: Bearer VALUETWO",
      "txn failed: token: VALUETHREE",
      "auth key=VALUEFOUR rejected",
    ]) {
      const text = redactDiagnosticText(raw);
      expect(text).not.toMatch(/VALUE(ONE|TWO|THREE|FOUR)/);
    }
  });

  it("leaves an ordinary provider sentence readable", () => {
    const text = redactDiagnosticText(
      "this asset has no verified DeFiLlama chain mapping in the repository — no slug is guessed",
    );
    expect(text).toContain("no verified DeFiLlama chain mapping");
    expect(text).toContain("no slug is guessed");
  });
});
