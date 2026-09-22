import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { I18nProvider } from "@/lib/i18n";
import { InstrumentInput } from "./InstrumentInput";
import type { CatalogInstrument } from "@/lib/discovery/instrument-universe";
import type { AnalysisInput } from "@/lib/analysis-engine";

const NOW = 1_800_000_000_000;

function catalogRow(
  overrides: Partial<CatalogInstrument> &
    Pick<CatalogInstrument, "provider" | "providerInstrumentId" | "assetClass">,
): CatalogInstrument {
  return {
    subType: "crypto_spot",
    baseAsset: "X",
    quoteAsset: "USD",
    tradingState: "TRADING",
    capabilities: ["ohlcv", "quote"],
    discoveredAt: NOW,
    lifecycle: "DISCOVERED",
    ...overrides,
  };
}

const catalog: CatalogInstrument[] = [
  catalogRow({
    provider: "okx",
    providerInstrumentId: "BTC-USDT",
    assetClass: "crypto",
    baseAsset: "BTC",
    quoteAsset: "USDT",
    lifecycle: "DISCOVERED",
  }),
  catalogRow({
    provider: "twelve-data",
    providerInstrumentId: "BTC/USD",
    assetClass: "crypto",
    baseAsset: "BTC",
    quoteAsset: "USD",
    lifecycle: "LIVE",
  }),
  catalogRow({
    provider: "twelve-data",
    providerInstrumentId: "EUR/USD",
    assetClass: "forex",
    subType: "forex_spot",
    baseAsset: "EUR",
    lifecycle: "LIVE",
  }),
  catalogRow({
    provider: "twelve-data",
    providerInstrumentId: "XAU/USD",
    assetClass: "commodity",
    subType: "commodity_spot",
    baseAsset: "XAU",
    lifecycle: "DISCOVERED",
  }),
  catalogRow({
    provider: "twelve-data",
    providerInstrumentId: "AAPL",
    assetClass: "equity",
    subType: "equity_common",
    baseAsset: "AAPL",
    lifecycle: "DISCOVERED",
  }),
];

function renderInput(
  onAnalyze: (input: AnalysisInput) => void = () => {},
  rows: CatalogInstrument[] = catalog,
) {
  return render(
    <I18nProvider>
      <InstrumentInput
        onAnalyze={onAnalyze}
        isAnalyzing={false}
        catalog={rows}
        discoveryProviders={[
          { provider: "okx", ok: true },
          { provider: "twelve-data", ok: true },
        ]}
      />
    </I18nProvider>,
  );
}

describe("InstrumentInput catalog selection", () => {
  beforeEach(() => {
    sessionStorage.clear();
  });

  it("selecting a discovered-but-not-acquired row sends exact native identity", () => {
    const onAnalyze = vi.fn();
    renderInput(onAnalyze);
    fireEvent.click(screen.getByText("BTC-USDT"));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    expect(onAnalyze).toHaveBeenCalledTimes(1);
    const input = onAnalyze.mock.calls[0][0] as AnalysisInput;
    expect(input.provider).toBe("okx");
    expect(input.providerInstrumentId).toBe("BTC-USDT");
    expect(input.instrument).toBe("BTC-USDT");
    expect(input.instrumentType).toBe("crypto");
    cleanup();
  });

  it("does not rewrite OKX BTC-USDT to BTC/USD", () => {
    const onAnalyze = vi.fn();
    renderInput(onAnalyze);
    fireEvent.click(screen.getByText("BTC-USDT"));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    const input = onAnalyze.mock.calls[0][0] as AnalysisInput;
    expect(input.providerInstrumentId).toBe("BTC-USDT");
    expect(input.providerInstrumentId).not.toBe("BTC/USD");
    cleanup();
  });

  it("does not rewrite XAU/USD to GOLD", () => {
    const onAnalyze = vi.fn();
    renderInput(onAnalyze);
    fireEvent.click(screen.getByText("XAU/USD"));
    fireEvent.click(screen.getByRole("button", { name: /run analysis/i }));
    const input = onAnalyze.mock.calls[0][0] as AnalysisInput;
    expect(input.providerInstrumentId).toBe("XAU/USD");
    expect(input.provider).toBe("twelve-data");
    expect(JSON.stringify(input)).not.toMatch(/GOLD/);
    cleanup();
  });

  it("keeps two provider identities for the same economic asset", () => {
    renderInput();
    expect(screen.getByText("BTC-USDT")).toBeTruthy();
    expect(screen.getByText("BTC/USD")).toBeTruthy();
    cleanup();
  });

  it("typing a missing symbol does not create an identity or submit", () => {
    const onAnalyze = vi.fn();
    renderInput(onAnalyze);
    const search = screen.getByPlaceholderText("Search discovered instruments");
    fireEvent.change(search, { target: { value: "GOLD" } });
    expect(screen.getByTestId("catalog-not-found").textContent).toMatch(
      /not found in current provider discovery/i,
    );
    fireEvent.submit(search.closest("form")!);
    expect(onAnalyze).not.toHaveBeenCalled();
    cleanup();
  });

  it("empty catalog shows waiting, never a static fallback list", () => {
    renderInput(() => {}, []);
    expect(screen.getByTestId("catalog-empty").textContent).toMatch(
      /waiting for provider discovery/i,
    );
    expect(screen.queryByText("EUR/USD")).toBeNull();
    expect(screen.queryByText("BTC/USD")).toBeNull();
    cleanup();
  });

  it("shows provider discovery failure instead of hiding it", () => {
    render(
      <I18nProvider>
        <InstrumentInput
          onAnalyze={() => {}}
          isAnalyzing={false}
          catalog={[]}
          discoveryProviders={[
            { provider: "twelve-data", ok: true },
            { provider: "okx", ok: false },
          ]}
        />
      </I18nProvider>,
    );
    const status = screen.getByTestId("discovery-status").textContent ?? "";
    expect(status).toContain("twelve-data");
    expect(status).toContain("okx");
    expect(status).toMatch(/UNAVAILABLE|unavailable/i);
    cleanup();
  });
});
