import { describe, it, expect } from "vitest";
import en from "./en";
import id from "./id";
import es from "./es";
import pt from "./pt";
import { SUPPORTED_LOCALES, LOCALE_LABELS } from "./locales";
import { DEFAULT_LOCALE } from "./types";

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

// ─── Helper: get value at dot-path ─────────────────────────────
function getValueAtPath(obj: unknown, path: string): unknown {
  const parts = path.split(".");
  let current = obj;
  for (const p of parts) {
    if (current === null || current === undefined || typeof current !== "object")
      return undefined;
    current = (current as Record<string, unknown>)[p];
  }
  return current;
}

// ─── Helper: count leaf keys ───────────────────────────────────
function countLeafKeys(obj: Record<string, unknown>): number {
  return collectLeafKeys(obj).length;
}

// ─── EN/ID Key Parity ──────────────────────────────────────────

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
      const val = getValueAtPath(en, key);
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });

  it("no ID leaf is empty string", () => {
    const idLeaves = collectLeafKeys(id as unknown as Record<string, unknown>);
    for (const key of idLeaves) {
      const val = getValueAtPath(id, key);
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });
});

// ─── EN/ES Key Parity ──────────────────────────────────────────

describe("i18n — EN/ES key parity", () => {
  it("EN and ES have the same top-level keys", () => {
    const enKeys = Object.keys(en).sort();
    const esKeys = Object.keys(es).sort();
    expect(enKeys).toEqual(esKeys);
  });

  it("EN and ES have the same leaf keys at every level", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>);
    const esLeaves = collectLeafKeys(es as unknown as Record<string, unknown>);
    expect(enLeaves.sort()).toEqual(esLeaves.sort());
  });

  it("EN and ES have the same number of leaf keys", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>);
    const esLeaves = collectLeafKeys(es as unknown as Record<string, unknown>);
    expect(enLeaves.length).toBe(esLeaves.length);
    expect(esLeaves.length).toBeGreaterThan(100);
  });

  it("no ES leaf is empty string", () => {
    const esLeaves = collectLeafKeys(es as unknown as Record<string, unknown>);
    for (const key of esLeaves) {
      const val = getValueAtPath(es, key);
      expect(typeof val).toBe("string");
      expect((val as string).length).toBeGreaterThan(0);
    }
  });

  it("ES has all EN leaf keys", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>);
    const esLeaves = collectLeafKeys(es as unknown as Record<string, unknown>);
    const esSet = new Set(esLeaves);
    for (const key of enLeaves) {
      expect(esSet.has(key)).toBe(true);
    }
  });
});

// ─── ID/ES Key Parity ──────────────────────────────────────────

describe("i18n — ID/ES key parity", () => {
  it("ID and ES have the same leaf keys", () => {
    const idLeaves = collectLeafKeys(id as unknown as Record<string, unknown>);
    const esLeaves = collectLeafKeys(es as unknown as Record<string, unknown>);
    expect(idLeaves.sort()).toEqual(esLeaves.sort());
  });
});

// ─── All Four Languages Key Parity ────────────────────────────

describe("i18n — EN/ID/ES/PT quadruple parity", () => {
  it("all four languages have the same leaf key count", () => {
    const enCount = countLeafKeys(en as unknown as Record<string, unknown>);
    const idCount = countLeafKeys(id as unknown as Record<string, unknown>);
    const esCount = countLeafKeys(es as unknown as Record<string, unknown>);
    const ptCount = countLeafKeys(pt as unknown as Record<string, unknown>);
    expect(enCount).toBe(idCount);
    expect(idCount).toBe(esCount);
    expect(esCount).toBe(ptCount);
    expect(enCount).toBeGreaterThan(400);
  });

  it("all four languages have the same leaf keys", () => {
    const enLeaves = collectLeafKeys(en as unknown as Record<string, unknown>).sort();
    const idLeaves = collectLeafKeys(id as unknown as Record<string, unknown>).sort();
    const esLeaves = collectLeafKeys(es as unknown as Record<string, unknown>).sort();
    const ptLeaves = collectLeafKeys(pt as unknown as Record<string, unknown>).sort();
    expect(enLeaves).toEqual(idLeaves);
    expect(idLeaves).toEqual(esLeaves);
    expect(esLeaves).toEqual(ptLeaves);
  });
});

