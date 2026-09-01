import { describe, it, expect, beforeEach, vi } from "vitest";
import en from "./en";
import id from "./id";
import type { Translations, Locale } from "./types";
import { SUPPORTED_LOCALES, DEFAULT_LOCALE, LOCALE_LABELS } from "./types";

// ─── Helper: recursively collect all leaf string keys ──────────
function collectLeafKeys(obj: Record<string, unknown>, prefix = ""): string[] {
  const keys: string[] = [];
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "string") {
      keys.push(path);
    } else if (v && typeof v === "object") {
      keys.push(...collectLeafKeys(v as Record<string, unknown>, path));
    }
  }
  return keys;
}

describe("i18n — EN/ID key parity", () => {
  it("EN and ID have the same top-level keys", () => {
    const enKeys = Object.keys(en).sort();
    const idKeys = Object.keys(id).sort();
    expect(enKeys).toEqual(idKeys);
  });

  it("EN and ID have the same leaf keys at every level", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>);
    const idLeaves = collectLeafKeys(id as unknown as Record<string, unknown>);
    expect(enLeaves.sort()).toEqual(idLeaves.sort());
  });

  it("EN and ID have the same number of leaf keys", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>);
    const idLeaves = collectLeafKeys(id as unknown as Record<string, unknown>);
    expect(enLeaves.length).toBe(idLeaves.length);
    expect(enLeaves.length).toBeGreaterThan(100);
  });

  it("no EN leaf is empty string", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>);
    for (const key of enLeaves) {
      const parts = key.split(".");
      let val: unknown = en;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });

  it("no ID leaf is empty string", () => {
    const idLeaves = collectLeafKeys(id as unknown as Record<string, unknown>);
    for (const key of idLeaves) {
      const parts = key.split(".");
      let val: unknown = id;
      for (const p of parts) val = (val as Record<string, unknown>)?.[p];
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });
});

describe("i18n — supported locales", () => {
  it("SUPPORTED_LOCALES includes en and id", () => {
    expect(SUPPORTED_LOCALES).toContain("en");
    expect(SUPPORTED_LOCALES).toContain("id");
  });

  it("DEFAULT_LOCALE is en", () => {
    expect(DEFAULT_LOCALE).toBe("en");
  });

  it("LOCALE_LABELS has entries for all supported locales", () => {
    for (const loc of SUPPORTED_LOCALES) {
      expect(LOCALE_LABELS[loc]).toBeTruthy();
    }
  });
});

