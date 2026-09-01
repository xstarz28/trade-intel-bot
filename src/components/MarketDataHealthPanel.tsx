import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "./ui/card";
import { Badge } from "./ui/badge";
import { Button } from "./ui/button";
import { useI18n } from "@/lib/i18n";

/**
 * Phase 67 — Market Data Health Panel
 *
 * Displays provider health status without exposing:
 * - API keys
 * - credentials
 * - tokens
 * - environment variable values
 * - internal secrets
 *
 * Provider failure must remain neutral (never bullish/bearish).
 */

export interface ProviderHealthInfo {
  provider: string;
  status: "CONNECTED" | "DEGRADED" | "UNAVAILABLE";
  lastSuccessfulUpdate: number | null;
  freshness: "FRESH" | "STALE" | "UNAVAILABLE";
  consecutiveFailures: number;
  role: "PRIMARY" | "FALLBACK";
  instrumentsServed: string[];
  recoveryState: "NONE" | "RECOVERING" | "RECOVERED";
}

export type DataQualityState = "LIVE" | "DEGRADED" | "STALE" | "UNAVAILABLE";

interface MarketDataHealthPanelProps {
  providers: ProviderHealthInfo[];
  dataQuality: DataQualityState;
  lastMarketUpdate: number | null;
  pollingActive: boolean;
}

function formatTimestamp(ts: number | null, neverLabel: string): string {
  if (ts === null) return neverLabel;
  const diff = Date.now() - ts;
  if (diff < 60_000) return `${Math.floor(diff / 1000)}s ago`;
  if (diff < 3600_000) return `${Math.floor(diff / 60_000)}m ago`;
  return `${Math.floor(diff / 3600_000)}h ago`;
}

function getStatusColor(status: ProviderHealthInfo["status"]): string {
  switch (status) {
    case "CONNECTED":
      return "bg-emerald-500/20 text-emerald-400 border-emerald-500/30";
    case "DEGRADED":
      return "bg-amber-500/20 text-amber-400 border-amber-500/30";
    case "UNAVAILABLE":
      return "bg-red-500/20 text-red-400 border-red-500/30";
  }
}

function getDataQualityInfo(dataQuality: DataQualityState, t: ReturnType<typeof useI18n>["t"]) {
  switch (dataQuality) {
    case "LIVE":
      return {
        label: "LIVE",
        icon: "🟢",
        color: "text-emerald-400",
        message: t.system.freshMessage,
      };
    case "DEGRADED":
      return {
        label: "DEGRADED",
        icon: "🟡",
        color: "text-amber-400",
        message: t.system.degradedMessage,
      };
    case "STALE":
      return {
        label: "STALE",
        icon: "🔴",
        color: "text-red-400",
        message: t.system.staleMessage,
      };
    case "UNAVAILABLE":
      return {
        label: "UNAVAILABLE",
        icon: "⚪",
        color: "text-zinc-400",
        message: t.system.unavailableMessage,
      };
  }
}

export function MarketDataHealthPanel({
  providers,
  dataQuality,
  lastMarketUpdate,
  pollingActive,
}: MarketDataHealthPanelProps) {
  const [expandedProvider, setExpandedProvider] = useState<string | null>(null);
  const { t } = useI18n();
  const qualityInfo = useMemo(() => getDataQualityInfo(dataQuality, t), [dataQuality, t]);

  const connectedCount = providers.filter(
    (p) => p.status === "CONNECTED"
  ).length;
  const degradedCount = providers.filter(
    (p) => p.status === "DEGRADED"
  ).length;
  const unavailableCount = providers.filter(
    (p) => p.status === "UNAVAILABLE"
  ).length;

  return (
    <Card className="bg-zinc-900/50 border-zinc-800">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm font-medium text-zinc-300 flex items-center gap-2">
          📡 {t.system.marketDataHealthTitle}
          <Badge
            variant="outline"
            className={`text-xs ${qualityInfo.color}`}
          >
            {qualityInfo.icon} {qualityInfo.label}
          </Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Data Quality Warning */}
        {dataQuality !== "LIVE" && (
          <div className="p-2 rounded bg-amber-950/30 border border-amber-800/30">
            <p className="text-xs text-amber-300">{qualityInfo.message}</p>
          </div>
        )}

        {/* Summary Row */}
        <div className="flex gap-3 text-xs">
          <span className="text-emerald-400">
            {connectedCount} {t.system.connectedCount}
          </span>
          <span className="text-amber-400">
            {degradedCount} {t.system.degradedCount}
          </span>
          <span className="text-red-400">
            {unavailableCount} {t.system.unavailableStatusLabel}
          </span>
        </div>

        {/* Polling Status */}
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span>{t.system.modeLabel} {pollingActive ? t.system.pollingLabel : t.system.stoppedLabel}</span>
          <span>•</span>
          <span>{t.system.lastUpdateLabel} {formatTimestamp(lastMarketUpdate, t.system.neverLabel)}</span>
        </div>

        {/* Provider List */}
        <div className="space-y-2">
          {providers.map((provider) => (
            <div
              key={provider.provider}
              className="p-2 rounded bg-zinc-800/50 border border-zinc-700/50 cursor-pointer hover:bg-zinc-800/80 transition-colors"
              onClick={() =>
                setExpandedProvider(
                  expandedProvider === provider.provider
                    ? null
                    : provider.provider
                )
              }
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-zinc-200">
                    {provider.provider}
                  </span>
                  <Badge
                    variant="outline"
                    className={`text-[10px] ${getStatusColor(provider.status)}`}
                  >
                    {provider.status}
                  </Badge>
                  <span className="text-[10px] text-zinc-500">
                    {provider.role}
                  </span>
                </div>
                <div className="flex items-center gap-2 text-[10px] text-zinc-500">
                  <span>{formatTimestamp(provider.lastSuccessfulUpdate, t.system.neverLabel)}</span>
                  {provider.consecutiveFailures > 0 && (
                    <span className="text-amber-400">
                      {provider.consecutiveFailures} {t.system.failuresLabel}
                    </span>
                  )}
                </div>
              </div>

              {/* Expanded Details */}
              {expandedProvider === provider.provider && (
                <div className="mt-2 pt-2 border-t border-zinc-700/30 space-y-1 text-[10px] text-zinc-400">
                  <div className="flex justify-between">
                    <span>{t.system.freshnessLabel}</span>
                    <span>{provider.freshness}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t.system.recoveryLabel}</span>
                    <span>{provider.recoveryState}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>{t.system.instrumentsLabel}</span>
                    <span>{provider.instrumentsServed.length} {t.system.activeLabel}</span>
                  </div>
                  {provider.instrumentsServed.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-1">
                      {provider.instrumentsServed.map((inst) => (
                        <Badge
                          key={inst}
                          variant="outline"
                          className="text-[9px] bg-zinc-800"
                        >
                          {inst}
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {providers.length === 0 && (
          <div className="text-xs text-zinc-500 text-center py-2">
            {t.system.noProvidersConfigured}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