// ─── Supported Locales ─────────────────────────────────────────

describe("i18n — supported locales", () => {
  it("SUPPORTED_LOCALES includes all nine canonical locales", () => {
    for (const code of ["en", "id", "es", "pt", "fr", "de", "ja", "ko", "zh"]) {
      expect(SUPPORTED_LOCALES).toContain(code);
    }
    expect(SUPPORTED_LOCALES.length).toBe(9);
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

// ─── Key Coverage for Critical Sections ────────────────────────

describe("i18n — key coverage for critical sections", () => {
  it("has all nav keys in EN/ID/ES", () => {
    const navKeys = ["overview", "analysis", "protection", "portfolio", "intelligence", "positions", "feed", "alerts", "notifications", "market", "system", "rules"];
    for (const k of navKeys) {
      expect((en as any).nav[k]).toBeTruthy();
      expect((id as any).nav[k]).toBeTruthy();
      expect((es as any).nav[k]).toBeTruthy();
    }
  });

  it("has all trader workspace keys in EN/ID/ES", () => {
    const traderKeys = ["portfolioOverview", "positions", "portfolioContext", "dataQuality", "systemHealth", "actions", "decisionSupport", "evidenceTrace", "currentAssessment", "positionMetrics", "marketContext"];
    for (const k of traderKeys) {
      expect((en as any).trader[k]).toBeTruthy();
      expect((id as any).trader[k]).toBeTruthy();
      expect((es as any).trader[k]).toBeTruthy();
    }
  });

  it("has all investor workspace keys in EN/ID/ES", () => {
    const investorKeys = ["noPositions", "noPositionsHint", "portfolioHealth", "positions", "healthy", "atRisk", "invalidated", "riskSummary", "riskLevel"];
    for (const k of investorKeys) {
      expect((en as any).investor[k]).toBeTruthy();
      expect((id as any).investor[k]).toBeTruthy();
      expect((es as any).investor[k]).toBeTruthy();
    }
  });

  it("has all protection keys in EN/ID/ES", () => {
    const protKeys = ["title", "addPosition", "noPositions", "noPositionsHint", "technicalIntelligence", "mtfAnalysis", "fundamentalIntelligence", "macroIntelligence", "crossAssetIntelligence", "causalTransmission", "techFundAlignment", "decisionSupportTitle"];
    for (const k of protKeys) {
      expect((en as any).protection[k]).toBeTruthy();
      expect((id as any).protection[k]).toBeTruthy();
      expect((es as any).protection[k]).toBeTruthy();
    }
  });

  it("has all intelligence keys in EN/ID/ES", () => {
    const intelKeys = ["technical", "fundamental", "macro", "crossAsset", "news", "newsIntelligence", "fundamentals", "evidenceHierarchy", "scenarios", "whatChanged", "analyticalSummary", "keyLevelsLabel"];
    for (const k of intelKeys) {
      expect((en as any).intelligence[k]).toBeTruthy();
      expect((id as any).intelligence[k]).toBeTruthy();
      expect((es as any).intelligence[k]).toBeTruthy();
    }
  });

  it("has all decision support keys in EN/ID/ES", () => {
    const decKeys = ["supportingEvidence", "conflictingEvidence", "whatCouldChange", "whatToMonitor", "dataAvailability", "thesisHealth"];
    for (const k of decKeys) {
      expect((en as any).decision[k]).toBeTruthy();
      expect((id as any).decision[k]).toBeTruthy();
      expect((es as any).decision[k]).toBeTruthy();
    }
  });

  it("has all status keys in EN/ID/ES", () => {
    const statusKeys = ["available", "unavailable", "insufficientData", "healthy", "stable", "caution", "deteriorating", "severelyDeteriorating", "invalidated", "unknown", "none", "watch", "highRisk", "live", "reconnecting", "dataStale", "disconnected", "monitoringPaused", "limited", "insufficient"];
    for (const k of statusKeys) {
      expect((en as any).status[k]).toBeTruthy();
      expect((id as any).status[k]).toBeTruthy();
      expect((es as any).status[k]).toBeTruthy();
    }
  });

  it("has all macro regime keys in EN/ID/ES", () => {
    const macroKeys = ["regime", "stagflation", "reflation", "disinflation", "contraction", "recovery", "riskOn", "riskOff", "stressed", "mixed", "insufficientData"];
    for (const k of macroKeys) {
      expect((en as any).macro[k]).toBeTruthy();
      expect((id as any).macro[k]).toBeTruthy();
      expect((es as any).macro[k]).toBeTruthy();
    }
  });

  it("has all fundamental keys in EN/ID/ES", () => {
    const fundKeys = ["macroRegime", "inflationRatesYieldsCurrency", "growthEnergyGeopolitical", "fundamentalEvidence", "technicalVsFundamental", "fundamentalTransmission", "whatCouldChangeMonitor", "dataAvailability", "overall", "inflationLabel", "driver", "marketRates", "policyRateLabel", "realYields", "usd", "liquidityLabel", "tips10y"];
    for (const k of fundKeys) {
      expect((en as any).fundamental[k]).toBeTruthy();
      expect((id as any).fundamental[k]).toBeTruthy();
      expect((es as any).fundamental[k]).toBeTruthy();
    }
  });

  it("has all journal keys in EN/ID/ES", () => {
    const journalKeys = ["title", "createEntry", "backToDashboard", "journalAsTrade", "journalAsObservation", "entryReason", "thesisAtEntry"];
    for (const k of journalKeys) {
      expect((en as any).journal[k]).toBeTruthy();
      expect((id as any).journal[k]).toBeTruthy();
      expect((es as any).journal[k]).toBeTruthy();
    }
  });

  it("has all global keys in EN/ID/ES", () => {
    const globalKeys = ["loading", "error", "empty", "back", "save", "cancel", "close", "confirm", "exit", "search", "filter", "refresh", "noData", "disclaimer", "guest"];
    for (const k of globalKeys) {
      expect((en as any).global[k]).toBeTruthy();
      expect((id as any).global[k]).toBeTruthy();
      expect((es as any).global[k]).toBeTruthy();
    }
  });

  it("has all dashboard keys in EN/ID/ES", () => {
    const dashKeys = ["terminalReady", "terminalDescription", "factors", "timeframes", "instruments", "selectInstrument", "notFound", "pageNotFound"];
    for (const k of dashKeys) {
      expect((en as any).dashboard[k]).toBeTruthy();
      expect((id as any).dashboard[k]).toBeTruthy();
      expect((es as any).dashboard[k]).toBeTruthy();
    }
  });

  it("has all alerts keys in EN/ID/ES", () => {
    const alertKeys = ["title", "createRule", "editRule", "deleteRule", "ruleName", "condition", "severity", "scope", "instrument", "position", "cooldown", "enabled", "disabled", "save", "cancel", "noRules", "noRulesHint"];
    for (const k of alertKeys) {
      expect((en as any).alerts[k]).toBeTruthy();
      expect((id as any).alerts[k]).toBeTruthy();
      expect((es as any).alerts[k]).toBeTruthy();
    }
  });

  it("has all notifications keys in EN/ID/ES", () => {
    const notifKeys = ["title", "markAllRead", "dismiss", "noNotifications", "noUnread", "unread", "read", "ago", "now", "minutes", "hours", "days"];
    for (const k of notifKeys) {
      expect((en as any).notifications[k]).toBeTruthy();
      expect((id as any).notifications[k]).toBeTruthy();
      expect((es as any).notifications[k]).toBeTruthy();
    }
  });

  it("has all market keys in EN/ID/ES", () => {
    const mktKeys = ["title", "live", "stale", "unavailable", "vix", "dxy", "us10y", "wti", "noData"];
    for (const k of mktKeys) {
      expect((en as any).market[k]).toBeTruthy();
      expect((id as any).market[k]).toBeTruthy();
      expect((es as any).market[k]).toBeTruthy();
    }
  });

  it("has all system keys in EN/ID/ES", () => {
    const sysKeys = ["title", "overallStatus", "healthy", "degraded", "failed", "components", "lastUpdate", "noData", "intelligenceCycle", "alertPipeline", "persistence", "allOperational"];
    for (const k of sysKeys) {
      expect((en as any).system[k]).toBeTruthy();
      expect((id as any).system[k]).toBeTruthy();
      expect((es as any).system[k]).toBeTruthy();
    }
  });

  it("has all analysis keys in EN/ID/ES", () => {
    const anaKeys = ["runAnalysis", "analyzing", "selectInstrument", "timeframe", "noResult", "confidence", "bias", "recommendation", "bullish", "bearish", "noTrade", "long", "short", "technicalSummary", "fundamentalSummary", "keyLevels", "support", "resistance", "invalidationLevel", "riskNote", "dataCompleteness"];
    for (const k of anaKeys) {
      expect((en as any).analysis[k]).toBeTruthy();
      expect((id as any).analysis[k]).toBeTruthy();
      expect((es as any).analysis[k]).toBeTruthy();
    }
  });

  it("has all emptyStates keys in EN/ID/ES", () => {
    const emptyKeys = ["noPositions", "noAlerts", "noNotifications", "noNews", "noMarketData", "noAnalysis", "noHistory", "selectToBegin"];
    for (const k of emptyKeys) {
      expect((en as any).emptyStates[k]).toBeTruthy();
      expect((id as any).emptyStates[k]).toBeTruthy();
      expect((es as any).emptyStates[k]).toBeTruthy();
    }
  });

  it("has all forms keys in EN/ID/ES", () => {
    const formKeys = ["required", "optional", "invalid", "enterPrice", "enterInstrument", "selectSide", "selectHorizon", "selectTimeframe"];
    for (const k of formKeys) {
      expect((en as any).forms[k]).toBeTruthy();
      expect((id as any).forms[k]).toBeTruthy();
      expect((es as any).forms[k]).toBeTruthy();
    }
  });
});

// ─── Interpolation Support ─────────────────────────────────────

describe("i18n — interpolation support", () => {
  it("notifications.unread supports {count} in all languages", () => {
    expect(en.notifications.unread).toContain("{count}");
    expect(id.notifications.unread).toContain("{count}");
    expect(es.notifications.unread).toContain("{count}");
    expect(pt.notifications.unread).toContain("{count}");
  });

  it("notifications.ago supports {time} in all languages", () => {
    expect(en.notifications.ago).toContain("{time}");
    expect(id.notifications.ago).toContain("{time}");
    expect(es.notifications.ago).toContain("{time}");
    expect(pt.notifications.ago).toContain("{time}");
  });

  it("notifications.minutes supports {count} in all languages", () => {
    expect(en.notifications.minutes).toContain("{count}");
    expect(id.notifications.minutes).toContain("{count}");
    expect(es.notifications.minutes).toContain("{count}");
    expect(pt.notifications.minutes).toContain("{count}");
  });

  it("notifications.hours supports {count} in all languages", () => {
    expect(en.notifications.hours).toContain("{count}");
    expect(id.notifications.hours).toContain("{count}");
    expect(es.notifications.hours).toContain("{count}");
    expect(pt.notifications.hours).toContain("{count}");
  });

  it("notifications.days supports {count} in all languages", () => {
    expect(en.notifications.days).toContain("{count}");
    expect(id.notifications.days).toContain("{count}");
    expect(es.notifications.days).toContain("{count}");
    expect(pt.notifications.days).toContain("{count}");
  });

  it("protection.positionsCount supports {count} in all languages", () => {
    expect(en.protection.positionsCount).toContain("{count}");
    expect(id.protection.positionsCount).toContain("{count}");
    expect(es.protection.positionsCount).toContain("{count}");
    expect(pt.protection.positionsCount).toContain("{count}");
  });

  it("trader.viewAlerts supports {count} in all languages", () => {
    expect(en.trader.viewAlerts).toContain("{count}");
    expect(id.trader.viewAlerts).toContain("{count}");
    expect(es.trader.viewAlerts).toContain("{count}");
    expect(pt.trader.viewAlerts).toContain("{count}");
  });
});

// ─── Different Translations (not identical) ────────────────────

describe("i18n — EN/ID/ES different translations (not identical)", () => {
  it("global.loading is different between EN and ID", () => {
    expect(en.global.loading).not.toBe(id.global.loading);
  });

  it("global.loading is different between EN and ES", () => {
    expect(en.global.loading).not.toBe(es.global.loading);
  });

  it("global.loading is different between EN and PT", () => {
    expect(en.global.loading).not.toBe(pt.global.loading);
  });

  it("nav.analysis is different between EN and ID", () => {
    expect(en.nav.analysis).not.toBe(id.nav.analysis);
  });

  it("nav.analysis is different between EN and ES", () => {
    expect(en.nav.analysis).not.toBe(es.nav.analysis);
  });

  it("nav.analysis is different between EN and PT", () => {
    expect(en.nav.analysis).not.toBe(pt.nav.analysis);
  });

  it("status.healthy is different between EN and ID", () => {
    expect(en.status.healthy).not.toBe(id.status.healthy);
  });

  it("status.healthy is different between EN and ES", () => {
    expect(en.status.healthy).not.toBe(es.status.healthy);
  });

  it("status.healthy is different between EN and PT", () => {
    expect(en.status.healthy).not.toBe(pt.status.healthy);
  });

  it("trader.portfolioOverview is different between EN and ID", () => {
    expect(en.trader.portfolioOverview).not.toBe(id.trader.portfolioOverview);
  });

  it("trader.portfolioOverview is different between EN and ES", () => {
    expect(en.trader.portfolioOverview).not.toBe(es.trader.portfolioOverview);
  });

  it("trader.portfolioOverview is different between EN and PT", () => {
    expect(en.trader.portfolioOverview).not.toBe(pt.trader.portfolioOverview);
  });

  it("investor.noPositions is different between EN and ID", () => {
    expect(en.investor.noPositions).not.toBe(id.investor.noPositions);
  });

  it("investor.noPositions is different between EN and ES", () => {
    expect(en.investor.noPositions).not.toBe(es.investor.noPositions);
  });

  it("investor.noPositions is different between EN and PT", () => {
    expect(en.investor.noPositions).not.toBe(pt.investor.noPositions);
  });

  it("protection.title is different between EN and ID", () => {
    expect(en.protection.title).not.toBe(id.protection.title);
  });

  it("protection.title is different between EN and ES", () => {
    expect(en.protection.title).not.toBe(es.protection.title);
  });

  it("protection.title is different between EN and PT", () => {
    expect(en.protection.title).not.toBe(pt.protection.title);
  });

  it("fundamental.overall is different between EN and ID", () => {
    expect(en.fundamental.overall).not.toBe(id.fundamental.overall);
  });

  it("fundamental.overall is different between EN and ES", () => {
    expect(en.fundamental.overall).not.toBe(es.fundamental.overall);
  });

  it("fundamental.overall is different between EN and PT", () => {
    expect(en.fundamental.overall).not.toBe(pt.fundamental.overall);
  });

  it("journal.title is different between EN and ID", () => {
    expect(en.journal.title).not.toBe(id.journal.title);
  });

  it("journal.title is different between EN and ES", () => {
    expect(en.journal.title).not.toBe(es.journal.title);
  });

  it("journal.title is different between EN and PT", () => {
    expect(en.journal.title).not.toBe(pt.journal.title);
  });
});

// ─── Same Values for Universal Terms ───────────────────────────

describe("i18n — same values for universal terms across all languages", () => {
  it("market.vix is same (universal ticker)", () => {
    expect(en.market.vix).toBe(id.market.vix);
    expect(en.market.vix).toBe(es.market.vix);
    expect(en.market.vix).toBe(pt.market.vix);
  });

  it("market.dxy is same (universal ticker)", () => {
    expect(en.market.dxy).toBe(id.market.dxy);
    expect(en.market.dxy).toBe(es.market.dxy);
    expect(en.market.dxy).toBe(pt.market.dxy);
  });

  it("market.us10y is same (universal ticker)", () => {
    expect(en.market.us10y).toBe(id.market.us10y);
    expect(en.market.us10y).toBe(es.market.us10y);
    expect(en.market.us10y).toBe(pt.market.us10y);
  });

  it("market.wti is same (universal ticker)", () => {
    expect(en.market.wti).toBe(id.market.wti);
    expect(en.market.wti).toBe(es.market.wti);
    expect(en.market.wti).toBe(pt.market.wti);
  });

  it("analysis.long is same (trading term)", () => {
    expect(en.analysis.long).toBe(id.analysis.long);
    expect(en.analysis.long).toBe(es.analysis.long);
    expect(en.analysis.long).toBe(pt.analysis.long);
  });

  it("analysis.short is same (trading term)", () => {
    expect(en.analysis.short).toBe(id.analysis.short);
    expect(en.analysis.short).toBe(es.analysis.short);
    expect(en.analysis.short).toBe(pt.analysis.short);
  });
});

// ─── Spanish-Specific Financial Terminology Tests ──────────────

describe("i18n — Spanish financial terminology", () => {
  it("Stop Loss is preserved as standard trading term in Spanish", () => {
    expect(es.protection.stopLossLabel).toBe("Stop Loss");
    expect(es.analysis.support).toBe("Soporte");
    expect(es.analysis.resistance).toBe("Resistencia");
  });

  it("Take Profit is preserved as standard trading term in Spanish", () => {
    expect(es.protection.takeProfitLabel).toBe("Take Profit");
  });

  it("Bullish/Bearish are translated as Alcista/Bajista", () => {
    expect(es.analysis.bullish).toBe("Alcista");
    expect(es.analysis.bearish).toBe("Bajista");
  });

  it("Long/Short are preserved as standard trading terms", () => {
    expect(es.analysis.long).toBe("LONG");
    expect(es.analysis.short).toBe("SHORT");
  });

  it("portfolio uses Portafolio in Spanish", () => {
    expect(es.investor.portfolio).toBe("PORTAFOLIO");
    expect(es.investor.portfolioHealth).toContain("PORTAFOLIO");
  });

  it("position uses Posición in Spanish", () => {
    expect(es.investor.positions).toBe("POSICIONES");
    expect(es.protection.positionsLabel).toBe("Posiciones");
  });

  it("leverage uses Apalancamiento in Spanish", () => {
    expect(es.protection.leverageLabel).toBe("Apalancamiento");
  });

  it("entry price uses Precio de Entrada in Spanish", () => {
    expect(es.protection.entryPriceLabel).toBe("Precio de Entrada");
  });

  it("market structure terms are translated", () => {
    expect(es.intelligence.liquidity).toBe("Liquidez");
    expect(es.intelligence.inflation).toBe("Inflación");
    expect(es.intelligence.growth).toBe("Crecimiento");
  });

  it("decision support terms are translated", () => {
    expect(es.decision.supportingEvidence).toContain("EVIDENCIA");
    expect(es.decision.conflictingEvidence).toContain("EVIDENCIA");
    expect(es.decision.whatCouldChange).toContain("CAMBIAR");
    expect(es.decision.whatToMonitor).toContain("MONITOREAR");
  });

  it("alerts and notifications are translated", () => {
    expect(es.alerts.title).toContain("Alerta");
    expect(es.notifications.title).toBe("Notificaciones");
  });

  it("fundamental terms are translated", () => {
    expect(es.intelligence.policyRate).toBe("Tasa de Política Monetaria");
    expect(es.intelligence.realYield).toBe("Rendimiento Real");
    expect(es.intelligence.economicCalendar).toBe("Calendario Económico");
  });

  it("status labels are translated", () => {
    expect(es.status.available).toBe("DISPONIBLE");
    expect(es.status.unavailable).toBe("NO DISPONIBLE");
    expect(es.status.healthy).toBe("SALUDABLE");
    expect(es.status.caution).toBe("PRECAUCIÓN");
    expect(es.status.invalidated).toBe("INVALIDADA");
  });

  it("workspace labels are translated", () => {
    expect(es.workspace.trader).toBe("Trader");
    expect(es.workspace.investor).toBe("Inversor");
    expect(es.workspace.trading).toBe("Trading");
    expect(es.workspace.investing).toBe("Inversión");
  });

  it("intelligence provenance labels are translated", () => {
    expect(es.intelligence.observed).toBe("OBSERVADO");
    expect(es.intelligence.derived).toBe("DERIVADO");
    expect(es.intelligence.unavailable).toBe("NO DISPONIBLE");
    expect(es.intelligence.insufficientData).toBe("DATOS INSUFICIENTES");
  });

  it("disclaimer is translated and meaningful", () => {
    expect(es.global.disclaimer).toContain("informativos");
    expect(es.global.disclaimer).toContain("automáticamente");
    expect(es.global.disclaimer).toContain("análisis");
  });
});

// ─── Portuguese Financial Terminology Tests ───────────────────

describe("i18n — Portuguese financial terminology", () => {
  it("Stop Loss is preserved as standard trading term in Portuguese", () => {
    expect(pt.protection.stopLossLabel).toBe("Stop Loss");
    expect(pt.analysis.support).toBe("Suporte");
    expect(pt.analysis.resistance).toBe("Resistência");
  });

  it("Take Profit is preserved as standard trading term in Portuguese", () => {
    expect(pt.protection.takeProfitLabel).toBe("Take Profit");
  });

  it("Bullish/Bearish are translated as Altista/Baixista", () => {
    expect(pt.analysis.bullish).toBe("Altista");
    expect(pt.analysis.bearish).toBe("Baixista");
  });

  it("Long/Short are preserved as standard trading terms", () => {
    expect(pt.analysis.long).toBe("LONG");
    expect(pt.analysis.short).toBe("SHORT");
  });

  it("portfolio uses Portfólio in Portuguese", () => {
    expect(pt.investor.portfolio).toBe("PORTFÓLIO");
    expect(pt.investor.portfolioHealth).toContain("PORTFÓLIO");
  });

  it("position uses Posição in Portuguese", () => {
    expect(pt.investor.positions).toBe("POSIÇÕES");
    expect(pt.protection.positionsLabel).toBe("Posições");
  });

  it("leverage uses Alavancagem in Portuguese", () => {
    expect(pt.protection.leverageLabel).toBe("Alavancagem");
  });

  it("entry price uses Preço de Entrada in Portuguese", () => {
    expect(pt.protection.entryPriceLabel).toBe("Preço de Entrada");
  });

  it("market structure terms are translated", () => {
    expect(pt.intelligence.liquidity).toBe("Liquidez");
    expect(pt.intelligence.inflation).toBe("Inflação");
    expect(pt.intelligence.growth).toBe("Crescimento");
  });

  it("decision support terms are translated", () => {
    expect(pt.decision.supportingEvidence).toContain("EVIDÊNCIA");
    expect(pt.decision.conflictingEvidence).toContain("EVIDÊNCIA");
    expect(pt.decision.whatCouldChange).toContain("MUDAR");
    expect(pt.decision.whatToMonitor).toContain("MONITORAR");
  });

  it("alerts and notifications are translated", () => {
    expect(pt.alerts.title).toContain("Alerta");
    expect(pt.notifications.title).toBe("Notificações");
  });

  it("fundamental terms are translated", () => {
    expect(pt.intelligence.policyRate).toBe("Taxa de Política Monetária");
    expect(pt.intelligence.realYield).toBe("Rendimento Real");
    expect(pt.intelligence.economicCalendar).toBe("Calendário Econômico");
  });

  it("status labels are translated", () => {
    expect(pt.status.available).toBe("DISPONÍVEL");
    expect(pt.status.unavailable).toBe("INDISPONÍVEL");
    expect(pt.status.healthy).toBe("SAUDÁVEL");
    expect(pt.status.caution).toBe("PRECAUÇÃO");
    expect(pt.status.invalidated).toBe("INVALIDADA");
  });

  it("workspace labels are translated", () => {
    expect(pt.workspace.trader).toBe("Trader");
    expect(pt.workspace.investor).toBe("Investidor");
    expect(pt.workspace.trading).toBe("Trading");
    expect(pt.workspace.investing).toBe("Investimento");
  });

  it("intelligence provenance labels are translated", () => {
    expect(pt.intelligence.observed).toBe("OBSERVADO");
    expect(pt.intelligence.derived).toBe("DERIVADO");
    expect(pt.intelligence.unavailable).toBe("INDISPONÍVEL");
    expect(pt.intelligence.insufficientData).toBe("DADOS_INSUFICIENTES");
  });

  it("disclaimer is translated and meaningful", () => {
    expect(pt.global.disclaimer).toContain("informativos");
    expect(pt.global.disclaimer).toContain("automaticamente");
    expect(pt.global.disclaimer).toContain("análise");
  });
});
