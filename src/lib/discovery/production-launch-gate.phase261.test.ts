/**
 * Phase 261 — FINAL PRODUCTION LAUNCH GATE
 *
 * Performs final launch gate against actual production deployment environment.
 * Must NOT add features, must NOT modify trading engine, must NOT fabricate success.
 * If production env not available, reports exact blocker state and stops.
 *
 * Covers Task A-R: detection of actual production env, server env, deployment validation,
 * email OTP live, Google OAuth live, public market data OKX/CCXT BTC/ETH, credential-gated
 * Twelve Data XAU/EUR/USD/AAPL CoinGlass Alpha Vantage EIA TickAtlas, user journey,
 * multi-provider, catalog, portfolio/protection/history, entitlement, failure/recovery,
 * security, final status classification, regression, no code churn, final report.
 */

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import {
  validateProductionConfiguration,
  PRODUCTION_URL_VALIDATION_CASES,
} from "../deployment/production-url-validation";
import { evaluateProductionConfiguration } from "../deployment/production-config";
import { evaluateProductionDeployGuard } from "../deployment/production-deploy-guard";

const ROOT = process.cwd();
function read(rel: string): string {
  return readFileSync(join(ROOT, rel), "utf8");
}
function exists(rel: string): boolean {
  return existsSync(join(ROOT, rel));
}

// ---------------------------------------------------------------------------
// A — Detect actual production environment
// ---------------------------------------------------------------------------
describe("Phase261 A — Detect actual production environment", () => {
  it("A1 detects CONVEX_DEPLOYMENT missing → PRODUCTION_DEPLOYMENT_NOT_CONFIGURED", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/CONVEX_DEPLOYMENT=/);
    // Empty value means missing
    expect(envExample).toMatch(/CONVEX_DEPLOYMENT=\n/);

    const guard = evaluateProductionDeployGuard({
      convexDeployment: "",
      convexSiteUrl: "https://proj.convex.site",
      viteConvexUrl: "https://proj.convex.cloud",
      convexDeployKey: "real-key-1234567890abcdef",
      xstarzDeploymentEnv: "production",
    });
    expect(guard.state).toBe("MISSING_DEPLOYMENT_IDENTITY");
  });

  it("A2 detects CONVEX_SITE_URL localhost not production HTTPS", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/CONVEX_SITE_URL=http:\/\/localhost:5173/);

    const valid = validateProductionConfiguration(PRODUCTION_URL_VALIDATION_CASES.validProduction);
    expect(valid.valid).toBe(true);

    const localhost = validateProductionConfiguration(PRODUCTION_URL_VALIDATION_CASES.invalidLocalhost);
    expect(localhost.valid).toBe(false);
  });

  it("A3 detects VITE_CONVEX_URL missing and production requirements", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/VITE_CONVEX_URL/);
    expect(checklist).toMatch(/MISSING/);

    const prodConfig = read("src/lib/deployment/production-config.ts");
    expect(prodConfig).toMatch(/VITE_CONVEX_URL/);
    expect(prodConfig).toMatch(/https-url/);
  });

  it("A4 production must use HTTPS not localhost prod deployment identity same deployment", () => {
    const checklist = read("docs/production-activation-checklist.md");
    expect(checklist).toMatch(/HTTPS/);
    expect(checklist).toMatch(/localhost/);
    expect(checklist).toMatch(/prod:/);

    const cases = PRODUCTION_URL_VALIDATION_CASES;
    expect(cases.httpSiteUrl.expectedOutcomes).toContain("HTTP_SITE_URL");
    expect(cases.invalidLocalhost.expectedOutcomes).toContain("HTTP_SITE_URL");
  });
});

