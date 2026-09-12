/**
 * Phase 188 — guest / free-trial product surface hardening.
 *
 * The critical property: **the UI must never manufacture entitlement state,
 * and a locked chargeable result must contain no actionable decision even in
 * the DOM.**
 *
 * These tests render the real components and inspect real DOM. Where the
 * boundary is server-side (redaction, chargeability) they assert against the
 * real modules rather than restating the rule.
 *
 * Phase 174 already covers the happy paths in
 * `EntitlementBadge.phase174.test.tsx`; this suite covers the failure and
 * ambiguity cases that phase did not.
 */

import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { I18nProvider } from "@/lib/i18n";
import {
  EntitlementBadge,
  LockedSignalNotice,
  type ServerEntitlement,
} from "./EntitlementBadge";
import {
  FREE_PROFIT_SIGNAL_LIMIT,
  isProfitSignal,
} from "@/lib/entitlement/entitlement";
import {
  PROTECTED_DECISION_FIELDS,
  gateDecision,
} from "@/lib/entitlement/decision-gate";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");
const BADGE_SRC = read("src/components/EntitlementBadge.tsx");
const DASHBOARD_SRC = read("src/pages/Dashboard.tsx");

const renderBadge = (entitlement: ServerEntitlement | undefined) =>
  render(
    <I18nProvider>
      <EntitlementBadge entitlement={entitlement} />
    </I18nProvider>,
  );

const GUEST: ServerEntitlement = {
  authenticated: true,
  plan: "GUEST",
  remaining: 2,
  limit: FREE_PROFIT_SIGNAL_LIMIT,
  upgradeRequired: false,
};

// ════════════ 1-2. LOADING MUST NOT GUESS ════════════

describe("188.1 — loading state never guesses", () => {
  it("1. loading does not guess a plan", () => {
    const { container } = renderBadge(undefined);
    expect(container.textContent).toBe("");
    expect(container.textContent).not.toMatch(/premium|trial/i);
  });

  it("2. loading does not guess a remaining count", () => {
    const { container } = renderBadge(undefined);
    expect(container.textContent).not.toMatch(/\d/);
  });

  it("an unauthenticated caller renders nothing rather than a trial claim", () => {
    const { container } = renderBadge({ ...GUEST, authenticated: false });
    expect(container.textContent).toBe("");
  });
});

// ════════════ 3-5. SERVER VALUES RENDER EXACTLY ════════════

describe("188.2 — displayed values come from the server verbatim", () => {
  it("3. the server's trial count renders exactly", () => {
    renderBadge({ ...GUEST, remaining: 2 });
    expect(screen.getByText(/2 free signals left/i)).toBeTruthy();
  });

  it("4. Premium renders as unlimited, with no finite trial count", () => {
    const { container } = renderBadge({ ...GUEST, plan: "PREMIUM", remaining: null });
    expect(container.textContent).toMatch(/premium/i);
    expect(container.textContent).toMatch(/unlimited/i);
    expect(container.textContent).not.toMatch(/\d+ free signals/i);
  });

  it("Premium never shows an exhausted lock even if remaining is 0", () => {
    // A stale or odd server value must not turn Premium into a locked trial.
    const { container } = renderBadge({ ...GUEST, plan: "PREMIUM", remaining: 0 });
    expect(container.textContent).toMatch(/unlimited/i);
    expect(container.textContent).not.toMatch(/used|exhaust/i);
  });

  it("5. a query failure does not become 'zero remaining'", () => {
    // REGRESSION (Phase 188 defect 1). `remaining ?? 0` rendered
    // "Free signals used" whenever the count was absent, fabricating
    // exhaustion. The server returns `remaining: null` for an authenticated
    // caller on INVALID_INPUT, so this was reachable, not theoretical.
    const { container } = renderBadge({ ...GUEST, remaining: null });
    expect(container.textContent).not.toMatch(/used|exhaust/i);
    expect(container.textContent).not.toMatch(/\d/);
    // The plan is still known, so it may still be shown.
    expect(container.textContent).toMatch(/trial/i);
  });

  it("an absent remaining field is treated as unknown, not zero", () => {
    const withoutCount = {
      authenticated: true,
      plan: "GUEST",
      limit: FREE_PROFIT_SIGNAL_LIMIT,
      upgradeRequired: false,
    } as unknown as ServerEntitlement;
    const { container } = renderBadge(withoutCount);
    expect(container.textContent).not.toMatch(/used|exhaust/i);
  });

  it("a genuine zero from the server still renders as exhausted", () => {
    // The fix must not swing the other way and hide real exhaustion.
    const { container } = renderBadge({ ...GUEST, remaining: 0 });
    expect(container.textContent).toMatch(/used|exhaust/i);
  });

  it("the component performs no entitlement arithmetic", () => {
    // No local subtraction, no deriving remaining from limit - used.
    expect(BADGE_SRC).not.toMatch(/remaining\s*-\s*1/);
    expect(BADGE_SRC).not.toMatch(/limit\s*-\s*/);
    expect(BADGE_SRC).not.toMatch(/profitSignalsUsed/);
  });
});

