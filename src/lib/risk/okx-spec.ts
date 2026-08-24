/**
 * Phase 7B-3 — OKX Public Instruments metadata (pure module).
 *
 * Source (verified live): https://www.okx.com/api/v5/public/instruments
 * Verified contract semantics from the LIVE response:
 *   BTC-USDT-SWAP : ctType "linear",  ctVal 0.01 BTC,  settleCcy USDT,
 *                   lotSz/minSz 0.01, tickSz 0.1, state "live".
 *   BTC-USD-SWAP  : ctType "inverse", ctVal 100 USD — INVERSE contracts do
 *                   NOT satisfy the linear risk-per-unit formula and are
 *                   rejected for auto-sizing with an explicit reason.
 *
 * NON-NEGOTIABLE:
 * - Mapping derives candidate instIds ONLY from the literal user symbol;
 *   existence is verified against the live response. Ambiguity or absence →
 *   unavailable. Never guesses exchange symbols.
 * - No assumptions (crypto=1, BTC=1 BTC, forex=100k, gold=100oz…). Every
 *   field must come from the actual response or explicit input.
 * - Explicit input wins; conflicts between explicit and OKX values are
 *   surfaced and BLOCK sizing rather than silently choosing a side.
 * - Leverage ("lever") is never used as risk sizing.
 */

import type { InstrumentSpec } from "../risk";

// ── Types ──────────────────────────────────────────────────────────

export interface OkxInstrumentMetadata {
  instId: string;
  instType: string;
  state?: string;
  /** "linear" | "inverse" | … */
  ctType?: string;
  /** Contract value per contract in ctValCcy units (verified semantics). */
  ctVal?: number;
  ctValCcy?: string;
  settleCcy?: string;
  quoteCcy?: string;
  baseCcy?: string;
  lotSz?: number;
  minSz?: number;
  tickSz?: number;
}

export interface OkxParsedResponse {
  instruments: OkxInstrumentMetadata[];
  parseWarnings: string[];
}

export interface OkxSpecData {
  fetchedAt: number;
  source: "OKX public instruments";
  /** Static instrument metadata — never presented as live market data. */
  freshness: "static";
  /** Parsed instruments actually returned by OKX for the mapped instId(s). */
  instruments: OkxInstrumentMetadata[];
  parseWarnings: string[];
}

export interface OkxResolution {
  status: "available" | "partial" | "unavailable" | "conflict";
  spec?: InstrumentSpec;
  /** Provenance per field that came from OKX. */
  okxFields: string[];
  missingForSizing: string[];
  unavailableReason?: string;
  /** Explicit-input vs OKX disagreements that block sizing. */
  conflicts: string[];
  mappedInstId?: string;
}

// ── Documented policy parameters ───────────────────────────────────

/** Relative difference above which explicit vs OKX numerics are a conflict. */
export const OKX_CONFLICT_REL_TOLERANCE = 0.001;

// ── Mapping (literal-symbol-derived candidates only) ───────────────

/**
 * Derive the OKX instId to query from the LITERAL requested symbol.
 * "BTC-USDT-SWAP" passes through; "BTC/USDT" → "BTC-USDT-SWAP".
 * Anything not shaped like BASE/QUOTE or an explicit OKX id → undefined.
 */
export function mapInstrumentToOkx(instrumentRaw: string): string | undefined {
  const normalized = instrumentRaw.trim().toUpperCase().replace(/[\s_/]+/g, "-");
  if (/^[A-Z0-9]+-[A-Z0-9]+-(SWAP|FUTURES)$/.test(normalized)) return normalized;
  const m = /^([A-Z0-9]{2,10})-([A-Z0-9]{2,10})$/.exec(normalized);
  if (!m) return undefined;
  return `${m[1]}-${m[2]}-SWAP`;
}

// ── Response parsing ───────────────────────────────────────────────