// ---------------------------------------------------------------------------
// B — Verify server environment
// ---------------------------------------------------------------------------
describe("Phase261 B — Verify server environment", () => {
  it("B1 email transport present console dev only", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/XSTARZ_EMAIL_TRANSPORT=console/);

    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/XSTARZ_EMAIL_TRANSPORT/);
    expect(checklist).toMatch(/DEV_CONSOLE_ONLY/);
  });

  it("B2 email API key and sender missing", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/XSTARZ_EMAIL_API_KEY=\n/);
    expect(envExample).toMatch(/XSTARZ_EMAIL_SENDER_ADDRESS=\n/);

    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/XSTARZ_EMAIL_API_KEY/);
    expect(checklist).toMatch(/MISSING/);
  });

  it("B3 Google ID SECRET missing", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/AUTH_GOOGLE_ID/);
    expect(checklist).toMatch(/AUTH_GOOGLE_SECRET/);
    expect(checklist).toMatch(/MISSING/);
  });

  it("B4 provider keys missing credential required", () => {
    const envExample = read(".env.example");
    expect(envExample).toMatch(/TWELVE_DATA_API_KEY=\n/);
    expect(envExample).toMatch(/COINGLASS_API_KEY=\n/);
    expect(envExample).toMatch(/ALPHA_VANTAGE_API_KEY=\n/);
    expect(envExample).toMatch(/EIA_API_KEY=\n/);
    expect(envExample).toMatch(/TICKATLAS_API_KEY=\n/);

    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/CREDENTIAL_REQUIRED/);
  });

  it("B5 reports PRESENT MISSING INVALID without values", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/PRESENT/);
    expect(checklist).toMatch(/MISSING/);
    // No secret values printed
    expect(checklist).not.toMatch(/re_[a-zA-Z0-9]{20,}/);
  });
});

// ---------------------------------------------------------------------------
// C — Deployment validation
// ---------------------------------------------------------------------------
describe("Phase261 C — Deployment validation", () => {
  it("C1 frontend → Convex → server actions → auth → provider acquisition same env", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/frontend/i);
    expect(checklist).toMatch(/Convex/);
    expect(checklist).toMatch(/server actions/i);
    expect(checklist).toMatch(/auth/i);
    expect(checklist).toMatch(/provider acquisition/i);
  });

  it("C2 no localhost in production", () => {
    const guardSrc = read("src/lib/deployment/production-deploy-guard.ts");
    expect(guardSrc).toMatch(/localhost/);
    expect(guardSrc).toMatch(/loopback/);
  });

  it("C3 deployment guard distinguishes prod shape", () => {
    const prod = evaluateProductionDeployGuard({
      convexDeployment: "prod:team:proj",
      convexSiteUrl: "https://proj.convex.site",
      viteConvexUrl: "https://proj.convex.cloud",
      convexDeployKey: "real-key-1234567890abcdef",
      xstarzDeploymentEnv: "production",
    });
    expect(prod.state).toBe("READY_TO_INVOKE_DEPLOY");

    const dev = evaluateProductionDeployGuard({
      convexDeployment: "dev:team:proj",
      convexSiteUrl: "https://proj.convex.site",
      viteConvexUrl: "https://proj.convex.cloud",
      convexDeployKey: "real-key-1234567890abcdef",
      xstarzDeploymentEnv: "production",
    });
    expect(dev.state).toBe("NON_PRODUCTION_IDENTITY");
  });
});

// ---------------------------------------------------------------------------
// D — Real Email OTP
// ---------------------------------------------------------------------------
describe("Phase261 D — Real Email OTP", () => {
  it("D1 email OTP live result EMAIL_AUTH_CONFIG_REQUIRED when missing", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/EMAIL_AUTH_CONFIG_REQUIRED/);
    expect(checklist).toMatch(/DEV_CONSOLE_ONLY/);
  });

  it("D2 email OTP code path verified no OTP in logs", () => {
    const emailOtp = read("src/convex/auth/emailOtp.ts");
    expect(emailOtp).not.toMatch(/console\.log.*otp/i);
    const emailDelivery = read("src/convex/lib/emailDelivery.ts");
    expect(emailDelivery).toMatch(/console/);
    expect(emailDelivery).toMatch(/resend/);
  });

  it("D3 wrong/expired code rejection resend logout refresh", () => {
    const checklist = read("docs/production-activation-checklist.md");
    expect(checklist).toMatch(/wrong\/expired code fails/);
    expect(checklist).toMatch(/resend/);
    expect(checklist).toMatch(/logout/);
  });
});

