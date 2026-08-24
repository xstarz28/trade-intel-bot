/**
 * Phase 7B-2 — CFTC Commitments of Traders positioning (pure module).
 *
 * Source (verified live): publicreporting.cftc.gov Socrata dataset 6dca-aqww
 * (Legacy Futures-Only report). No API key.
 *
 * NON-NEGOTIABLE:
 * - COT is WEEKLY regulated-futures positioning — never live data, never
 *   exchange/retail positioning, never convertible to funding rates.
 *   It is always labeled "CFTC Futures Positioning".
 * - Contract names are mapped EXPLICITLY (every mapping verified against the
 *   live dataset). If no verified mapping exists → mappingStatus UNAVAILABLE,
 *   never forced. Crypto spot has NO COT mapping by design.
 * - Positioning LEVEL is never scored directionally (high long ≠ bullish).
 *   Directional evidence comes only from the CHANGE between two actual
 *   consecutive reports, scaled by open interest. No synthetic z-scores or
 *   percentiles (insufficient history in this integration).
 *
 * No `@/` alias imports: this module is also consumed by Convex actions.
 */

// ── Types ──────────────────────────────────────────────────────────

export type CotFreshness = "FRESH" | "DELAYED" | "STALE";

export interface CotReport {
  reportDate: string; // YYYY-MM-DD from the report itself
  nonCommercialLong: number;
  nonCommercialShort: number;
  commercialLong?: number;
  commercialShort?: number;
  openInterest?: number;
}

export interface CotMapping {
  /** Exact CFTC market_and_exchange_names value (verified live). */
  sourceInstrument: string;
  /** Human-readable description of what is actually measured. */
  mappedAsset: string;
  /**
   * Which side of the trading pair the futures contract represents:
   * "base" (EUR/USD → EUR contract), "quote" (USD/JPY → JPY contract),
   * or "asset" (XAU/USD → Gold contract itself).
   */
  contractSide: "base" | "quote" | "asset";
}

export interface CotContext {
  available: true;
  source: "CFTC Commitments of Traders (publicreporting.cftc.gov)";
  fetchedAt: number;
  freshness: CotFreshness;
  requestedInstrument: string;
  sourceInstrument: string;
  mappedAsset: string;
  latest: CotReport;
  previous?: CotReport;
  netNonCommercial: number; // latest: nonCommercialLong − nonCommercialShort
  changeFromPreviousReport?: number; // net vs previous net; absent if no previous
}

export interface CotUnavailable {
  available: false;
  reason: string;
  requestedInstrument: string;
}

export type CotData = CotContext | CotUnavailable;

/**
 * Derived directional evidence from ACTUAL consecutive reports.
 * Zero = no directional evidence (availability ≠ confluence).
 */
export interface CotEvidence {
  /** Effect on the CONTRACT currency from positioning change, in [-1,1]. */
  effectOnContractCurrency: number;
  /**
   * Crowding context flag: |net|/openInterest at or above threshold on the
   * LATEST report. Crowded positioning may act as continuation evidence OR
   * contrarian risk — interpretation is left to the engine's contradiction
   * layer, never a directional score by itself.
   */
  crowded: boolean;
  crowdRatio?: number;
  notes: string[];
}

// ── Documented policy parameters ───────────────────────────────────

/** Weekly-release freshness windows (days since report date). */
export const COT_FRESH_DAYS = 10; // normal inter-release maximum
export const COT_DELAYED_DAYS = 17; // tolerates one missed release

/**
 * Change signal thresholds as a fraction of open interest:
 * below SIGNAL the change is noise → no directional evidence;
 * FULL is where effect magnitude saturates.
 */
export const COT_SIGNAL_CHANGE_OI_RATIO = 0.005;
export const COT_FULL_EFFECT_OI_RATIO = 0.05;
/** |net|/OI at which positioning is flagged as crowded (context only). */
export const COT_CROWDING_OI_RATIO = 0.4;

// ── Instrument mapping (each name verified against the live dataset) ──

const CME = "- CHICAGO MERCANTILE EXCHANGE";

