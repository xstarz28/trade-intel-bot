import { createServer } from "node:http";
import { createReadStream, existsSync, statSync } from "node:fs";
import { extname, resolve, sep } from "node:path";
import { createAuthHandler } from "./auth.mjs";
import { createDomainHandler } from "./domain.mjs";
import { createPositionHandler } from "./positions.mjs";
import { createAlertHandler } from "./alerts.mjs";
import { createMarketDataHandler } from "./market-data.mjs";
import { createFundamentalsHandler } from "./fundamentals.mjs";
import { createHistoryHandler } from "./history.mjs";
import { createAccountExportHandler } from "./account-export.mjs";
import { createAccountImportHandler } from "./account-import.mjs";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8",
};

function serveStatic(request,response,pathname,staticDirectory) {
  if (!staticDirectory || !["GET","HEAD"].includes(request.method ?? "GET")) return false;
  if (pathname.startsWith("/api/")) return false;

  let decoded;
  try { decoded=decodeURIComponent(pathname); }
  catch { sendJson(response,400,{error:"invalid_path"}); return true; }

  const root=resolve(staticDirectory);
  const candidate=resolve(root,`.${decoded}`);
  if (candidate!==root && !candidate.startsWith(root+sep)) {
    sendJson(response,403,{error:"path_not_allowed"});
    return true;
  }

  let file=candidate;
  if (!existsSync(file) || !statSync(file).isFile()) {
    if (extname(decoded)) {
      sendJson(response,404,{error:"asset_not_found"});
      return true;
    }
    file=resolve(root,"index.html");
  }
  if (!existsSync(file) || !statSync(file).isFile()) {
    sendJson(response,404,{error:"frontend_build_not_found"});
    return true;
  }

  const extension=extname(file).toLowerCase();
  const immutable=/\.[a-f0-9]{8,}\./i.test(file);
  response.writeHead(200,{
    "content-type":MIME_TYPES[extension]??"application/octet-stream",
    "cache-control":extension===".html"?"no-cache":immutable?"public, max-age=31536000, immutable":"public, max-age=3600",
    "x-content-type-options":"nosniff",
    "referrer-policy":"strict-origin-when-cross-origin",
    "x-frame-options":"DENY",
    "permissions-policy":"camera=(), microphone=(), geolocation=()",
  });
  if (request.method==="HEAD") { response.end(); return true; }
  createReadStream(file).pipe(response);
  return true;
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

export function createAppServer({ database, env = process.env, fetchImpl = fetch, staticDirectory }) {
  const authHandler = createAuthHandler({ database, env, fetchImpl });
  const domainHandler = database ? createDomainHandler({ database, env }) : null;
  const positionHandler = database ? createPositionHandler({ database, env }) : null;
  const alertHandler = database ? createAlertHandler({ database, env }) : null;
  const marketDataHandler = database ? createMarketDataHandler({ database, env, fetchImpl }) : null;
  const fundamentalsHandler = database ? createFundamentalsHandler({ database, env }) : null;
  const historyHandler = database ? createHistoryHandler({ database, env }) : null;
  const accountExportHandler = database ? createAccountExportHandler({ database, env }) : null;
  const accountImportHandler = database ? createAccountImportHandler({ database, env }) : null;
  const configuredOrigin = env.APP_ORIGIN?.trim();
  const allowedOrigin = configuredOrigin || (
    env.NODE_ENV === "production" ? "" : "http://localhost:5173"
  );

  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigin && origin === allowedOrigin) {
      response.setHeader("access-control-allow-origin", allowedOrigin);
      response.setHeader("access-control-allow-credentials", "true");
      response.setHeader("access-control-allow-methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS");
      response.setHeader("access-control-allow-headers", "content-type");
      response.setHeader("vary", "Origin");
    }

    if (request.method === "OPTIONS") {
      if (!origin || !allowedOrigin || origin !== allowedOrigin) {
        sendJson(response, 403, { error: "origin_not_allowed" });
        return;
      }
      response.writeHead(204, { "cache-control": "no-store" });
      response.end();
      return;
    }

    const method = request.method ?? "GET";
    const url = new URL(request.url ?? "/", "http://localhost");

    if (method === "GET" && url.pathname === "/health/live") {
      sendJson(response, 200, {
        status: "ok",
        service: "trade-intel-backend",
      });
      return;
    }

    if (method === "GET" && url.pathname === "/health/ready") {
      if (!database) {
        sendJson(response, 503, {
          status: "not_ready",
          checks: { database: "not_configured" },
        });
        return;
      }

      try {
        database.check();
        sendJson(response, 200, {
          status: "ready",
          checks: { database: "ok" },
        });
      } catch {
        sendJson(response, 503, {
          status: "not_ready",
          checks: { database: "unavailable" },
        });
      }
      return;
    }

    if (!database && url.pathname.startsWith("/api/v1/")) {
      sendJson(response, 503, { error: "database_not_configured" });
      return;
    }

    if (!database) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    try {
      if (await authHandler(request, response, url)) return;
      if (accountExportHandler && await accountExportHandler(request, response, url)) return;
      if (accountImportHandler && await accountImportHandler(request, response, url)) return;
      if (domainHandler && await domainHandler(request, response, url)) return;
      if (positionHandler && await positionHandler(request, response, url)) return;
      if (alertHandler && await alertHandler(request, response, url)) return;
      if (marketDataHandler && await marketDataHandler(request, response, url)) return;
      if (fundamentalsHandler && await fundamentalsHandler(request, response, url)) return;
      if (historyHandler && await historyHandler(request, response, url)) return;
      if (url.pathname.startsWith("/api/")) { sendJson(response, 404, { error: "not_found" }); return; }
      if (serveStatic(request,response,url.pathname,staticDirectory)) return;
      sendJson(response, 404, { error: "not_found" });
    } catch (error) {
      console.error("[backend] Unhandled request failure:", error);
      if (!response.headersSent) {
        sendJson(response, 500, { error: "internal_server_error" });
      } else {
        response.destroy();
      }
    }
  });
}
