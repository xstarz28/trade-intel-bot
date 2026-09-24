import { describe, expect, it } from "vitest";
import {
  assessEvidenceConfidence,
  type EvidenceConfidenceInput,
} from "./evidence-confidence";

const FULL: EvidenceConfidenceInput = {
  freshness: "FRESH",
  dataCompleteness: "FULL",
  providerCoverage: "FULL",
  missingCriticalCount: 0,
  conflictingCount: 0,
  hasVerifiedLivePrice: true,
  hasOhlcv: true,
  hasExecutionEvidence: true,
  supportingCount: 4,
};

const MINIMAL: EvidenceConfidenceInput = {
  freshness: "DELAYED",
  dataCompleteness: "MINIMAL",
  providerCoverage: "MINIMAL",
  missingCriticalCount: 3,
  conflictingCount: 0,
  hasVerifiedLivePrice: true,
  hasOhlcv: false,
  hasExecutionEvidence: false,
  supportingCount: 0,
};

describe("evidence-quality confidence", () => {
  it("full + fresh + coherent evidence scores higher than minimal evidence", () => {
    const full = assessEvidenceConfidence(FULL);
    const minimal = assessEvidenceConfidence(MINIMAL);
    expect(full.confidence).toBeGreaterThan(minimal.confidence + 20);
  });

  it("conflicting evidence reduces confidence materially", () => {
    const clean = assessEvidenceConfidence(FULL);
    const conflicted = assessEvidenceConfidence({
      ...FULL,
      conflictingCount: 2,
      supportingCount: 2,
    });
    expect(clean.confidence - conflicted.confidence).toBeGreaterThanOrEqual(20);
  });

  it("missing critical evidence reduces confidence", () => {
    const complete = assessEvidenceConfidence(FULL);
    const missing = assessEvidenceConfidence({
      ...FULL,
      missingCriticalCount: 2,
    });
    expect(complete.confidence - missing.confidence).toBeGreaterThanOrEqual(15);
  });

  it("same data quality but different verified provider coverage produces different confidence", () => {
    const base = {
      ...FULL,
      dataCompleteness: "PARTIAL" as const,
      freshness: "FRESH" as const,
    };
    const fullCov = assessEvidenceConfidence({
      ...base,
      providerCoverage: "FULL",
    });
    const minCov = assessEvidenceConfidence({
      ...base,
      providerCoverage: "MINIMAL",
    });
    expect(fullCov.confidence).toBeGreaterThan(minCov.confidence);
    expect(fullCov.confidence - minCov.confidence).toBeGreaterThanOrEqual(10);
  });

  it("does not special-case popular names — the instrument is not an input", () => {
    expect(Object.keys(FULL)).not.toContain("instrument");
    const a = assessEvidenceConfidence(FULL);
    const b = assessEvidenceConfidence(FULL);
    expect(a.confidence).toBe(b.confidence);
  });

  it("confidence is explicitly NOT win-rate / probability of profit", () => {
    const result = assessEvidenceConfidence(FULL);
    expect(result.notProbabilityOfProfit).toBe(true);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(100);
  });

  it("is deterministic", () => {
    expect(assessEvidenceConfidence(FULL)).toEqual(
      assessEvidenceConfidence(FULL),
    );
  });

  it("does not cluster every live snapshot onto the same baseline", () => {
    const values = [
      assessEvidenceConfidence(FULL).confidence,
      assessEvidenceConfidence(MINIMAL).confidence,
      assessEvidenceConfidence({
        ...FULL,
        freshness: "DELAYED",
        providerCoverage: "PARTIAL",
      }).confidence,
      assessEvidenceConfidence({
        ...FULL,
        conflictingCount: 1,
        supportingCount: 3,
      }).confidence,
    ];
    expect(new Set(values).size).toBe(values.length);
  });
});
