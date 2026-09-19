/**
 * Phase 200 — codegen authority and the post-unblock recovery contract.
 *
 * After official Convex access exists, `npx convex codegen` becomes the ONLY
 * authority for `src/convex/_generated/*`. This file encodes what must be true
 * before that happens and what must become true after, so the handoff does not
 * depend on anyone remembering the Phase 187 workaround.
 *
 * The tests are deliberately two-sided:
 *
 *   - while codegen is unavailable, the workaround must stay exactly as it is
 *     (removing it now would break the runtime, and hand-patching `_generated`
 *     is forbidden);
 *   - once codegen has run, the workaround must be gone and replaced by the
 *     official `internal.*` shape.
 *
 * The second set is expressed as an explicit, executable assertion that flips
 * on automatically when the generated file stops being a placeholder — see
 * `officialCodegenHasRun()`. Nothing here edits a generated file.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = process.cwd();
const read = (p: string) => readFileSync(join(root, p), "utf8");

const EMAIL_OTP = "src/convex/auth/emailOtp.ts";
const API_DTS = "src/convex/_generated/api.d.ts";
const LIMITER = "src/convex/otpLimiter.ts";

/** The string-addressed reference Phase 187 had to use. */
const WORKAROUND_REF = 'makeFunctionReference<';
const WORKAROUND_PATH = '"otpLimiter:consumeResendAllowance"';
/** The shape official codegen makes available. */
const OFFICIAL_REF = "internal.otpLimiter.consumeResendAllowance";

/**
 * Has the migration to official codegen STARTED?
 *
 * Keyed on the appearance of the official `internal.*` reference alone —
 * deliberately NOT on the workaround also being absent.
 *
 * An earlier version required both (official present AND workaround gone),
 * which made the post-codegen contract unfalsifiable: a half-finished
 * migration that added `internal.otpLimiter.*` while leaving the string
 * reference in place looked "not yet migrated", so every assertion below
 * returned early and the suite stayed green. A mutation proved it. The
 * trigger is now the *start* of the migration, so a half-migration is exactly
 * what gets caught.
 */
function officialCodegenHasRun(): boolean {
  // Must look at CODE, not prose: the workaround's own comment names the
  // official reference (it documents its own replacement), so a naive
  // substring match fires on the comment that exists precisely because the
  // migration has NOT happened.
  return stripComments(read(EMAIL_OTP)).includes(OFFICIAL_REF);
}

/** Remove block and line comments so assertions read executable code only. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

describe("Phase 200 — generated files stay generated", () => {
  it("_generated/api.d.ts declares otpLimiter, and a real source module backs it", () => {
    const api = read(API_DTS);
    expect(api).toContain("otpLimiter");

    // A generated entry pointing at a module that does not exist would be the
    // actual danger: type-level success, runtime failure on first OTP send.
    const limiter = read(LIMITER);
    expect(limiter).toMatch(/export\s+const\s+consumeResendAllowance\s*=\s*internalMutation/);
  });

  it("every module named in api.d.ts has a source file (no phantom entries)", () => {
    const api = read(API_DTS);
    const imports = [...api.matchAll(/import type \* as ([A-Za-z0-9_]+) from "\.\.\/([A-Za-z0-9_/]+)\.js"/g)];
    expect(imports.length).toBeGreaterThan(15);

    const missing: string[] = [];
    for (const match of imports) {
      const modulePath = match[2];
      try {
        read(`src/convex/${modulePath}.ts`);
      } catch {
        missing.push(modulePath);
      }
    }
    expect(missing, `api.d.ts names modules with no source file: ${missing.join(", ")}`).toEqual([]);
  });

  it("no source module is missing from api.d.ts (drift in the other direction)", () => {
    // Kept in sync with the Phase 175 integrity guard's exclusions.
    const api = read(API_DTS);
    const declared = new Set(
      [...api.matchAll(/import type \* as [A-Za-z0-9_]+ from "\.\.\/([A-Za-z0-9_/]+)\.js"/g)].map(
        (m) => m[1],
      ),
    );
    // Spot-check the modules the production runtime depends on. A full walk is
    // already covered by generated-api-integrity.phase175.test.ts; duplicating
    // it here would add maintenance cost without adding signal.
    for (const required of ["entitlements", "protectedAnalysis", "otpLimiter", "auth/emailOtp"]) {
      expect(declared, `${required} missing from api.d.ts`).toContain(required);
    }
  });
});

describe("Phase 200 — the Phase 187 workaround is recorded, not silently kept", () => {
  it("documents why the string-addressed reference exists", () => {
    const source = read(EMAIL_OTP);
    if (officialCodegenHasRun()) return; // contract below takes over

    expect(source).toContain(WORKAROUND_REF);
    expect(source).toContain(WORKAROUND_PATH);
    // The workaround must carry its own removal instruction, so it cannot
    // quietly become permanent.
    expect(source).toMatch(/Replace it with `internal\.otpLimiter\.consumeResendAllowance`/);
    expect(source).toMatch(/codegen/i);
  });

  it("uses the officially supported escape hatch, not a hand-edited generated type", () => {
    const source = read(EMAIL_OTP);
    if (officialCodegenHasRun()) return;

    // makeFunctionReference is public Convex API. Importing a type from
    // _generated and widening it by hand would not be.
    expect(source).toMatch(/import\s*\{[^}]*makeFunctionReference[^}]*\}\s*from\s*"convex\/server"/);
    expect(source).not.toMatch(/from\s*"\.\.\/_generated\/api"/);
  });

  it("the workaround resolves the same function path the official reference would", () => {
    // "otpLimiter:consumeResendAllowance" and internal.otpLimiter.consumeResendAllowance
    // are the same address. If the module or export were renamed, the string
    // would rot silently — this pins them together.
    const source = read(EMAIL_OTP);
    if (officialCodegenHasRun()) return;

    const match = /makeFunctionReference<[\s\S]*?>\(\s*"([^"]+)"\s*\)/.exec(source);
    expect(match, "could not find the function reference").not.toBeNull();
    const [moduleName, exportName] = (match?.[1] ?? "").split(":");
    expect(moduleName).toBe("otpLimiter");
    expect(read(LIMITER)).toContain(`export const ${exportName}`);
  });
});

describe("Phase 200 — post-codegen recovery contract", () => {
  /**
   * This is the assertion §4 asks for. It is inert while codegen is
   * unavailable and becomes binding the moment the source switches to the
   * official shape — at which point the workaround must be fully gone, not
   * left behind as dead code.
   */
  it("once official codegen has run, the manual workaround must be gone", () => {
    if (!officialCodegenHasRun()) {
      // Not yet applicable. Recorded explicitly rather than silently skipped,
      // so this never reads as a pass that proves something.
      expect(officialCodegenHasRun()).toBe(false);
      return;
    }

    const source = read(EMAIL_OTP);
    expect(source, "official codegen has run but makeFunctionReference remains").not.toContain(
      WORKAROUND_PATH,
    );
    expect(source).toContain(OFFICIAL_REF);
    expect(source).toMatch(/from\s*"\.\.\/_generated\/api"/);
  });

  it("generated output must never depend on a manual workaround", () => {
    // _generated must not contain hand-written glue. If someone patches it,
    // these markers are what they would most likely leave behind.
    const api = read(API_DTS);
    for (const smell of [
      "makeFunctionReference",
      "hand-added",
      "manually added",
      "TODO",
      "HACK",
      "@ts-expect-error",
    ]) {
      expect(api, `_generated/api.d.ts contains "${smell}" — it must be generated output only`).not.toContain(
        smell,
      );
    }
  });
});
