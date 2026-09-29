/**
 * Phase 289D — the smoke's EIA-leg surface.
 *
 * The deployed run could only report `eiaEvidence=0`. Every leg's classified
 * reason was already on the result, but the failing-leg line is bounded to three
 * legs, so the EIA leg sat behind the market-data / news / derivatives failures
 * that always precede it — and a missing credential, a rejected credential, a
 * rate limit, a provider fault and an empty dataset were indistinguishable from
 * outside.
 *
 * These tests pin the added surface: the EIA leg's own state and its own reason
 * (`eiaLegDigest`), the direct read of the deployed action's own envelope
 * (`eiaActionEnvelope`/`eiaActionProbeDigest`), and their serialization. They
 * also pin the two properties the audit must never lose: a leg is only
 * "consumed" when the RUNTIME said so (never because a request returned 200),
 * and no timestamp is ever derived locally. Credential-shaped text is redacted.
 */
import { describe, expect, it } from "vitest";
import {
  commodityMarketOf,
  eiaActionEnvelope,
  eiaActionProbeDigest,
  eiaLegDigest,
  eiaLegRecord,
  energyGateVerdict,
  runtimeMarkers,
} from "../../../scripts/development-runtime-smoke.mjs";

type Leg = {
  provider: string;
  dataset?: string | null;
  mode?: string | null;
  acquired?: boolean;
  attached?: boolean;
  usedByEngine?: boolean;
  observedAt?: number | null;
  reason?: string | null;
};

const evidenceWith = (diagnostics: Leg[]) => ({ diagnostics });

const EIA = (over: Partial<Leg> = {}): Leg => ({
  provider: "eia",
  dataset: "inventories",
  mode: "failed",
  acquired: false,
  attached: false,
  usedByEngine: false,
  reason: null,
  ...over,
});

describe("289D — the EIA leg's own state, read from the runtime's flags", () => {
  it("no diagnostics at all is reported as not-reported, never as unavailable", () => {
    expect(eiaLegRecord(null).state).toBe("not-reported");
    expect(eiaLegRecord({}).state).toBe("not-reported");
    expect(eiaLegDigest({})).toContain("eia-leg: not-reported");
  });

  it("a result whose diagnostics carry no eia leg is not-scheduled (the predicate did not fire)", () => {
    const evidence = evidenceWith([EIA({ provider: "market-data", reason: "no live data" })]);
    expect(eiaLegRecord(evidence).state).toBe("not-scheduled");
    const digest = eiaLegDigest(evidence);
    expect(digest).toContain("eia-leg: not-scheduled");
    expect(digest).toMatch(/eligibility predicate/);
  });

  it("uses the runtime's OWN flags for acquired / attached / used", () => {
    expect(eiaLegRecord(evidenceWith([EIA({ acquired: true })])).state).toBe("acquired-not-attached");
    expect(eiaLegRecord(evidenceWith([EIA({ acquired: true, attached: true })])).state).toBe(
      "attached-not-used",
    );
    expect(
      eiaLegRecord(evidenceWith([EIA({ acquired: true, attached: true, usedByEngine: true })])).state,
    ).toBe("consumed");
  });

  it("carries a missing-credential reason verbatim and claims no evidence", () => {
    const digest = eiaLegDigest(
      evidenceWith([
        EIA({ reason: "EIA_[redacted] is missing. Add it in the Keys/API keys tab to enable actual WPSR inventory data." }),
      ]),
    );
    expect(digest).toContain("eia-leg: no-evidence");
    expect(digest).toContain("is missing");
    expect(digest).not.toContain("consumed");
  });

  it("carries an auth rejection, a rate limit and an empty dataset as their own texts", () => {
    const auth = eiaLegDigest(evidenceWith([EIA({ reason: "EIA API key rejected (HTTP 401/403) — verify EIA_[redacted]." })]));
    expect(auth).toMatch(/key rejected/);
    expect(auth).toContain("eia-leg: no-evidence");

    const rate = eiaLegDigest(evidenceWith([EIA({ reason: "EIA rate limit exceeded (HTTP 429)." })]));
    expect(rate).toMatch(/rate limit/i);

    const empty = eiaLegDigest(
      evidenceWith([EIA({ reason: "No EIA inventory series available (EPC0: empty dataset for this query)" })]),
    );
    expect(empty).toMatch(/No EIA inventory series available/);
    expect(empty).not.toMatch(/inventoryLatest=\d/);
  });

  it("never claims success from a status: an answered-but-empty leg stays no-evidence", () => {
    const digest = eiaLegDigest(
      evidenceWith([
        EIA({
          mode: "observed-now",
          acquired: true,
          attached: false,
          usedByEngine: false,
          reason: "EIA returned HTTP 200 with no observation rows",
        }),
      ]),
    );
    expect(digest).toContain("eia-leg: acquired-not-attached");
    expect(digest).not.toContain("consumed");
    expect(digest.toLowerCase()).not.toContain("success");
  });

  it("passes the provider's own instant through and NEVER derives one", () => {
    const withInstant = eiaLegDigest(
      evidenceWith([EIA({ acquired: true, attached: true, usedByEngine: true, observedAt: 1_790_000_000_000 })]),
    );
    expect(withInstant).toContain("observedAt=1790000000000");
    expect(withInstant).toContain("eia-leg: consumed");

    const without = eiaLegDigest(evidenceWith([EIA({ acquired: true, attached: true, usedByEngine: true })]));
    expect(without).toContain("observedAt=none");
  });

  it("redacts credential-shaped text and stays bounded", () => {
    const digest = eiaLegDigest(
      evidenceWith([
        EIA({
          reason:
            "request failed: api_key=SUPERSECRETVALUE1234567890ABCDEFGHIJKLMNOP Authorization: Bearer abcdefghijklmnopqrstuvwxyz012345",
        }),
      ]),
    );
    expect(digest).not.toContain("SUPERSECRETVALUE");
    expect(digest).not.toContain("abcdefghijklmnopqrstuvwxyz012345");
    expect(digest).toContain("<redacted>");
    expect(digest.length).toBeLessThanOrEqual(900);
  });
});