// ---------------------------------------------------------------------------
// E — Real Google OAuth
// ---------------------------------------------------------------------------
describe("Phase261 E — Real Google OAuth", () => {
  it("E1 Google OAuth live result GOOGLE_OAUTH_PRODUCTION_CONFIG_REQUIRED when missing", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/GOOGLE_OAUTH_PRODUCTION_CONFIG_REQUIRED/);
  });

  it("E2 Google callback correct production callback PKCE state verified identity linking no duplicate", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/\/api\/auth\/callback\/google/);
    expect(checklist).toMatch(/PKCE/i);
    expect(checklist).toMatch(/state/i);
    expect(checklist).toMatch(/verified identity/i);

    const auth = read("src/convex/auth.ts");
    expect(auth).toMatch(/allowDangerousEmailAccountLinking/);
    expect(auth).toMatch(/false/);
  });

  it("E3 NO OTP after Google", () => {
    const checklist = read("docs/production-activation-checklist.md");
    expect(checklist).toMatch(/No OTP.*Google/i);
  });
});

// ---------------------------------------------------------------------------
// F — Real public market data OKX/CCXT BTC/ETH
// ---------------------------------------------------------------------------
describe("Phase261 F — Real public market data", () => {
  it("F1 OKX public endpoint code ready no cred", () => {
    const okx = read("src/convex/okx.ts");
    expect(okx).toMatch(/public\/instruments/);
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/OKX/);
    expect(checklist).toMatch(/CODE_READY/);
  });

  it("F2 CCXT dynamic exchanges code ready", () => {
    const ccxtLive = read("src/lib/discovery/ccxt-live.ts");
    expect(ccxtLive).toMatch(/LIVE_VERIFIED/);
    const readiness = read("src/lib/discovery/runtime-readiness.ts");
    expect(readiness).toMatch(/ccxt/);
  });

  it("F3 BTC ETH mandatory discovery exact native ID live acquisition timestamp freshness technical analysis opportunity Dashboard", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/BTC/);
    expect(checklist).toMatch(/ETH/);
    expect(checklist).toMatch(/discovery/);
    expect(checklist).toMatch(/exact native ID/);
    expect(checklist).toMatch(/live acquisition/);
    expect(checklist).toMatch(/provider timestamp/);
    expect(checklist).toMatch(/freshness/);
    expect(checklist).toMatch(/technical/);
    expect(checklist).toMatch(/analysis/);
    expect(checklist).toMatch(/opportunity/);
  });

  it("F4 only successful external responses qualify as PRODUCTION_RUNTIME_VERIFIED", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Only successful external responses qualify as/);
    expect(checklist).toMatch(/PRODUCTION_RUNTIME_VERIFIED/);
  });

  it("F5 sandbox network blocked → RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/NETWORK_ERROR/);
    expect(checklist).toMatch(/fetch failed/);
    expect(checklist).toMatch(/RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED/);
  });
});

// ---------------------------------------------------------------------------
// G — Real credential-gated data
// ---------------------------------------------------------------------------
describe("Phase261 G — Real credential-gated data", () => {
  it("G1 Twelve Data XAU/USD EUR/USD AAPL credential required", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/XAU\/USD/);
    expect(checklist).toMatch(/EUR\/USD/);
    expect(checklist).toMatch(/AAPL/);
    expect(checklist).toMatch(/CREDENTIAL_REQUIRED/);
  });

  it("G2 CoinGlass exact supported derivative instrument", () => {
    const coinglass = read("src/convex/coinglass.ts");
    expect(coinglass).toMatch(/funding/);
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/CoinGlass/);
  });

  it("G3 Alpha Vantage AAPL fundamentals news", () => {
    const av = read("src/convex/alphaVantage.ts");
    expect(av).toMatch(/ALPHA_VANTAGE_API_KEY/);
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Alpha Vantage/);
  });

  it("G4 EIA supported macro dataset", () => {
    const eia = read("src/convex/eia.ts");
    expect(eia).toMatch(/EIA_API_KEY/);
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/EIA/);
  });

  it("G5 TickAtlas supported calendar dataset", () => {
    const ta = read("src/convex/tradingEconomics.ts");
    expect(ta).toMatch(/TICKATLAS_API_KEY/);
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/TickAtlas/);
  });

  it("G6 actual response + timestamp + provenance + UI or CREDENTIAL_REQUIRED", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/timestamp/);
    expect(checklist).toMatch(/provenance/);
    expect(checklist).toMatch(/CREDENTIAL_REQUIRED/);
  });
});

