import { createServer } from "node:http";
import { createAuthHandler } from "./auth.mjs";

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

export function createAppServer({ database, env = process.env, fetchImpl = fetch }) {
  const authHandler = createAuthHandler({ database, env, fetchImpl });
  const configuredOrigin = env.APP_ORIGIN?.trim();
  const allowedOrigin = configuredOrigin || (
    env.NODE_ENV === "production" ? "" : "http://localhost:5173"
  );

  return createServer(async (request, response) => {
    const origin = request.headers.origin;
    if (origin && allowedOrigin && origin === allowedOrigin) {
      response.setHeader("access-control-allow-origin", allowedOrigin);
      response.setHeader("access-control-allow-credentials", "true");
      response.setHeader("access-control-allow-methods", "GET, POST, OPTIONS");
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

    if (!database && url.pathname.startsWith("/api/v1/auth/")) {
      sendJson(response, 503, { error: "database_not_configured" });
      return;
    }

    if (!database) {
      sendJson(response, 404, { error: "not_found" });
      return;
    }

    try {
      if (await authHandler(request, response, url)) return;
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
