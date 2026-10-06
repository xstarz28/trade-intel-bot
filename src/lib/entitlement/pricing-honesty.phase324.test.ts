/**
 * Phase 324 — pricing/monetization honesty guardrails.
 *
 * The pricing layer is built ONLY from capabilities the backend actually
 * enforces today:
 *  - FREE (guest plan): full analysis workspace + a one-time allowance of
 *    actionable profit signals, enforced by the server-side entitlements
 *    table (Phase 169 rules in src/lib/entitlement/entitlement.ts);
 *  - PROFESSIONAL (PREMIUM plan): unlimited actionable signals, granted ONLY
 *    through the server-side admin/webhook path (`grantPremium`) — no payment
 *    processing exists yet, so checkout is a factual coming-soon state.
 *
 * This suite locks that honesty in place: the number shown is the number
 * enforced, no invented tiers, no fake checkout success, no client-side
 * unlock, no AI marketing, and the XSTARZG identity persists on the page.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const read = (p: string) => readFileSync(join(process.cwd(), p), "utf8");

const pricing = read("src/pages/Pricing.tsx");
const main = read("src/main.tsx");
const dashboard = read("src/pages/Dashboard.tsx");
const landing = read("src/pages/Landing.tsx");
const entitlement = read("src/lib/entitlement/entitlement.ts");
const enPricing = read("src/lib/i18n/en.ts");

const LOCALES = ["en", "id", "es", "fr", "pt", "de", "ja", "ko", "zh"] as const;

function walkTsxs(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walkTsxs(full));
    else if ((entry.endsWith(".tsx") || entry.endsWith(".ts")) && !entry.includes(".test.")) out.push(full);
  }
  return out;
}

describe("324 — the pricing page exists and is reachable", () => {
  it("/pricing is a PUBLIC route (before the download route, outside RequireAuth)", () => {
    expect(main).toContain('import { PricingPage } from "@/pages/Pricing";');
    expect(main).toContain('<Route path="/pricing" element={<PricingPage />} />');
    expect(main.indexOf("/pricing")).toBeLessThan(main.indexOf("/download"));
  });

  it("the upgrade CTAs lead to /pricing — no dead upgrade buttons", () => {
    expect(dashboard).toMatch(/onUpgrade=\{\(\) => navigate\("\/pricing"\)\}/);
    expect(landing).toMatch(/<Link to="\/pricing">/);
    // Landing LINKS to pricing — it must not duplicate the plan grid.
    expect(landing).not.toContain("t.pricing.freeName");
  });
});

describe("324 — the number shown is the number enforced", () => {
  it("the free allowance is interpolated from the SHARED enforced constant", () => {
    expect(pricing).toContain(
      'import { FREE_PROFIT_SIGNAL_LIMIT } from "@/lib/entitlement/entitlement";',
    );
    expect(pricing).toContain('txi("pricing.freeAllowance", { count: FREE_PROFIT_SIGNAL_LIMIT })');
    // no hard-coded marketing number for the allowance
    expect(pricing).not.toMatch(/>\s*2\s*<|"\s*2\s*(free|signals)/);
  });

  it("the enforced constant is unchanged and server-authoritative", () => {
    expect(entitlement).toContain("export const FREE_PROFIT_SIGNAL_LIMIT = 2;");
    expect(entitlement).toContain("**Server-authoritative.**");
    // only actionable directions are charged; WAIT/NO_TRADE stay free
    expect(entitlement).toContain('const ACTIONABLE = new Set(["BUY", "SELL", "LONG", "SHORT"]);');
  });

  it("every locale ships the pricing copy with the SAME leaf keys", () => {
    const keys = [...enPricing.matchAll(/^    (\w+): "(?:[^"]|\\")*",$/gm)].map((m) => m[1]);
    const enBlock = enPricing.slice(enPricing.indexOf("  pricing: {"), enPricing.indexOf("checkoutNote"));
    expect(enBlock).toContain("pricing: {");
    for (const locale of LOCALES) {
      const dict = read(`src/lib/i18n/${locale}.ts`);
      const block = dict.slice(dict.indexOf("  pricing: {"), dict.indexOf("  checkoutNote") === -1 ? dict.indexOf("checkoutNote") : undefined);
      expect(block, locale).toContain("pricing: {");
      for (const key of [
        "title","subtitle","freeName","freeDescription","freeActionStart","freeActionCurrent",
        "proName","proDescription","proBadge","proAction","included","marketAnalysis","waitFree",
        "history","protection","actionableSignals","freeAllowance","unlimitedSignals","enforcedNote","checkoutNote",
      ]) {
        expect(block, `${locale}.${key}`).toContain(`${key}: "`);
      }
    }
  });
});

describe("324 — checkout honesty (no billing exists yet)", () => {
  it("the professional CTA is a disabled coming-soon control — never a success state", () => {
    expect(pricing).toMatch(/<Button variant="secondary" disabled className="w-full gap-2 font-mono">/);
    expect(pricing).not.toMatch(/payment successful|purchase complete|subscribed|thank you for your purchase/i);
  });

  it("grantPremium is never imported client-side (unlock is server-only)", () => {
    for (const file of walkTsxs("src")) {
      if (file.includes(`${join("src", "convex")}`) || file.includes("src/convex")) continue;
      expect(read(file), file).not.toContain("grantPremium");
    }
    // and the server grant stays admin-gated
    const convex = read("src/convex/entitlements.ts");
    expect(convex).toContain('if (user.role !== "admin")');
    expect(convex).toContain("payment webhook or an admin path");
  });

  it("no currency amounts are advertised while nothing can be charged", () => {
    expect(pricing).not.toMatch(/\$\s?\d|\bUSD\b|\bEUR\b|\bIDR\b|\/\s?mo(nth)?\b/i);
  });
});

describe("324 — copy and identity discipline", () => {
  it("no AI marketing, fake scarcity, or invented tiers in the pricing surface", () => {
    // The en dictionary deliberately carries FORBIDDEN-phrase fixtures for the
    // truthfulness suites — scan only this phase's pricing block of it.
    const blockStart = enPricing.indexOf("  pricing: {");
    const enPricingBlock = enPricing.slice(blockStart, enPricing.indexOf("},  ", blockStart) === -1 ? enPricing.indexOf("enforcedNote") + 400 : undefined);
    for (const content of [pricing, enPricingBlock]) {
      expect(content).not.toMatch(/AI-powered|unlock your AI|artificial intelligence|AI insights/i);
      expect(content).not.toMatch(/limited time|today only|act now|last chance|only today/i);
      expect(content).not.toMatch(/\bEnterprise\b|\bUltimate\b|\bPlatinum\b|\bElite\b/);
      expect(content).not.toMatch(/guaranteed (profit|returns)|win rate \d|risk-free/i);
    }
  });

  it("the page speaks the XSTARZG visual language", () => {
    expect(pricing).toContain("metal-panel");
    expect(pricing).toContain("chrome-text");
    expect(pricing).not.toMatch(/(text|bg|border)-(violet|purple|fuchsia)-/);
    expect(pricing).not.toMatch(/backdrop-blur-xl/);
  });

  it("both plans honestly include the SAME workspace; only actionable signals differ", () => {
    // the included rows list is shared between the two plan cards
    const occurrences = pricing.split("includedRows.map").length - 1;
    expect(occurrences).toBe(2);
    expect(pricing).toContain('t.pricing.waitFree');
  });
});
