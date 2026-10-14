import type { InstrumentSpec } from "../risk";

export interface ManualInstrumentSpecFields {
  quoteCurrency: string;
  contractSize: string;
  quantityStep: string;
  minQuantity: string;
}

function positiveNumber(raw: string): number | undefined {
  if (!raw.trim()) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/**
 * Convert explicitly entered broker metadata to a partial InstrumentSpec.
 * Empty/invalid values remain absent: this helper never fills contract
 * conventions, lot size, currency, or minimum quantity from an asset class.
 */
export function buildManualInstrumentSpec(args: {
  instrument: string;
  assetClass: string;
  fields: ManualInstrumentSpecFields;
}): InstrumentSpec | undefined {
  const contractSize = positiveNumber(args.fields.contractSize);
  const quantityStep = positiveNumber(args.fields.quantityStep);
  const minQuantity = positiveNumber(args.fields.minQuantity);
  const rawQuote = args.fields.quoteCurrency.trim().toUpperCase();
  const quoteCurrency = /^[A-Z0-9]{3,6}$/.test(rawQuote) ? rawQuote : undefined;

  if (
    contractSize === undefined &&
    quantityStep === undefined &&
    minQuantity === undefined &&
    quoteCurrency === undefined
  ) {
    return undefined;
  }

  return {
    assetClass: args.assetClass,
    ...(contractSize !== undefined ? { contractSize } : {}),
    ...(quantityStep !== undefined ? { quantityStep } : {}),
    ...(minQuantity !== undefined ? { minQuantity } : {}),
    ...(quoteCurrency ? { quoteCurrency } : {}),
    source: `user-provided broker specification (${args.instrument.trim()})`,
  };
}