describe("289D — the deployed action's own envelope, probed directly", () => {
  it("reports the action's success flag and the provider's own periods, verbatim", () => {
    const envelope = eiaActionEnvelope({
      ok: true,
      value: {
        success: true,
        acquisition: "observed-now",
        observedAt: 1_790_000_000_000,
        data: {
          available: true,
          series: [
            { productId: "EPC0", observationDate: "2026-09-18", latestValue: 426_398 },
            { productId: "EPM0", observationDate: "2026-09-18", latestValue: 206_046 },
          ],
        },
      },
    });
    expect(envelope.answered).toBe(true);
    expect(envelope.success).toBe(true);
    expect(envelope.seriesCount).toBe(2);
    expect(envelope.observationDates).toEqual(["2026-09-18", "2026-09-18"]);
    const digest = eiaActionProbeDigest(envelope);
    expect(digest).toContain("eia-action: success");
    expect(digest).toContain("periods=2026-09-18,2026-09-18");
    expect(digest).toContain("observedAt=1790000000000");
  });

  it("keeps the action's classified error code and text when it refuses", () => {
    const digest = eiaActionProbeDigest(
      eiaActionEnvelope({
        ok: true,
        value: { success: false, errorCode: "AUTH_ERROR", error: "EIA API key rejected (HTTP 401/403) — verify EIA_[redacted]." },
      }),
    );
    expect(digest).toContain("eia-action: no-evidence");
    expect(digest).toContain("errorCode=AUTH_ERROR");
    expect(digest).toMatch(/key rejected/);
    expect(digest).toContain("observedAt=none");
    expect(digest).not.toContain("success");
  });

  it("separates an unanswered transport from an answered refusal", () => {
    const unanswered = eiaActionProbeDigest(
      eiaActionEnvelope({ ok: false, transportError: "timeout after 15000ms" }),
    );
    expect(unanswered).toContain("eia-action: unanswered");
    expect(unanswered).toContain("timeout");
    expect(eiaActionProbeDigest(null)).toBeNull();
  });

  it("never turns HTTP 200 into evidence", () => {
    const digest = eiaActionProbeDigest(
      eiaActionEnvelope({ ok: true, value: { success: false, error: "EIA returned no data." } }),
    );
    expect(digest).toContain("eia-action: no-evidence");
    expect(digest).not.toContain("eia-action: success");
  });
});

describe("289D — the serialized energy-gate sample carries the EIA reason, credential-free", () => {
  const energyEvidence = {
    fundamental: {
      commodityProfile: { group: "energy" },
      commodityMetrics: { inventoryLatest: 426_398 },
      dimensions: [{ name: "inventories", status: "positive" }],
      evidenceProviders: ["U.S. Energy Information Administration"],
      limitations: [],
    },
    diagnostics: [
      { provider: "market-data", dataset: "ohlcv", acquired: false, attached: false, usedByEngine: false, reason: "No live data: [404] plan" },
      EIA({ reason: "EIA API key rejected (HTTP 401/403) — verify EIA_[redacted]." }),
    ],
  };

  it("commodityMarketOf exposes the state and the digest", () => {
    const market = commodityMarketOf(energyEvidence);
    expect(market.group).toBe("energy");
    expect(market.eiaLegState).toBe("no-evidence");
    expect(market.eiaLeg).toContain("eia-leg: no-evidence");
    expect(market.eiaLeg).toMatch(/key rejected/);
  });

  it("a serialized energy sample round-trips the reason and leaks nothing", () => {
    const sample = { instrument: "WTI/USD", position: 7, ...commodityMarketOf(energyEvidence) };
    const serialized = JSON.stringify(sample);
    expect(serialized).toContain("key rejected");
    expect(serialized).toContain("eia-leg: no-evidence");
    expect(serialized).not.toMatch(/api_key=[^<]/i);
    expect(serialized).not.toMatch(/Bearer [A-Za-z0-9_-]{20,}/);
  });

  it("runtimeMarkers reports the state, and the gate text names the leg", () => {
    const markers = runtimeMarkers(energyEvidence);
    expect(markers.eiaLegState).toBe("no-evidence");

    const sample = { instrument: "WTI/USD", ...commodityMarketOf(energyEvidence) };
    const verdict = energyGateVerdict([sample]);
    const text = `${verdict.summary ?? ""} ${(verdict.failures ?? []).join(" ")}`;
    expect(text).toContain("eiaLeg=no-evidence");
  });
});
