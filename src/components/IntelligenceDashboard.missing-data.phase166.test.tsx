/**
 * Phase 166 — IntelligenceDashboard must degrade honestly on missing data.
 *
 * Defects fixed here, all found once the dormant `.test.tsx` suites were
 * actually collected by vitest for the first time:
 *
 *  1. `intelligence.actionRecommendation.includes(...)` and `.replace(...)`
 *     threw a TypeError when the field was absent, taking down the surface.
 *  2. `pnlPct !== 0` also passes for `undefined`, so `.toFixed()` crashed.
 *  3. `available={hasChanges || changes === null}` treated an empty array as
 *     "provider not connected". An empty array is a real answer — the
 *     comparison ran and found no material change — so the user was told data
 *     was unavailable when it had in fact been reported.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { readFileSync } from "node:fs";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import en from "@/lib/i18n/en";
import { IntelligenceDashboard } from "./IntelligenceDashboard";
import type { PositionIntelligence } from "@/lib/position-protection/market-intelligence-analyzer";

const SOURCE = readFileSync("src/components/IntelligenceDashboard.tsx", "utf8");

function baseIntelligence(
  overrides: Partial<PositionIntelligence> = {},
): PositionIntelligence {
  return {
    instrument: "BTC/USDT",
    displayName: "Bitcoin",
    side: "LONG",
    assetClass: "crypto",
    currentPrice: 80_000,
    entryPrice: 75_000,
    marketState: "BULLISH",
    shortTermContext: "Short-term bullish",
    mediumTermContext: "Medium-term bullish",
    volatilityContext: "Normal volatility",
    thesisHealth: "HEALTHY",
    thesisHealthScore: 80,
    confidence: "MODERATE_EVIDENCE",
    evidence: [],
    supportingEvidence: [],
    conflictingEvidence: [],
    pullbackClassification: "NORMAL_PULLBACK",
    invalidationConditions: [],
    nextMonitor: [],
    actionRecommendation: "HOLD",
    ...overrides,
  } as PositionIntelligence;
}

type DashboardProps = React.ComponentProps<typeof IntelligenceDashboard>;

function renderDashboard(props: Partial<DashboardProps>) {
  return render(
    <I18nProvider>
      <IntelligenceDashboard
        positionSide="LONG"
        instrument="BTC/USDT"
        {...props}
      />
    </I18nProvider>,
  );
}

describe("missing field resilience", () => {
  it("does not crash when actionRecommendation is absent", () => {
    const intel = baseIntelligence();
    delete (intel as Partial<PositionIntelligence>).actionRecommendation;

    expect(() => renderDashboard({ intelligence: intel })).not.toThrow();
  });

  it("reports an absent recommendation as UNAVAILABLE, not as an action", () => {
    const intel = baseIntelligence();
    delete (intel as Partial<PositionIntelligence>).actionRecommendation;

    const { container } = renderDashboard({ intelligence: intel });
    const text = container.textContent ?? "";

    expect(text).toContain(en.status.unavailable);
    // Must never imply a tradable instruction it does not have.
    expect(text).not.toMatch(/ACTION:\s*(BUY|SELL|HOLD)/);
  });

  it("does not crash when pnlPct is absent", () => {
    const intel = baseIntelligence();
    delete (intel as Partial<PositionIntelligence>).pnlPct;

    expect(() => renderDashboard({ intelligence: intel })).not.toThrow();
  });

  it("omits PnL entirely rather than rendering a fabricated 0.00%", () => {
    const intel = baseIntelligence();
    delete (intel as Partial<PositionIntelligence>).pnlPct;

    const { container } = renderDashboard({ intelligence: intel });
    expect(container.textContent ?? "").not.toContain("0.00%");
  });

  it("renders a real PnL when it is present", () => {
    const { container } = renderDashboard({
      intelligence: baseIntelligence({ pnlPct: 6.25 } as Partial<PositionIntelligence>),
    });
    expect(container.textContent ?? "").toContain("6.25%");
  });

  it("never renders a NaN literal", () => {
    const intel = baseIntelligence({
      pnlPct: Number.NaN,
      thesisHealthScore: Number.NaN,
    } as Partial<PositionIntelligence>);

    const { container } = renderDashboard({ intelligence: intel });
    expect(container.textContent ?? "").not.toContain("NaN");
  });
});

describe("empty result vs missing data", () => {
  it("treats whatChanged=[] as a reported result, not as unavailable", () => {
    const { container } = renderDashboard({
      intelligence: baseIntelligence(),
      whatChanged: [],
    });
    const text = container.textContent ?? "";

    expect(text).toContain(en.intelligence.noMaterialChange);
  });

  it("treats a missing whatChanged as genuinely unavailable", () => {
    const { container } = renderDashboard({ intelligence: baseIntelligence() });
    const text = container.textContent ?? "";

    expect(text).not.toContain(en.intelligence.noMaterialChange);
    expect(text).toContain(en.status.unavailable);
  });

  it("distinguishes null (awaiting first analysis) from empty", () => {
    const { container } = renderDashboard({
      intelligence: baseIntelligence(),
      whatChanged: null,
    });
    const text = container.textContent ?? "";

    expect(text).toContain(en.intelligence.awaitingFirstAnalysis);
    expect(text).not.toContain(en.intelligence.noMaterialChange);
  });

  it("lists real changes when present", () => {
    const { container } = renderDashboard({
      intelligence: baseIntelligence(),
      whatChanged: ["H1 trend shifted from BEARISH to BULLISH"],
    });
    const text = container.textContent ?? "";

    expect(text).toContain("H1 trend shifted from BEARISH to BULLISH");
    expect(text).not.toContain(en.intelligence.noMaterialChange);
  });
});

describe("conditional hook order (Phase 235 remaining finding)", () => {
  it("AnalyticalSummarySection calls useI18n before the intelligence early return", () => {
    const start = SOURCE.indexOf("function AnalyticalSummarySection");
    const end = SOURCE.indexOf("function KeyLevelsSection", start);
    const block = start === -1 || end === -1 ? "" : SOURCE.slice(start, end);
    expect(block.length).toBeGreaterThan(100);

    const hook = block.indexOf("useI18n()");
    const early = block.indexOf("if (!intelligence) return null");
    expect(hook).toBeGreaterThan(-1);
    expect(early).toBeGreaterThan(-1);
    expect(hook).toBeLessThan(early);
  });

  it("does not crash when intelligence appears after an absent first render", () => {
    const { rerender, container } = renderDashboard({ intelligence: null });
    expect(container.textContent ?? "").not.toContain(en.intelligence.analyticalSummary);

    expect(() =>
      rerender(
        <I18nProvider>
          <IntelligenceDashboard
            positionSide="LONG"
            instrument="BTC/USDT"
            intelligence={baseIntelligence()}
          />
        </I18nProvider>,
      ),
    ).not.toThrow();

    expect(container.textContent ?? "").toContain(en.intelligence.analyticalSummary);
  });

  it("still omits the analytical summary when intelligence is absent", () => {
    const { container } = renderDashboard({ intelligence: null });
    const text = container.textContent ?? "";
    expect(text).not.toContain(en.intelligence.analyticalSummary);
    expect(text).not.toContain(en.intelligence.marketLabel);
  });
});

describe("safety semantics", () => {
  it("never presents automated execution language", () => {
    const { container } = renderDashboard({
      intelligence: baseIntelligence(),
      whatChanged: [],
    });
    const text = (container.textContent ?? "").toLowerCase();

    expect(text).not.toMatch(
      /order placed|executing trade|auto-trade|trade executed|guaranteed/,
    );
  });
});
