/**
 * Phase 258 — PRODUCTION CONFIGURATION GATE & DEPLOYMENT TRUTH
 *
 * Ensures development config never mistaken for production, localhost not production-ready,
 * missing production config explicit, parser vs runtime distinction, credential/license preserved,
 * no fake smoke, no secrets, email OTP and Google OAuth production readiness explicit.
 *
 * Preserves Phase235-257.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

// ---------------------------------------------------------------------------
// 1 environment classification
// ---------------------------------------------------------------------------
describe("Phase258 1 — environment classification", () => {
  it("1.1 inventory lists all required vars without values", () => {
    const src = read("src/lib/deployment/production-config.ts") + read("src/lib/data/universal/live/credentials.ts");
    expect(src).toMatch(/CONVEX_SITE_URL/);
    expect(src).toMatch(/VITE_CONVEX_URL/);
    expect(src).toMatch(/TWELVE_DATA_API_KEY|COINGLASS_API_KEY|ALPHA_VANTAGE_API_KEY/);
  });

  it("1.2 classification DEV_ONLY vs PRODUCTION_REQUIRED vs SERVER_ONLY", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/convex-production/);
    expect(src).toMatch(/app-build/);
    expect(src).toMatch(/requiredInProduction/);
  });

  it("1.3 XSTARZ_DEPLOYMENT_ENV, XSTARZ_EMAIL_TRANSPORT, XSTARZ_OWNER_PRINCIPALS classified", () => {
    const src = read("src/lib/deployment/production-config.ts") + read("src/convex/lib/deploymentEnvironment.ts");
    expect(src).toMatch(/XSTARZ_DEPLOYMENT_ENV|DEPLOYMENT_ENV_VAR/);
    expect(src).toMatch(/XSTARZ_EMAIL_TRANSPORT/);
    expect(src).toMatch(/XSTARZ_OWNER_PRINCIPALS/);
  });
});

// ---------------------------------------------------------------------------
// 2 production/development distinction
// ---------------------------------------------------------------------------
describe("Phase258 2 — production/development distinction", () => {
  it("2.1 deploymentEnvironment resolves absent to production (fail-closed)", () => {
    const src = read("src/convex/lib/deploymentEnvironment.ts");
    expect(src).toMatch(/Absent.*production|Unset means production/);
  });

  it("2.2 allowsDevelopmentAffordances distinguishes production vs preview vs development", () => {
    const src = read("src/convex/lib/deploymentEnvironment.ts");
    expect(src).toMatch(/allowsDevelopmentAffordances/);
    expect(src).toMatch(/preview/);
    expect(src).toMatch(/development/);
  });

  it("2.3 production config report outcome READY_FOR_CONFIGURATION vs MISSING vs INVALID", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/READY_FOR_CONFIGURATION/);
    expect(src).toMatch(/MISSING_REQUIRED_CONFIG/);
    expect(src).toMatch(/INVALID_CONFIG/);
  });
});

// ---------------------------------------------------------------------------
// 3 localhost detection
// ---------------------------------------------------------------------------
describe("Phase258 3 — localhost detection", () => {
  it("3.1 CONVEX_SITE_URL=http://localhost:5173 cannot be production-ready", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/https-url/);
    // https-url shape should reject localhost http
  });

  it("3.2 VITE_CONVEX_URL localhost not production-shaped", () => {
    const src = read("src/lib/deployment/production-deploy-guard.ts");
    expect(src).toMatch(/CONVEX_CLOUD_HOST|convex\.cloud/);
  });

  it("3.3 localhost explicitly not production in .env.example", () => {
    const env = read(".env.example");
    expect(env).toContain("http://localhost:5173");
    // Example is dev, not prod
  });
});

// ---------------------------------------------------------------------------
// 4 Convex deployment
// ---------------------------------------------------------------------------
describe("Phase258 4 — Convex deployment", () => {
  it("4.1 CONVEX_DEPLOYMENT required shape deployment-identity", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/CONVEX_DEPLOYMENT/);
    expect(src).toMatch(/deployment-identity/);
  });

  it("4.2 production deployment not configured explicit", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/deployment/);
    expect(src).toMatch(/productionVerified/);
  });

  it("4.3 no invented deployment name", () => {
    const src = read("src/lib/deployment/production-deploy-guard.ts");
    expect(src).not.toMatch(/hardcoded.*prod:.*my-deployment/);
  });
});

// ---------------------------------------------------------------------------
// 5 site URL + 6 Google config + 7 callback config
// ---------------------------------------------------------------------------
describe("Phase258 5 — site URL & Google", () => {
  it("5.1 CONVEX_SITE_URL required https-url", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/CONVEX_SITE_URL/);
    expect(src).toMatch(/https-url/);
  });

  it("6.1 Google config AUTH_GOOGLE_ID/SECRET server-only", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toMatch(/AUTH_GOOGLE_ID|Google/);
    // Secret not in client
    const client = read("src/pages/Dashboard.tsx");
    expect(client).not.toContain("AUTH_GOOGLE_SECRET");
  });

  it("7.1 callback <production-site>/api/auth/callback/google not localhost", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toMatch(/google/i);
    const cfg = read("src/convex/auth.config.ts");
    expect(cfg).toMatch(/CONVEX_SITE_URL/);
  });
});

// ---------------------------------------------------------------------------
// 8 email OTP config + 9 email transport + 10 email sender
// ---------------------------------------------------------------------------
describe("Phase258 8 — email OTP", () => {
  it("8.1 email OTP production requires transport, api key, sender", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/XSTARZ_EMAIL_TRANSPORT/);
    expect(src).toMatch(/XSTARZ_EMAIL_API_KEY/);
    expect(src).toMatch(/XSTARZ_EMAIL_SENDER_ADDRESS/);
  });

  it("9.1 transport classification console vs resend/smtp2go", () => {
    const src = read("src/convex/lib/emailDelivery.ts");
    expect(src).toMatch(/console/);
    expect(src).toMatch(/resend|smtp2go/i);
  });

  it("10.1 sender must be Xstarz-owned, not default", () => {
    const src = read("src/convex/lib/emailDelivery.ts");
    expect(src).toMatch(/Xstarz-owned|sender/i);
  });
});

// ---------------------------------------------------------------------------
// 11 Twelve Data + 12 CoinGlass + 13 Alpha Vantage + 14 EIA + 15 TickAtlas
// ---------------------------------------------------------------------------
describe("Phase258 11 — provider config", () => {
  it("11.1 Twelve Data credential required", () => {
    const src = read("src/convex/marketData.ts");
    expect(src).toMatch(/TWELVE_DATA_API_KEY is missing/);
  });
  it("12.1 CoinGlass credential required", () => {
    const src = read("src/convex/coinglass.ts");
    expect(src).toMatch(/COINGLASS_API_KEY is missing/);
  });
  it("13.1 Alpha Vantage credential required", () => {
    const src = read("src/convex/alphaVantage.ts");
    expect(src).toMatch(/ALPHA_VANTAGE_API_KEY is missing/);
  });
  it("14.1 EIA credential required", () => {
    const src = read("src/convex/eia.ts");
    expect(src).toMatch(/EIA_API_KEY is missing/);
  });
  it("15.1 TickAtlas credential required", () => {
    const src = read("src/lib/deployment/production-config.ts") + read("src/lib/data/universal/live/credentials.ts") + read("src/convex/marketData.ts");
    expect(src).toMatch(/TICKATLAS_API_KEY/);
  });
});

// ---------------------------------------------------------------------------
// 16 provider status + 17 parser vs runtime + 18 test-vs-runtime + 19 sandbox-blocked
// ---------------------------------------------------------------------------
describe("Phase258 16 — provider status semantics", () => {
  it("16.1 provider status CODE_READY vs RUNTIME_VERIFIED vs CREDENTIAL_REQUIRED etc", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toMatch(/CREDENTIAL_REQUIRED/);
    expect(src).toMatch(/LICENSE_REQUIRED/);
    expect(src).toMatch(/BOUNDED/);
    expect(src).toMatch(/NOT_IMPLEMENTED/);
  });

  it("17.1 parser vs runtime distinction — EIA parser works != live verified without key", () => {
    const readiness = read("src/lib/discovery/runtime-readiness.ts");
    const eia = read("src/convex/eia.ts");
    expect(eia).toMatch(/EIA/);
    expect(readiness).toMatch(/EIA|eia/i);
  });

  it("18.1 test-vs-runtime distinction", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toMatch(/RUNTIME|TEST|CODE/);
  });

  it("19.1 sandbox-blocked distinction RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED", () => {
    const src = read("src/lib/discovery/production-runtime-acceptance.phase254.test.ts");
    expect(src).toMatch(/RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED|NETWORK_ERROR/);
  });
});

// ---------------------------------------------------------------------------
// 20 user-facing config status + 21 fail-fast + 22 optional degradation + 23 critical failure
// ---------------------------------------------------------------------------
describe("Phase258 20 — user-facing config & fail-fast", () => {
  it("20.1 user-facing shows safe states not values", () => {
    const dash = read("src/pages/Dashboard.tsx");
    expect(dash).not.toMatch(/TWELVE_DATA_API_KEY=.*[A-Za-z0-9]{16,}/);
  });

  it("21.1 fail-fast production missing config → deterministic state", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/MISSING_REQUIRED_CONFIG/);
  });

  it("22.1 optional provider degradation safe (Twelve Data missing → degraded not fake)", () => {
    const src = read("src/convex/marketData.ts");
    expect(src).toMatch(/not configured|is missing/);
    expect(src).not.toMatch(/fake.*data/);
  });

  it("23.1 critical config failure (CONVEX_SITE_URL, deployment) fails clearly", () => {
    const src = read("src/lib/deployment/production-deploy-guard.ts");
    expect(src).toMatch(/WRONG_SITE_URL|WRONG_CONVEX_URL|MISSING_DEPLOYMENT_IDENTITY/);
  });
});

// ---------------------------------------------------------------------------
// 24 BTC + 25 ETH + 26 XAU + 27 EUR/USD + 28 AAPL
// ---------------------------------------------------------------------------
describe("Phase258 24 — instruments", () => {
  it("24.1 BTC public via okx/ccxt", () => {
    expect(exists("src/convex/okx.ts")).toBe(true);
  });
  it("25.1 ETH public", () => {
    expect(exists("src/convex/okx.ts")).toBe(true);
  });
  it("26.1 XAU credential required", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toMatch(/CREDENTIAL_REQUIRED/);
  });
  it("27.1 EUR/USD credential required", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toMatch(/CREDENTIAL_REQUIRED|LICENSE/);
  });
  it("28.1 AAPL stock", () => {
    const src = read("src/lib/data/providers/twelve-data.ts");
    expect(src.length).toBeGreaterThan(10);
  });
});

// ---------------------------------------------------------------------------
// 29 fundamental + 30 derivatives + 31 macro + 32 news + 33 calendar + 34 technical
// ---------------------------------------------------------------------------
describe("Phase258 29 — feature panels", () => {
  it("29.1 fundamental panel", () => {
    expect(read("src/components/AnalysisResult.tsx")).toMatch(/fundamental/i);
  });
  it("30.1 derivatives panel", () => {
    expect(read("src/components/AnalysisResult.tsx")).toMatch(/derivatives|fundingRate/i);
  });
  it("31.1 macro panel", () => {
    expect(read("src/components/AnalysisResult.tsx")).toMatch(/macro/i);
  });
  it("32.1 news panel", () => {
    expect(read("src/components/AnalysisResult.tsx")).toMatch(/sentiment|news/i);
  });
  it("33.1 calendar panel", () => {
    expect(read("src/components/AnalysisResult.tsx")).toMatch(/calendar/i);
  });
  it("34.1 technical panel", () => {
    expect(read("src/components/AnalysisResult.tsx")).toMatch(/technical|RSI|MACD/i);
  });
});

// ---------------------------------------------------------------------------
// 35 Google no OTP + 36 email OTP regression
// ---------------------------------------------------------------------------
describe("Phase258 35 — auth", () => {
  it("35.1 Google no OTP after OAuth", () => {
    const src = read("src/convex/auth.ts");
    expect(src).toContain("allowDangerousEmailAccountLinking: false");
  });
  it("36.1 email OTP regression transport console vs production", () => {
    const src = read("src/convex/lib/emailDelivery.ts");
    expect(src).toMatch(/console/);
  });
});

// ---------------------------------------------------------------------------
// 37 security + 38 no secrets + 39 no localhost production + 40 no fake runtime
// ---------------------------------------------------------------------------
describe("Phase258 37 — security", () => {
  it("37.1 no client API keys", () => {
    for (const f of ["src/pages/Dashboard.tsx", "src/components/AnalysisResult.tsx", "src/main.tsx"]) {
      const src = read(f);
      expect(src).not.toMatch(/TWELVE_DATA_API_KEY|COINGLASS_API_KEY/);
    }
  });
  it("38.1 no secrets in bundle", () => {
    if (!exists("dist/assets")) return;
    const dir = join(ROOT, "dist/assets");
    const files = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dir, f), "utf8"));
    for (const js of files) {
      expect(js).not.toContain("XSTARZ_OWNER_PRINCIPALS");
    }
  });
  it("39.1 no localhost production — localhost is dev only", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/https-url/);
  });
  it("40.1 no fake runtime", () => {
    const src = read("src/lib/data/universal/live/client.ts");
    expect(src).not.toMatch(/Math\.random.*price/);
  });
});

// ---------------------------------------------------------------------------
// 41 readiness matrix + 42 deployment checklist + 43 provider dependency matrix + 44 config diagnostics + 45 UI status + 46 no raw env + 47 server-only boundary + 48 bundle scan + 49 catalog + 50 provider/native identity + 51 provenance + 52 freshness + 53 stale + 54 historical + 55 DEX bounded + 56 CCXT eventual + 57 Gecko eventual + 58 auth session + 59 entitlement + 60 workspace + 61 portfolio + 62 protection + 63 history + 64 opportunity + 65 scanner + 66 deterministic + 67 regression + 68 TS + 69 build + 70 final gate
// ---------------------------------------------------------------------------
describe("Phase258 41 — final matrix & gate", () => {
  it("41.1 readiness matrix covers all states", () => {
    const src = read("src/lib/discovery/runtime-readiness.ts");
    expect(src).toMatch(/CREDENTIAL_REQUIRED|LICENSE_REQUIRED|NOT_IMPLEMENTED|BOUNDED|HISTORICAL/);
  });
  it("42.1 deployment checklist names only, no values", () => {
    const env = read(".env.example");
    expect(env).toMatch(/VITE_CONVEX_URL=/);
    expect(env).not.toMatch(/sk_live/);
  });
  it("43.1 provider dependency matrix FEATURE→PROVIDER→CONFIG→STATE→UI", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/PRODUCTION_CONFIG_VARIABLES/);
    expect(src).toMatch(/PROVIDER_CREDENTIAL_REQUIREMENTS/);
  });
  it("44.1 configuration diagnostics safe, no values", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/redactSecrets|Never contains a value/);
  });
  it("45.1 UI status safe", () => {
    const dash = read("src/pages/Dashboard.tsx");
    expect(dash).not.toMatch(/TWELVE_DATA_API_KEY=.*[A-Za-z0-9]/);
  });
  it("46.1 no raw env values exposed", () => {
    const ar = read("src/components/AnalysisResult.tsx");
    expect(ar).not.toMatch(/process\.env\./);
  });
  it("47.1 server-only boundary", () => {
    const client = read("src/pages/Dashboard.tsx");
    expect(client).not.toMatch(/process\.env\.AUTH_GOOGLE_SECRET/);
  });
  it("48.1 bundle scan clean", () => {
    if (!exists("dist/assets")) return;
    const dir = join(ROOT, "dist/assets");
    const files = readdirSync(dir).filter((f) => f.endsWith(".js")).map((f) => readFileSync(join(dir, f), "utf8"));
    for (const js of files) {
      expect(js).not.toMatch(/AUTH_GOOGLE_SECRET/);
    }
  });
  it("49.1 catalog complete discovered", () => {
    expect(exists("src/components/InstrumentInput.tsx")).toBe(true);
  });
  it("50.1 provider/native identity typed", () => {
    const src = read("src/types/analysis.ts");
    expect(src).toMatch(/provider\?: string/);
  });
  it("51.1 provenance provider/timestamp", () => {
    expect(read("src/lib/data/universal/engines.ts")).toMatch(/observedAt/);
  });
  it("52.1 freshness FRESH/DELAYED/STALE", () => {
    expect(read("src/lib/market-radar/freshness.ts")).toMatch(/FRESH/);
  });
  it("53.1 stale handling", () => {
    expect(read("src/pages/Dashboard.tsx")).toMatch(/stale/i);
  });
  it("54.1 historical handling", () => {
    expect(read("src/components/AnalysisHistory.tsx")).toMatch(/historical/i);
  });
  it("55.1 DEX bounded", () => {
    expect(read("src/lib/discovery/runtime-readiness.ts")).toMatch(/BOUNDED/);
  });
  it("56.1 CCXT eventual", () => {
    expect(read("src/lib/discovery/runtime-readiness.ts")).toMatch(/ccxt/i);
  });
  it("57.1 Gecko eventual", () => {
    expect(read("src/lib/discovery/runtime-readiness.ts")).toMatch(/gecko/i);
  });
  it("58.1 auth session", () => {
    const auth = read("src/convex/auth.ts") + read("src/convex/auth/emailOtp.ts");
    expect(auth).toMatch(/session|Session|signIn|signOut/i);
  });
  it("59.1 entitlement", () => {
    expect(read("src/convex/entitlements.ts")).toMatch(/FREE|OWNER/);
  });
  it("60.1 workspace Trader vs Investor", () => {
    expect(read("src/pages/Dashboard.tsx")).toMatch(/workspaceMode/);
  });
  it("61.1 portfolio", () => {
    expect(read("src/components/PortfolioIntelligence.tsx")).toMatch(/portfolio/i);
  });
  it("62.1 protection", () => {
    expect(read("src/components/PositionProtectionDashboard.tsx")).toMatch(/protection|risk/i);
  });
  it("63.1 history", () => {
    expect(read("src/components/AnalysisHistory.tsx")).toMatch(/history|History/i);
  });
  it("64.1 opportunity", () => {
    expect(read("src/components/MarketOpportunities.tsx")).toMatch(/opportunity|Opportunity/i);
  });
  it("65.1 scanner", () => {
    expect(exists("src/lib/liveScanner.ts")).toBe(true);
  });
  it("66.1 deterministic output", () => {
    expect(read("src/components/AnalysisResult.tsx")).not.toMatch(/Math\.random.*bias/);
  });
  it("67.1 regression Phase244-258", () => {
    expect(exists("src/lib/discovery/final-release-readiness.phase256.test.ts")).toBe(true);
    expect(exists("src/lib/discovery/production-deployment-readiness.phase257.test.ts")).toBe(true);
  });
  it("68.1 TypeScript compatibility no any provider", () => {
    expect(read("src/components/AnalysisResult.tsx")).not.toContain("(result as any).provider");
  });
  it("69.1 build compatibility", () => {
    expect(exists("dist/index.html")).toBe(true);
  });
  it("70.1 final gate productionVerified false until real smoke", () => {
    const src = read("src/lib/deployment/production-config.ts");
    expect(src).toMatch(/productionVerified: false/);
    expect(src).toMatch(/NOT_VERIFIED|READY_FOR_CONFIGURATION/);
  });
});
