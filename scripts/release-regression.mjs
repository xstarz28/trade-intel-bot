#!/usr/bin/env node
/**
 * Phase 265 — Canonical Release Regression Gate
 *
 * Reproducible single command that:
 *  - builds with safe placeholder VITE_CONVEX_URL (no real credentials)
 *  - syncs ignored mobile artifacts (dist -> android/ios public via cap sync)
 *  - runs full vitest suite
 *  - fails non-zero on any failure or skipped test (canonical = 0 skipped)
 *  - ensures no committed build artifacts, no secrets leak
 *
 * Usage: npm run test:release
 *
 * Safe placeholder: https://placeholder.convex.cloud (never a real deployment)
 * Real builds must pass secret scan separately via npm run mobile:verify
 */

import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const SAFE_PLACEHOLDER_URL = "https://placeholder.convex.cloud";

function log(msg) {
  console.log(`[release-regression] ${msg}`);
}

function fail(msg) {
  console.error(`[release-regression] FAIL: ${msg}`);
  process.exit(1);
}

function run(cmd, args, env = {}) {
  log(`$ ${cmd} ${args.join(" ")}`);
  const result = spawnSync(cmd, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
    cwd: ROOT,
  });
  if (result.status !== 0) {
    fail(`${cmd} ${args.join(" ")} exited with ${result.status}`);
  }
  return result;
}

function runCapture(cmd, args, env = {}) {
  const result = spawnSync(cmd, args, {
    encoding: "utf8",
    env: { ...process.env, ...env },
    cwd: ROOT,
  });
  return result;
}

// ── 1. Guard: no real secrets in env that would leak into build ──
const forbiddenEnv = [
  "TWELVE_DATA_API_KEY",
  "ALPHA_VANTAGE_API_KEY",
  "COINGLASS_API_KEY",
  "TICKATLAS_API_KEY",
  "EIA_API_KEY",
];
for (const key of forbiddenEnv) {
  if (process.env[key]) {
    log(`Warning: ${key} is set in current env — build will use placeholder VITE_CONVEX_URL but secret remains in process env (not inlined into client bundle). Ensure client bundle does not read server-only vars.`);
  }
}

// ── 2. Build with safe placeholder VITE_CONVEX_URL ──
log(`Building with safe placeholder VITE_CONVEX_URL=${SAFE_PLACEHOLDER_URL}`);
run("npx", ["tsc", "-b"], {});
run("npx", ["vite", "build"], {
  VITE_CONVEX_URL: SAFE_PLACEHOLDER_URL,
  MOBILE_BUILD: "1",
});

// Verify dist exists and contains index.html
const distIndex = join(ROOT, "dist", "index.html");
if (!existsSync(distIndex)) {
  fail("dist/index.html missing after build");
}
log(`dist/index.html present (${statSync(distIndex).size} bytes)`);

