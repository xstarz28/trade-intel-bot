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
