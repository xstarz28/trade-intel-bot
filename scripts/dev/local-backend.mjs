#!/usr/bin/env node
/**
 * Phase 321 — Convex Local Deployment runner (development quota isolation).
 *
 * WHY
 * ---
 * The Convex Cloud Free deployment is disabled whenever the monthly limits
 * bind, which takes development, Arena/test workflows and the acceptance
 * harness down with it. Convex's officially supported escape is the LOCAL
 * deployment: a real Convex backend binary run on the developer machine
 * ("Convex Local Deployment"), selected by the convex CLI through
 * `CONVEX_SELF_HOSTED_URL` + `CONVEX_SELF_HOSTED_ADMIN_KEY` — a first-class
 * deployment-selection path (no cloud login, no cloud quota, no project
 * registration). Production is untouched: Vercel builds keep their existing
 * `VITE_CONVEX_URL` (the cloud deployment), and CI keeps its
 * `CONVEX_DEPLOY_KEY` flows. Local is strictly opt-in through this script and
 * its env file.
 *
 * WHAT IT DOES
 * ------------
 *   `node scripts/dev/local-backend.mjs start`   download (once, pinned) + run
 *                                                the backend + write the env file
 *   `node scripts/dev/local-backend.mjs status`  is a backend running on the port?
 *   `node scripts/dev/local-backend.mjs stop`    stop the local backend
 *   `node scripts/dev/local-backend.mjs clean`   remove local storage (fresh DB)
 *
 * DESIGN RULES
 * ------------
 *  - The backend version is PINNED here (a GitHub release tag). Deliberately
 *    NOT resolved through version.convex.dev, so the pinned flow has one
 *    network dependency: github.com release downloads.
 *  - The instance secret is generated per data directory; the admin key is
 *    derived by the binary itself (`keygen admin-key`). Both are LOCAL-ONLY
 *    values for a local-only database — but this script still never prints
 *    them; they live in `.env.local-backend` (gitignored).
 *  - Database storage lives under `.convex-local/<name>/` (gitignored). A
 *    local deployment is disposable by design: `clean` resets it.
 *  - This script NEVER touches a cloud deployment: no CONVEX_DEPLOYMENT,
 *    no CONVEX_DEPLOY_KEY, no team/project selection, no network calls to
 *    any *.convex.cloud / *.convex.dev host.
 *
 * After `start`, push the repo's functions to the local deployment (real
 * schema validation, zero cloud quota):
 *
 *   npx convex dev --env-file .env.local-backend --once --typecheck=disable
 *
 * and point a frontend dev server at it by exporting the same file's
 * `VITE_CONVEX_URL_LOCAL` (see docs/phase321-convex-local-development.md).
 */

import { spawn, spawnSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pipeline } from "node:stream/promises";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const STATE_DIR = path.join(ROOT, ".convex-local");
const ENV_FILE = path.join(ROOT, ".env.local-backend");
const PORT = Number(process.env.XSTARZ_LOCAL_CONVEX_PORT ?? 3210);

// Pinned release of get-convex/convex-backend. Bump deliberately, never "latest".
const BACKEND_RELEASE = "precompiled-2026-09-28-5c7cb5b";
const ARCH = process.arch === "arm64" ? "aarch64" : "x86_64";
const PLATFORM = process.platform === "darwin" ? "apple-darwin" : process.platform === "win32" ? "pc-windows-msvc" : "unknown-linux-gnu";
const ASSET = `convex-local-backend-${ARCH}-${PLATFORM}.zip`;
const URL = `https://github.com/get-convex/convex-backend/releases/download/${BACKEND_RELEASE}/${ASSET}`;

const INSTANCE_NAME = `xstarz-local-${crypto.randomBytes(4).toString("hex")}`;
const BINARY = path.join(STATE_DIR, "bin", BACKEND_RELEASE, "convex-local-backend" + (process.platform === "win32" ? ".exe" : ""));
const SECRET_FILE = path.join(STATE_DIR, "instance-secret");

const get = (url, redirects = 0) =>
  new Promise((resolve, reject) => {
    if (redirects > 5) return reject(new Error("too many redirects"));
    const mod = url.startsWith("https:") ? import("node:https") : import("node:http");
    mod.then((http) => {
      const req = http.get(url, { headers: { "user-agent": "xstarz-local-backend-setup" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume();
          return resolve(get(new URL(res.headers.location, url).href, redirects + 1));
        }
        resolve(res);
      });
      req.on("error", reject);
      req.setTimeout(60_000, () => req.destroy(new Error("download timed out")));
    }, reject);
  });

async function downloadWithCurl(dest) {
  // Some proxies terminate TLS for node's fetch but are trusted by the system
  // store that curl uses (and vice versa); try curl as the second path.
  const res = spawnSync("curl", ["-fsSL", "--max-time", "240", "-o", dest, URL]);
  return res.status === 0;
}