describe("i18n — key coverage for critical sections", () => {
  it("has all nav keys", () => {
    const navKeys = ["overview", "analysis", "protection", "portfolio", "intelligence", "positions", "feed", "alerts", "notifications", "market", "system", "rules"];
    for (const k of navKeys) {
      expect((en as any).nav[k]).toBeTruthy();
      expect((id as any).nav[k]).toBeTruthy();
    }
  });

  it("has all trader workspace keys", () => {
    const traderKeys = ["portfolioOverview", "positions", "portfolioContext", "dataQuality", "systemHealth", "actions", "decisionSupport", "evidenceTrace", "currentAssessment", "positionMetrics", "marketContext"];
    for (const k of traderKeys) {
      expect((en as any).trader[k]).toBeTruthy();
      expect((id as any).trader[k]).toBeTruthy();
    }
  });

  it("has all investor workspace keys", () => {
    const investorKeys = ["noPositions", "noPositionsHint", "portfolioHealth", "positions", "healthy", "atRisk", "invalidated", "riskSummary", "riskLevel"];
    for (const k of investorKeys) {
      expect((en as any).investor[k]).toBeTruthy();
      expect((id as any).investor[k]).toBeTruthy();
    }
  });

  it("has all protection keys", () => {
    const protKeys = ["title", "addPosition", "noPositions", "noPositionsHint", "technicalIntelligence", "mtfAnalysis", "fundamentalIntelligence", "macroIntelligence", "crossAssetIntelligence", "causalTransmission", "techFundAlignment", "decisionSupportTitle"];
    for (const k of protKeys) {
      expect((en as any).protection[k]).toBeTruthy();
      expect((id as any).protection[k]).toBeTruthy();
    }
  });

  it("has all intelligence keys", () => {
    const intelKeys = ["technical", "fundamental", "macro", "crossAsset", "news", "newsIntelligence", "fundamentals", "evidenceHierarchy", "scenarios", "whatChanged", "analyticalSummary", "keyLevelsLabel"];
    for (const k of intelKeys) {
      expect((en as any).intelligence[k]).toBeTruthy();
      expect((id as any).intelligence[k]).toBeTruthy();
    }
  });

  it("has all decision support keys", () => {
    const decKeys = ["supportingEvidence", "conflictingEvidence", "whatCouldChange", "whatToMonitor", "dataAvailability", "thesisHealth"];
    for (const k of decKeys) {
      expect((en as any).decision[k]).toBeTruthy();
      expect((id as any).decision[k]).toBeTruthy();
    }
  });

  it("has all status keys including new stream/monitoring statuses", () => {
    const statusKeys = ["available", "unavailable", "insufficientData", "healthy", "stable", "caution", "deteriorating", "severelyDeteriorating", "invalidated", "unknown", "none", "watch", "highRisk", "live", "reconnecting", "dataStale", "disconnected", "monitoringPaused", "limited", "insufficient"];
    for (const k of statusKeys) {
      expect((en as any).status[k]).toBeTruthy();
      expect((id as any).status[k]).toBeTruthy();
    }
  });

  it("has all macro regime keys", () => {
    const macroKeys = ["regime", "stagflation", "reflation", "disinflation", "contraction", "recovery", "riskOn", "riskOff", "stressed", "mixed", "insufficientData"];
    for (const k of macroKeys) {
      expect((en as any).macro[k]).toBeTruthy();
      expect((id as any).macro[k]).toBeTruthy();
    }
  });

  it("has all fundamental keys", () => {
    const fundKeys = ["macroRegime", "inflationRatesYieldsCurrency", "growthEnergyGeopolitical", "fundamentalEvidence", "technicalVsFundamental", "fundamentalTransmission", "whatCouldChangeMonitor", "dataAvailability", "overall", "inflationLabel", "driver", "marketRates", "policyRateLabel", "realYields", "usd", "liquidityLabel", "tips10y"];
    for (const k of fundKeys) {
      expect((en as any).fundamental[k]).toBeTruthy();
      expect((id as any).fundamental[k]).toBeTruthy();
    }
  });

  it("has all journal keys", () => {
    const journalKeys = ["title", "createEntry", "backToDashboard", "journalAsTrade", "journalAsObservation", "entryReason", "thesisAtEntry"];
    for (const k of journalKeys) {
      expect((en as any).journal[k]).toBeTruthy();
      expect((id as any).journal[k]).toBeTruthy();
    }
  });

  it("has all global keys", () => {
    const globalKeys = ["loading", "error", "empty", "back", "save", "cancel", "close", "confirm", "exit", "search", "filter", "refresh", "noData", "disclaimer", "guest"];
    for (const k of globalKeys) {
      expect((en as any).global[k]).toBeTruthy();
      expect((id as any).global[k]).toBeTruthy();
    }
  });

  it("has all dashboard keys", () => {
    const dashKeys = ["terminalReady", "terminalDescription", "factors", "timeframes", "instruments", "selectInstrument", "notFound", "pageNotFound"];
    for (const k of dashKeys) {
      expect((en as any).dashboard[k]).toBeTruthy();
      expect((id as any).dashboard[k]).toBeTruthy();
    }
  });

  it("has all alerts keys", () => {
    const alertKeys = ["title", "createRule", "editRule", "deleteRule", "ruleName", "condition", "severity", "scope", "instrument", "position", "cooldown", "enabled", "disabled", "save", "cancel", "noRules", "noRulesHint"];
    for (const k of alertKeys) {
      expect((en as any).alerts[k]).toBeTruthy();
      expect((id as any).alerts[k]).toBeTruthy();
    }
  });

  it("has all notifications keys", () => {
    const notifKeys = ["title", "markAllRead", "dismiss", "noNotifications", "noUnread", "unread", "read", "ago", "now", "minutes", "hours", "days"];
    for (const k of notifKeys) {
      expect((en as any).notifications[k]).toBeTruthy();
      expect((id as any).notifications[k]).toBeTruthy();
    }
  });

  it("has all market keys", () => {
    const mktKeys = ["title", "live", "stale", "unavailable", "vix", "dxy", "us10y", "wti", "noData"];
    for (const k of mktKeys) {
      expect((en as any).market[k]).toBeTruthy();
      expect((id as any).market[k]).toBeTruthy();
    }
  });

  it("has all system keys", () => {
    const sysKeys = ["title", "overallStatus", "healthy", "degraded", "failed", "components", "lastUpdate", "noData", "intelligenceCycle", "alertPipeline", "persistence", "allOperational"];
    for (const k of sysKeys) {
      expect((en as any).system[k]).toBeTruthy();
      expect((id as any).system[k]).toBeTruthy();
    }
  });

  it("has all analysis keys", () => {
    const anaKeys = ["runAnalysis", "analyzing", "selectInstrument", "timeframe", "noResult", "confidence", "bias", "recommendation", "bullish", "bearish", "noTrade", "long", "short", "technicalSummary", "fundamentalSummary", "keyLevels", "support", "resistance", "invalidationLevel", "riskNote", "dataCompleteness"];
    for (const k of anaKeys) {
      expect((en as any).analysis[k]).toBeTruthy();
      expect((id as any).analysis[k]).toBeTruthy();
    }
  });

  it("has all emptyStates keys", () => {
    const emptyKeys = ["noPositions", "noAlerts", "noNotifications", "noNews", "noMarketData", "noAnalysis", "noHistory", "selectToBegin"];
    for (const k of emptyKeys) {
      expect((en as any).emptyStates[k]).toBeTruthy();
      expect((id as any).emptyStates[k]).toBeTruthy();
    }
  });

  it("has all forms keys", () => {
    const formKeys = ["required", "optional", "invalid", "enterPrice", "enterInstrument", "selectSide", "selectHorizon", "selectTimeframe"];
    for (const k of formKeys) {
      expect((en as any).forms[k]).toBeTruthy();
      expect((id as any).forms[k]).toBeTruthy();
    }
  });
});

