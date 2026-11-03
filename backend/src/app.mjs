import { createServer } from "node:http";

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

export function createAppServer({ database }) {
  return createServer((request, response) => {
    const method = request.method ?? "GET";
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;

    if (method === "GET" && pathname === "/health/live") {
      sendJson(response, 200, {
        status: "ok",
        service: "trade-intel-backend",
      });
      return;
    }

    if (method === "GET" && pathname === "/health/ready") {
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

    sendJson(response, 404, { error: "not_found" });
  });
}
