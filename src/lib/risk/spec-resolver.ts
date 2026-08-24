/**
 * Phase 4 — Instrument specification resolver (pure).
 *
 * NON-NEGOTIABLE: no provider in this integration exposes contract size,
 * tick value, lot conventions, or leverage. Those fields are ONLY accepted
 * from explicit user/provider input. The only field derivable without
 * market-convention assumptions is the QUOTE currency, parsed from the
 * literal instrument symbol structure (e.g. "EUR/USD" → quote USD) or taken
 * from a provider-returned currency metadata field when actually present.
 *
 * Forbidden assumptions (never applied):
 *   forex = 100000, gold = 100 oz, crypto = 1 coin/contract, stock = 1 share.
 */
import type { InstrumentSpec } from "../risk";
import { resolveWithOkx, type OkxSpecData } from "./okx-spec";

export type SpecResolutionStatus =
  | "available"
  | "partial"
  | "unavailable"
  | "provider_error"
  // Phase 7B-3: explicit input and provider metadata disagree — sizing blocked.
  | "conflict";

export interface ResolvedInstrumentSpec {
  status: SpecResolutionStatus;
  /** Merged spec — only fields that are actually known are populated. */
  spec: InstrumentSpec;
  /** Human-readable provenance of each critical field. */
  sources: {
    quoteCurrency?: string;
    contractSize?: string;
    quantityStep?: string;
  };
  /** Fields still required for full position sizing. Empty = complete. */
  missingForSizing: string[];
  unavailableReason?: string;
  /** Phase 7B-3: explicit-vs-OKX disagreements that BLOCK sizing when present. */
  conflicts?: string[];
}

/** Currencies parseable from a literal "AAA/BBB" symbol structure. */
export function parseSymbolCurrencies(instrument: string): { base?: string; quote?: string } {
  const sym = instrument.toUpperCase().trim();
  const m = /^([A-Z]{2,5})\/([A-Z]{3})$/.exec(sym);
  if (!m) return {};
  // Deterministic string structure of the requested symbol itself.
  return { base: m[1], quote: m[2] };
}

/**
 * Merge an explicit user/provider spec with what can be derived from the
 * instrument symbol and provider metadata. Explicit input always wins.
 * Nothing is inferred beyond literal symbol structure.
 */
export function resolveInstrumentSpec(args: {
  instrument: string;
  /** Optional provider-returned currency metadata (e.g. Twelve Data /quote.currency). */
  providerCurrency?: string;
  explicitSpec?: InstrumentSpec;
  /** Phase 7B-3: OKX public instruments metadata. Hierarchy:
   *  explicit input > verified OKX metadata > unavailable; conflicts BLOCK sizing. */
  okx?: OkxSpecData;
}): ResolvedInstrumentSpec {
  const { instrument, providerCurrency, explicitSpec } = args;

  // Phase 7B-3: OKX path (crypto derivatives). Runs whenever OKX metadata
  // exists, even alongside explicit input, so conflicts can be detected.
  if (args.okx) {
    const o = resolveWithOkx({ instrument, explicitSpec, okx: args.okx });
    return {
      status: o.status,
      spec: o.spec ?? { assetClass: "" },
      sources: { contractSize: "OKX public instruments", quantityStep: "OKX public instruments" },
      missingForSizing: o.missingForSizing,
      unavailableReason: o.unavailableReason,
      conflicts: o.conflicts,
    };
  }

  if (!explicitSpec) {
    const parsed = parseSymbolCurrencies(instrument);
    const quote = parsed.quote ?? providerCurrency?.toUpperCase();
    if (!quote) {
      return {
        status: "unavailable",
        spec: { assetClass: "" },
        sources: {},
        missingForSizing: ["instrument specification not provided"],
        unavailableReason:
          "no instrument specification available — this provider does not expose contract specifications; supply them explicitly for position sizing",
      };
    }
    return {
      status: "partial",
      spec: { assetClass: "", quoteCurrency: quote },
      sources: parsed.quote
        ? { quoteCurrency: `symbol structure (${instrument})` }
        : { quoteCurrency: "provider currency metadata" },
      missingForSizing: ["contract size", "quantity step"],
      unavailableReason: undefined,
    };
  }

  // Explicit spec provided — merge derived fields only where missing.
  const spec: InstrumentSpec = { ...explicitSpec };
  const sources: ResolvedInstrumentSpec["sources"] = { contractSize: "user-provided", quantityStep: "user-provided" };
  let status: SpecResolutionStatus =
    spec.contractSize && spec.quantityStep && spec.quoteCurrency ? "available" : "partial";

  if (!spec.quoteCurrency) {
    const parsed = parseSymbolCurrencies(instrument);
    const quote = parsed.quote ?? providerCurrency?.toUpperCase();
    if (quote) {
      spec.quoteCurrency = quote;
      sources.quoteCurrency = parsed.quote
        ? `symbol structure (${instrument})`
        : "provider currency metadata";
      status = spec.contractSize && spec.quantityStep ? "available" : "partial";
    } else {
      status = "partial";
    }
  } else {
    sources.quoteCurrency = "user-provided";
  }
  if (!spec.source) spec.source = "user-provided";

  const missingForSizing: string[] = [];
  if (!spec.contractSize || spec.contractSize <= 0) missingForSizing.push("contract size");
  if (!spec.quoteCurrency) missingForSizing.push("quote currency");
  if (!spec.quantityStep || spec.quantityStep <= 0) missingForSizing.push("quantity step");

  return { status, spec, sources, missingForSizing };
}