describe("i18n — interpolation support", () => {
  it("notifications.unread supports {count}", () => {
    expect(en.notifications.unread).toContain("{count}");
    expect(id.notifications.unread).toContain("{count}");
  });

  it("notifications.ago supports {time}", () => {
    expect(en.notifications.ago).toContain("{time}");
    expect(id.notifications.ago).toContain("{time}");
  });

  it("notifications.minutes supports {count}", () => {
    expect(en.notifications.minutes).toContain("{count}");
    expect(id.notifications.minutes).toContain("{count}");
  });

  it("notifications.hours supports {count}", () => {
    expect(en.notifications.hours).toContain("{count}");
    expect(id.notifications.hours).toContain("{count}");
  });

  it("notifications.days supports {count}", () => {
    expect(en.notifications.days).toContain("{count}");
    expect(id.notifications.days).toContain("{count}");
  });

  it("protection.positionsCount supports {count}", () => {
    expect(en.protection.positionsCount).toContain("{count}");
    expect(id.protection.positionsCount).toContain("{count}");
  });
});

describe("i18n — EN/ID different translations (not identical)", () => {
  it("global.loading is different between EN and ID", () => {
    expect(en.global.loading).not.toBe(id.global.loading);
  });

  it("nav.analysis is different between EN and ID", () => {
    expect(en.nav.analysis).not.toBe(id.nav.analysis);
  });

  it("status.healthy is different between EN and ID", () => {
    expect(en.status.healthy).not.toBe(id.status.healthy);
  });

  it("trader.portfolioOverview is different between EN and ID", () => {
    expect(en.trader.portfolioOverview).not.toBe(id.trader.portfolioOverview);
  });

  it("investor.noPositions is different between EN and ID", () => {
    expect(en.investor.noPositions).not.toBe(id.investor.noPositions);
  });

  it("protection.title is different between EN and ID", () => {
    expect(en.protection.title).not.toBe(id.protection.title);
  });

  it("fundamental.overall is different between EN and ID", () => {
    expect(en.fundamental.overall).not.toBe(id.fundamental.overall);
  });

  it("journal.title is different between EN and ID", () => {
    expect(en.journal.title).not.toBe(id.journal.title);
  });
});

describe("i18n — EN/ID same values for universal terms", () => {
  it("market.vix is same (universal ticker)", () => {
    expect(en.market.vix).toBe(id.market.vix);
  });

  it("market.dxy is same (universal ticker)", () => {
    expect(en.market.dxy).toBe(id.market.dxy);
  });

  it("market.us10y is same (universal ticker)", () => {
    expect(en.market.us10y).toBe(id.market.us10y);
  });

  it("market.wti is same (universal ticker)", () => {
    expect(en.market.wti).toBe(id.market.wti);
  });

  it("analysis.long is same (trading term)", () => {
    expect(en.analysis.long).toBe(id.analysis.long);
  });

  it("analysis.short is same (trading term)", () => {
    expect(en.analysis.short).toBe(id.analysis.short);
  });
});
