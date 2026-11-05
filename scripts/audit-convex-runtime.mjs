#!/usr/bin/env node
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";

const root = process.cwd();
const sourceRoot = resolve(root, "src");
const allowedLegacyClientFiles = new Set([
  "src/components/AccountMigrationPanel.tsx",
  "src/lib/convex-provider.tsx",
]);
const importPattern = /(?:from\s*|import\s*\(|import\s*)["'](?:convex(?:\/[^"']*)?|@convex-dev\/[^"']*|@\/convex\/[^"']*)["']/g;
const runtimeSymbolPattern = /\b(?:useConvex|useConvexAuth|useAction|useMutation|useQuery|usePaginatedQuery|ConvexReactClient|ConvexAuthProvider|ConvexProvider|ConvexProviderWithAuth)\b/g;
const migrationBoundaryImportPattern = /(?:from\s*|import\s*\()\s*["']@\/(?:components\/AccountMigrationPanel|lib\/convex-provider)["']/g;
const retiredAdapterImportPattern = /(?:from\s*|import\s*\()\s*["'][^"']*\/convex-(?:bridge|persistence)(?:\.ts)?["']/g;
const errors = [];

function walk(directory) {
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...walk(path));
    else if (entry.isFile() && /\.(?:ts|tsx|js|jsx|mjs)$/.test(entry.name)) files.push(path);
  }
  return files;
}

function read(relativePath) {
  return readFileSync(resolve(root, relativePath), "utf8");
}

for (const absolutePath of walk(sourceRoot)) {
  const path = relative(root, absolutePath).replaceAll("\\", "/");
  if (path.startsWith("src/convex/")) continue;

  const source = readFileSync(absolutePath, "utf8");
  const hasRuntimeImport = importPattern.test(source);
  importPattern.lastIndex = 0;
  const hasRuntimeSymbol = runtimeSymbolPattern.test(source);
  runtimeSymbolPattern.lastIndex = 0;
  const hasMigrationBoundaryImport = migrationBoundaryImportPattern.test(source);
  migrationBoundaryImportPattern.lastIndex = 0;
  const hasRetiredAdapterImport = retiredAdapterImportPattern.test(source);
  retiredAdapterImportPattern.lastIndex = 0;

  if ((hasRuntimeImport || hasRuntimeSymbol) && !allowedLegacyClientFiles.has(path)) {
    errors.push(`${path}: Convex runtime import/symbol outside the optional legacy migration boundary`);
  }
  if (hasMigrationBoundaryImport && path !== "src/pages/Dashboard.tsx") {
    errors.push(`${path}: optional legacy migration UI may only be mounted by Dashboard behind its URL allowlist`);
  }
  if (hasRetiredAdapterImport) {
    errors.push(`${path}: retired Convex persistence adapters must not be imported by application runtime code`);
  }
}

const dashboard = read("src/pages/Dashboard.tsx");
if (!/isActiveConvexUrl\s*\(\s*import\.meta\.env\.VITE_LEGACY_CONVEX_URL\s*\)/.test(dashboard) ||
    !/isAllowedConvexCloudUrl\s*\(\s*import\.meta\.env\.VITE_LEGACY_CONVEX_URL\s*\)/.test(dashboard)) {
  errors.push("src/pages/Dashboard.tsx: legacy migration UI must remain behind the exact legacy URL allowlist");
}
if (!/import\(["']@\/components\/AccountMigrationPanel["']\)/.test(dashboard) ||
    !/import\(["']@\/lib\/convex-provider["']\)/.test(dashboard)) {
  errors.push("src/pages/Dashboard.tsx: the optional legacy export boundary is missing or no longer isolated");
}

for (const path of [
  "src/main.tsx",
  "src/hooks/use-auth.ts",
  "src/hooks/use-backend-session.ts",
  "src/pages/Auth.tsx",
  "src/components/RequireAuth.tsx",
]) {
  const source = read(path);
  if (importPattern.test(source) || runtimeSymbolPattern.test(source)) {
    errors.push(`${path}: authentication and route entry points must not depend on Convex`);
  }
  importPattern.lastIndex = 0;
  runtimeSymbolPattern.lastIndex = 0;
}

for (const absolutePath of walk(resolve(root, "backend"))) {
  const path = relative(root, absolutePath).replaceAll("\\", "/");
  const source = readFileSync(absolutePath, "utf8");
  if (importPattern.test(source) || runtimeSymbolPattern.test(source)) {
    errors.push(`${path}: self-hosted backend must not import or instantiate the Convex SDK`);
  }
  importPattern.lastIndex = 0;
  runtimeSymbolPattern.lastIndex = 0;
}

if (errors.length) {
  console.error("Convex runtime boundary audit failed:");
  for (const error of errors) console.error(`- ${error}`);
  process.exit(1);
}

console.log("Convex runtime boundary audit passed.");
console.log("Core authentication, route entry points, and self-hosted backend are Convex-independent.");
console.log("Convex SDK imports are confined to the explicitly allow-listed one-time legacy account export.");