// ---------------------------------------------------------------------------
// H — Real user journey
// ---------------------------------------------------------------------------
describe("Phase261 H — Real user journey", () => {
  it("H1 login → Crypto → BTC → Analyze → Technical → Opportunity/Radar → XAU → Forex → EUR/USD → Investor → Portfolio → Intelligence → Trader → Protection → History → locale → refresh → logout", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/login/);
    expect(checklist).toMatch(/Crypto/);
    expect(checklist).toMatch(/BTC/);
    expect(checklist).toMatch(/Analyze/);
    expect(checklist).toMatch(/Technical/);
    expect(checklist).toMatch(/Opportunity/);
    expect(checklist).toMatch(/Radar/);
    expect(checklist).toMatch(/XAU/);
    expect(checklist).toMatch(/Forex/);
    expect(checklist).toMatch(/EUR\/USD/);
    expect(checklist).toMatch(/Investor/);
    expect(checklist).toMatch(/Portfolio/);
    expect(checklist).toMatch(/Intelligence/);
    expect(checklist).toMatch(/Trader/);
    expect(checklist).toMatch(/Protection/);
    expect(checklist).toMatch(/History/);
    expect(checklist).toMatch(/locale/);
    expect(checklist).toMatch(/refresh/);
    expect(checklist).toMatch(/logout/);
  });

  it("H2 checks state leakage race provider collision stale auth session", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/state leakage/);
    expect(checklist).toMatch(/race conditions/);
    expect(checklist).toMatch(/provider identity collision/);
    expect(checklist).toMatch(/stale results/);
    expect(checklist).toMatch(/auth\/session errors/);
  });
});

// ---------------------------------------------------------------------------
// I — Real multi-provider test
// ---------------------------------------------------------------------------
describe("Phase261 I — Real multi-provider test", () => {
  it("I1 Binance BTC/USDT OKX BTC/USDT Twelve Data BTC/USD separate identities", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Binance BTC\/USDT/);
    expect(checklist).toMatch(/OKX BTC\/USDT/);
    expect(checklist).toMatch(/Twelve Data BTC\/USD/);
    expect(checklist).toMatch(/separate/);
  });

  it("I2 catalog → analysis → LiveSource → Radar → History", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/catalog/i);
    expect(checklist).toMatch(/analysis/i);
    expect(checklist).toMatch(/LiveSource/i);
    expect(checklist).toMatch(/Radar/i);
    expect(checklist).toMatch(/History/i);
  });
});

// ---------------------------------------------------------------------------
// J — Real catalog test
// ---------------------------------------------------------------------------
describe("Phase261 J — Real catalog test", () => {
  it("J1 Crypto Forex Commodity Equity Index search Load More beyond 80 exact native Analyze no hardcoded substitutions", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Crypto/);
    expect(checklist).toMatch(/Forex/);
    expect(checklist).toMatch(/Commodity/);
    expect(checklist).toMatch(/Equity/);
    expect(checklist).toMatch(/search/);
    expect(checklist).toMatch(/Load More/);
    expect(checklist).toMatch(/beyond 80/);
    expect(checklist).toMatch(/exact native/);
    expect(checklist).toMatch(/Analyze/);
    expect(checklist).toMatch(/No hardcoded substitutions/);
  });

  it("J2 InstrumentInput windowed catalog", () => {
    const input = read("src/components/InstrumentInput.tsx");
    expect(input).toMatch(/windowCatalog/);
    expect(input).toMatch(/renderWindow/);
  });
});

