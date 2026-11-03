import { Hono } from "hono";

export interface DatabaseHealthCheck {
  query: (sql: string) => Promise<unknown>;
}

export interface AppDependencies {
  database?: DatabaseHealthCheck;
}

export function createApp(dependencies: AppDependencies = {}) {
  const app = new Hono();

  app.get("/health/live", (context) =>
    context.json({ status: "ok", service: "trade-intel-backend" }),
  );

  app.get("/health/ready", async (context) => {
    if (!dependencies.database) {
      return context.json(
        {
          status: "not_ready",
          checks: { database: "not_configured" },
        },
        503,
      );
    }

    try {
      await dependencies.database.query("SELECT 1");
      return context.json({
        status: "ready",
        checks: { database: "ok" },
      });
    } catch {
      return context.json(
        {
          status: "not_ready",
          checks: { database: "unavailable" },
        },
        503,
      );
    }
  });

  return app;
}
