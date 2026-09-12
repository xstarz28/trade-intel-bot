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
  // Quoted value:  TWELVE_DATA_API_KEY: "abcd1234..."
  { name: "provider API key assignment", re: /(TWELVE_DATA|ALPHA_VANTAGE|COINGLASS|TICKATLAS|EIA|OTP_EMAIL)_API_KEY\s*[:=]\s*["'][^"']{8,}["']/i },
  // Phase 182: bare/env-style value, e.g. a .env line or an embedded
  // "KEY=abcd1234" inside another string. Found by mutation testing — the
  // quoted-value pattern above missed it, so a dotenv file copied into a
  // packaged artifact would have passed the scan.
  { name: "provider API key (env-style value)", re: /(TWELVE_DATA|ALPHA_VANTAGE|COINGLASS|TICKATLAS|EIA|OTP_EMAIL)_API_KEY\s*=\s*[A-Za-z0-9_\-.]{8,}/i },
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
  // Phase 182 — the desktop shell is held to the identical standard. It wraps
  // the same dist/, so a secret that reached the web bundle would reach the
  // Windows installer too.
  { label: "desktop shell (src-tauri)", dir: join(ROOT, "src-tauri") },
];

for (const { label, dir } of scanTargets) {
  if (!existsSync(dir)) {
    notes.push(`${label}: not present (skipped)`);
    continue;
  }
  // Phase 182: also scan dotenv-style files by NAME. Found by mutation
  // testing — `.env.production` has extname ".production", which is not in
  // the extension allowlist, so a real dotenv file copied into a packaged
  // artifact was never read at all. That is exactly the file most likely to
  // carry a live provider key.
  const isEnvFile = (f) => /(^|\/)\.env(\.|$)/.test(f);
  const files = walk(dir).filter(
    (f) => TEXT.has(extname(f)) || extname(f) === "" || isEnvFile(f),
  );
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
    // `src-tauri/tauri.conf.json` is BUILD configuration, not a shipped
    // artifact. Its `devUrl` is consumed only by `tauri dev`; `tauri build`
    // bundles `frontendDist` instead, and the string never reaches the
    // installer. Verified: localhost:5173 does not appear in dist/. Section 9
    // below still validates devUrl's shape, so this is a narrowing of scope,
    // not a hole — any OTHER localhost reference in that file still fails.
    const devUrlLine = /"devUrl"\s*:\s*"http:\/\/localhost:\d+"/;
    const scanText = rel === "src-tauri/tauri.conf.json" ? text.replace(devUrlLine, '"devUrl": ""') : text;

    for (const { name, re } of DEV_PATTERNS) {
      if (re.test(scanText)) problems.push(`DEV-DEP ${name} in ${rel}`);
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

// ── 7. Deep-link association files (Phase 180) ───────────────────
// These exist so hosting can serve them, but they carry PLACEHOLDERS until
// the release cert and Apple Team ID are known. Shipping a placeholder as if
// it were configured would let someone believe App/Universal Links are live.
const assetlinks = join(ROOT, "public/.well-known/assetlinks.json");
const aasa = join(ROOT, "public/.well-known/apple-app-site-association");

if (existsSync(assetlinks)) {
  const text = readText(assetlinks);
  try {
    const parsed = JSON.parse(text);
    const pkg = parsed?.[0]?.target?.package_name;
    if (pkg !== "app.xstarz.analysis") {
      problems.push(`DEEPLINK assetlinks.json package_name is "${pkg}", expected app.xstarz.analysis`);
    }
  } catch {
    problems.push("DEEPLINK assetlinks.json is not valid JSON");
  }
  if (text.includes("REPLACE_WITH_RELEASE_CERT_SHA256")) {
    notes.push("assetlinks.json: PLACEHOLDER cert fingerprint — App Links NOT verified");
  }
}

if (existsSync(aasa)) {
  const text = readText(aasa);
  try {
    const parsed = JSON.parse(text);
    const appId = parsed?.applinks?.details?.[0]?.appID ?? "";
    if (!appId.endsWith("app.xstarz.analysis")) {
      problems.push(`DEEPLINK apple-app-site-association appID "${appId}" does not end with the bundle id`);
    }
  } catch {
    problems.push("DEEPLINK apple-app-site-association is not valid JSON");
  }
  if (text.includes("REPLACE_WITH_APPLE_TEAM_ID")) {
    notes.push("apple-app-site-association: PLACEHOLDER Team ID — Universal Links NOT verified");
  }
}

// ── 8. Server-only variables must never reach a client artifact ──
// Phase 180 classification D: these names must not appear in anything the
// browser or a packaged app can read.
const SERVER_ONLY_VARS = [
  "TWELVE_DATA_API_KEY", "ALPHA_VANTAGE_API_KEY", "COINGLASS_API_KEY",
  "TICKATLAS_API_KEY", "EIA_API_KEY", "OTP_EMAIL_API_KEY",
  "CONVEX_DEPLOY_KEY", "JWT_PRIVATE_KEY", "JWKS",
];
//
// IMPORTANT: a bare mention of the NAME is not a leak. The UI legitimately
// tells an operator "Check that TWELVE_DATA_API_KEY is configured in the Keys
// tab", and that string is translated into all nine locales. Flagging it
// would train everyone to ignore this scanner. What matters is the VALUE
// being assigned, or the client READING the variable — either of which means
// a server-only secret reached the client.
for (const { label, dir } of scanTargets) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir).filter((f) => TEXT.has(extname(f)))) {
    const text = readText(file);
    for (const v of SERVER_ONLY_VARS) {
      // Assigned a non-empty literal: KEY="...", KEY: '...', KEY=`...`
      const assigned = new RegExp(`${v}["'\`]?\\s*[:=]\\s*["'\`][^"'\`]{4,}`);
      // Read from an env object in client code.
      const read = new RegExp(`(process\\.env|import\\.meta\\.env)\\.${v}\\b`);
      if (assigned.test(text)) {
        problems.push(`ENV server-only ${v} has a VALUE in ${file.replace(`${ROOT}/`, "")} (${label})`);
      } else if (read.test(text)) {
        problems.push(`ENV client reads server-only ${v} in ${file.replace(`${ROOT}/`, "")} (${label})`);
      }
    }
  }
}

