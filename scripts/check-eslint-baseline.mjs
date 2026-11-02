import fs from "node:fs";
import path from "node:path";

const [currentPath, baselinePath] = process.argv.slice(2);
if (!currentPath || !baselinePath) {
  process.stderr.write("Usage: node scripts/check-eslint-baseline.mjs <eslint-json> <baseline-json>\n");
  process.exit(2);
}

const currentResults = JSON.parse(fs.readFileSync(currentPath, "utf8"));
const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
if (!Array.isArray(currentResults) || !baseline.files || !baseline.totals) {
  throw new Error("Invalid ESLint results or baseline report shape.");
}

function relativeFile(filePath) {
  const relative = path.relative(process.cwd(), filePath).replaceAll(path.sep, "/");
  return relative.startsWith("../") ? filePath.replaceAll("\\", "/") : relative;
}

function normalizeRule(message) {
  if (message.ruleId) return message.ruleId;
  const text = message.message ?? "";
  if (text.includes("Calling setState synchronously within an effect")) return "react-hooks/set-state-in-effect";
  if (text.includes("Cannot access refs during render")) return "react-hooks/refs";
  if (text.includes("Cannot call impure function during render")) return "react-hooks/purity";
  if (text.includes("This value cannot be modified")) return "react-hooks/immutability";
  if (text.includes("Unused eslint-disable directive")) return "eslint-comments/no-unused-disable";
  return "unclassified";
}

const current = {};
let errors = 0;
let warnings = 0;
for (const result of currentResults) {
  const file = relativeFile(result.filePath);
  for (const message of result.messages ?? []) {
    const level = message.severity === 2 ? "errors" : "warnings";
    const rule = normalizeRule(message);
    current[file] ??= { errors: 0, warnings: 0, rules: {} };
    current[file][level] += 1;
    current[file].rules[rule] = (current[file].rules[rule] ?? 0) + 1;
    if (level === "errors") errors += 1;
    else warnings += 1;
  }
}

const regressions = [];
const improvements = [];
const allFiles = new Set([...Object.keys(baseline.files), ...Object.keys(current)]);
for (const file of allFiles) {
  const before = baseline.files[file] ?? { errors: 0, warnings: 0, rules: {} };
  const after = current[file] ?? { errors: 0, warnings: 0, rules: {} };
  const allRules = new Set([...Object.keys(before.rules ?? {}), ...Object.keys(after.rules ?? {})]);
  for (const rule of allRules) {
    const previousCount = before.rules?.[rule] ?? 0;
    const currentCount = after.rules?.[rule] ?? 0;
    if (currentCount > previousCount) {
      regressions.push({ file, rule, baseline: previousCount, current: currentCount, increase: currentCount - previousCount });
    } else if (currentCount < previousCount) {
      improvements.push({ file, rule, reduction: previousCount - currentCount });
    }
  }
}

const baselineErrors = baseline.totals.errors;
const baselineWarnings = baseline.totals.warnings;
process.stdout.write(`ESLint baseline ratchet: baseline ${baselineErrors} errors / ${baselineWarnings} warnings; current ${errors} errors / ${warnings} warnings.\n`);
process.stdout.write(`Per-file/per-rule improvements: ${improvements.length}; regressions: ${regressions.length}.\n`);

if (regressions.length > 0) {
  process.stderr.write("New or increased lint violations detected:\n");
  for (const item of regressions.slice(0, 100)) {
    process.stderr.write(`- ${item.file} [${item.rule}]: ${item.baseline} -> ${item.current} (+${item.increase})\n`);
  }
  if (regressions.length > 100) process.stderr.write(`... and ${regressions.length - 100} more.\n`);
  process.exit(1);
}

process.stdout.write("No lint regression detected. Existing debt may be reduced incrementally.\n");