// ════════════ 6-7. LOCKED STATE ════════════

describe("188.3 — LOCKED replaces the actionable result", () => {
  const renderLocked = () =>
    render(
      <I18nProvider>
        <LockedSignalNotice instrument="BTC-USDT" />
      </I18nProvider>,
    );

  it("6. the locked notice states a signal exists and is withheld", () => {
    const { container } = renderLocked();
    expect(container.textContent).toMatch(/locked/i);
    expect(container.textContent).toMatch(/BTC-USDT/);
  });

  it("6. LOCKED is never rewritten as WAIT or NO_TRADE", () => {
    const { container } = renderLocked();
    const text = container.textContent ?? "";
    // The copy explicitly says it is NOT a wait verdict; it must not be
    // presented as one.
    expect(text).toMatch(/not a wait|not a no-trade/i);
    // And the Dashboard must clear the result rather than substitute one.
    expect(DASHBOARD_SRC).toContain("A locked signal is NOT a WAIT");
    expect(DASHBOARD_SRC).toMatch(/status === "LOCKED"[\s\S]{0,200}setCurrentResult\(null\)/);
  });

  it("7. the locked DOM contains no directional token anywhere", () => {
    const { container } = renderLocked();
    // innerHTML, not textContent: attributes, aria-labels and hidden nodes
    // are all included, so visual masking cannot pass this.
    const html = container.innerHTML.toUpperCase();
    for (const direction of ["LONG", "SHORT", "BUY", "SELL"]) {
      expect(html, `${direction} must not appear in locked DOM`).not.toContain(direction);
    }
  });

  it("7. the locked DOM exposes no actionable numeric fields", () => {
    const { container } = renderLocked();
    const html = container.innerHTML.toLowerCase();
    for (const field of ["entry", "stop", "target", "invalidation", "confidence", "conviction"]) {
      expect(html, `${field} must not appear in locked DOM`).not.toContain(field);
    }
  });

  it("no hidden-but-present actionable nodes exist", () => {
    const { container } = renderLocked();
    // Anything visually hidden must still be non-actionable.
    const hidden = container.querySelectorAll("[hidden], [aria-hidden='true'], .sr-only");
    for (const node of Array.from(hidden)) {
      const text = (node.textContent ?? "").toUpperCase();
      expect(text).not.toMatch(/LONG|SHORT|BUY|SELL/);
    }
  });

  it("12. server-side redaction withholds every protected field", () => {
    // The DOM cannot leak what the server never sent. Assert the boundary.
    const engineResult = {
      instrument: "BTC-USDT",
      instrumentType: "crypto",
      recommendation: "LONG",
      confidence: 87,
      conviction: "HIGH",
      tradePlan: { entry: 50000, stop: 49000, target: 52000 },
      bias: "BULLISH",
      analystThesis: "secret directional reasoning",
    };
    const gated = gateDecision({ result: engineResult, entitlement: { allowed: false } });

    expect(gated.status).toBe("LOCKED");
    const serialized = JSON.stringify(gated.result);
    for (const field of PROTECTED_DECISION_FIELDS) {
      expect(serialized, `${field} must not survive redaction`).not.toContain(field);
    }
    expect(serialized).not.toContain("LONG");
    expect(serialized).not.toContain("50000");
    expect(serialized).not.toContain("secret directional reasoning");
  });

  it("redaction builds from safe fields rather than deleting unsafe ones", () => {
    // An upstream field added later must be withheld by default.
    const gated = gateDecision({
      result: { instrument: "X", recommendation: "SHORT", someFutureSecret: "SHORT bias" },
      entitlement: { allowed: false },
    });
    expect(JSON.stringify(gated.result)).not.toContain("someFutureSecret");
  });
});

