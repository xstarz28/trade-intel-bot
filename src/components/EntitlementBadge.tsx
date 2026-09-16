/**
 * Phase 174 — entitlement surface.
 *
 * Renders ONLY what the server reported. This component performs no
 * entitlement arithmetic of its own: it does not count usage, does not decide
 * whether a decision is chargeable, and does not read localStorage. If the
 * server query has not resolved yet it renders nothing rather than guessing a
 * plan, because a guessed "Premium" or a guessed remaining count would be a
 * lie the moment it disagreed with the database.
 *
 * No pricing, currency, or plan naming beyond the neutral Trial/Premium state
 * — commercial terms are deliberately deferred.
 */

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { useI18n } from "@/lib/i18n";
import { Lock, Sparkles } from "lucide-react";

/** Exactly the server's `getMyEntitlement` shape. */
export interface ServerEntitlement {
  authenticated: boolean;
  plan: "GUEST" | "PREMIUM";
  remaining: number | null;
  limit: number;
  upgradeRequired: boolean;
  reason?: string;
}

export function EntitlementBadge({
  entitlement,
}: {
  entitlement: ServerEntitlement | undefined;
}) {
  const { t, txi } = useI18n();

  // Not resolved yet, or not signed in: render nothing. Never invent a state.
  if (!entitlement || !entitlement.authenticated) return null;

  if (entitlement.plan === "PREMIUM") {
    return (
      <Badge
        variant="outline"
        className="gap-1 font-mono text-[10px] border-primary/50 text-primary"
      >
        <Sparkles className="size-3" />
        {t.entitlement.premiumLabel}
        <span className="text-muted-foreground">· {t.entitlement.unlimited}</span>
      </Badge>
    );
  }

  // Phase 188 — a GUEST whose `remaining` the server did not supply is
  // UNKNOWN, not exhausted.
  //
  // The previous `?? 0` collapsed "no number available" into "zero left",
  // which renders "Free signals used" to a user who may have their full
  // allowance. That is the UI manufacturing entitlement state, and it is
  // reachable: the protected action returns `remaining: null` for an
  // authenticated caller on INVALID_INPUT. Render only the plan when the
  // count is unknown, and never a fabricated zero.
  const remaining = entitlement.remaining;
  const countKnown = typeof remaining === "number" && Number.isFinite(remaining);
  const exhausted = countKnown && remaining <= 0;

  return (
    <Badge
      variant="outline"
      className={
        exhausted
          ? "gap-1 font-mono text-[10px] border-destructive/50 text-destructive"
          : "gap-1 font-mono text-[10px] border-border/60 text-muted-foreground"
      }
    >
      {exhausted && <Lock className="size-3" />}
      {t.entitlement.trialLabel}
      {countKnown && (
        <span>
          ·{" "}
          {exhausted
            ? t.entitlement.signalsExhausted
            : remaining === 1
              ? t.entitlement.signalsRemainingOne
              : txi("entitlement.signalsRemaining", { count: remaining })}
        </span>
      )}
    </Badge>
  );
}

/**
 * Shown when the server WITHHELD an actionable signal.
 *
 * Critical: this is not a WAIT and must never be styled or worded as one. The
 * engine reached a directional conclusion; the user is told that a signal
 * exists and that it is locked — never which way it points, and never a
 * substituted refusal.
 */
export function LockedSignalNotice({
  instrument,
  onUpgrade,
}: {
  instrument: string;
  onUpgrade?: () => void;
}) {
  const { t, txi } = useI18n();

  return (
    <div
      role="status"
      className="rounded-md border border-primary/40 bg-primary/5 p-4 space-y-2"
    >
      <div className="flex items-center gap-2">
        <Lock className="size-4 text-primary" />
        <span className="font-mono text-xs font-semibold text-foreground">
          {t.entitlement.lockedTitle}
        </span>
      </div>

      <p className="text-xs text-muted-foreground">
        {txi("entitlement.lockedBody", { instrument })}
      </p>

      {/* States plainly that the verdict was NOT downgraded to Wait/No-Trade. */}
      <p className="text-[11px] text-muted-foreground/80 italic">
        {t.entitlement.lockedNotWait}
      </p>

      <p className="text-[11px] text-muted-foreground/80">
        {t.entitlement.freeAlways}
      </p>

      <div className="flex items-center gap-2 pt-1">
        <Button
          size="sm"
          className="h-7 text-[10px] font-mono gap-1"
          onClick={onUpgrade}
          disabled={!onUpgrade}
        >
          <Sparkles className="size-3" />
          {t.entitlement.upgradeCta}
        </Button>
        {/* No price, no currency, no plan tier — deferred by design. */}
        <span className="text-[10px] text-muted-foreground/70 font-mono">
          {t.entitlement.upgradeComingSoon}
        </span>
      </div>
    </div>
  );
}