export function mapInstrumentToCot(instrumentRaw: string): CotMapping | undefined {
  const instrument = instrumentRaw.trim().toUpperCase();
  const pairs: Record<string, CotMapping> = {
    "EUR/USD": { sourceInstrument: `EURO FX ${CME}`, mappedAsset: "Euro FX futures (CME)", contractSide: "base" },
    "GBP/USD": { sourceInstrument: `BRITISH POUND ${CME}`, mappedAsset: "British Pound futures (CME)", contractSide: "base" },
    "AUD/USD": { sourceInstrument: `AUSTRALIAN DOLLAR ${CME}`, mappedAsset: "Australian Dollar futures (CME)", contractSide: "base" },
    "USD/JPY": { sourceInstrument: `JAPANESE YEN ${CME}`, mappedAsset: "Japanese Yen futures (CME)", contractSide: "quote" },
    "USD/CAD": { sourceInstrument: `CANADIAN DOLLAR ${CME}`, mappedAsset: "Canadian Dollar futures (CME)", contractSide: "quote" },
    "USD/CHF": { sourceInstrument: `SWISS FRANC ${CME}`, mappedAsset: "Swiss Franc futures (CME)", contractSide: "quote" },
  };
  if (pairs[instrument]) return pairs[instrument];
  // Commodity contracts (asset itself):
  if (/XAU|GOLD/.test(instrument))
    return { sourceInstrument: "GOLD - COMMODITY EXCHANGE INC.", mappedAsset: "Gold futures (COMEX)", contractSide: "asset" };
  if (/XAG|SILVER/.test(instrument))
    return { sourceInstrument: "SILVER - COMMODITY EXCHANGE INC.", mappedAsset: "Silver futures (COMEX)", contractSide: "asset" };
  if (/WTI|CRUDE|USOIL|UKOIL|BRENT/.test(instrument))
    return { sourceInstrument: "WTI FINANCIAL CRUDE OIL - NEW YORK MERCANTILE EXCHANGE", mappedAsset: "WTI Crude Oil futures (NYMEX)", contractSide: "asset" };
  // Crypto, indices, stocks: NO verified CFTC mapping — unavailable, not forced.
  return undefined;
}

// ── Parsing & context building ─────────────────────────────────────

