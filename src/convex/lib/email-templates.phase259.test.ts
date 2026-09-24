/**
 * Transactional templates + temporary-sender policy → RETIRED in Phase 270.
 *
 * The email templates and delivery modules no longer exist, so the
 * template-rendering and sender-policy assertions this file held are replaced
 * by retirement/inaccessibility assertions. The security properties they
 * protected are verified at the strongest available form: branded/enforced
 * templates cannot drift from copy because no email can be sent at all, and
 * the sender denylist's security content survives in the retained
 * `issuerPolicy.ts` (`FORBIDDEN_DELIVERY_HOSTS`).
 *
 * These tests never perform a network send and never contain a real
 * credential.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import {
  FORBIDDEN_DELIVERY_HOSTS,
  RETIRED_ISSUER_HOSTS,
} from "./issuerPolicy";

const cwd = (p: string) => join(process.cwd(), p);

describe("270/259.1 — the template and delivery modules are retired", () => {
  it("emailTemplates.ts does not exist", () => {
    expect(existsSync(cwd("src/convex/lib/emailTemplates.ts"))).toBe(false);
  });

  it("emailDelivery.ts does not exist", () => {
    expect(existsSync(cwd("src/convex/lib/emailDelivery.ts"))).toBe(false);
  });

  it("no UI or runtime module imports the retired template surface", () => {
    // If something still imported it, tsc would already fail — but this also
    // guards the string surface from being quoted back into existence.
    for (const probe of [
      "src/convex/auth.ts",
      "src/convex/otpLimiter.ts",
      "src/lib/deployment/production-config.ts",
      "src/lib/deployment/convex-deployment-verification.ts",
    ]) {
      expect(readFileSync(cwd(probe), "utf8")).not.toContain(
        'from "../../convex/lib/emailDelivery"',
      );
      expect(readFileSync(cwd(probe), "utf8")).not.toContain("./emailTemplates");
    }
  });
});

describe("270/259.2 — branding by removal: no email can be sent, so none can be off-brand", () => {
  it("the app-facing verification send function cannot be called anymore", async () => {
    // @ts-expect-error — Phase 270: the module is retired; importing it must
    // fail closed, so tsc knowingly cannot resolve the specifier.
    await expect(import("./emailDelivery")).rejects.toThrow();
  });

  it("no security-alert email path exists", () => {
    // The security-alert template was the alternative sender of record. Both
    // are gone; nothing can dispatch a branded (or unbranded) mail.
    expect(existsSync(cwd("src/convex/lib/emailTemplates.ts"))).toBe(false);
  });
});

describe("270/259.3 — retired senders and shared-test-sender rules survive in the denylist", () => {
  it("the provider shared test sender rule is subsumed by sender retirement", () => {
    // `resend.dev` shared-test-sender enforcement died with the sending path.
    // The equivalent guard now: there is no From header construction at all.
    expect(existsSync(cwd("src/convex/lib/emailDelivery.ts"))).toBe(false);
  });

  it("retired platform domains stay forbidden as sender/mail identities", () => {
    expect(FORBIDDEN_DELIVERY_HOSTS).toContain("auth.freebuff.app");
    for (const host of RETIRED_ISSUER_HOSTS) {
      expect(FORBIDDEN_DELIVERY_HOSTS).toContain(host);
    }
    expect(RETIRED_ISSUER_HOSTS).toContain("vly.ai");
  });
});