// ════════════ 8-9. WAIT / NO_TRADE ARE FREE ════════════

describe("188.4 — free outcomes are clearly free", () => {
  it("8 & 9. WAIT and NO_TRADE are not chargeable", () => {
    expect(isProfitSignal("WAIT")).toBe(false);
    expect(isProfitSignal("NO_TRADE")).toBe(false);
  });

  it("directional verdicts remain chargeable", () => {
    for (const a of ["BUY", "SELL", "LONG", "SHORT"]) expect(isProfitSignal(a)).toBe(true);
  });

  it("the locked notice tells the user free outcomes stay free", () => {
    const { container } = render(
      <I18nProvider>
        <LockedSignalNotice instrument="EURUSD" />
      </I18nProvider>,
    );
    expect(container.textContent).toMatch(/wait and no-trade.*free/i);
  });

  it("a WAIT verdict is delivered, never locked", () => {
    const gated = gateDecision({
      result: { instrument: "X", recommendation: "WAIT" },
      entitlement: { allowed: false },
    });
    // Not chargeable, so exhausted allowance does not withhold it.
    expect(gated.status).toBe("DELIVERED");
  });

  it("copy does not claim usage when nothing was consumed", () => {
    // "analysis used" style wording must not appear on the free path.
    const en = read("src/lib/i18n/en.ts");
    const block = en.slice(en.indexOf("entitlement: {"), en.indexOf("legal: {"));
    expect(block).not.toMatch(/analysis used/i);
  });
});

// ════════════ 10-15. USAGE COUNTER / CLIENT AUTHORITY ════════════

describe("188.5 — the client is never an entitlement authority", () => {
  it("10 & 11. the UI reads entitlement from the server query only", () => {
    expect(DASHBOARD_SRC).toContain("api.entitlements.getMyEntitlement");
    // Rendered straight through, no local shadow copy being mutated.
    expect(DASHBOARD_SRC).toContain("<EntitlementBadge entitlement={serverEntitlement");
  });

  it("11 & 12. entitlement is never persisted to localStorage or cookies", () => {
    for (const src of [BADGE_SRC, DASHBOARD_SRC]) {
      const nearEntitlement = src.match(/.{0,120}(localStorage|sessionStorage|document\.cookie).{0,120}/gs) ?? [];
      for (const window of nearEntitlement) {
        expect(window).not.toMatch(/remaining|entitlement|premium|profitSignals/i);
      }
    }
  });

  it("no optimistic decrement exists anywhere in the UI", () => {
    for (const src of [BADGE_SRC, DASHBOARD_SRC]) {
      expect(src).not.toMatch(/remaining\s*-[-=]/);
      expect(src).not.toMatch(/setRemaining|decrementRemaining/);
    }
  });

  it("14. an extra client-supplied plan field cannot flip the badge to Premium", () => {
    // MUTATION-DRIVEN (M8 survived the first round). Asserting that the
    // request omits a plan proved nothing about the RENDER path: a mutation
    // adding `|| entitlement.clientPremium` to the Premium branch passed all
    // 56 tests. The badge must key off the server's `plan` alone, so an
    // unexpected extra field is inert.
    const spoofed = {
      ...GUEST,
      remaining: 0,
      clientPremium: true,
      isPremium: true,
      unlimited: true,
      plan: "GUEST",
    } as unknown as ServerEntitlement;

    const { container } = renderBadge(spoofed);
    expect(container.textContent).not.toMatch(/premium/i);
    expect(container.textContent).not.toMatch(/unlimited/i);
    expect(container.textContent).toMatch(/trial/i);
  });

  it("14. only the server's plan value selects the Premium branch", () => {
    // Structural guard: the Premium test must be an exact comparison against
    // the server field, with no additional client-controlled disjunct.
    const premiumBranch = BADGE_SRC.match(/if \(entitlement\.plan === "PREMIUM"[^)]*\)/);
    expect(premiumBranch).not.toBeNull();
    expect(premiumBranch![0]).toBe('if (entitlement.plan === "PREMIUM")');
  });

  it("14. a client-supplied plan cannot be sent to the server", () => {
    // The protected action takes only `input`; plan/remaining are resolved
    // server-side and are not part of the request.
    const call = DASHBOARD_SRC.slice(DASHBOARD_SRC.indexOf("await runProtectedAnalysis("));
    const args = call.slice(0, call.indexOf("});"));
    expect(args).not.toMatch(/plan:|premium:|remaining:|unlimited:/i);
  });

  it("15. the upgrade CTA mutates nothing", () => {
    // It is inert by design while billing is deferred.
    const notice = BADGE_SRC.slice(BADGE_SRC.indexOf("export function LockedSignalNotice"));
    expect(notice).not.toMatch(/useMutation|grantPremium|consumeProfitSignal/);
    expect(notice).toContain("disabled={!onUpgrade}");
  });

  it("7. the upgrade surface invents no commercial terms", () => {
    const en = read("src/lib/i18n/en.ts");
    const block = en.slice(en.indexOf("entitlement: {"), en.indexOf("legal: {"));
    expect(block).not.toMatch(/\$|€|£|\/month|per month|USD|price/i);
    expect(block).toMatch(/not available yet/i);
  });
});

