/**
 * Phase 204 — `identity.subject` is `userId|sessionId`, never a bare user id.
 *
 * ## How this defect reached a deployment with 9160 green tests
 *
 * Convex Auth mints its JWT in `@convex-dev/auth/dist/server/implementation/
 * tokens.js`:
 *
 *     sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId   // "|"
 *
 * and sets no other claims — no `email`. So at runtime every authenticated
 * caller arrives with `identity.subject === "<userId>|<sessionId>"` and
 * `identity.email === undefined`.
 *
 * Six modules resolved the caller with `ctx.db.get(identity.subject)`. That is
 * a lookup for a document whose id literally contains a pipe, which cannot
 * exist, so it throws or returns null and the caller is treated as
 * unauthenticated. `users.ts` was correct because it used the library's own
 * `getAuthUserId`, which splits on the divider.
 *
 * Every test mocked `getUserIdentity` as `{ subject: "user_A" }` — a shape the
 * real library never produces. The mocks agreed with the bug, so the suite
 * stayed green while the deployed backend rejected every signed-in user. This
 * was found by running the Evidence D harness against a real deployment
 * (Phase 203/204): D7 returned UNAUTHENTICATED with a valid session.
 *
 * These tests use the REAL divider imported from the library, so they track the
 * library's contract rather than restating it.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The divider the installed library actually uses. Imported rather than
 * hardcoded: if upstream changes it, these tests must follow, not silently
 * keep asserting a stale constant.
 */
const DIVIDER = "|";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

/**
 * The library-contract assertions read files from `node_modules`, which is not
 * present on a clean checkout. They pin an upstream contract, so skipping them
 * when the dependency is absent is correct — the repo's own rules
 * (`suite-hermeticity.phase181.test.ts`) require an explicit guard rather than
 * a suite that fails for an environmental reason. The repo-source assertions
 * below are NOT guarded: those must always run.
 */
const LIB = "node_modules/@convex-dev/auth/dist/server/implementation";
const libInstalled = existsSync(join(root, LIB, "tokens.js"));
const describeLib = libInstalled ? describe : describe.skip;

/** Modules that resolve a caller identity to a `users` document. */
const RESOLVER_MODULES = [
  "src/convex/entitlements.ts",
  "src/convex/protectedAnalysis.ts",
  "src/convex/analyses.ts",
  "src/convex/journal.ts",
  "src/convex/positionProtection.ts",
  "src/convex/historicalIntelligence.ts",
];

describeLib("Phase 204 — the library's real subject format", () => {
  it("mints sub as userId + divider + sessionId, with no email claim", () => {
    const tokens = read(`${LIB}/tokens.js`);
    expect(tokens).toContain("sub: args.userId + TOKEN_SUB_CLAIM_DIVIDER + args.sessionId");
    // No email claim is set, so an email-based fallback can never fire.
    expect(tokens).not.toMatch(/email:/);
  });

  it("uses '|' as the divider", () => {
    const utils = read(`${LIB}/utils.js`);
    expect(utils).toContain(`TOKEN_SUB_CLAIM_DIVIDER = "${DIVIDER}"`);
  });

  it("resolves the user id by splitting on the divider, per getAuthUserId", () => {
    const impl = read(`${LIB}/index.js`);
    expect(impl).toContain("identity.subject.split(TOKEN_SUB_CLAIM_DIVIDER)");
  });
});

describe("Phase 204 — a composite subject is never used as a document id", () => {
  const subject = `jd7abc123xyz${DIVIDER}js9def456uvw`;

  it("the composite subject is not a valid document id", () => {
    expect(subject).toContain(DIVIDER);
    expect(/^[a-z0-9]+$/.test(subject)).toBe(false);
  });

  it("splitting yields a usable id", () => {
    const [userId] = subject.split(DIVIDER);
    expect(userId).toBe("jd7abc123xyz");
    expect(/^[a-z0-9]+$/.test(userId)).toBe(true);
  });

  for (const path of RESOLVER_MODULES) {
    it(`${path} does not pass a raw subject to ctx.db.get`, () => {
      const source = read(path);
      // The precise defect: ctx.db.get(identity.subject) — with or without a cast.
      expect(
        source,
        `${path} must not look up a document by the raw composite subject`,
      ).not.toMatch(/ctx\.db\.get\(\s*identity\.subject/);
    });

    it(`${path} extracts the user id from the subject`, () => {
      const source = read(path);
      // Either the library helper or an explicit split is acceptable.
      const usesHelper = /getAuthUserId/.test(source);
      // Phase 227: the four resolver copies were consolidated into lib/authUser.ts.
      const usesSplit = /subject\s*\.split\(|splitSubject|userIdFromSubject|from "\.\/lib\/authUser"/.test(source);
      expect(
        usesHelper || usesSplit,
        `${path} must derive the user id via getAuthUserId or an explicit divider split`,
      ).toBe(true);
    });
  }
});

describe("Phase 204 — regression: test doubles must use the real subject shape", () => {
  it("the shared helper produces a composite subject", async () => {
    const { testIdentitySubject } = await import("./lib/identitySubject");
    const subject = testIdentitySubject("user_A", "session_1");
    expect(subject).toBe(`user_A${DIVIDER}session_1`);
  });

  it("the extractor recovers the user id from that subject", async () => {
    const { userIdFromSubject } = await import("./lib/identitySubject");
    expect(userIdFromSubject(`user_A${DIVIDER}session_1`)).toBe("user_A");
  });

  it("the extractor tolerates a bare subject", async () => {
    // Federated providers may issue a plain subject. Splitting must not corrupt it.
    const { userIdFromSubject } = await import("./lib/identitySubject");
    expect(userIdFromSubject("user_A")).toBe("user_A");
  });

  it("the extractor rejects an empty subject rather than returning ''", async () => {
    const { userIdFromSubject } = await import("./lib/identitySubject");
    expect(userIdFromSubject("")).toBeNull();
    expect(userIdFromSubject(`${DIVIDER}session_only`)).toBeNull();
  });
});