async function ensureBinary() {
  if (fs.existsSync(BINARY)) return BINARY;
  fs.mkdirSync(path.dirname(BINARY), { recursive: true });
  process.stdout.write(`downloading ${URL}\n`);
  let raw = path.join(STATE_DIR, "backend.download");
  let ok = false;
  try {
    const res = await get(URL);
    if (res.statusCode === 200) {
      await pipeline(res, fs.createWriteStream(raw));
      ok = fs.statSync(raw).size > 0;
    }
  } catch (err) {
    process.stdout.write(`direct download unavailable (${err.message}) — trying curl\n`);
  }
  if (!ok) ok = await downloadWithCurl(raw);
  if (!ok) {
    fs.rmSync(raw, { force: true });
    throw new Error(
      `could not download ${ASSET} — network must allow github.com release assets ` +
        `(Arena sandboxes block release-assets.githubusercontent.com; run this on a dev machine or in CI)`,
    );
  }
  // The release asset may be gzip-encoded or a raw binary; accept both.
  try {
    const gz = fs.createWriteStream(BINARY);
    await pipeline(fs.createReadStream(raw), zlib.createGunzip(), gz);
  } catch {
    fs.copyFileSync(raw, BINARY);
  }
  fs.rmSync(raw, { force: true });
  if (fs.statSync(BINARY).size < 1_000_000) throw new Error("downloaded binary looks wrong (too small)");
  fs.chmodSync(BINARY, 0o755);
  return BINARY;
}

function readSecret() {
  if (fs.existsSync(SECRET_FILE)) return fs.readFileSync(SECRET_FILE, "utf8").trim();
  const secret = crypto.randomBytes(32).toString("hex");
  fs.mkdirSync(STATE_DIR, { recursive: true });
  fs.writeFileSync(SECRET_FILE, secret + "\n");
  return secret;
}

async function adminKeyFor(binary, name, secret) {
  const res = spawnSync(binary, ["keygen", "admin-key", "--instance-name", name, "--instance-secret", secret]);
  if (res.status !== 0) {
    throw new Error(`keygen failed: ${res.stderr?.toString() ?? res.error ?? "unknown error"}`);
  }
  return res.stdout.toString().trim();
}

function httpStatus(url) {
  return new Promise((resolve) => {
    import("node:http").then((http) => {
      const req = http.get(url, (res) => {
        res.resume();
        resolve(res.statusCode);
      });
      req.on("error", () => resolve(0));
      req.setTimeout(5_000, () => req.destroy(new Error("timeout")));
    });
  });
}

async function start() {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const binary = await ensureBinary();
  const secret = readSecret();
  const status = await httpStatus(`http://127.0.0.1:${PORT}/instance_name`);
  if (status === 200) {
    process.stdout.write(`a local backend already answers on port ${PORT} — reusing it\n`);
  } else {
    const storage = path.join(STATE_DIR, "storage");
    fs.mkdirSync(storage, { recursive: true });
    const log = fs.openSync(path.join(STATE_DIR, "backend.log"), "a");
    const child = spawn(
      binary,
      [
        "--port", String(PORT),
        "--instance-name", INSTANCE_NAME,
        "--instance-secret", secret,
        "--local-storage", path.join(storage, "local_storage"),
        path.join(storage, "convex_local_backend.sqlite3"),
      ],
      { detached: true, stdio: ["ignore", log, log] },
    );
    child.unref();
    let up = false;
    for (let i = 0; i < 60 && !up; i++) {
      await new Promise((r) => setTimeout(r, 500));
      up = (await httpStatus(`http://127.0.0.1:${PORT}/instance_name`)) === 200;
    }
    if (!up) throw new Error(`local backend did not become ready on port ${PORT} — see .convex-local/backend.log`);
    process.stdout.write(`local backend running (pid ${child.pid}) on http://127.0.0.1:${PORT}\n`);
  }
  const adminKey = await adminKeyFor(binary, INSTANCE_NAME, secret);
  fs.writeFileSync(
    ENV_FILE,
    [
      "# Phase 321 — LOCAL development deployment ONLY (gitignored).",
      "# Selects the local Convex backend for convex CLI commands via the CLI's",
      "# self-hosted deployment-selection path. Never used by Vercel builds or CI.",
      `CONVEX_SELF_HOSTED_URL=http://127.0.0.1:${PORT}`,
      `CONVEX_SELF_HOSTED_ADMIN_KEY=${adminKey}`,
      "",
    ].join("\n"),
  );
  process.stdout.write(`wrote ${path.relative(ROOT, ENV_FILE)} (values local-only, not printed)\n`);
  process.stdout.write(`next: npx convex dev --env-file .env.local-backend --once --typecheck=disable\n`);
}

async function status() {
  const code = await httpStatus(`http://127.0.0.1:${PORT}/instance_name`);
  process.stdout.write(`port ${PORT}: HTTP ${code} ${code === 200 ? "(local backend running)" : "(no backend)"}\n`);
  process.stdout.write(`binary: ${fs.existsSync(BINARY) ? "downloaded" : "not downloaded"}\n`);
  process.stdout.write(`env file: ${fs.existsSync(ENV_FILE) ? "present" : "absent"}\n`);
  return code === 200 ? 0 : 1;
}

function stop() {
  // Best-effort: kill any local-backend process we started (matched by storage path).
  const res = spawnSync("pkill", ["-f", STATE_DIR]);
  process.stdout.write(res.status === 0 ? "stopped\n" : "no matching process found\n");
}

function clean() {
  stop();
  const storage = path.join(STATE_DIR, "storage");
  fs.rmSync(storage, { recursive: true, force: true });
  process.stdout.write("local storage removed (fresh database on next start)\n");
}

const command = process.argv[2] ?? "status";
try {
  if (command === "start") await start();
  else if (command === "status") process.exit(await status());
  else if (command === "stop") stop();
  else if (command === "clean") clean();
  else {
    process.stderr.write(`unknown command: ${command}\nusage: local-backend.mjs [start|status|stop|clean]\n`);
    process.exit(2);
  }
} catch (err) {
  process.stderr.write(`local-backend: ${err.message}\n`);
  process.exit(1);
}