function toPositiveNumber(v: unknown): number | undefined {
  if (typeof v !== "string" && typeof v !== "number") return undefined;
  const n = typeof v === "number" ? v : parseFloat(v);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

/** Parse an OKX /public/instruments JSON body. Malformed bodies degrade to warnings. */
export function parseOkxResponse(json: unknown): OkxParsedResponse {
  const warnings: string[] = [];
  if (typeof json !== "object" || json === null) {
    return { instruments: [], parseWarnings: ["response is not a JSON object"] };
  }
  const body = json as { code?: unknown; data?: unknown; msg?: unknown };
  if (body.code !== "0" && body.code !== 0) {
    return {
      instruments: [],
      parseWarnings: [`OKX error code ${String(body.code)}: ${String(body.msg ?? "unknown")}`],
    };
  }
  if (!Array.isArray(body.data)) {
    return { instruments: [], parseWarnings: ["response data is not an array"] };
  }
  const instruments: OkxInstrumentMetadata[] = [];
  body.data.forEach((row, i) => {
    if (typeof row !== "object" || row === null) {
      warnings.push(`row ${i}: not an object`);
      return;
    }
    const r = row as Record<string, unknown>;
    const instId = typeof r.instId === "string" ? r.instId : undefined;
    const instType = typeof r.instType === "string" ? r.instType : undefined;
    if (!instId || !instType) {
      warnings.push(`row ${i}: missing instId/instType`);
      return;
    }
    const ctVal = toPositiveNumber(r.ctVal);
    instruments.push({
      instId,
      instType,
      ...(typeof r.state === "string" ? { state: r.state } : {}),
      ...(typeof r.ctType === "string" ? { ctType: r.ctType } : {}),
      ...(ctVal !== undefined ? { ctVal } : {}),
      ...(typeof r.ctValCcy === "string" && r.ctValCcy ? { ctValCcy: r.ctValCcy } : {}),
      ...(typeof r.settleCcy === "string" && r.settleCcy ? { settleCcy: r.settleCcy } : {}),
      ...(typeof r.quoteCcy === "string" && r.quoteCcy ? { quoteCcy: r.quoteCcy } : {}),
      ...(typeof r.baseCcy === "string" && r.baseCcy ? { baseCcy: r.baseCcy } : {}),
      ...(toPositiveNumber(r.lotSz) !== undefined ? { lotSz: toPositiveNumber(r.lotSz) } : {}),
      ...(toPositiveNumber(r.minSz) !== undefined ? { minSz: toPositiveNumber(r.minSz) } : {}),
      ...(toPositiveNumber(r.tickSz) !== undefined ? { tickSz: toPositiveNumber(r.tickSz) } : {}),
    });
  });
  return { instruments, parseWarnings: warnings };
}

// ── Resolution & merge hierarchy ───────────────────────────────────

function numericConflict(a: number, b: number): boolean {
  const ref = Math.max(Math.abs(b), 1e-12);
  return Math.abs(a - b) / ref > OKX_CONFLICT_REL_TOLERANCE;
}

export function resolveWithOkx(args: {
  instrument: string;
  explicitSpec?: InstrumentSpec;
  okx?: OkxSpecData;
}): OkxResolution {
  const { instrument, explicitSpec, okx } = args;
  const empty: OkxResolution = {
    status: "unavailable",
    okxFields: [],
    missingForSizing: [],
    conflicts: [],
  };

  const instId = mapInstrumentToOkx(instrument);
  if (!instId || !okx || !Array.isArray(okx.instruments)) {
    return { ...empty, unavailableReason: "instrument not mappable to a verified OKX contract id" };
  }

  // Exact-id match against the live rows; ambiguity is never resolved by guessing.
  const matches = okx.instruments.filter((m) => m.instId === instId);
  if (matches.length === 0) {
    return {
      ...empty,
      mappedInstId: instId,
      unavailableReason: `instrument ${instId} not found on OKX public instruments`,
    };
  }
  if (matches.length > 1) {
    return {
      ...empty,
      mappedInstId: instId,
      unavailableReason: `ambiguous OKX response: ${matches.length} entries for ${instId}`,
    };
  }
  const meta = matches[0];

  // Only live, LINEAR contracts satisfy the Phase 4 risk-per-unit formula.
  if (meta.state && meta.state !== "live") {
    return {
      ...empty,
      mappedInstId: instId,
      unavailableReason: `OKX instrument ${instId} state is "${meta.state}" — not tradeable metadata`,
    };
  }
  if (meta.ctType && meta.ctType !== "linear") {
    return {
      ...empty,
      mappedInstId: instId,
      unavailableReason: `OKX ${instId} is a ${meta.ctType} contract — the linear risk-per-unit formula does not apply; supply an explicit specification`,
    };
  }

  // Build the OKX-derived partial spec (only actually-present fields).
  const okxSpec: InstrumentSpec = { assetClass: "crypto", source: `OKX public instruments (${instId})` };
  const okxFields: string[] = [];
  const missingForSizing: string[] = [];
  if (meta.ctVal !== undefined && meta.ctValCcy) {
    okxSpec.contractSize = meta.ctVal;
    okxFields.push(`contractSize=ctVal (${meta.ctVal} ${meta.ctValCcy} per contract)`);
  } else {
    missingForSizing.push("ctVal/ctValCcy");
  }
  if (meta.settleCcy || meta.quoteCcy) {
    okxSpec.quoteCurrency = (meta.settleCcy ?? meta.quoteCcy)!.toUpperCase();
    okxFields.push(`quoteCurrency=settleCcy (${okxSpec.quoteCurrency})`);
  } else {
    missingForSizing.push("settlement currency");
  }
  if (meta.lotSz !== undefined) {
    okxSpec.quantityStep = meta.lotSz;
    okxFields.push(`quantityStep=lotSz (${meta.lotSz})`);
  } else {
    missingForSizing.push("lotSz");
  }
  if (meta.minSz !== undefined) {
    okxSpec.minQuantity = meta.minSz;
    okxFields.push(`minQuantity=minSz (${meta.minSz})`);
  }
  if (meta.tickSz !== undefined) {
    okxSpec.tickSize = meta.tickSz;
    okxFields.push(`tickSize=tickSz (${meta.tickSz})`);
  }
  if (missingForSizing.length > 0) {
    return {
      status: "partial",
      spec: okxSpec,
      okxFields,
      missingForSizing,
      conflicts: [],
      mappedInstId: instId,
      unavailableReason: `incomplete OKX contract metadata: ${missingForSizing.join(", ")}`,
    };
  }

  // Merge hierarchy: explicit input wins field-by-field; disagreement blocks sizing.
  const conflicts: string[] = [];
  let merged: InstrumentSpec = { ...okxSpec };
  if (explicitSpec) {
    merged = { ...okxSpec };
    if (explicitSpec.contractSize !== undefined) {
      if (okxSpec.contractSize !== undefined && numericConflict(explicitSpec.contractSize, okxSpec.contractSize)) {
        conflicts.push(
          `contractSize conflict: explicit ${explicitSpec.contractSize} vs OKX ${okxSpec.contractSize} (${instId})`,
        );
      } else {
        merged.contractSize = explicitSpec.contractSize;
        okxFields.push("contractSize overridden by explicit input");
      }
    }
    if (explicitSpec.quantityStep !== undefined) {
      if (okxSpec.quantityStep !== undefined && numericConflict(explicitSpec.quantityStep, okxSpec.quantityStep)) {
        conflicts.push(`quantityStep conflict: explicit ${explicitSpec.quantityStep} vs OKX ${okxSpec.quantityStep}`);
      } else {
        merged.quantityStep = explicitSpec.quantityStep;
      }
    }
    if (explicitSpec.minQuantity !== undefined) merged.minQuantity = explicitSpec.minQuantity;
    if (explicitSpec.tickSize !== undefined) merged.tickSize = explicitSpec.tickSize;
    if (explicitSpec.quoteCurrency) {
      if (okxSpec.quoteCurrency && explicitSpec.quoteCurrency.toUpperCase() !== okxSpec.quoteCurrency) {
        conflicts.push(
          `settlement currency conflict: explicit ${explicitSpec.quoteCurrency} vs OKX ${okxSpec.quoteCurrency}`,
        );
      } else {
        merged.quoteCurrency = explicitSpec.quoteCurrency.toUpperCase();
      }
    }
    if (explicitSpec.assetClass) merged.assetClass = explicitSpec.assetClass;
  }

  if (conflicts.length > 0) {
    return {
      status: "conflict",
      spec: merged,
      okxFields,
      missingForSizing: [],
      conflicts,
      mappedInstId: instId,
      unavailableReason: `specification conflicts detected — sizing blocked until resolved: ${conflicts.join("; ")}`,
    };
  }

  return { status: "available", spec: merged, okxFields, missingForSizing: [], conflicts: [], mappedInstId: instId };
}
