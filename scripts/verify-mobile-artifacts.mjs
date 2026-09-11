#!/usr/bin/env node
/**
 * Phase 179 — mobile artifact verification.
 *
 * Scans everything that will be packaged into the Android and iOS apps for
 * material that must never ship: provider credentials, localhost/dev-server
 * dependencies, editor branding, and unjustified native permissions.
 *
 * Runs on Linux with no Android SDK and no Xcode, so it is the strongest
 * check available in this environment. It is a STATIC check: it proves what
 * is in the source and copied web assets, not what a signed store build does.
 *
 * Exit code 0 = clean, 1 = at least one violation.
 */

import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = process.cwd();
const problems = [];
const notes = [];

const walk = (dir, out = []) => {
  if (!existsSync(dir)) return out;
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".git" || entry === "Pods") continue;
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
};

const TEXT = new Set([".js", ".mjs", ".cjs", ".html", ".css", ".json", ".xml", ".plist", ".gradle", ".properties", ".java", ".kt", ".swift", ".pbxproj", ".webmanifest", ".txt", ".entitlements", ".map"]);
const readText = (f) => {
  try {
    return readFileSync(f, "utf8");
  } catch {
    return "";
  }
};

// ── 1. Credential patterns ───────────────────────────────────────
// Real provider keys are long opaque tokens. These patterns target the SHAPE
// of a credential, plus the specific env names this product uses.
const SECRET_PATTERNS = [
  { name: "provider API key assignment", re: /(TWELVE_DATA|ALPHA_VANTAGE|COINGLASS|TICKATLAS|EIA|OTP_EMAIL)_API_KEY\s*[:=]\s*["'][^"']{8,}["']/i },
  { name: "bearer token", re: /Bearer\s+[A-Za-z0-9._-]{20,}/ },
  { name: "openai-style key", re: /\bsk-[A-Za-z0-9]{20,}\b/ },
  { name: "AWS access key", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "private key block", re: /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/ },
  { name: "google api key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
];

// ── 2. Dev/sandbox dependencies that must not ship ───────────────
const DEV_PATTERNS = [
  // NOTE: a bare "http://localhost" string is NOT flagged on its own.
  // React Router embeds one as the base for its internal `createPath()`
  // URL parsing; it is library-internal and never used as a network target.
  // What matters is OUR configuration pointing a real client at localhost,
  // which is assignment-shaped or carries a dev port.
  { name: "localhost as configured endpoint", re: /(url|endpoint|baseUrl|origin|host|CONVEX_URL|apiUrl)\s*[:=]\s*["'`]https?:\/\/(localhost|127\.0\.0\.1)/i },
  { name: "localhost with dev port", re: /https?:\/\/(localhost|127\.0\.0\.1):(5173|3000|8080|8100|4173)/ },
  { name: "e2b sandbox host", re: /\.e2b\.app/i },
  { name: "vite dev client", re: /@vite\/client|__vite_ping/ },
];

const scanTargets = [
  { label: "web assets (dist/)", dir: join(ROOT, "dist") },
  { label: "android project", dir: join(ROOT, "android") },
  { label: "ios project", dir: join(ROOT, "ios") },
];

for (const { label, dir } of scanTargets) {
  if (!existsSync(dir)) {
    notes.push(`${label}: not present (skipped)`);
    continue;
  }
  const files = walk(dir).filter((f) => TEXT.has(extname(f)) || extname(f) === "");
  let scanned = 0;
  for (const file of files) {
    const rel = file.replace(`${ROOT}/`, "");
    // The template documents required fields with EMPTY values; that is the
    // opposite of a leak and must not be flagged.
    if (rel.endsWith("keystore.properties.example")) continue;
    const text = readText(file);
    if (!text) continue;
    scanned++;
    for (const { name, re } of SECRET_PATTERNS) {
      if (re.test(text)) problems.push(`SECRET  ${name} in ${rel}`);
    }
    for (const { name, re } of DEV_PATTERNS) {
      if (re.test(text)) problems.push(`DEV-DEP ${name} in ${rel}`);
    }
  }
  notes.push(`${label}: ${scanned} text files scanned`);
}

// ── 3. Android permission allowlist ──────────────────────────────
const ALLOWED_ANDROID_PERMISSIONS = new Set(["android.permission.INTERNET"]);
const manifestPath = join(ROOT, "android/app/src/main/AndroidManifest.xml");
if (existsSync(manifestPath)) {
  const manifest = readText(manifestPath);
  const requested = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map((m) => m[1]);
  for (const p of requested) {
    if (!ALLOWED_ANDROID_PERMISSIONS.has(p)) {
      problems.push(`PERMISSION unjustified Android permission: ${p}`);
    }
  }
  notes.push(`android permissions: ${requested.length} requested (${requested.join(", ") || "none"})`);

  if (/android:allowBackup="true"/.test(manifest)) {
    problems.push("CONFIG  android:allowBackup=\"true\" would back up the auth session to the cloud");
  }
  if (/android:debuggable="true"/.test(manifest)) {
    problems.push("CONFIG  android:debuggable=\"true\" must never ship");
  }
} else {
  notes.push("android manifest: not present (skipped)");
}

// ── 4. iOS privacy-permission keys ───────────────────────────────
const FORBIDDEN_IOS_KEYS = [
  "NSCameraUsageDescription", "NSMicrophoneUsageDescription",
  "NSLocationWhenInUseUsageDescription", "NSLocationAlwaysAndWhenInUseUsageDescription",
  "NSPhotoLibraryUsageDescription", "NSPhotoLibraryAddUsageDescription",
  "NSContactsUsageDescription", "NSBluetoothAlwaysUsageDescription",
  "NSUserTrackingUsageDescription", "NSCalendarsUsageDescription",
  "NSRemindersUsageDescription", "NSMotionUsageDescription",
  "NSSpeechRecognitionUsageDescription", "NSHealthShareUsageDescription",
];
const plistPath = join(ROOT, "ios/App/App/Info.plist");
if (existsSync(plistPath)) {
  const plist = readText(plistPath);
  const found = FORBIDDEN_IOS_KEYS.filter((k) => plist.includes(k));
  for (const k of found) problems.push(`PERMISSION unjustified iOS permission key: ${k}`);
  notes.push(`ios privacy keys: ${found.length} present (expected 0)`);

  // A production app must not allow arbitrary cleartext HTTP.
  if (/NSAllowsArbitraryLoads<\/key>\s*<true\/>/.test(plist)) {
    problems.push("CONFIG  NSAllowsArbitraryLoads=true disables App Transport Security");
  }
} else {
  notes.push("ios Info.plist: not present (skipped)");
}

// ── 5. Capacitor must not point at a remote/dev server ───────────
const capConfig = join(ROOT, "capacitor.config.ts");
if (existsSync(capConfig)) {
  const cfg = readText(capConfig);
  if (/^\s*url\s*:/m.test(cfg)) {
    problems.push("CONFIG  capacitor.config.ts sets server.url — the packaged app would load from a remote server");
  }
  if (/webContentsDebuggingEnabled\s*:\s*true/.test(cfg)) {
    problems.push("CONFIG  webContentsDebuggingEnabled=true must not ship");
  }
}

// ── 6. Editor/platform branding in shipped web assets ────────────
const distDir = join(ROOT, "dist");
if (existsSync(distDir)) {
  for (const file of walk(distDir).filter((f) => TEXT.has(extname(f)))) {
    const text = readText(file);
    // The editor TOOLBAR must not ship. A defensive console.warn label
    // inside an error boundary is not the toolbar and carries no branding to
    // the user, so match the real module/endpoint rather than the word.
    if (/vly-toolbar-readonly|@vly-ai\/integrations|https?:\/\/[a-z0-9.-]*vly[a-z0-9.-]*\//i.test(text)) {
      problems.push(`BRANDING editor toolbar/runtime shipped in ${file.replace(`${ROOT}/`, "")}`);
    }
  }
}

// ── Report ───────────────────────────────────────────────────────
console.log("Phase 179 — mobile artifact verification\n");
for (const n of notes) console.log(`  · ${n}`);
console.log("");
if (problems.length === 0) {
  console.log("PASS — no secrets, dev dependencies, or unjustified permissions found.");
  process.exit(0);
}
console.log(`FAIL — ${problems.length} issue(s):`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(1);
