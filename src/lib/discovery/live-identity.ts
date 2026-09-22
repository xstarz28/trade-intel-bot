/**
 * Resolve a user-typed instrument against actual provider discovery.
 *
 * The typed string is NOT proof that a provider supports it. Identity is
 * established only when a discovered provider-native id matches. Matching
 * never substitutes a different symbol, never consults the static
 * instruments.ts registry, and never uses alias maps (GOLD → XAU/USD).
 */

import type { AssetClass } from "@/lib/data/universal/types";
import type { DiscoveredInstrument } from "./types";
import { assetClassToInstrumentType } from "./universal-cycle";
import type { TrackedInstrument } from "./lifecycle";

export type LiveIdentitySuccess = {
  ok: true;
  provider: string;
  providerInstrumentId: string;
  assetClass: AssetClass;
  discovered: DiscoveredInstrument;
};

export type LiveIdentityFailure = {
  ok: false;
  failureClass: "SYMBOL_UNSUPPORTED";
  reason: string;
};

export type LiveIdentity = LiveIdentitySuccess | LiveIdentityFailure;

export function instrumentTypeToAssetClass(
  instrumentType: string | undefined,
): AssetClass | undefined {
  if (!instrumentType) return undefined;
  if (instrumentType === "stock") return "equity";
  if (
    instrumentType === "crypto" ||
    instrumentType === "forex" ||
    instrumentType === "commodity" ||
    instrumentType === "indices" ||
    instrumentType === "equity" ||
    instrumentType === "macro"
  ) {
    return instrumentType;
  }
  return undefined;
}

function idsEqual(a: string, b: string): boolean {
  return a === b;
}

function idsEqualIgnoreCase(a: string, b: string): boolean {
  return a.toUpperCase() === b.toUpperCase();
}

export function resolveLiveIdentity(args: {
  typed: string;
  instrumentType?: string;
  discovered: readonly DiscoveredInstrument[];
}): LiveIdentity {
  const typed = args.typed.trim();
  if (!typed) {
    return {
      ok: false,
      failureClass: "SYMBOL_UNSUPPORTED",
      reason: "instrument is empty — typed input is not a provider identity",
    };
  }

  if (args.discovered.length === 0) {
    return {
      ok: false,
      failureClass: "SYMBOL_UNSUPPORTED",
      reason:
        "instrument is not present in provider discovery — typed input is not proof of a live listing",
    };
  }

  const exact = args.discovered.filter((row) =>
    idsEqual(row.providerInstrumentId, typed),
  );
  const caseInsensitive =
    exact.length > 0
      ? exact
      : args.discovered.filter((row) =>
          idsEqualIgnoreCase(row.providerInstrumentId, typed),
        );

  if (caseInsensitive.length === 0) {
    return {
      ok: false,
      failureClass: "SYMBOL_UNSUPPORTED",
      reason: `instrument "${typed}" was not found as a provider-native id in discovery`,
    };
  }

  const preferredClass = instrumentTypeToAssetClass(args.instrumentType);
  const classFiltered =
    preferredClass !== undefined
      ? caseInsensitive.filter((row) => row.assetClass === preferredClass)
      : caseInsensitive;
  const pool = classFiltered.length > 0 ? classFiltered : caseInsensitive;

  const uniqueKeys = new Set(
    pool.map((row) => `${row.provider}::${row.providerInstrumentId}`),
  );
  if (uniqueKeys.size > 1) {
    return {
      ok: false,
      failureClass: "SYMBOL_UNSUPPORTED",
      reason: `instrument "${typed}" matches multiple provider-native identities; refuse to pick one`,
    };
  }

  const chosen = pool[0];
  return {
    ok: true,
    provider: chosen.provider,
    // Exact catalog id — including the provider's own casing.
    providerInstrumentId: chosen.providerInstrumentId,
    assetClass: chosen.assetClass,
    discovered: chosen,
  };
}

/** Listed discovery rows eligible for Analyze identity — never DELISTED. */
export function discoveredFromTracked(
  tracked: ReadonlyMap<string, TrackedInstrument>,
): DiscoveredInstrument[] {
  return Array.from(tracked.values())
    .filter((entry) => entry.state !== "DELISTED")
    .map((entry) => entry.instrument);
}

export { assetClassToInstrumentType };