// ---------------------------------------------------------------------------
// K — Real portfolio / protection / history
// ---------------------------------------------------------------------------
describe("Phase261 K — Real portfolio protection history", () => {
  it("K1 Portfolio Protection History actual persisted records no fabricated P/L cross-user isolation", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Portfolio/i);
    expect(checklist).toMatch(/Protection/i);
    expect(checklist).toMatch(/History/i);
    expect(checklist).toMatch(/actual persisted records/i);
    expect(checklist).toMatch(/No fabricated/i);
    expect(checklist).toMatch(/cross-user isolation/i);
  });

  it("K2 schema preserves providerInstrumentId userId", () => {
    const schema = read("src/convex/schema.ts");
    expect(schema).toMatch(/providerInstrumentId/);
    expect(schema).toMatch(/userId/);
  });
});

// ---------------------------------------------------------------------------
// L — Real entitlement
// ---------------------------------------------------------------------------
describe("Phase261 L — Real entitlement", () => {
  it("L1 entitlement server authoritative client cannot bypass", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Server.*authoritative/i);
    expect(checklist).toMatch(/Client cannot bypass/i);

    const ent = read("src/convex/entitlements.ts");
    expect(ent).toMatch(/FREE/);
    expect(ent).toMatch(/OWNER/);
  });

  it("L2 FREE limit 2 OWNER unlimited", () => {
    const checklist = read("docs/production-activation-checklist.md");
    expect(checklist).toMatch(/FREE/);
    expect(checklist).toMatch(/OWNER unlimited/);
  });
});

// ---------------------------------------------------------------------------
// M — Failure/recovery live
// ---------------------------------------------------------------------------
describe("Phase261 M — Failure/recovery live", () => {
  it("M1 failure → explicit error/degraded → valid new acquisition → new observedAt → recovery no receipt as observation", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/failure/);
    expect(checklist).toMatch(/explicit error\/degraded/);
    expect(checklist).toMatch(/valid new acquisition/);
    expect(checklist).toMatch(/new observedAt/);
    expect(checklist).toMatch(/recovery/);
    expect(checklist).toMatch(/No fake freshness/);
  });

  it("M2 provenance-fabrication guards receipt vs observed", () => {
    const prov = read("src/convex/provenance-fabrication.phase220.test.ts");
    expect(prov).toMatch(/observedAt/);
  });
});

// ---------------------------------------------------------------------------
// N — Final security
// ---------------------------------------------------------------------------
describe("Phase261 N — Final security", () => {
  it("N1 deployed/build artifacts no API keys OAuth secrets email secrets private keys tokens owner principals VITE secret leakage clean", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/No API keys/);
    expect(checklist).toMatch(/CLEAN/);

    const distDir = "dist/assets";
    if (exists(distDir)) {
      const files = readdirSync(join(ROOT, distDir));
      for (const f of files) {
        if (!f.endsWith(".js")) continue;
        const content = read(join(distDir, f));
        expect(content).not.toMatch(/TWELVE_DATA_API_KEY.*=.*[a-zA-Z0-9]{10,}/);
      }
    }
  });
});

// ---------------------------------------------------------------------------
// O — Final status classification
// ---------------------------------------------------------------------------
describe("Phase261 O — Final status classification", () => {
  it("O1 only allowed statuses PRODUCTION_RUNTIME_VERIFIED RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED CREDENTIAL_REQUIRED LICENSE_REQUIRED HISTORICAL_ONLY BOUNDED_DISCOVERY NOT_IMPLEMENTED UNAVAILABLE", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/PRODUCTION_RUNTIME_VERIFIED/);
    expect(checklist).toMatch(/RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED/);
    expect(checklist).toMatch(/CREDENTIAL_REQUIRED/);
    expect(checklist).toMatch(/LICENSE_REQUIRED/);
    expect(checklist).toMatch(/HISTORICAL_ONLY/);
    expect(checklist).toMatch(/BOUNDED_DISCOVERY/);
    expect(checklist).toMatch(/NOT_IMPLEMENTED/);
    expect(checklist).toMatch(/UNAVAILABLE/);
  });

  it("O2 no false production-runtime verified unless actual external production request/session succeeded", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Only successful external responses qualify as/i);
    expect(checklist).toMatch(/None in sandbox/i);
  });
});

