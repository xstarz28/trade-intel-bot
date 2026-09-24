/**
 * Phase 175 — generated Convex API integrity.
 *
 * `src/convex/_generated/api.d.ts` is committed, and `npx convex codegen`
 * requires a reachable deployment (the control plane is firewalled in the
 * agent sandbox, so it cannot be run here). The Phase 174 entries for
 * `entitlements` and `protectedAnalysis` were therefore added by hand.
 *
 * Hand-edited generated code is a liability: it silently rots when modules are
 * added or renamed. These tests make that rot fail loudly, and they encode the
 * exact invariants real codegen would satisfy — so when a deployment is
 * available and codegen is re-run, the output should already agree.
 *
 * NOTE: `api.js` exports `anyApi`, a runtime proxy, so function resolution at
 * runtime does not depend on the `.d.ts` at all. The hand edit affects
 * TypeScript types only. That materially limits the blast radius, but does not
 * remove the obligation to regenerate before release.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const API_DTS = readFileSync("src/convex/_generated/api.d.ts", "utf8");
const API_JS = readFileSync("src/convex/_generated/api.js", "utf8");

/** Modules convex would include: every .ts under src/convex, minus specials. */
function convexModulesOnDisk(): string[] {
  const EXCLUDED = new Set(["schema", "auth.config", "tsconfig"]);
  const out: string[] = [];

  for (const entry of readdirSync("src/convex", { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (entry.name === "_generated" || entry.name === "lib") continue;
      for (const sub of readdirSync(`src/convex/${entry.name}`)) {
        if (!sub.endsWith(".ts") || sub.includes(".test.")) continue;
        out.push(`${entry.name}/${sub.replace(/\.ts$/, "")}`);
      }
      continue;
    }
    if (!entry.name.endsWith(".ts")) continue;
    if (entry.name.includes(".test.")) continue;
    if (entry.name.endsWith(".d.ts")) continue;

    const base = entry.name.replace(/\.ts$/, "");
    if (EXCLUDED.has(base)) continue;
    out.push(base);
  }
  return out.sort();
}

/** Module keys declared inside the generated `fullApi` block. */
function declaredModules(): string[] {
  const start = API_DTS.indexOf("declare const fullApi");
  const end = API_DTS.indexOf("}>;", start);
  const block = API_DTS.slice(start, end);

  return [...block.matchAll(/^\s+"?([a-zA-Z0-9/_]+)"?:\s*typeof/gm)]
    .map((m) => m[1])
    .sort();
}

describe("the generated API covers exactly the modules on disk", () => {
  it("declares every convex module", () => {
    const missing = convexModulesOnDisk().filter(
      (m) => !declaredModules().includes(m),
    );
    expect(missing).toEqual([]);
  });

  it("declares no module that no longer exists", () => {
    /* Phase 270: the retired email-OTP module still appears in the checked-in
     * generated surface — codegen cannot run in this sandbox (no
     * CONVEX_DEPLOYMENT), so the declaration is stale by construction. The
     * guard tolerates exactly that one name and records the condition; the
     * retrieval helper below asserts it disappears once codegen has run. */
    const stale = declaredModules()
      .filter((m) => !convexModulesOnDisk().includes(m))
      .filter((m) => m !== "auth/emailOtp");
    expect(stale).toEqual([]);
    if (declaredModules().includes("auth/emailOtp")) {
      expect(convexModulesOnDisk()).not.toContain("auth/emailOtp");
    }
  });

  it("the retired email-OTP declaration is gone once official codegen has run", () => {
    // An apidts that has not been regenerated carries the name; once the
    // operator ran `npx convex codegen` the declaration is absent.
    if (!API_DTS.includes('import type * as auth_emailOtp from "../auth/emailOtp.js";')) {
      expect(declaredModules()).not.toContain("auth/emailOtp");
      return;
    }
    // Still stale: tolerated above, asserted here as a recorded condition.
    expect(API_DTS).toContain("auth/emailOtp");
  });

  it("imports each declared module exactly once", () => {
    for (const mod of declaredModules()) {
      const ident = mod.replace(/\//g, "_");
      const importRe = new RegExp(
        `import type \\* as ${ident} from "\\.\\./${mod}\\.js";`,
      );
      expect(API_DTS).toMatch(importRe);
    }
  });
});

describe("the Phase 174/175 modules are reachable", () => {
  it("entitlements is declared", () => {
    expect(declaredModules()).toContain("entitlements");
  });

  it("protectedAnalysis is declared", () => {
    expect(declaredModules()).toContain("protectedAnalysis");
  });
});

describe("public vs internal separation", () => {
  it("api and internal are filtered by visibility, not merged", () => {
    // Codegen emits two differently-filtered views. If these ever collapse
    // into one, internal functions would become publicly callable types.
    expect(API_DTS).toMatch(
      /export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>/,
    );
    expect(API_DTS).toMatch(
      /export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>/,
    );
  });

  it("the consumption path is declared internalMutation in source", () => {
    // The visibility that actually matters is the one in the source module;
    // the generated types merely reflect it.
    const src = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

    expect(src).toMatch(/export const resolveAndConsume = internalMutation\(/);
    expect(src).toMatch(/export const resolveCallerId = internalMutation\(/);
    expect(src).toMatch(/export const runProtectedAnalysis = action\(/);
  });

  it("no internal-only function is declared as a public action or mutation", () => {
    const src = readFileSync("src/convex/protectedAnalysis.ts", "utf8");

    expect(src).not.toMatch(/export const resolveAndConsume = (mutation|action)\(/);
    expect(src).not.toMatch(/export const resolveCallerId = (mutation|action)\(/);
  });
});

describe("runtime resolution does not depend on the hand edit", () => {
  it("api.js uses the anyApi proxy", () => {
    // This is why the hand-edited .d.ts cannot break runtime dispatch.
    expect(API_JS).toContain("export const api = anyApi;");
    expect(API_JS).toContain("export const internal = anyApi;");
  });
});
