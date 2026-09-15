/**
 * Phase 215 — never instruct an operator to print secret values.
 *
 * Phase 214 told the operator to run `npx convex env list` and claimed it
 * "shows names only". That is false. The Convex CLI's `envList` prints
 * `NAME=VALUE` for every variable unless `--names-only` is passed:
 *
 *   for (const { name, value } of envs) {
 *     if (options?.namesOnly) { logOutput(name); continue; }
 *     logOutput(`${name}=${formatted}`);
 *   }
 *
 * Following that instruction would have printed the live email API key to the
 * terminal and into any captured transcript. Two other documents carried the
 * same wrong instruction.
 *
 * These guards fail if any operator-facing document reintroduces the
 * value-printing form.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const DOCS_DIR = resolve(process.cwd(), "docs");

const markdownFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return markdownFiles(full);
    return entry.endsWith(".md") ? [full] : [];
  });

const docs = markdownFiles(DOCS_DIR).map((path) => ({
  path: path.slice(resolve(process.cwd()).length + 1),
  text: readFileSync(path, "utf8"),
}));

describe("Phase 215 — env inspection must never print values", () => {
  it("finds the documents to check (guard is not vacuous)", () => {
    expect(docs.length).toBeGreaterThan(5);
    expect(docs.some((d) => d.path.endsWith("PRODUCTION-EMAIL-SETUP.md"))).toBe(true);
  });

  it("never instructs `convex env list` without --names-only", () => {
    const offenders: string[] = [];
    // Prose explaining the defect legitimately names the unsafe form, and that
    // explanation often wraps onto the following line. Judge each mention in
    // the context of its surrounding lines, not the single line it sits on.
    const EXPLANATORY =
      /prints|would disclose|never the value|unsafe|mandatory|without the flag|claiming|asserted|is false|told the operator|instructed the operator/i;
    for (const doc of docs) {
      const lines = doc.text.split("\n");
      lines.forEach((line, i) => {
        if (!/convex env (default )?list/.test(line)) return;
        if (line.includes("--names-only")) return;
        const context = lines.slice(Math.max(0, i - 2), i + 3).join(" ");
        if (EXPLANATORY.test(context)) return;
        offenders.push(`${doc.path}: ${line.trim()}`);
      });
    }
    expect(offenders, `documents instruct a value-printing command:\n${offenders.join("\n")}`).toEqual(
      [],
    );
  });

  it("states explicitly that plain `env list` prints values", () => {
    const setup = docs.find((d) => d.path.endsWith("PRODUCTION-EMAIL-SETUP.md"));
    expect(setup).toBeTruthy();
    expect(setup!.text).toMatch(/prints\s*\n?`NAME=VALUE`|prints `NAME=VALUE`/);
    expect(setup!.text).toMatch(/--names-only.{0,40}mandatory|mandatory.{0,40}--names-only/s);
  });

  it("tells the operator what to do if they already ran the unsafe form", () => {
    const setup = docs.find((d) => d.path.endsWith("PRODUCTION-EMAIL-SETUP.md"));
    expect(setup!.text).toMatch(/treat the key as exposed and rotate it/i);
  });
});

describe("Phase 216 — no document points `env get` at a secret", () => {
  /**
   * `npx convex env get NAME` prints the raw value with no masking
   * (`logOutput(`${envVar.value}`)` in the CLI). It is therefore safe only for
   * variables whose values may be disclosed. A document that shows it applied
   * to a credential is an instruction to leak that credential.
   */
  const SECRET_NAMES = [
    "XSTARZ_EMAIL_API_KEY",
    "TWELVE_DATA_API_KEY",
    "ALPHA_VANTAGE_API_KEY",
    "COINGLASS_API_KEY",
    "TICKATLAS_API_KEY",
    "EIA_API_KEY",
    "VLY_INTEGRATION_KEY",
    "CONVEX_DEPLOY_KEY",
  ];

  it("never shows `env get` applied to a credential", () => {
    const offenders: string[] = [];
    for (const doc of docs) {
      const lines = doc.text.split("\n");
      lines.forEach((line, i) => {
        if (!/convex env (default )?get/.test(line)) return;
        const named = SECRET_NAMES.find((n) => line.includes(n));
        if (!named) return;
        // A prohibition ("Never run ...") is the opposite of an instruction.
        const context = lines.slice(Math.max(0, i - 1), i + 2).join(" ");
        if (/never|must not|do not|forbidden|NEVER/i.test(context)) return;
        offenders.push(`${doc.path}: ${line.trim()}`);
      });
    }
    expect(offenders, `documents point env get at a secret:\n${offenders.join("\n")}`).toEqual([]);
  });

  it("states that env get prints an unmasked value", () => {
    const setup = docs.find((d) => d.path.endsWith("PRODUCTION-EMAIL-SETUP.md"));
    expect(setup!.text).toMatch(/env get.{0,80}raw value with no masking/s);
  });

  it("classifies every email variable for disclosure safety", () => {
    const deployment = docs.find((d) => d.path.endsWith("DEPLOYMENT.md"));
    expect(deployment, "DEPLOYMENT.md must exist").toBeTruthy();
    expect(deployment!.text).toContain("Disclosure safety");
    // The key must be marked NEVER printable; the sender must be marked safe.
    const table = deployment!.text.slice(deployment!.text.indexOf("Disclosure safety"));
    const keyRow = table.split("\n").find((l) => l.includes("XSTARZ_EMAIL_API_KEY"));
    expect(keyRow).toMatch(/NEVER/);
    const senderRow = table
      .split("\n")
      .find((l) => l.includes("XSTARZ_EMAIL_SENDER_ADDRESS"));
    expect(senderRow).toMatch(/\|\s*Yes\s*\|/);
  });

  it("tells the operator to rotate the Xstarz key if it was disclosed", () => {
    const setup = docs.find((d) => d.path.endsWith("PRODUCTION-EMAIL-SETUP.md"));
    expect(setup!.text).toMatch(/Rotate that key/i);
    // ...and keeps it separate from the Phase 184 credential.
    expect(setup!.text).toMatch(/unrelated to the Phase 184 Freebuff credential/i);
  });
});

describe("Phase 215 — no document leaks a credential-shaped literal", () => {
  it("contains no value-shaped assignment for a secret-looking name", () => {
    const pattern =
      /(api[_-]?key|secret|password|token|bearer)\s*[:=]\s*["']?[A-Za-z0-9_-]{20,}["']?/i;
    const offenders = docs
      .filter((doc) => {
        for (const line of doc.text.split("\n")) {
          if (!pattern.test(line)) continue;
          // Placeholders and prose are fine; a real value is not.
          if (/placeholder|example|REPLACE_WITH|<your|\.\.\.|xxxx|never|must not/i.test(line)) {
            continue;
          }
          return true;
        }
        return false;
      })
      .map((d) => d.path);
    expect(offenders).toEqual([]);
  });

  it("never embeds a Resend-style key prefix", () => {
    for (const doc of docs) {
      expect(doc.text, `${doc.path} must not contain a live-looking key`).not.toMatch(
        /\bre_[A-Za-z0-9]{16,}\b/,
      );
    }
  });
});
