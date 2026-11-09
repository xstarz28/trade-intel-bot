import { useCallback, useEffect, useState } from "react";
import { Activity, RefreshCw, TrendingDown, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { fetchBackendOpportunities, triggerBackendOpportunityScan } from "@/lib/backend-api";
import type { RadarOpportunity } from "@/lib/market-radar/types";

const HORIZONS = [
  ["SCALPING", "Scalping"], ["INTRADAY", "Intraday"], ["SWING", "Swing"],
  ["1-4_WEEKS", "1–4W"], ["1-3_MONTHS", "1–3M"], ["3-6_MONTHS", "3–6M"],
  ["6-12_MONTHS", "6–12M"], ["1-3_YEARS", "1–3Y"], ["3+_YEARS", "3Y+"],
] as const;
const money = (value?: number) => value === undefined || !Number.isFinite(value)
  ? "—" : new Intl.NumberFormat("en-US", { maximumFractionDigits: 6 }).format(value);
const label = (value: string) => value.replace(/_/g, " ").toLowerCase();

export function BackendOpportunityRadar() {
  const [horizon, setHorizon] = useState<string>("INTRADAY");
  const [items, setItems] = useState<RadarOpportunity[]>([]);
  const [lastScanAt, setLastScanAt] = useState(0);
  const [status, setStatus] = useState<"available" | "warming_up" | "stale">("warming_up");
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const result = await fetchBackendOpportunities(horizon);
      setItems(result.items);
      setLastScanAt(result.lastScanAt);
      setStatus(result.status);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Opportunity radar unavailable");
    } finally {
      setLoading(false);
    }
  }, [horizon]);

  useEffect(() => {
    let active = true;
    const refresh = () => {
      void fetchBackendOpportunities(horizon)
        .then((result) => {
          if (!active) return;
          setItems(result.items);
          setLastScanAt(result.lastScanAt);
          setStatus(result.status);
          setError(null);
        })
        .catch((cause: unknown) => {
          if (active) setError(cause instanceof Error ? cause.message : "Opportunity radar unavailable");
        })
        .finally(() => {
          if (active) setLoading(false);
        });
    };
    refresh();
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [horizon]);

  const scan = async () => {
    setScanning(true);
    try {
      await triggerBackendOpportunityScan();
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Scan request failed");
    } finally {
      setScanning(false);
    }
  };

  return (
    <Card className="mb-5 border-border/60">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Activity className="size-4 text-primary" />
            <div>
              <h3 className="text-sm font-semibold">Autonomous Opportunity Radar</h3>
              <p className="text-[11px] text-muted-foreground">Self-hosted scan · trading setups and investment horizons</p>
            </div>
            <Badge variant="outline">{status === "available" ? "LIVE SNAPSHOTS" : status === "stale" ? "STALE SNAPSHOTS" : "WARMING UP"}</Badge>
          </div>
          <Button size="sm" variant="outline" onClick={scan} disabled={scanning}>
            <RefreshCw className={`mr-2 size-3 ${scanning ? "animate-spin" : ""}`} />
            {scanning ? "Scanning" : "Scan next batch"}
          </Button>
        </div>
        <div className="flex flex-wrap gap-1.5 pt-2">
          {HORIZONS.map(([key, title]) => (
            <Button key={key} size="sm" variant={horizon === key ? "default" : "ghost"} className="h-7 px-2 text-[10px]" onClick={() => setHorizon(key)}>
              {title}
            </Button>
          ))}
        </div>
      </CardHeader>
      <CardContent className="space-y-2">
        {lastScanAt > 0 && <p className="text-[10px] text-muted-foreground">Last background batch: {new Date(lastScanAt).toLocaleString()}</p>}
        {error && <p className="text-xs text-destructive">{error}</p>}
        {loading && <p className="text-xs text-muted-foreground">Loading persisted opportunities…</p>}
        {!loading && !error && items.length === 0 && (
          <p className="rounded-md border border-dashed p-4 text-xs text-muted-foreground">
            {status === "warming_up" ? "The scanner is acquiring its first market batches. Results will appear as verified snapshots accumulate." : status === "stale" ? "The last scanner batch is stale. Existing snapshots are shown for reference, not as current opportunities." : "No candidate passed the current evidence and data-quality gates for this horizon."}
          </p>
        )}
        {items.map((item) => {
          const projection = item.investmentProjection;
          const scenarios = item.conditionalScenarios ?? [];
          return (
            <div key={`${item.instrument}:${item.marketTimeframe ?? ""}`} className="rounded-lg border border-border/50 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold">{item.instrument}</span>
                <Badge variant="outline">{item.assetClass}</Badge>
                <Badge variant="outline">Tier {item.qualityTier}</Badge>
                <Badge variant="outline">{label(item.lifecycle)}</Badge>
                <span className="ml-auto text-xs tabular-nums text-muted-foreground">Score {item.score} · {item.confidence} evidence</span>
              </div>
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span>Price: {money(item.currentPrice)}</span>
                <span>Timeframe: {item.marketTimeframe ?? "—"}</span>
                <span>Freshness: {item.freshness}</span>
                <span>Coverage: {item.providerCoverage}</span>
              </div>
              {scenarios.length > 0 && (
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {scenarios.map((scenario) => (
                    <div key={scenario.id} className="rounded-md bg-muted/30 p-2 text-[11px]">
                      <div className="mb-1 flex items-center gap-1 font-semibold">
                        {scenario.direction === "long" ? <TrendingUp className="size-3 text-emerald-500" /> : <TrendingDown className="size-3 text-red-500" />}
                        Conditional {scenario.direction.toUpperCase()} · {scenario.ready ? "trigger-ready" : "waiting"}
                      </div>
                      <div>Trigger {money(scenario.trigger)} · Invalidation {money(scenario.invalidation)}</div>
                      <div>Target {money(scenario.target)} · R:R {scenario.riskReward?.toFixed(2) ?? "—"}</div>
                      <p className="mt-1 text-muted-foreground">{scenario.reason}</p>
                    </div>
                  ))}
                </div>
              )}
              {projection && (
                <div className="mt-2 rounded-md bg-muted/30 p-2 text-[11px]">
                  Investment thesis: {projection.status} · {projection.direction}
                  {projection.entryReference !== undefined ? ` · Spot reference ${money(projection.entryReference)}` : ""}
                  {projection.accumulationZone
                    ? ` · Accumulation zone ${money(projection.accumulationZone.lower)}–${money(projection.accumulationZone.upper)} (${projection.accumulationZone.timeframe})`
                    : " · No validated accumulation zone"}
                  {projection.objective ? ` · Objective ${money(projection.objective.price)}` : ""}
                  {projection.invalidation ? ` · Invalidation ${money(projection.invalidation.price)}` : ""}
                  {projection.rewardRiskRatio !== undefined ? ` · R:R ${projection.rewardRiskRatio.toFixed(2)}` : ""}
                </div>
              )}
              {item.primaryReasons.length > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{item.primaryReasons.slice(0, 3).join(" · ")}</p>}
              {item.conflictingEvidence.length > 0 && <p className="mt-1 text-[10px] text-amber-500">Conflicts: {item.conflictingEvidence.slice(0, 2).join(" · ")}</p>}
              {item.missingInformation.length > 0 && <p className="mt-1 text-[10px] text-muted-foreground">Missing context: {item.missingInformation.slice(0, 3).join(" · ")}</p>}
            </div>
          );
        })}
        <p className="text-[10px] text-muted-foreground">Informational research only. Conditional levels are not orders; evidence confidence is not a probability of profit. Missing fundamentals or provider data remain explicitly missing.</p>
      </CardContent>
    </Card>
  );
}
