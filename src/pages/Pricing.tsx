/**
 * Phase 324 — public pricing route (`/pricing`).
 *
 * Built ONLY from what the backend actually enforces today:
 *
 *  - FREE (the guest plan): the full analysis workspace — bias, structure,
 *    key levels, trade plan, evidence, history, protection — with a small
 *    ONE-TIME allowance of actionable profit signals (BUY/SELL/LONG/SHORT).
 *    WAIT / NO_TRADE verdicts are never charged.
 *  - PROFESSIONAL (the PREMIUM plan): unlimited actionable profit signals.
 *    The allowance counter lives in the entitlements table keyed by userId —
 *    a reload, a storage reset or a second client cannot resurrect it.
 *
 * HONESTY RULES this page follows (see docs/phase324-pricing.md):
 *  - the free allowance number is interpolated from the SHARED pure module
 *    (`FREE_PROFIT_SIGNAL_LIMIT`) — never a hard-coded marketing number;
 *  - no payment processing exists yet, so checkout is a factual
 *    "coming soon" state: no fake success, no simulated purchase, and
 *    Premium is granted ONLY through the server-side verified grant path
 *    (admin/webhook), never from this page;
 *  - no currency amounts are advertised while no billing can charge them;
 *  - no AI marketing language, no fake scarcity, no invented tiers.
 */

import { Link } from "react-router";
import { useI18n } from "@/lib/i18n";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, ArrowLeft, ArrowUpRight } from "lucide-react";
// Single source of truth for the free allowance: the same pure constant the
// Convex server enforces. If the server limit ever changes, this page follows.
import { FREE_PROFIT_SIGNAL_LIMIT } from "@/lib/entitlement/entitlement";

export function PricingPage() {
  const { t, txi } = useI18n();

  const includedRows: string[] = [
    t.pricing.marketAnalysis,
    t.pricing.waitFree,
    t.pricing.history,
    t.pricing.protection,
  ];

  return (
    <div className="min-h-screen bg-background">
      <header className="sticky top-0 z-50 border-b border-border/50 bg-background/80 backdrop-blur-md">
        <div className="mx-auto flex h-14 max-w-5xl items-center justify-between px-4 sm:px-6">
          <Link
            to="/"
            className="flex items-center gap-2 rounded-lg font-mono text-sm font-bold tracking-tight focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            <ArrowLeft className="size-4 text-muted-foreground" />
            <span className="chrome-text">Xstarz Analysis</span>
          </Link>
          <Button variant="ghost" size="sm" asChild className="text-sm">
            <Link to="/auth">{t.landing.launch}</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-4 sm:px-6 py-10 sm:py-14">
        <h1 className="text-3xl sm:text-4xl font-bold tracking-tight font-mono">
          <span className="chrome-text">{t.pricing.title}</span>
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-muted-foreground">{t.pricing.subtitle}</p>

        <div className="mt-8 grid grid-cols-1 gap-4 md:grid-cols-2">
          {/* FREE — what every signed-in account has today */}
          <section className="metal-panel rounded-xl p-5 sm:p-6 flex flex-col">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold font-mono">{t.pricing.freeName}</h2>
              <Badge variant="outline" className="font-mono text-[10px] border-border/60 text-muted-foreground">
                {t.pricing.freeActionCurrent}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t.pricing.freeDescription}</p>

            <div className="mt-4 rounded-lg border border-border/50 bg-muted/20 px-4 py-3">
              <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                {t.pricing.actionableSignals}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums font-mono">
                {txi("pricing.freeAllowance", { count: FREE_PROFIT_SIGNAL_LIMIT })}
              </p>
            </div>

            <ul className="mt-4 space-y-2">
              {includedRows.map((row) => (
                <li key={row} className="flex items-start gap-2 text-xs text-foreground/80">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                  {row}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-5">
              <Button className="w-full gap-2 font-mono" asChild>
                <Link to="/auth">
                  {t.pricing.freeActionStart}
                  <ArrowUpRight className="size-3.5" />
                </Link>
              </Button>
            </div>
          </section>

          {/* PROFESSIONAL — the PREMIUM entitlement, checkout honestly pending */}
          <section className="metal-panel rounded-xl p-5 sm:p-6 flex flex-col border-primary/40">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-lg font-semibold font-mono">{t.pricing.proName}</h2>
              <Badge variant="outline" className="font-mono text-[10px] border-primary/40 text-primary">
                {t.pricing.proBadge}
              </Badge>
            </div>
            <p className="mt-2 text-xs text-muted-foreground leading-relaxed">{t.pricing.proDescription}</p>

            <div className="mt-4 rounded-lg border border-primary/30 bg-primary/5 px-4 py-3">
              <p className="text-[10px] font-mono uppercase tracking-wide text-muted-foreground">
                {t.pricing.actionableSignals}
              </p>
              <p className="mt-1 text-xl font-bold tabular-nums font-mono text-primary">
                {t.pricing.unlimitedSignals}
              </p>
            </div>

            <ul className="mt-4 space-y-2">
              {includedRows.map((row) => (
                <li key={row} className="flex items-start gap-2 text-xs text-foreground/80">
                  <Check className="mt-0.5 size-3.5 shrink-0 text-primary/80" aria-hidden="true" />
                  {row}
                </li>
              ))}
            </ul>

            <div className="mt-auto pt-5 space-y-2">
              {/* The factual checkout boundary: no payment provider exists yet,
                  so this control performs no transaction and can never report
                  success. Premium is granted only through the server-side
                  verified path once billing exists. */}
              <Button variant="secondary" disabled className="w-full gap-2 font-mono">
                <ArrowUpRight className="size-3.5" />
                {t.pricing.proAction}
              </Button>
              <p className="text-[10px] leading-relaxed text-muted-foreground/80">{t.pricing.checkoutNote}</p>
            </div>
          </section>
        </div>

        <p className="mt-8 max-w-2xl text-[11px] leading-relaxed text-muted-foreground/80 font-mono">
          {t.pricing.enforcedNote}
        </p>
      </main>
    </div>
  );
}