// ════════════ 16. ERROR SEMANTICS STAY DISTINCT ════════════

describe("188.6 — error states are not collapsed together", () => {
  it("16. the Dashboard distinguishes each server status", () => {
    for (const status of ["UNAUTHENTICATED", "INVALID_INPUT", "LOCKED"]) {
      expect(DASHBOARD_SRC).toContain(`"${status}"`);
    }
    // Each has its own message, not a shared "0 remaining".
    expect(DASHBOARD_SRC).toContain("t.entitlement.signInRequired");
    expect(DASHBOARD_SRC).toContain("t.entitlement.invalidInput");
  });

  it("provider degradation is not rendered as NO_TRADE", () => {
    // Phase 172 semantics: a provider outage degrades explicitly.
    const gate = read("src/lib/entitlement/decision-gate.ts");
    expect(gate).toContain("never rewrites a locked LONG/SHORT into WAIT");
  });

  it("an unauthenticated status does not render an exhausted badge", () => {
    const { container } = renderBadge({
      authenticated: false,
      plan: "GUEST",
      remaining: 0,
      limit: FREE_PROFIT_SIGNAL_LIMIT,
      upgradeRequired: false,
    });
    expect(container.textContent).toBe("");
  });
});

// ════════════ 17. LOCALIZATION ════════════

describe("188.7 — entitlement strings exist in all nine locales", () => {
  const LOCALES = ["en", "id", "es", "fr", "pt", "de", "ja", "ko", "zh"];
  const KEYS = [
    "trialLabel",
    "premiumLabel",
    "signalsRemaining",
    "signalsRemainingOne",
    "signalsExhausted",
    "unlimited",
    "lockedTitle",
    "lockedBody",
    "lockedNotWait",
    "upgradeCta",
    "upgradeComingSoon",
    "freeAlways",
    "signInRequired",
    "invalidInput",
  ];

  it("17. every locale defines every entitlement key", () => {
    for (const locale of LOCALES) {
      const src = read(`src/lib/i18n/${locale}.ts`);
      const start = src.indexOf("entitlement: {");
      expect(start, `${locale} has no entitlement block`).toBeGreaterThan(-1);
      const block = src.slice(start, src.indexOf("\n  },", start));
      for (const key of KEYS) {
        expect(block, `${locale} is missing entitlement.${key}`).toContain(`${key}:`);
      }
    }
  });

  it("no locale falls back to the English sentence for locked copy", () => {
    const en = read("src/lib/i18n/en.ts");
    const enBlock = en.slice(en.indexOf("entitlement: {"), en.indexOf("\n  },", en.indexOf("entitlement: {")));
    const enLocked = enBlock.match(/lockedTitle:\s*"([^"]+)"/)?.[1];
    expect(enLocked).toBeTruthy();

    for (const locale of LOCALES.filter((l) => l !== "en")) {
      const src = read(`src/lib/i18n/${locale}.ts`);
      const block = src.slice(src.indexOf("entitlement: {"), src.indexOf("\n  },", src.indexOf("entitlement: {")));
      const localeLocked = block.match(/lockedTitle:\s*"([^"]+)"/)?.[1];
      expect(localeLocked, `${locale} lockedTitle missing`).toBeTruthy();
      expect(localeLocked, `${locale} still shows the English string`).not.toBe(enLocked);
    }
  });

  it("the count interpolation placeholder survives translation", () => {
    for (const locale of LOCALES) {
      const src = read(`src/lib/i18n/${locale}.ts`);
      const block = src.slice(src.indexOf("entitlement: {"), src.indexOf("\n  },", src.indexOf("entitlement: {")));
      const plural = block.match(/signalsRemaining:\s*"([^"]+)"/)?.[1] ?? "";
      expect(plural, `${locale} lost the {count} placeholder`).toContain("{count}");
    }
  });

  it("no hardcoded English entitlement text in the component", () => {
    const jsx = BADGE_SRC.slice(BADGE_SRC.indexOf("export function EntitlementBadge"));
    expect(jsx).not.toMatch(/>[^<>{]*\b(Trial|Premium|Unlimited|signals left)\b/);
    expect(jsx).toContain("t.entitlement.");
  });
});

