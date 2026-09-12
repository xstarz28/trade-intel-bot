#!/usr/bin/env node
/**
 * Phase 180 — minimal SPA host that implements the same rewrite contract as
 * the production hosting config (`vercel.json` rewrites / `_redirects`).
 *
 * Purpose: prove that a production build served under an SPA rewrite actually
 * resolves BrowserRouter deep links (`/dashboard`, `/journal`) on direct
 * navigation and refresh — rather than only asserting that a config file
 * contains a rewrite rule.
 *
 * This is a VERIFICATION harness, not production infrastructure. Production
 * hosting is the platform's own static server; this only models its contract.
 */

import { createServer } from "node:http";
import { readFileSync, existsSync, statSync } from "node:fs";
import { join, extname, normalize } from "node:path";

const ROOT = process.argv[2] ?? "dist";
const PORT = Number(process.argv[3] ?? 4180);

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".txt": "text/plain; charset=utf-8",
};

const server = createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://internal");
  // Block traversal before touching the filesystem.
  const rel = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  const candidate = join(ROOT, rel);

  const isFile = existsSync(candidate) && statSync(candidate).isFile();

  if (isFile) {
    const ext = extname(candidate);
    res.writeHead(200, {
      "Content-Type": MIME[ext] ?? "application/octet-stream",
      // Well-known association files must be served as JSON with no redirect.
      ...(rel.includes(".well-known") ? { "Content-Type": "application/json" } : {}),
    });
    res.end(readFileSync(candidate));
    return;
  }

  // SPA rewrite: any unmatched path returns index.html with 200 (NOT 404),
  // which is what lets BrowserRouter own client-side routing.
  const index = join(ROOT, "index.html");
  if (!existsSync(index)) {
    res.writeHead(500, { "Content-Type": "text/plain" });
    res.end("no index.html");
    return;
  }
  res.writeHead(200, { "Content-Type": MIME[".html"] });
  res.end(readFileSync(index));
});

server.listen(PORT, "0.0.0.0", () => {
  console.log(`SPA host serving ${ROOT} on http://0.0.0.0:${PORT}`);
});
