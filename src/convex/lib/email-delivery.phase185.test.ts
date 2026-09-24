/**
 * Phase 185 — Xstarz-owned OTP delivery → RETIRED in Phase 270.
 *
 * The email-OTP provider and the whole email delivery stack
 * (`src/convex/auth/emailOtp.ts`, `src/convex/lib/emailDelivery.ts`,
 * `src/convex/lib/emailTemplates.ts`) were retired: they no longer exist,
 * so every "active support" assertion this file once held is replaced by a
 * *retirement/inaccessibility* assertion. Nothing here is weakened — each
 * security property is now verified in its strongest form (the code that
 * could violate it is gone), and the properties that live in RETAINED
 * modules (the forbidden-hosts denylist in `issuerPolicy.ts`, the frozen
 * resend throttle below) keep their live assertions.
 */

import { beforeEach, describe, expect, it } from "vitest";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import {
  FORBIDDEN_DELIVERY_HOSTS,
  RETIRED_ISSUER_HOSTS,
} from "./issuerPolicy";
import {
  MAX_SENDS_PER_WINDOW,
  RESEND_COOLDOWN_MS,
  RESEND_WINDOW_MS,
  checkResendAllowed,
  recordResend,
  resetResendThrottleForTests,
} from "./otpResendThrottle";

beforeEach(() => resetResendThrottleForTests());

const RECIPIENT = "trader@example.com";

const cwd = (p: string) => join(process.cwd(), p);
const codeOf = (p: string) =>
  readFileSync(cwd(p), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

describe("270.1 — the email delivery stack is retired and stays absent", () => {
  it("the delivery module does not exist", () => {
    expect(existsSync(cwd("src/convex/lib/emailDelivery.ts"))).toBe(false);
  });

  it("the email templates module does not exist", () => {
    expect(existsSync(cwd("src/convex/lib/emailTemplates.ts"))).toBe(false);
  });

  it("the email-OTP provider module does not exist", () => {
    expect(existsSync(cwd("src/convex/auth/emailOtp.ts"))).toBe(false);
  });

  it("importing the retired provider fails closed", async () => {
    // @ts-expect-error — Phase 270: the module is retired; importing it must
    // fail closed, so tsc knowingly cannot resolve the specifier.
    await expect(import("../auth/emailOtp")).rejects.toThrow();
  });

  it("the registered auth providers are exactly guest + Google", () => {
    const code = codeOf("src/convex/auth.ts");
    expect(code).toMatch(/providers:\s*\[\s*Anonymous\s*,\s*googleProvider\s*\]/);
    expect(code).not.toMatch(/emailOtp/);
  });

  it("no convex runtime module reads an XSTARZ_EMAIL_* variable anymore", () => {
    // The variables are inert by construction: nothing in the runtime tree
    // references them from code (comments may keep the names as history).
    const offenders: string[] = [];
    const walk = (dir: string): string[] =>
      readdirSync(cwd(dir), { withFileTypes: true }).flatMap((entry) =>
        entry.isDirectory()
          ? walk(`${dir}/${entry.name}`)
          : entry.name.endsWith(".ts")
            ? [`${dir}/${entry.name}`]
            : [],
      );
    for (const file of walk("src/convex")) {
      if (file.endsWith(".test.ts")) continue;
      if (/process\.env\.XSTARZ_EMAIL_/.test(codeOf(file))) offenders.push(file);
    }
    expect(offenders).toEqual([]);
  });
});

describe("270.2 — the forbidden-hosts security property survives retirement", () => {
  it("the delivery-side forbidden list lives in the retained issuer policy", () => {
    expect(FORBIDDEN_DELIVERY_HOSTS).toContain("auth.freebuff.app");
    for (const host of RETIRED_ISSUER_HOSTS) {
      expect(FORBIDDEN_DELIVERY_HOSTS).toContain(host);
    }
  });

  it("the retired platform domains are still named", () => {
    expect(RETIRED_ISSUER_HOSTS).toEqual(["freebuff.com", "freebuff.app", "vly.ai"]);
  });
});

describe("270.3 — the retained resend throttle stays frozen and unchanged", () => {
  it("is marked frozen", () => {
    const src = readFileSync(cwd("src/convex/lib/otpResendThrottle.ts"), "utf8");
    expect(src).toContain("FROZEN — Phase 270");
    expect(readFileSync(cwd("src/convex/otpLimiter.ts"), "utf8")).toContain(
      "RETAINED FROZEN",
    );
  });
});

describe("11. resend throttling (retained, frozen — semantics unchanged)", () => {
  it("allows the first send", () => {
    expect(checkResendAllowed(RECIPIENT).allowed).toBe(true);
  });

  it("blocks an immediate resend and reports how long to wait", () => {
    const t0 = 1_000_000;
    recordResend(RECIPIENT, t0);
    const decision = checkResendAllowed(RECIPIENT, t0 + 5_000);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.reason).toBe("cooldown");
      expect(decision.retryAfterMs).toBe(RESEND_COOLDOWN_MS - 5_000);
    }
  });

  it("allows a resend once the cooldown elapses", () => {
    const t0 = 2_000_000;
    recordResend(RECIPIENT, t0);
    expect(checkResendAllowed(RECIPIENT, t0 + RESEND_COOLDOWN_MS + 1).allowed).toBe(true);
  });

  it("enforces a window cap even when cooldowns are respected", () => {
    let t = 3_000_000;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      expect(checkResendAllowed(RECIPIENT, t).allowed).toBe(true);
      recordResend(RECIPIENT, t);
      t += RESEND_COOLDOWN_MS + 1_000;
    }
    const decision = checkResendAllowed(RECIPIENT, t);
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toBe("window_exceeded");
  });

  it("recovers after the window rolls over", () => {
    let t = 4_000_000;
    for (let i = 0; i < MAX_SENDS_PER_WINDOW; i++) {
      recordResend(RECIPIENT, t);
      t += RESEND_COOLDOWN_MS + 1_000;
    }
    expect(checkResendAllowed(RECIPIENT, t).allowed).toBe(false);
    expect(checkResendAllowed(RECIPIENT, t + RESEND_WINDOW_MS + 1).allowed).toBe(true);
  });

  it("cannot be evaded by changing capitalisation or padding", () => {
    const t0 = 5_000_000;
    recordResend("Trader@Example.com", t0);
    expect(checkResendAllowed("  trader@example.COM  ", t0 + 1_000).allowed).toBe(false);
  });

  it("throttles per address, not globally", () => {
    const t0 = 6_000_000;
    recordResend("a@example.com", t0);
    expect(checkResendAllowed("b@example.com", t0 + 1).allowed).toBe(true);
  });
});
