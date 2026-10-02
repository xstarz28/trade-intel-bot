/**
 * Phase 312 addendum — the SIGNAL CARD.
 *
 * One coherent presentation of an actionable analysis:
 *   [CHART] → WHY (structure/HTF-MTF/location/confirmation/fundamental/
 *   confluence) → TRADE PLAN (entry/SL/TP1/TP2/distances/R:R) → POSITION
 *   MECHANICS (product-specific) → RISK → INVALIDATION → LIMITATIONS.
 *
 * Wording rules enforced by tests: no guaranteed-profit language anywhere;
 * win rates appear ONLY as historically observed figures with their sample
 * size, and only when the recorded-outcome assessment supports them. The
 * probability block is enriched from the user's REAL journal records when the
 * Convex context is available; without it the assessment carried inside the
 * signal is shown verbatim. All copy goes through i18n (phase-189 ratchet).
 */

import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { SignalChartView } from "./SignalChartView";
import type { SignalResponse } from "@/lib/strategy/signal";
import { assessHistoricalProbability, type ProbabilityAssessment } from "@/lib/strategy/probability";
import { useI18n } from "@/lib/i18n";

// Test-environment-safe Convex access (same pattern as Journal.tsx).
let useQuery: any = () => undefined;
let journalQueryRef: any = undefined;
try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const convexReact = require("convex/react") as { useQuery: any };
  useQuery = convexReact.useQuery;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  journalQueryRef = ((require("@/convex/_generated/api") as any).api ?? {}).journal?.getByInstrument;
} catch {
  // test environment without Convex bundling — fall back to the embedded assessment
}

function useOptionalQuery(queryRef: any): any[] | undefined {
  try {
    if (!queryRef) return undefined;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery(queryRef) as any[] | undefined;
  } catch {
    return undefined;
  }
}