// Only VITE_-prefixed variables may be inlined into a client bundle at all.
for (const { label, dir } of scanTargets) {
  if (!existsSync(dir)) continue;
  for (const file of walk(dir).filter((f) => extname(f) === ".js")) {
    const text = readText(file);
    const inlined = [...text.matchAll(/import\.meta\.env\.([A-Z_][A-Z0-9_]*)/g)].map((m) => m[1]);
    for (const name of new Set(inlined)) {
      if (!name.startsWith("VITE_") && name !== "DEV" && name !== "PROD" && name !== "MODE" && name !== "SSR" && name !== "BASE_URL") {
        problems.push(`ENV non-VITE variable ${name} read from client bundle ${file.replace(`${ROOT}/`, "")} (${label})`);
      }
    }
  }
}

// ── 9. Desktop shell configuration (Phase 182) ───────────────────
// The desktop wrapper must load the bundled production build, never a dev
// server, and must not widen the OS surface exposed to web content.
const tauriConf = join(ROOT, "src-tauri/tauri.conf.json");
if (existsSync(tauriConf)) {
  const raw = readText(tauriConf);
  let conf;
  try {
    conf = JSON.parse(raw);
  } catch {
    problems.push("DESKTOP tauri.conf.json is not valid JSON");
  }

  if (conf) {
    // frontendDist must point at the shared build output.
    if (conf.build?.frontendDist !== "../dist") {
      problems.push(`DESKTOP frontendDist must be "../dist" (found ${JSON.stringify(conf.build?.frontendDist)}) — the desktop app must ship the same web build`);
    }

    // A production bundle that points at a dev server is the desktop
    // equivalent of Capacitor's server.url, and just as unacceptable.
    const devUrl = conf.build?.devUrl ?? "";
    if (devUrl && !/^http:\/\/localhost:\d+$/.test(devUrl)) {
      problems.push(`DESKTOP devUrl must be a plain localhost dev server or absent (found ${devUrl})`);
    }

    // Identity and naming.
    if (conf.identifier !== "app.xstarz.analysis.desktop") {
      problems.push(`DESKTOP identifier is ${JSON.stringify(conf.identifier)}, expected app.xstarz.analysis.desktop`);
    }
    if (conf.productName !== "Xstarz Analysis") {
      problems.push(`DESKTOP productName is ${JSON.stringify(conf.productName)}, expected "Xstarz Analysis"`);
    }

    // Microsoft Store rejects a publisher equal to the product name.
    const publisher = conf.bundle?.publisher;
    if (!publisher) {
      problems.push("DESKTOP bundle.publisher is required for Windows installer metadata");
    } else if (publisher === conf.productName) {
      problems.push("DESKTOP bundle.publisher must differ from productName (Microsoft Store requirement)");
    }

    // Version metadata must exist for upgrade/uninstall behaviour.
    if (!/^\d+\.\d+\.\d+$/.test(conf.version ?? "")) {
      problems.push(`DESKTOP version must be semver (found ${JSON.stringify(conf.version)})`);
    }

    // No signing material may ever be committed.
    if (conf.bundle?.windows?.certificateThumbprint) {
      problems.push("DESKTOP certificateThumbprint is committed — signing material must not be in source control");
    }

    // An updater endpoint would be a self-update channel; it must be a
    // deliberate, reviewed addition rather than an accident.
    if (conf.plugins?.updater) {
      problems.push("DESKTOP updater plugin configured — auto-update is documented but intentionally not implemented yet");
    }

    notes.push(`desktop identifier: ${conf.identifier} (publisher: ${publisher})`);
    notes.push(`desktop bundle targets: ${JSON.stringify(conf.bundle?.targets)}`);
  }
} else {
  notes.push("desktop shell: not present (skipped)");
}

