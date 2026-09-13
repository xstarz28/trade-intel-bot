/**
 * Phase 79 — {t.market.title} Panel
 *
 * Multi-instrument market-wide view using the universal instrument registry.
 * Shows all supported instruments with live prices, market state, and data freshness.
 */

import React, { useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { Globe } from "lucide-react";
import {
  getAllInstruments,
  getInstrumentInfo,
  formatInstrumentPrice,
  type InstrumentInfo,
} from "@/lib/position-protection/instrument-registry";
import type { LiveInstrumentState } from "@/lib/position-protection/use-live-protection-polling";

// ═══════════════════════════════════════════════════════════════
// ASSET CLASS GROUPING
// ═══════════════════════════════════════════════════════════════

const ASSET_CLASS_LABELS: Record<string, string> = {
  crypto: "CRYPTO",
  forex: "FOREX",
  commodity: "COMMODITY",
  macro: "MACRO",
};

const ASSET_CLASS_COLORS: Record<string, string> = {
  crypto: "text-orange-400",
  forex: "text-blue-400",
  commodity: "text-yellow-400",
  macro: "text-purple-400",
};

// ═══════════════════════════════════════════════════════════════
// INSTRUMENT ROW
// ═══════════════════════════════════════════════════════════════

function InstrumentRow({
  info,
  liveState,
}: {
  info: InstrumentInfo;
  liveState?: LiveInstrumentState;
}) {
  // Phase 193 — the LIVE/STALE badge is a DATA-PROVENANCE claim, not chrome.
  // `market.live` / `market.stale` / `market.unavailable` exist in all nine
  // locales; this row previously hardcoded the English words, so a non-English
  // user saw an untranslated assertion about data currency. The keys were
  // reported "unreferenced" precisely because this consumer was disconnected.
  const { t } = useI18n();
  // A price is only usable if the provider actually reported a finite,
  // positive number. `?? 0` alone let NaN/Infinity through, which rendered as
  // the literal string "NaN" next to a provider name.
  const rawPrice = liveState?.price;
  const hasUsablePrice =
    typeof rawPrice === "number" && Number.isFinite(rawPrice) && rawPrice > 0;
  const price = hasUsablePrice ? rawPrice : 0;
  const sourceMode = liveState?.sourceMode ?? "UNAVAILABLE";
  const provider = liveState?.provider ?? info.primaryProvider;

  const isLive = sourceMode === "LIVE" && hasUsablePrice;
  const isStale = sourceMode === "STALE" && hasUsablePrice;
  // Simulated data is never real market data: show it as unavailable rather
  // than letting a synthetic number sit in a price column unlabelled.
  const isUnavailable = !hasUsablePrice || sourceMode === "UNAVAILABLE" || sourceMode === "SIMULATED";

  // Determine price color based on source mode
  const priceColor = isLive
    ? "text-foreground"
    : isStale
      ? "text-amber-400"
      : "text-muted-foreground";

  // Source badge color
  const sourceColor = isLive
    ? "text-emerald-400 bg-emerald-500/10"
    : isStale
      ? "text-amber-400 bg-amber-500/10"
      : "text-muted-foreground bg-muted/30";

  return (
    <div className="flex items-center gap-2 px-2 py-1.5 rounded-md hover:bg-muted/30 transition-colors">
      {/* Symbol */}
      <span className="text-[11px] font-mono font-semibold min-w-[70px] text-foreground">
        {info.symbol}
      </span>

      {/* Price */}
      <span className={`text-[11px] font-mono font-medium flex-1 text-right ${priceColor}`}>
        {isUnavailable
          ? "—"
          : `${info.assetClass === "forex" ? "" : "$"}${formatInstrumentPrice(info.symbol, price)}`}
      </span>

      {/* Source mode badge */}
      <span
        className={`text-[8px] font-mono px-1.5 py-0.5 rounded ${sourceColor}`}
        aria-label={isLive ? t.market.live : isStale ? t.market.stale : t.market.unavailable}
      >
        {isLive ? t.market.live : isStale ? t.market.stale : "—"}
      </span>

      {/* Provider */}
      <span className="text-[8px] font-mono text-muted-foreground/60 w-[60px] text-right">
        {provider}
      </span>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ═══════════════════════════════════════════════════════════════

interface MarketOverviewPanelProps {
  /** Live price states keyed by instrument symbol. */
  livePrices: Map<string, LiveInstrumentState>;
}

export function MarketOverviewPanel({ livePrices }: MarketOverviewPanelProps) {
  const { t } = useI18n();
  // Group instruments by asset class
  const grouped = useMemo(() => {
    const allSymbols = getAllInstruments();
    const groups: Record<string, InstrumentInfo[]> = {};

    for (const symbol of allSymbols) {
      const info = getInstrumentInfo(symbol);
      if (!info) continue;
      if (!groups[info.assetClass]) groups[info.assetClass] = [];
      groups[info.assetClass].push(info);
    }

    return groups;
  }, []);

  const totalLive = useMemo(() => {
    let count = 0;
    for (const [, state] of livePrices) {
      // Must match the per-row definition of "live" exactly, otherwise the
      // "N/M live" counter can claim more live feeds than are displayed.
      if (
        state.sourceMode === "LIVE" &&
        typeof state.price === "number" &&
        Number.isFinite(state.price) &&
        state.price > 0
      ) {
        count++;
      }
    }
    return count;
  }, [livePrices]);

  const totalInstruments = getAllInstruments().length;

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Globe className="size-3.5 text-primary" />
          <h3 className="text-xs font-mono font-semibold">{t.market.title}</h3>
        </div>
        <span className="text-[9px] font-mono text-muted-foreground">
          {totalLive}/{totalInstruments} live
        </span>
      </div>

      {/* Asset class groups */}
      {Object.entries(grouped).map(([assetClass, instruments]) => (
        <div key={assetClass} className="space-y-0.5">
          <div className="flex items-center gap-1.5 px-2 py-1">
            <span className={`text-[9px] font-mono font-bold tracking-wider ${ASSET_CLASS_COLORS[assetClass] ?? "text-muted-foreground"}`}>
              {ASSET_CLASS_LABELS[assetClass] ?? assetClass.toUpperCase()}
            </span>
          </div>
          {instruments.map((info) => (
            <InstrumentRow
              key={info.symbol}
              info={info}
              liveState={livePrices.get(info.symbol)}
            />
          ))}
        </div>
      ))}

      {/* Footer */}
      <div className="text-[8px] font-mono text-muted-foreground/40 px-2 pt-1 border-t border-border/20">
        {t.market.sourceTransparency}
      </div>
    </div>
  );
}