const ACTIONABILITY_CONFIG = {
  VALIDATED: { cls: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30" },
  WAIT: { cls: "bg-amber-500/15 text-amber-400 border-amber-500/30" },
  NO_TRADE: { cls: "bg-red-500/15 text-red-400 border-red-500/30" },
} as const;

function fmt(n: number | undefined): string {
  return n === undefined || !Number.isFinite(n) ? "—" : String(n);
}

function ProbabilityBlock({ p }: { p: ProbabilityAssessment }) {
  const { t } = useI18n();
  if (p.status === "historically_estimated") {
    return (
      <div data-testid="probability-estimated" className="space-y-1 text-sm">
        <p className="font-medium text-muted-foreground">
          {`${t.signal.probabilityEstimatedLabel} ${p.sampleSize}`}
        </p>
        <p>
          {`${t.signal.probabilityWinRate} ${(p.winRate! * 100).toFixed(1)}% (95% ${(p.winRateUncertainty!.low * 100).toFixed(1)}–${(p.winRateUncertainty!.high * 100).toFixed(1)}%) · ${t.signal.probabilityLossRate} ${(p.lossRate! * 100).toFixed(1)}%`}
        </p>
        <p>
          {`${t.signal.probabilityAvgR} ${p.averageR!.toFixed(3)} · ${t.signal.probabilityExpectedR} ${p.expectedR!.toFixed(3)}`}
        </p>
      </div>
    );
  }
  if (p.status === "limited_sample") {
    return (
      <div data-testid="probability-limited" className="space-y-1 text-sm">
        <p className="font-medium text-amber-400">
          {`${t.signal.probabilityLimitedLabel} ${p.sampleSize}`}
        </p>
        <p className="text-muted-foreground">{p.reason}</p>
      </div>
    );
  }
  return (
    <div data-testid="probability-unavailable" className="space-y-1 text-sm">
      <p className="font-medium text-muted-foreground">{t.signal.probabilityUnavailableLabel}</p>
      <p className="text-muted-foreground">{p.reason}</p>
    </div>
  );
}

export function SignalCard({ signal }: { signal: SignalResponse }) {
  const { t } = useI18n();
  // Enrich from the user's REAL journal records when a Convex context exists.
  const journalRows = useOptionalQuery(
    journalQueryRef ? { ...journalQueryRef, instrument: signal.instrument } : undefined,
  );
  let probability = signal.probability;
  if (Array.isArray(journalRows)) {
    probability = assessHistoricalProbability(
      journalRows.map((r) => ({
        instrument: r.instrument,
        timeframe: r.timeframe,
        direction: r.direction,
        style: r.style,
        ...(typeof r.rMultiple === "number" ? { rMultiple: r.rMultiple } : {}),
        ...(r.closedAt !== undefined ? { closedAt: r.closedAt } : {}),
      })),
      signal.probability.matchedOn ?? { instrument: signal.instrument, timeframe: signal.timeframe },
    );
  }

  const dirLabel =
    signal.direction === "long" ? t.signal.buyLong : signal.direction === "short" ? t.signal.sellShort : t.signal.noDirection;
  const act = ACTIONABILITY_CONFIG[signal.plan.actionability];
  const sizing = signal.position.sizing;
  const fx = signal.position.forex;
  const spot = signal.position.spot;
  const fut = signal.position.futures;
  const stock = signal.position.stock;
  const commodity = signal.position.commodity;

  return (
    <Card data-testid="signal-card" className="border-border">
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-mono font-bold">{signal.instrument}</span>
          <Badge variant="outline" className={signal.direction === "long" ? "text-emerald-400" : "text-red-400"}>
            {dirLabel}
          </Badge>
          <span className="text-muted-foreground">{signal.timeframe}</span>
          {signal.provider && <span className="text-muted-foreground">{`· ${signal.provider}`}</span>}
          {signal.providerInstrumentId && (
            <span className="font-mono text-xs text-muted-foreground">{`· ${signal.providerInstrumentId}`}</span>
          )}
          {signal.observedAt !== undefined && (
            <span className="text-muted-foreground">{`· ${new Date(signal.observedAt).toISOString()}`}</span>
          )}
          <Badge variant="outline" className={act.cls}>
            {`${t.signal.planPrefix} ${signal.plan.actionability}`}
          </Badge>
        </div>
        {signal.plan.available && (
          <p className="text-xs text-muted-foreground">{signal.plan.actionabilityReason}</p>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <SignalChartView spec={signal.chart} />

        {/* WHY */}
        <section data-testid="signal-why" className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.signal.why}</h3>
          {signal.why.map((s) => (
            <div key={s.heading} className="text-sm">
              <span className="font-medium">{`${s.heading}: `}</span>
              <span className="text-muted-foreground">{s.lines.join(" · ")}</span>
            </div>
          ))}
        </section>

        {/* TRADE PLAN */}
        <section data-testid="signal-plan" className="space-y-1 rounded-lg border border-border/60 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.signal.tradePlan}</h3>
          {signal.plan.available ? (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
              <p>{`${t.signal.entry}: `}<span className="font-mono">{fmt(signal.plan.entry)}</span></p>
              <p>{`${t.signal.stopLoss}: `}<span className="font-mono">{fmt(signal.plan.stop)}</span></p>
              <p>{`${t.signal.tp1}: `}<span className="font-mono">{fmt(signal.plan.tp1)}</span></p>
              <p>{`${t.signal.tp2}: `}<span className="font-mono">{fmt(signal.plan.tp2)}</span></p>
              <p>{`${t.signal.riskDistance}: `}<span className="font-mono">{fmt(signal.plan.riskDistance)}</span></p>
              <p>{`${t.signal.rewardDistance}: `}<span className="font-mono">{fmt(signal.plan.rewardDistance)}</span></p>
              <p>{`${t.signal.riskReward}: `}<span className="font-mono">{signal.plan.riskReward !== undefined ? `1:${signal.plan.riskReward.toFixed(2)}` : "—"}</span></p>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{signal.plan.unavailableReason}</p>
          )}
          {signal.plan.available && (
            <div className="space-y-0.5 pt-1 text-xs text-muted-foreground">
              <p>{`${t.signal.entryBasis}: ${signal.plan.entryBasis}`}</p>
              <p>{`${t.signal.invalidationBasis}: ${signal.plan.stopBasis}`}</p>
              <p>{`${t.signal.targetBasisTp1}: ${signal.plan.tp1Basis}`}</p>
              {signal.plan.tp2Basis && <p>{`${t.signal.targetBasisTp2}: ${signal.plan.tp2Basis}`}</p>}
            </div>
          )}
        </section>

        {/* POSITION MECHANICS */}
        <section data-testid="signal-position" className="space-y-1 rounded-lg border border-border/60 p-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            {`${t.signal.positionMechanics} — ${signal.position.productType} (${t.signal.neverExecuted})`}
          </h3>
          {!sizing.available ? (
            <p className="text-sm text-muted-foreground">{`${t.signal.sizingNotComputed} ${sizing.unavailableReason}`}</p>
          ) : (
            <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm md:grid-cols-3">
              <p>{`${t.signal.riskAmount}: `}<span className="font-mono">{fmt(sizing.riskAmount)}</span>{` ${sizing.denominationCurrency ?? ""}`}</p>
              <p>{`${t.signal.quantity}: `}<span className="font-mono">{fmt(sizing.quantity)}</span></p>
              <p className="col-span-2 md:col-span-3 text-xs text-muted-foreground">
                {`${t.signal.specLabel} ${sizing.specificationSource}${sizing.conversion ? ` · ${t.signal.conversionLabel} ${sizing.conversion.from}→${sizing.conversion.to} @ ${sizing.conversion.rate} (${sizing.conversion.source})` : ""}`}
              </p>
              {spot && spot.slDistance !== undefined && (
                <p>{`${t.signal.slDistance}: `}<span className="font-mono">{fmt(spot.slDistance)}</span></p>
              )}
              {spot && spot.expectedLossAtSL !== undefined && (
                <p>{`${t.signal.expectedLossAtSl}: `}<span className="font-mono">{fmt(spot.expectedLossAtSL)}</span></p>
              )}
              {fx && (
                <>
                  {fx.stopDistancePips !== undefined && (
                    <p>{`${t.signal.stopDistancePips}: `}<span className="font-mono">{fmt(fx.stopDistancePips)}</span>{" pips"}</p>
                  )}
                  {fx.targetDistancePips !== undefined && (
                    <p>{`${t.signal.targetDistancePips}: `}<span className="font-mono">{fmt(fx.targetDistancePips)}</span>{" pips"}</p>
                  )}
                  {fx.standardLots !== undefined && (
                    <p className="col-span-2 md:col-span-3">
                      {`lots — ${t.signal.lotsStandard} ${fmt(fx.standardLots)} · ${t.signal.lotsMini} ${fmt(fx.miniLots)} · ${t.signal.lotsMicro} ${fmt(fx.microLots)}${fx.pipValuePerStandardLot !== undefined ? ` · ${t.signal.pipValuePerStdLot} ${fmt(fx.pipValuePerStandardLot)}` : ""}`}
                    </p>
                  )}
                  {fx.available === false && <p className="col-span-2 md:col-span-3 text-red-400">{fx.reason}</p>}
                </>
              )}
              {stock && stock.shares !== undefined && (
                <>
                  <p>{`${t.signal.shares}: `}<span className="font-mono">{fmt(stock.shares)}</span></p>
                  <p>{`${t.signal.riskPerShare}: `}<span className="font-mono">{fmt(stock.riskPerShare)}</span></p>
                  <p>{`${t.signal.notional}: `}<span className="font-mono">{fmt(stock.notional)}</span></p>
                </>
              )}
              {stock && stock.available === false && <p className="col-span-2 md:col-span-3 text-red-400">{stock.reason}</p>}
              {commodity && (
                <>
                  {commodity.units !== undefined && (
                    <p>{`units: `}<span className="font-mono">{fmt(commodity.units)}</span></p>
                  )}
                  {commodity.contracts !== undefined && (
                    <p>{`contracts: `}<span className="font-mono">{fmt(commodity.contracts)}</span>{` (×${fmt(commodity.contractMultiplier)} ${commodity.multiplierSource ?? ""})`}</p>
                  )}
                  {commodity.available === false && <p className="col-span-2 md:col-span-3 text-red-400">{commodity.reason}</p>}
                </>
              )}
              {fut?.leverage && (
                <div className="col-span-2 md:col-span-3 space-y-0.5 text-xs text-muted-foreground">
                  <p>{fut.leverage.mechanicsNote}</p>
                  {fut.leverage.suggestedRange && (
                    <p>
                      {`${t.signal.leverageRangeLabel} `}
                      <span className="font-mono">
                        {`${fut.leverage.suggestedRange.min}x–${fut.leverage.suggestedRange.max}x`}
                      </span>
                    </p>
                  )}
                  {fut.leverage.reason && <p>{fut.leverage.reason}</p>}
                  {fut.leverage.liquidationCheck && (
                    <p data-testid="liquidation-check">
                      {fut.leverage.liquidationCheck.available
                        ? `${t.signal.liquidationCheckLabel} ${fut.leverage.liquidationCheck.checkedLeverage}x: stop ${fut.leverage.liquidationCheck.stopIsSafe ? t.signal.liquidationSafe : t.signal.liquidationUnsafe} — ${fmt(fut.leverage.liquidationCheck.approximateLiquidationPrice)} (${fut.leverage.liquidationCheck.formula})`
                        : `${t.signal.liquidationCheckLabel}: ${fut.leverage.liquidationCheck.reason}`}
                    </p>
                  )}
                  {fut.leverage.fundingCaveat && <p>{fut.leverage.fundingCaveat}</p>}
                </div>
              )}
            </div>
          )}
        </section>

        {/* RISK */}
        <section data-testid="signal-risk" className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.signal.riskHeading}</h3>
          {signal.risk.policyConfigured && (
            <p className="text-sm">
              {`${t.signal.riskAmount}: `}
              <span className="font-mono">{fmt(signal.risk.riskAmount)}</span>
              {signal.risk.accountCurrency ? ` ${signal.risk.accountCurrency}` : ""}
              {signal.risk.riskPercent !== undefined ? ` (${(signal.risk.riskPercent * 100).toFixed(2)}% ${t.signal.riskAmountSuffix})` : ""}
            </p>
          )}
          <p className="text-sm">{signal.risk.note}</p>
          <ProbabilityBlock p={probability} />
        </section>

        {/* INVALIDATION */}
        <section data-testid="signal-invalidation" className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.signal.invalidationHeading}</h3>
          <p className="text-sm">
            {signal.invalidation.condition}
            {signal.invalidation.level !== undefined
              ? ` (${signal.invalidation.level}${signal.invalidation.timeframe ? `, ${signal.invalidation.timeframe}` : ""})`
              : ""}
          </p>
        </section>

        {/* LIMITATIONS */}
        <section data-testid="signal-limitations" className="space-y-1">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{t.signal.limitationsHeading}</h3>
          <ul className="list-disc space-y-0.5 pl-5 text-xs text-muted-foreground">
            {signal.limitations.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>

        <p className="text-xs italic text-muted-foreground">{signal.noGuaranteeNote}</p>
      </CardContent>
    </Card>
  );
}