// Capability permissions: deny anything that hands the OS to web content.
const capsDir = join(ROOT, "src-tauri/capabilities");
if (existsSync(capsDir)) {
  const FORBIDDEN_PERMISSION_PREFIXES = [
    "shell:",       // process execution
    "fs:",          // filesystem access
    "http:",        // bypasses the app's own network layer
    "process:",
  ];
  for (const file of walk(capsDir).filter((f) => extname(f) === ".json")) {
    let cap;
    try {
      cap = JSON.parse(readText(file));
    } catch {
      problems.push(`DESKTOP capability ${file.replace(`${ROOT}/`, "")} is not valid JSON`);
      continue;
    }
    const perms = (cap.permissions ?? []).map((p) => (typeof p === "string" ? p : p.identifier ?? ""));
    for (const perm of perms) {
      if (FORBIDDEN_PERMISSION_PREFIXES.some((pre) => perm.startsWith(pre))) {
        problems.push(`DESKTOP capability grants "${perm}" — filesystem/shell/process/http access must not be exposed to web content`);
      }
    }
    notes.push(`desktop capabilities (${cap.identifier}): ${perms.length} permission(s)`);
  }
}

// ── Report ───────────────────────────────────────────────────────
console.log("Artifact verification — mobile (Phase 179) + desktop (Phase 182)\n");
for (const n of notes) console.log(`  · ${n}`);
console.log("");
if (problems.length === 0) {
  console.log("PASS — no secrets, dev dependencies, or unjustified permissions found.");
  process.exit(0);
}
console.log(`FAIL — ${problems.length} issue(s):`);
for (const p of problems) console.log(`  ✗ ${p}`);
process.exit(1);