// ════════════ 18. ACCESSIBILITY ════════════

describe("188.8 — the locked state is perceivable without colour", () => {
  const renderLocked = () =>
    render(
      <I18nProvider>
        <LockedSignalNotice instrument="XAUUSD" />
      </I18nProvider>,
    );

  it("18. the locked notice is announced to assistive technology", () => {
    renderLocked();
    const status = screen.getByRole("status");
    expect(status).toBeTruthy();
    expect(status.textContent).toMatch(/locked/i);
  });

  it("18. the meaning survives without colour or icons", () => {
    const { container } = renderLocked();
    // Strip every svg (the icons) and check the text still explains the state.
    for (const svg of Array.from(container.querySelectorAll("svg"))) svg.remove();
    const text = container.textContent ?? "";
    expect(text).toMatch(/locked/i);
    expect(text).toMatch(/free/i);
    expect(text.trim().length).toBeGreaterThan(40);
  });

  it("the upgrade control is a real button with a discernible label", () => {
    renderLocked();
    const button = screen.getByRole("button");
    expect((button.textContent ?? "").trim().length).toBeGreaterThan(0);
  });

  it("the inert upgrade button is marked disabled, not merely styled", () => {
    renderLocked();
    expect(screen.getByRole("button").hasAttribute("disabled")).toBe(true);
  });
});

// ════════════ 19. NO ALTERNATE PATH ════════════

describe("188.9 — one authoritative protected analysis path", () => {
  it("19. the analysis engine is never invoked from the client", () => {
    const clientFiles = ["src/pages/Dashboard.tsx", "src/components/InstrumentInput.tsx"];
    for (const file of clientFiles) {
      const src = read(file);
      // Type-only imports are fine; a call is not.
      expect(src, `${file} calls runAnalysis directly`).not.toMatch(/\brunAnalysis\s*\(/);
    }
  });

  it("19. the Dashboard reaches analysis only through the protected action", () => {
    expect(DASHBOARD_SRC).toContain("api.protectedAnalysis.runProtectedAnalysis");
    // The deprecated client-reported mutation must not be wired to delivery.
    expect(DASHBOARD_SRC).not.toContain("api.entitlements.consumeProfitSignal");
  });

  it("the development toolbar is gated out of production", () => {
    const main = read("src/main.tsx");
    expect(main).toContain("import.meta.env.DEV && (");
  });
});

// ════════════ 20. PRODUCTION BUNDLE ════════════

describe("188.10 — the production bundle carries no bypass surface", () => {
  const distFiles = (() => {
    try {
      const dir = join(process.cwd(), "dist/assets");
      return readdirSync(dir)
        .filter((f) => f.endsWith(".js"))
        .map((f) => readFileSync(join(dir, f), "utf8"));
    } catch {
      return null;
    }
  })();

  it.skipIf(distFiles === null)(
    "19. the analysis engine is not shipped to the client",
    () => {
      // The decisive proof for §13: even a crafted client cannot run the
      // engine locally to recover a locked direction, because the engine is
      // not in the bundle at all.
      for (const js of distFiles!) {
        expect(js).not.toContain("runAnalysis");
      }
    },
  );

  it.skipIf(distFiles === null)(
    "the dev toolbar is tree-shaken out of production",
    () => {
      // `import.meta.env.DEV &&` lets the bundler drop it. Only the error
      // boundary's log string survives, which carries no toolbar code.
      for (const js of distFiles!) {
        expect(js).not.toContain("vly-toolbar-highlight");
        expect(js).not.toContain("vly-toolbar-enable-select");
        expect(js).not.toContain(".vly.sh");
      }
    },
  );

  it.skipIf(distFiles === null)("no provider secret reaches the bundle", () => {
    for (const js of distFiles!) {
      expect(js).not.toContain("XSTARZ_EMAIL_API_KEY");
      expect(js).not.toContain("TWELVE_DATA_API_KEY");
    }
  });
});
