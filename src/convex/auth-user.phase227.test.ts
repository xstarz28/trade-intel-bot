/**
 * Phase 227 — typed owner resolution for user-scoped Convex tables.
 *
 * Two defects surfaced when the `any`s came out:
 *
 *  1. alertRules / notifications / notificationPreferences / runtimeHealth
 *     used `identity.subject` as the `userId` column (needed `as any` to
 *     compile). Convex Auth mints subject = `userId|sessionId`, so those
 *     tables were keyed per SESSION: each re-login orphaned the previous
 *     rows. They now go through `authUserId()` (= library `getAuthUserId`).
 *
 *  2. journal.transition / journal.updateFields patched
 *     `{"timestamps.updatedAt": now}` behind `Record<string, any>`. Convex
 *     `db.patch` has no dotted-path semantics, so this wrote a literal
 *     top-level key and never updated `timestamps.updatedAt`.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { authUserId, resolveUser } from "./lib/authUser";
import { testIdentitySubject } from "./lib/identitySubject";

const read = (p: string) => readFileSync(p, "utf8");

interface FakeUser { _id: string; email?: string }

function fakeCtx(identity: { subject: string; email?: string } | null, users: FakeUser[]) {
  return {
    auth: { getUserIdentity: async () => identity },
    db: {
      get: async (id: string) => users.find((u) => u._id === id) ?? null,
      query: (_table: string) => ({
        withIndex: (_name: string, fn: (q: { eq: (f: string, v: unknown) => unknown }) => unknown) => {
          let wanted: unknown;
          fn({ eq: (_f, v) => { wanted = v; return {}; } });
          return { unique: async () => users.find((u) => u.email === wanted) ?? null };
        },
      }),
    },
  };
}
type Ctx = Parameters<typeof resolveUser>[0];

describe("227 — authUserId extracts the user id, never the composite subject", () => {
  it("returns the id part of `userId|sessionId`", async () => {
    const ctx = fakeCtx({ subject: testIdentitySubject("user_A", "sess_1") }, []);
    expect(await authUserId(ctx as unknown as Ctx)).toBe("user_A");
  });
  it("two sessions of the same user resolve to the same owner id (the old code keyed per session)", async () => {
    const a = await authUserId(fakeCtx({ subject: testIdentitySubject("user_A", "sess_1") }, []) as unknown as Ctx);
    const b = await authUserId(fakeCtx({ subject: testIdentitySubject("user_A", "sess_2") }, []) as unknown as Ctx);
    expect(a).toBe(b);
    expect(testIdentitySubject("user_A", "sess_1")).not.toBe(testIdentitySubject("user_A", "sess_2"));
  });
  it("null identity → null (callers return [] / null / throw, never a shared bucket)", async () => {
    expect(await authUserId(fakeCtx(null, []) as unknown as Ctx)).toBeNull();
  });
});

describe("227 — resolveUser (shared) keeps the email-then-subject contract", () => {
  const users: FakeUser[] = [{ _id: "user_A", email: "a@x.io" }, { _id: "user_B" }];
  it("email match wins", async () => {
    const u = await resolveUser(fakeCtx({ subject: testIdentitySubject("user_B"), email: "a@x.io" }, users) as unknown as Ctx);
    expect(u?._id).toBe("user_A");
  });
  it("falls back to the id split from the subject", async () => {
    const u = await resolveUser(fakeCtx({ subject: testIdentitySubject("user_B") }, users) as unknown as Ctx);
    expect(u?._id).toBe("user_B");
  });
  it("never looks up the raw composite subject", async () => {
    const seen: string[] = [];
    const ctx = fakeCtx({ subject: testIdentitySubject("user_B") }, users);
    const origGet = ctx.db.get; ctx.db.get = async (id: string) => { seen.push(id); return origGet(id); };
    await resolveUser(ctx as unknown as Ctx);
    expect(seen).toEqual(["user_B"]);
  });
  it("unknown id / empty subject → null", async () => {
    expect(await resolveUser(fakeCtx({ subject: testIdentitySubject("ghost") }, users) as unknown as Ctx)).toBeNull();
    expect(await resolveUser(fakeCtx({ subject: "|sess" }, users) as unknown as Ctx)).toBeNull();
    expect(await resolveUser(fakeCtx(null, users) as unknown as Ctx)).toBeNull();
  });
});

describe("227 — structural: the defects cannot come back", () => {
  const SESSION_KEYED = ["alertRules", "notifications", "notificationPreferences", "runtimeHealth"];
  it.each(SESSION_KEYED)("src/convex/%s.ts derives userId via authUserId, not identity.subject", (m) => {
    const src = read(`src/convex/${m}.ts`);
    expect(src).toContain("authUserId(ctx)");
    expect(src).not.toMatch(/getUserIdentity\(\)\)\?\.subject/);
    expect(src).not.toContain("as any");
  });
  it.each(["analyses", "journal", "positionProtection", "historicalIntelligence"])(
    "src/convex/%s.ts uses the shared typed resolveUser (no local db: any copy)", (m) => {
      const src = read(`src/convex/${m}.ts`);
      expect(src).toContain('from "./lib/authUser"');
      expect(src).not.toMatch(/db:\s*any/);
      expect(src).not.toMatch(/\(q:\s*any\)/);
    });
  it("journal.ts patches timestamps as a nested object, not a dotted key", () => {
    const src = read("src/convex/journal.ts");
    expect(src).not.toContain('"timestamps.updatedAt"');
    expect(src).toContain("timestamps: { ...entry.timestamps, updatedAt:");
    expect(src).not.toMatch(/Record<string,\s*any>/);
  });
  it("no explicit any remains in the eight touched modules", () => {
    for (const m of [...SESSION_KEYED, "analyses", "journal", "positionProtection", "historicalIntelligence", "lib/authUser"]) {
      expect(read(`src/convex/${m}.ts`), m).not.toMatch(/:\s*any\b|as any\b|<any>/);
    }
  });
});
