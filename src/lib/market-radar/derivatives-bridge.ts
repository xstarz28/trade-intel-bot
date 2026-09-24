/**
 * Phase 226 — CoinGlass derivatives → radar candidate bridge.
 *
 * The only authenticated CoinGlass acquisition is the Convex action
 * `coinglass.fetchDerivatives`, which returns `CryptoDerivativesData` with the
 * provider's own observation `timestamp`. The Dashboard keeps that payload on
 * each `LiveCandidateSource.derivativesData`, but until this phase the radar
 * mapping dropped it, so `RadarCandidateSource.derivatives` — which
 * `radar.ts` scoring and `candidate-builder.ts` read — was always undefined.
 *
 * This bridge is the single place that decides whether a derivatives payload
 * may reach the radar. It is deliberately strict:
 *
 *  - identity: the payload's `symbol` must be the base asset of the candidate
 *    instrument (`BTC/USD` → `BTC`). A payload for another coin is rejected,
 *    never re-labelled.
 *  - provenance: the provider timestamp must be finite, not in the future and
 *    within the radar's own freshness window (`assessFreshness` ≠ UNAVAILABLE).
 *    A payload the provider marks `unavailable` is rejected.
 *  - values: a dataset is forwarded only when the provider flagged it available
 *    AND the number is finite. Nothing is defaulted to 0.
 *  - result: undefined when no dataset survives, so downstream keeps treating
 *    derivatives as MISSING rather than present-but-empty.
 */
import type { CryptoDerivativesData } from "@/lib/data/derivatives-types";
import type { RadarCandidateSource } from "./candidate-builder";
import { assessFreshness } from "./freshness";

export type RadarDerivatives = NonNullable<RadarCandidateSource["derivatives"]>;

/** Base asset of a canonical crypto instrument, upper-cased: "eth/usd" → "ETH". */
export function baseAssetOf(instrument: string): string {
  return instrument.toUpperCase().trim().split("/")[0] ?? "";
}

export interface DerivativesBridgeResult {
  derivatives?: RadarDerivatives;
  /** Why nothing (or only part) was forwarded. Empty when fully forwarded. */
  rejected: string[];
  /** Phase 241 — explicit additional evidence inventory with freshness/provenance */
  additionalEvidence?: Array<{
    source: string;
    provider: string;
    observedAt?: number;
    acquiredAt?: number;
    timestampProvenance?: "PROVIDER_OBSERVED" | "PROVIDER_RESPONSE" | "APPLICATION_RECEIPT" | "UNKNOWN";
    freshness: "FRESH" | "DELAYED" | "STALE" | "UNAVAILABLE" | "UNKNOWN";
    required: boolean;
  }>;
}

export function derivativesForRadar(
  instrument: string,
  data: CryptoDerivativesData | undefined | null,
  now: number,
): DerivativesBridgeResult {
  const rejected: string[] = [];
  if (!data) return { rejected: ["no derivatives payload"] };

  if (data.provider !== "coinglass") {
    return { rejected: [`unknown derivatives provider ${String(data.provider)}`] };
  }
  const expected = baseAssetOf(instrument);
  if (!expected || String(data.symbol).toUpperCase() !== expected) {
    return { rejected: [`symbol mismatch: payload ${String(data.symbol)} vs instrument ${instrument}`] };
  }
  if (data.freshness === "unavailable" || data.confidence === "unavailable") {
    return { rejected: ["provider marked payload unavailable"] };
  }
  if (typeof data.timestamp !== "number" || !Number.isFinite(data.timestamp)) {
    return { rejected: ["missing provider observation timestamp"] };
  }
  const freshness = assessFreshness(data.timestamp, now);
  if (freshness === "UNAVAILABLE") {
    return { rejected: [`provider observation outside freshness window (${now - data.timestamp} ms old)`] };
  }

  const out: RadarDerivatives = {};
  const fr = data.fundingRate?.currentRate;
  if (data.availability?.fundingRate && typeof fr === "number" && Number.isFinite(fr)) out.fundingRate = fr;
  else rejected.push("funding rate not available");

  const oi = data.openInterest?.current;
  if (data.availability?.openInterest && typeof oi === "number" && Number.isFinite(oi) && oi > 0) out.openInterest = oi;
  else rejected.push("open interest not available");

  const liq = data.liquidations?.totalVolume;
  if (data.availability?.liquidations && typeof liq === "number" && Number.isFinite(liq) && liq >= 0) out.liquidationVolume = liq;

  // Phase 241 — build explicit additional evidence entries with freshness contract
  const additionalEvidence: NonNullable<DerivativesBridgeResult["additionalEvidence"]> = [];
  if (out.fundingRate !== undefined) {
    additionalEvidence.push({
      source: "funding",
      provider: "coinglass",
      observedAt: data.timestamp,
      freshness,
      timestampProvenance: "PROVIDER_OBSERVED",
      required: false,
    });
  }
  if (out.openInterest !== undefined) {
    additionalEvidence.push({
      source: "openInterest",
      provider: "coinglass",
      observedAt: data.timestamp,
      freshness,
      timestampProvenance: "PROVIDER_OBSERVED",
      required: false,
    });
  }
  if (out.liquidationVolume !== undefined) {
    additionalEvidence.push({
      source: "derivatives",
      provider: "coinglass",
      observedAt: data.timestamp,
      freshness,
      timestampProvenance: "PROVIDER_OBSERVED",
      required: false,
    });
  }

  if (out.fundingRate === undefined && out.openInterest === undefined && out.liquidationVolume === undefined) {
    return { rejected, additionalEvidence: [] };
  }
  return { derivatives: out, rejected, additionalEvidence };
}
