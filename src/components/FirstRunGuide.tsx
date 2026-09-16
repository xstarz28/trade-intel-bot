import { useCallback, useState } from "react";
import { Compass, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { useI18n } from "@/lib/i18n";

const DISMISS_KEY = "xstarz:first-run-guide-dismissed";

interface FirstRunGuideProps {
  /**
   * True only when the history query has RESOLVED and returned nothing.
   * While history is still loading this must be false, otherwise the guide
   * flashes for returning users — the same "loading is not empty" rule the
   * history list follows.
   */
  show: boolean;
}

/**
 * Phase 189 — first-run guidance.
 *
 * Explains the minimum action needed to get a first result, and states the
 * three outcome semantics honestly (free / chargeable / locked). It is pure
 * guidance: it renders no data, triggers no query, and creates no second
 * analysis path — the protected server action remains the only authority.
 */
export function FirstRunGuide({ show }: FirstRunGuideProps) {
  const { t } = useI18n();
  // Lazy initialiser: read storage once during the first render rather than
  // in an effect. An effect would set state on mount and cause a second
  // render (and a visible flash of the guide for users who dismissed it).
  const [dismissed, setDismissed] = useState(() => {
    try {
      return localStorage.getItem(DISMISS_KEY) === "1";
    } catch {
      // Private-mode or blocked storage: show the guide rather than crash.
      return false;
    }
  });

  const dismiss = useCallback(() => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // Non-fatal — the guide simply reappears next session.
    }
  }, []);

  if (!show || dismissed) return null;

  return (
    <Card className="border-primary/30 bg-primary/5" data-testid="first-run-guide">
      <CardContent className="p-4">
        <div className="flex items-start gap-3">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <Compass className="size-4 text-primary" />
          </div>
          <div className="min-w-0 flex-1">
            <h2 className="font-mono text-sm font-semibold">
              {t.onboarding.welcomeTitle}
            </h2>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {t.onboarding.welcomeBody}
            </p>

            <ol className="mt-3 space-y-1.5">
              {[t.onboarding.step1, t.onboarding.step2, t.onboarding.step3].map(
                (step, i) => (
                  <li key={i} className="flex gap-2 text-xs text-muted-foreground">
                    <span className="font-mono text-primary">{i + 1}.</span>
                    <span>{step}</span>
                  </li>
                ),
              )}
            </ol>

            <div className="mt-3 space-y-1 border-t border-border/50 pt-2.5">
              <p className="text-[11px] text-muted-foreground">
                {t.onboarding.freeOutcomeNote}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t.onboarding.chargeableNote}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {t.onboarding.lockedNote}
              </p>
            </div>

            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="mt-2 h-7 px-2 text-[11px]"
              onClick={dismiss}
            >
              {t.onboarding.dismiss}
            </Button>
          </div>

          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="size-7 shrink-0"
            aria-label={t.onboarding.dismiss}
            onClick={dismiss}
          >
            <X className="size-3.5" />
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
