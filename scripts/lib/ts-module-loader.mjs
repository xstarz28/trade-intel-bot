/**
 * Shared TypeScript resolution hook for the operator/CI guard scripts.
 *
 * Node can execute `.ts` sources with type stripping, but a relative import
 * written without an extension (`import "./production-config"`) does not
 * resolve. This registers a resolver hook that maps such a specifier to the
 * `.ts` file sitting next to the importer, so both deploy guards load the SAME
 * policy modules the application uses rather than a re-implementation.
 *
 * Phase 286 extracted this from `scripts/production-deploy-guard.mjs` when the
 * development guard needed the identical behaviour: two copies of a module
 * resolver is two places for loading to differ.
 */
import { readFileSync } from "node:fs";
import module from "node:module";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export function registerTypeScriptResolution() {
  module.registerHooks({
    resolve(specifier, context, nextResolve) {
      if (specifier.startsWith(".") && !/\.[a-z]+$/i.test(specifier)) {
        const parentPath = context.parentURL?.startsWith("file:")
          ? fileURLToPath(context.parentURL)
          : null;
        if (parentPath) {
          const candidate = resolve(parentPath, "..", `${specifier}.ts`);
          try {
            readFileSync(candidate);
            return { url: pathToFileURL(candidate).href, shortCircuit: true };
          } catch {
            // fall through
          }
        }
      }
      return nextResolve(specifier, context);
    },
  });
}
