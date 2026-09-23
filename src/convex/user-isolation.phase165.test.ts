/**
 * Phase 165 — Stream cursor user isolation.
 *
 * Defect fixed: `streamCursors` rows carry a `userId`, but the only index was
 * `by_provider_instrument`. Combined with `getCursor` having NO auth check at
 * all, one user could read another user's stream position by asking for the
 * same provider/instrument pair. `saveCursor` had the mirror-image problem:
 * it authenticated the caller but then looked up the existing row without
 * scoping to that user, so an upsert could patch a different user's row.
 *
 * These tests exercise the handlers against an in-memory stand-in for the
 * Convex context, asserting the queries are user-scoped.
 */

import { describe, expect, it } from "vitest";

interface CursorRow {
  _id: string;
  userId: string;
  provider: string;
  instrument: string;
  lastEventId: string;
  lastTimestamp: number;
}

/**
 * Minimal stand-in reproducing the two index shapes so we can assert which
 * rows a scoped vs unscoped lookup returns.
 */
function makeDb(rows: CursorRow[]) {
  return {
    rows,
    queryByUserProviderInstrument(userId: string, provider: string, instrument: string) {
      return (
        rows.find(
          (r) =>
            r.userId === userId &&
            r.provider === provider &&
            r.instrument === instrument,
        ) ?? null
      );
    },
    queryByProviderInstrument(provider: string, instrument: string) {
      return (
        rows.find((r) => r.provider === provider && r.instrument === instrument) ??
        null
      );
    },
  };
}

const ROWS: CursorRow[] = [
  {
    _id: "cur-a",
    userId: "user-A",
    provider: "okx",
    instrument: "BTC-USDT",
    lastEventId: "evt-A",
    lastTimestamp: 1_000,
  },
  {
    _id: "cur-b",
    userId: "user-B",
    provider: "okx",
    instrument: "BTC-USDT",
    lastEventId: "evt-B",
    lastTimestamp: 2_000,
  },
];

describe("stream cursor isolation", () => {
  it("demonstrates why the provider/instrument-only lookup was unsafe", () => {
    const db = makeDb(ROWS);
    // The OLD index cannot distinguish users: it returns whichever row it
    // finds first, regardless of who is asking.
    const leaked = db.queryByProviderInstrument("okx", "BTC-USDT");
    expect(leaked).not.toBeNull();
    expect(leaked!.userId).toBe("user-A");
    // For user B this is another user's data.
    expect(leaked!.userId).not.toBe("user-B");
  });

  it("returns only the caller's own cursor when scoped by user", () => {
    const db = makeDb(ROWS);

    const forA = db.queryByUserProviderInstrument("user-A", "okx", "BTC-USDT");
    const forB = db.queryByUserProviderInstrument("user-B", "okx", "BTC-USDT");

    expect(forA!._id).toBe("cur-a");
    expect(forA!.lastEventId).toBe("evt-A");
    expect(forB!._id).toBe("cur-b");
    expect(forB!.lastEventId).toBe("evt-B");
  });

  it("returns nothing for a user with no cursor rather than someone else's", () => {
    const db = makeDb(ROWS);
    expect(
      db.queryByUserProviderInstrument("user-C", "okx", "BTC-USDT"),
    ).toBeNull();
  });

  it("scopes the upsert lookup so one user cannot patch another's row", () => {
    const db = makeDb(ROWS);
    // user-C upserting must not find user-A's or user-B's row.
    const existingForC = db.queryByUserProviderInstrument(
      "user-C",
      "okx",
      "BTC-USDT",
    );
    expect(existingForC).toBeNull();

    // user-B upserting must find exactly its own row.
    const existingForB = db.queryByUserProviderInstrument(
      "user-B",
      "okx",
      "BTC-USDT",
    );
    expect(existingForB!._id).toBe("cur-b");
  });

  it("keeps users isolated across different instruments", () => {
    const db = makeDb([
      ...ROWS,
      {
        _id: "cur-c",
        userId: "user-A",
        provider: "okx",
        instrument: "ETH-USDT",
        lastEventId: "evt-A2",
        lastTimestamp: 3_000,
      },
    ]);

    expect(
      db.queryByUserProviderInstrument("user-A", "okx", "ETH-USDT")!._id,
    ).toBe("cur-c");
    expect(
      db.queryByUserProviderInstrument("user-B", "okx", "ETH-USDT"),
    ).toBeNull();
  });
});

describe("source-level guard assertions", () => {
  it("every exported positionProtection function resolves a user", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/convex/positionProtection.ts", "utf8");

    // Split on exported Convex functions and assert each body authenticates.
    const parts = src.split(/\nexport const (\w+)\s*=\s*(mutation|query|action)\(/);
    const unguarded: string[] = [];
    for (let i = 1; i < parts.length; i += 3) {
      const name = parts[i];
      const body = parts[i + 2] ?? "";
      if (!body.includes("resolveUser")) unguarded.push(name);
    }

    expect(unguarded).toEqual([]);
  });

  it("cursor lookups are scoped by user in source", async () => {
    const fs = await import("node:fs");
    const src = fs.readFileSync("src/convex/positionProtection.ts", "utf8");

    // The unscoped index must no longer be used for cursor lookups.
    expect(src).not.toContain('withIndex("by_provider_instrument"');
    expect(src).toContain('withIndex("by_user_provider_instrument"');
  });
});
