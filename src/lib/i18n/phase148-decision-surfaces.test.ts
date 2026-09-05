/**
 * Phase 148 - decision-surface wiring regression coverage.
 *
 * Position side is a decision-relevant enum. These surfaces must use the
 * centralized mapper so localized labels cannot drift or leak raw values.
 */
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { resolve } from "node:path";
import en from "./en";
import id from "./id";
import es from "./es";
import pt from "./pt";
import { mapSide } from "./enum-mapping";

const componentPaths = [
  "src/components/TraderWorkspace.tsx",
  "src/components/InvestorWorkspace.tsx",
  "src/components/NotificationCenter.tsx",
  "src/components/RuntimeHealthDashboard.tsx",
  "src/components/AnalysisResult.tsx",
];

describe("Phase 148 - decision-surface side mapping", () => {
  it("preserves side semantics while localizing supported labels", () => {
    for (const translations of [en, id, es, pt]) {
      expect(mapSide("LONG", translations)).toBe(translations.analysis.long);
      expect(mapSide("SHORT", translations)).toBe(translations.analysis.short);
    }
    expect(mapSide("FUTURE_SIDE", en)).toBe("FUTURE SIDE");
  });

  it("routes trader, investor, and notification side displays through mapSide", () => {
    for (const relativePath of componentPaths.slice(0, 3)) {
      const source = readFileSync(resolve(process.cwd(), relativePath), "utf8");
      expect(source).toContain("mapSide");
    }

    expect(readFileSync(resolve(process.cwd(), componentPaths[0]), "utf8"))
      .not.toMatch(/\{intel\.side\}/);
    expect(readFileSync(resolve(process.cwd(), componentPaths[1]), "utf8"))
      .not.toMatch(/\{(?:row|pos)\.side\}/);
    expect(readFileSync(resolve(process.cwd(), componentPaths[2]), "utf8"))
      .not.toMatch(/\{notif\.side\}/);
    expect(readFileSync(resolve(process.cwd(), componentPaths[3]), "utf8"))
      .toContain("getComponentLabel(t, component.component)");
    expect(readFileSync(resolve(process.cwd(), componentPaths[4]), "utf8"))
      .toContain("mapFreshness(result.treasuryContext.freshness, t)");
    expect(readFileSync(resolve(process.cwd(), componentPaths[4]), "utf8"))
      .toContain("mapFreshness(result.cotContext.freshness, t)");
    expect(readFileSync(resolve(process.cwd(), componentPaths[4]), "utf8"))
      .toContain("mapFreshness(result.eiaContext.freshness, t)");
    expect(readFileSync(resolve(process.cwd(), componentPaths[4]), "utf8"))
      .toContain("mapFreshness(result.executionContext.freshness, t)");
  });
});