function toInt(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return Math.round(v);
  if (typeof v === "string") {
    const n = parseInt(v, 10);
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function toDate(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const m = v.match(/^(\d{4}-\d{2}-\d{2})/);
  return m ? m[1] : undefined;
}

function parseReportRow(row: unknown): CotReport | undefined {
  if (typeof row !== "object" || row === null) return undefined;
  const r = row as Record<string, unknown>;
  const reportDate = toDate(r.report_date_as_yyyy_mm_dd);
  const long = toInt(r.noncomm_positions_long_all);
  const short = toInt(r.noncomm_positions_short_all);
  if (!reportDate || long === undefined || short === undefined) return undefined; // unusable row
  return {
    reportDate,
    nonCommercialLong: long,
    nonCommercialShort: short,
    ...(toInt(r.comm_positions_long_all) !== undefined ? { commercialLong: toInt(r.comm_positions_long_all) } : {}),
    ...(toInt(r.comm_positions_short_all) !== undefined ? { commercialShort: toInt(r.comm_positions_short_all) } : {}),
    ...(toInt(r.open_interest_all) !== undefined && (r.open_interest_all ?? 0) !== 0 ? { openInterest: toInt(r.open_interest_all) } : {}),
  };
}

export function classifyCotFreshness(reportDate: string, nowMs: number): CotFreshness {
  const t = Date.parse(`${reportDate}T00:00:00Z`);
  if (!Number.isFinite(t)) return "STALE";
  const ageDays = Math.max(0, (nowMs - t) / 86400e3);
  if (ageDays <= COT_FRESH_DAYS) return "FRESH";
  if (ageDays <= COT_DELAYED_DAYS) return "DELAYED";
  return "STALE";
}

/**
 * Build the COT context from raw Socrata rows (already filtered to one
 * market by the caller). Missing fields degrade honestly; an unmappable
 * instrument or zero usable rows yields an explicit unavailable state.
 */
export function buildCotContext(
  rows: unknown[],
  requestedInstrument: string,
  nowMs: number,
): CotData {
  const mapping = mapInstrumentToCot(requestedInstrument);
  if (!mapping) {
    return {
      available: false,
      reason: `No verified CFTC futures contract mapping for ${requestedInstrument} — COT positioning stays explicitly unavailable.`,
      requestedInstrument,
    };
  }
  const reports = rows
    .map(parseReportRow)
    .filter((r): r is CotReport => !!r)
    .sort((a, b) => a.reportDate.localeCompare(b.reportDate));
  const latest = reports[reports.length - 1];
  if (!latest) {
    return {
      available: false,
      reason: `CFTC returned no usable reports for "${mapping.sourceInstrument}".`,
      requestedInstrument,
    };
  }
  const previous = reports.length > 1 ? reports[reports.length - 2] : undefined;
  const netNonCommercial = latest.nonCommercialLong - latest.nonCommercialShort;
  return {
    available: true,
    source: "CFTC Commitments of Traders (publicreporting.cftc.gov)",
    fetchedAt: nowMs,
    freshness: classifyCotFreshness(latest.reportDate, nowMs),
    requestedInstrument,
    sourceInstrument: mapping.sourceInstrument,
    mappedAsset: mapping.mappedAsset,
    latest,
    ...(previous ? { previous } : {}),
    netNonCommercial,
    ...(previous ? { changeFromPreviousReport: netNonCommercial - (previous.nonCommercialLong - previous.nonCommercialShort) } : {}),
  };
}

// ── Evidence derivation ────────────────────────────────────────────

function clampUnit(v: number): number {
  return Math.max(-1, Math.min(1, v));
}

/**
 * Derive positioning evidence from TWO actual consecutive weekly reports.
 * Level alone is never directional. Crowding uses the actual net/OI ratio
 * as context — its interpretation (continuation vs contrarian risk) belongs
 * to the engine's contradiction layer together with structure and location.
 */
export function deriveCotEvidence(ctx: CotContext): CotEvidence {
  const notes: string[] = [];
  let effectOnContractCurrency = 0;
  let crowded = false;
  let crowdRatio: number | undefined;

  const oi = ctx.latest.openInterest;
  if (oi && oi > 0) {
    crowdRatio = Math.abs(ctx.netNonCommercial) / oi;
    crowded = crowdRatio >= COT_CROWDING_OI_RATIO;
    if (crowded) {
      notes.push(
        `Crowding context: non-commercial net position equals ${(crowdRatio * 100).toFixed(0)}% of open interest — may represent continuation fuel OR contrarian risk depending on structure and price location.`,
      );
    }
  }

  if (ctx.changeFromPreviousReport === undefined || !ctx.previous) {
    notes.push("Only one report available — positioning-change evidence requires two consecutive reports.");
    return { effectOnContractCurrency, crowded, ...(crowdRatio !== undefined ? { crowdRatio } : {}), notes };
  }

  const oiRef = ctx.latest.openInterest ?? ctx.previous.openInterest;
  if (!oiRef || oiRef <= 0) {
    notes.push("Open interest unavailable — change cannot be scaled honestly; no directional evidence.");
    return { effectOnContractCurrency, crowded, ...(crowdRatio !== undefined ? { crowdRatio } : {}), notes };
  }

  const changeRatio = Math.abs(ctx.changeFromPreviousReport) / oiRef;
  if (changeRatio < COT_SIGNAL_CHANGE_OI_RATIO) {
    notes.push(
      `Positioning change ${ctx.changeFromPreviousReport > 0 ? "+" : ""}${ctx.changeFromPreviousReport.toLocaleString()} (${(changeRatio * 100).toFixed(2)}% of OI) below signal threshold — no directional evidence.`,
    );
    return { effectOnContractCurrency, crowded, ...(crowdRatio !== undefined ? { crowdRatio } : {}), notes };
  }

  // Rising non-commercial net long = supportive for the CONTRACT currency.
  effectOnContractCurrency = clampUnit(ctx.changeFromPreviousReport / oiRef / COT_FULL_EFFECT_OI_RATIO);
  notes.push(
    `Non-commercial positioning ${ctx.changeFromPreviousReport > 0 ? "net length increasing" : "net length decreasing"} (${ctx.changeFromPreviousReport > 0 ? "+" : ""}${ctx.changeFromPreviousReport.toLocaleString()}, ${(changeRatio * 100).toFixed(1)}% of OI) — ${effectOnContractCurrency > 0 ? "supportive" : "opposing"} for ${ctx.mappedAsset} at swing horizon.`,
  );

  return { effectOnContractCurrency, crowded, ...(crowdRatio !== undefined ? { crowdRatio } : {}), notes };
}