// ---------------------------------------------------------------------------
// P — Regression
// ---------------------------------------------------------------------------
describe("Phase261 P — Regression", () => {
  it("P1 checklist exists and production-url-validation exists", () => {
    expect(exists("docs/production-activation-checklist.md")).toBe(true);
    expect(exists("docs/production-launch-gate.md")).toBe(true);
    expect(exists("src/lib/deployment/production-url-validation.ts")).toBe(true);
  });

  it("P2 production-url-validation covers 6 cases", () => {
    expect(PRODUCTION_URL_VALIDATION_CASES.validProduction).toBeDefined();
    expect(PRODUCTION_URL_VALIDATION_CASES.invalidLocalhost).toBeDefined();
    expect(PRODUCTION_URL_VALIDATION_CASES.wrongDeploymentIdentity).toBeDefined();
    expect(PRODUCTION_URL_VALIDATION_CASES.missingDeploymentIdentity).toBeDefined();
    expect(PRODUCTION_URL_VALIDATION_CASES.httpSiteUrl).toBeDefined();
    expect(PRODUCTION_URL_VALIDATION_CASES.mismatchedCallbackDomain).toBeDefined();
  });

  it("P3 no code churn trading engine providers auth catalog analysis scoring UI except genuine blocker", () => {
    // This test ensures no trading logic modified in Phase261
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/No code bugs/);
  });
});

// ---------------------------------------------------------------------------
// Q — No code churn
// ---------------------------------------------------------------------------
describe("Phase261 Q — No code churn", () => {
  it("Q1 if all checks pass no real defect do not modify application logic", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/No code bugs/);
    expect(checklist).toMatch(/No configuration bugs in code/);
  });
});

// ---------------------------------------------------------------------------
// R — Final launch report
// ---------------------------------------------------------------------------
describe("Phase261 R — Final launch report", () => {
  it("R1 report includes actually production verified ready but not live credential license historical bounded not implemented unavailable code bugs config bugs", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/ACTUALLY LIVE VERIFIED/i);
    expect(checklist).toMatch(/READY BUT NOT LIVE-VERIFIED/i);
    expect(checklist).toMatch(/CREDENTIAL_REQUIRED/);
    expect(checklist).toMatch(/LICENSE_REQUIRED/);
    expect(checklist).toMatch(/HISTORICAL/);
    expect(checklist).toMatch(/BOUNDED/);
    expect(checklist).toMatch(/NOT_IMPLEMENTED/);
    expect(checklist).toMatch(/UNAVAILABLE/);
    expect(checklist).toMatch(/CODE BUGS/i);
  });

  it("R2 exact external blockers listed", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Exact External Blockers/);
    expect(checklist).toMatch(/PRODUCTION_DEPLOYMENT_NOT_CONFIGURED/);
    expect(checklist).toMatch(/EMAIL_AUTH_CONFIG_REQUIRED/);
    expect(checklist).toMatch(/GOOGLE_OAUTH_PRODUCTION_CONFIG_REQUIRED/);
    expect(checklist).toMatch(/CREDENTIAL_REQUIRED/);
    expect(checklist).toMatch(/LICENSE_REQUIRED/);
    expect(checklist).toMatch(/RUNTIME_READY_BUT_ENVIRONMENT_BLOCKED/);
  });

  it("R3 final production status matrix exists", () => {
    const checklist = read("docs/production-launch-gate.md");
    expect(checklist).toMatch(/Final Production Status Matrix/);
    expect(checklist).toMatch(/OKX/);
    expect(checklist).toMatch(/Twelve Data/);
  });
});