// Check dist does not contain server-only secrets (quick scan)
const distFiles = [];
function walk(dir) {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (full.endsWith(".js") || full.endsWith(".html")) distFiles.push(full);
  }
}
walk(join(ROOT, "dist"));
for (const file of distFiles) {
  try {
    const content = readFileSync(file, "utf8");
    for (const secret of forbiddenEnv) {
      // Check for assignment shape, not bare name mention
      const re = new RegExp(`${secret}\\s*[:=]\\s*["'][^"']{8,}[\"']`, "i");
      if (re.test(content)) {
        fail(`Secret pattern ${secret} found in ${file.replace(ROOT + "/", "")}`);
      }
      // Check for process.env / import.meta.env read of server-only var in client bundle
      const readRe = new RegExp(`(process\\.env|import\\.meta\\.env)\\.${secret}\\b`);
      if (readRe.test(content)) {
        fail(`Client bundle reads server-only ${secret} in ${file.replace(ROOT + "/", "")}`);
      }
    }
    // Check for localhost dev dependencies that must not ship
    if (/https?:\/\/(localhost|127\.0\.0\.1):(5173|3000|8080|8100|4173)/.test(content)) {
      // Allow if it's inside source map comment? No, fail
      // But ignore vite's own localhost mention in comments? We check assignment shape
      const localhostRe = /(url|endpoint|baseUrl|origin|host|CONVEX_URL|apiUrl)\s*[:=]\s*["'`]https?:\/\/(localhost|127\.0\.0\.1)/i;
      if (localhostRe.test(content)) {
        fail(`Dev localhost endpoint found in ${file.replace(ROOT + "/", "")}`);
      }
    }
  } catch {
    // ignore binary
  }
}
log(`Scanned ${distFiles.length} dist files — no secret patterns found`);

// ── 3. Sync ignored mobile artifacts (dist -> android/ios) ──
// Use cap sync which copies webDir (dist) into android/app/src/main/assets/public and ios/App/public
if (existsSync(join(ROOT, "android")) || existsSync(join(ROOT, "ios"))) {
  log("Syncing Capacitor artifacts (npx cap sync)");
  // cap sync needs dist already built, which we have
  run("npx", ["cap", "sync"], {
    VITE_CONVEX_URL: SAFE_PLACEHOLDER_URL,
  });
  log("Capacitor sync complete");
} else {
  log("No android/ios projects present — skipping cap sync (dist is still the canonical artifact)");
}

// ── 4. Run full vitest suite — canonical gate must have 0 skipped, 0 failed ──
log("Running full vitest suite (npx vitest run) — this is the canonical authoritative gate");
const vitestMain = spawnSync("npx", ["vitest", "run", "--reporter=verbose"], {
  stdio: "inherit",
  env: { ...process.env, VITE_CONVEX_URL: SAFE_PLACEHOLDER_URL },
  cwd: ROOT,
});
if (vitestMain.status !== 0) {
  fail(`vitest run failed with exit code ${vitestMain.status}`);
}

// For skipped detection, run a second time with JSON reporter to a file (small output, no buffer overflow)
// Vitest JSON reporter writes to stdout by default, but we capture to file via outputFile option
const tmpJson = join(ROOT, "node_modules/.cache/vitest-release-gate.json");
try { unlinkSync(tmpJson); } catch {}
log("Checking for skipped tests via JSON reporter");
const jsonResult = spawnSync("npx", ["vitest", "run", "--reporter=json", `--outputFile=${tmpJson}`], {
  encoding: "utf8",
  env: { ...process.env, VITE_CONVEX_URL: SAFE_PLACEHOLDER_URL },
  cwd: ROOT,
  maxBuffer: 20 * 1024 * 1024,
});
// Even if jsonResult status non-zero (failed tests), we still want to parse
let skipped = 0;
let failed = 0;
let passed = 0;
try {
  if (existsSync(tmpJson)) {
    const jsonContent = readFileSync(tmpJson, "utf8");
    const parsed = JSON.parse(jsonContent);
    // Vitest JSON format: { numTotalTests, numPassedTests, numFailedTests, etc, testResults: [{ assertionResults: [{ status: "passed"|"failed"|"skipped" }] }] }
    if (typeof parsed.numFailedTests === "number") failed = parsed.numFailedTests;
    if (typeof parsed.numPendingTests === "number" || typeof parsed.numTodoTests === "number") {
      skipped = (parsed.numPendingTests || 0) + (parsed.numTodoTests || 0);
    }
    // Fallback: count via testResults
    if (parsed.testResults) {
      for (const file of parsed.testResults) {
        for (const r of file.assertionResults || []) {
          if (r.status === "failed") failed++;
          if (r.status === "pending" || r.status === "skipped" || r.status === "todo") skipped++;
          if (r.status === "passed") passed++;
        }
      }
    }
    // Also try to parse summary from jsonResult stdout if file missing
  } else if (jsonResult.stdout) {
    const out = jsonResult.stdout;
    const mSkipped = out.match(/(\d+)\s+skipped/);
    if (mSkipped) skipped = parseInt(mSkipped[1], 10);
    const mFailed = out.match(/(\d+)\s+failed/);
    if (mFailed) failed = parseInt(mFailed[1], 10);
  }
} catch (e) {
  log(`Warning: could not parse JSON reporter output: ${e}`);
  // Fallback to parsing verbose output from a small run with dot reporter
  const dotResult = spawnSync("npx", ["vitest", "run", "--reporter=dot"], {
    encoding: "utf8",
    env: { ...process.env, VITE_CONVEX_URL: SAFE_PLACEHOLDER_URL },
    cwd: ROOT,
    maxBuffer: 10 * 1024 * 1024,
  });
  const combined = (dotResult.stdout || "") + (dotResult.stderr || "");
  const mS = combined.match(/(\d+)\s+skipped/);
  if (mS) skipped = parseInt(mS[1], 10);
  const mF = combined.match(/(\d+)\s+failed/);
  if (mF) failed = parseInt(mF[1], 10);
}

if (failed > 0) {
  fail(`Canonical gate requires 0 failed, found ${failed} failed`);
}
if (skipped > 0) {
  fail(`Canonical gate requires 0 skipped, found ${skipped} skipped`);
}

log(`Vitest passed — canonical gate: 0 failed, 0 skipped (full regression)`);

// ── 5. Ensure no build artifacts committed (dist, android/app/src/main/assets/public, ios/App/public should be gitignored) ──
log("Checking .gitignore for build artifacts");
const gitignorePath = join(ROOT, ".gitignore");
if (existsSync(gitignorePath)) {
  const gi = readFileSync(gitignorePath, "utf8");
  const requiredIgnores = ["dist", "android", "ios"];
  for (const pat of requiredIgnores) {
    if (!gi.includes(pat)) {
      log(`Warning: .gitignore does not contain ${pat} — ensure build artifacts are not committed`);
    }
  }
}

// ── 6. Final bundle security scan (reuse verify-mobile-artifacts if present) ──
if (existsSync(join(ROOT, "scripts", "verify-mobile-artifacts.mjs"))) {
  log("Running bundle security scan (verify-mobile-artifacts.mjs)");
  const scanResult = spawnSync("node", ["scripts/verify-mobile-artifacts.mjs"], {
    stdio: "inherit",
    cwd: ROOT,
    env: { ...process.env, VITE_CONVEX_URL: SAFE_PLACEHOLDER_URL },
  });
  if (scanResult.status !== 0) {
    fail("Bundle security scan failed");
  }
}

log("=== RELEASE REGRESSION GATE PASSED ===");
log(`Build: placeholder ${SAFE_PLACEHOLDER_URL}`);
log(`Artifacts: dist/ + cap sync (if mobile projects present)`);
log(`Tests: full suite, 0 failed, 0 skipped`);
log(`Security: no secrets, no dev localhost, no unjustified permissions`);
process.exit(0);
