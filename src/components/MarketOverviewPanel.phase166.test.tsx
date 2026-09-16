/**
 * Phase 166 — MarketOverviewPanel live-price honesty.
 *
 * Defects fixed:
 *  1. `liveState?.price ?? 0` let NaN/Infinity through. `formatInstrumentPrice`
 *     then rendered the literal string "NaN" in the price column next to a
 *     provider name and, for a LIVE sourceMode, a green LIVE badge.
 *  2. `sourceMode === "SIMULATED"` was not handled at all, so simulated data
 *     would have been rendered as an ordinary price.
 *  3. The "N/M live" counter used a slightly different liveness rule than the
 *     rows, so it could claim more live feeds than were actually shown.
 */

import { describe, expect, it } from "vitest";
import React from "react";
import { render } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { MarketOverviewPanel } from "./MarketOverviewPanel";
import { getAllInstruments } from "@/lib/position-protection/instrument-registry";
import type { LiveInstrumentState } from "@/lib/position-protection/use-live-protection-polling";

const SYMBOL = getAllInstruments()[0];
const TOTAL = getAllInstruments().length;

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

function renderWith(map: Map<string, LiveInstrumentState>) {
  return render(
    <I18nProvider>
      <MarketOverviewPanel livePrices={map} />
    </I18nProvider>,
  );
}

describe("price rendering never fabricates a value", () => {
  it("does not render a NaN literal when the provider price is NaN", () => {
    const { container } = renderWith(
      new Map([[SYMBOL, state({ price: Number.NaN })]]),
    );
    expect(container.textContent ?? "").not.toContain("NaN");
  });

  it("does not render Infinity", () => {
    const { container } = renderWith(
      new Map([[SYMBOL, state({ price: Number.POSITIVE_INFINITY })]]),
    );
    expect(container.textContent ?? "").not.toContain("Infinity");
  });

  it("does not show a LIVE badge for an unusable price", () => {
    const { container } = renderWith(
      new Map([[SYMBOL, state({ price: Number.NaN, sourceMode: "LIVE" })]]),
    );
    // The row must fall back to the em-dash placeholder instead.
    expect(container.textContent ?? "").toContain("—");
  });

  it("renders a real price when the provider reports one", () => {
    const { container } = renderWith(new Map([[SYMBOL, state({ price: 123.5 })]]));
    expect(container.textContent ?? "").toMatch(/123\.5/);
  });

  it("treats SIMULATED as unavailable rather than as a price", () => {
    const { container } = renderWith(
      new Map([[SYMBOL, state({ price: 999, sourceMode: "SIMULATED" })]]),
    );
    const text = container.textContent ?? "";
    // The synthetic number must not be presented in the price column.
    expect(text).not.toContain("999");
  });
});

describe("live counter matches what is displayed", () => {
  it("does not count a NaN-priced LIVE entry as live", () => {
    const { container } = renderWith(
      new Map([[SYMBOL, state({ price: Number.NaN, sourceMode: "LIVE" })]]),
    );
    expect(container.textContent ?? "").toContain(`0/${TOTAL} live`);
  });

  it("counts a genuinely live entry", () => {
    const { container } = renderWith(new Map([[SYMBOL, state({ price: 42 })]]));
    expect(container.textContent ?? "").toContain(`1/${TOTAL} live`);
  });

  it("counts nothing when there is no data at all", () => {
    const { container } = renderWith(new Map());
    expect(container.textContent ?? "").toContain(`0/${TOTAL} live`);
  });
});
