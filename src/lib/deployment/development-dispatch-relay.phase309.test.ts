/**
 * Phase 309 — the dispatch RELAY workflow is fail-closed: a repository
 * dispatch can never run a deploy or a smoke directly; it is re-issued as an
 * explicit workflow_dispatch with the payload copied VERBATIM (omitted flags
 stay omitted), the deploy relay requires the exact DEPLOY_DEV confirmation,
 * and no production relay type exists.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const root = process.cwd();
const RELAY = ".github/workflows/development-dispatch-relay.yml";
const DEPLOY = ".github/workflows/development-deploy.yml";
const SMOKE = ".github/workflows/development-runtime-smoke.yml";

describe("309 — the dispatch relay is the only repository-dispatch carrier, and it is fail-closed", () => {
  const relay = readFileSync(resolve(root, RELAY), "utf8");

  it("exists and listens ONLY to the two relay types", () => {
    expect(existsSync(resolve(root, RELAY))).toBe(true);
    expect(relay).toMatch(/repository_dispatch:/);
    expect(relay).toMatch(/- development-deploy-relay/);
    expect(relay).toMatch(/- development-runtime-smoke-relay/);
    expect(relay).not.toMatch(/workflow_dispatch:\n/); // never dispatchable by hand; only relayed
    // it can re-issue workflow dispatches and nothing more
    expect(relay).toMatch(/actions: write/);
    expect(relay).toMatch(/contents: read/);
  });

  it("forwards the payload VERBATIM — omits absent flags, invents nothing", () => {
    // the relay reads the payload fields by name and only forwards non-empty values
    expect(relay).toMatch(/\.\[\$k\] \/\/ empty/);
    expect(relay).toMatch(/if \[ -n "\$\{VALUE\}" \]; then/);
    expect(relay).toMatch(/gh workflow run development-deploy\.yml --ref main -f "ref=\$\{REF\}" -f "confirm=\$\{CONFIRM\}"/);
    expect(relay).toMatch(/gh workflow run development-runtime-smoke\.yml "\$\{ARGS\[@\]\}"/);
    // no other value is ever synthesized
    expect(relay).not.toMatch(/default=.*arena/);
  });

  it("refuses a deploy relay without the exact DEPLOY_DEV confirmation", () => {
    expect(relay).toMatch(/confirm must be exactly DEPLOY_DEV/);
    expect(relay).toMatch(/both ref and confirm are required/);
  });

  it("never carries a production relay type or a production target", () => {
    // no event type and no gh workflow run may reference production; the
    // word may appear in the fail-closed commentary only
    const code = relay.split("jobs:")[1];
    expect(code).not.toMatch(/production/i);
    expect(relay).not.toMatch(/production-deploy\.yml/);
  });

  it("the target workflows gate their bodies to workflow_dispatch", () => {
    const deploy = readFileSync(resolve(root, DEPLOY), "utf8");
    const smoke = readFileSync(resolve(root, SMOKE), "utf8");
    for (const [name, src] of [["deploy", deploy], ["smoke", smoke]] as const) {
      // every job runs ONLY on workflow_dispatch
      const jobIfs = [...src.matchAll(/^ {4}if: github\.event_name == 'workflow_dispatch'$/gm)];
      expect(jobIfs.length, name).toBeGreaterThanOrEqual(1);
      // a repository dispatch carries the relay type, nothing else
      expect(src, name).toMatch(/types: \[development-(deploy|runtime-smoke)-relay\]/);
    }
  });
});
