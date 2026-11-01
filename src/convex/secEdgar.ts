"use node";

import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";
import {
  findSecTickerRecord,
  mapSecQuarterlyFundamentals,
  type SecTickerRecord,
  type SecSubmissions,
} from "../lib/data/sec-edgar";

const SEC_TICKER_DIRECTORY = "https://www.sec.gov/files/company_tickers.json";
const SEC_DATA_BASE = "https://data.sec.gov";
const TICKER_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
let tickerDirectoryCache: { value: Record<string, SecTickerRecord>; expiresAt: number } | undefined;

async function fetchSecJson<T>(url: string, userAgent: string): Promise<T> {
  const response = await fetch(url, {
    headers: {
      "User-Agent": userAgent,
      Accept: "application/json",
    },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) {
    throw new Error(`SEC EDGAR HTTP ${response.status} for ${new URL(url).pathname}`);
  }
  return await response.json() as T;
}

async function getTickerDirectory(userAgent: string): Promise<Record<string, SecTickerRecord>> {
  if (tickerDirectoryCache && tickerDirectoryCache.expiresAt > Date.now()) {
    return tickerDirectoryCache.value;
  }
  const value = await fetchSecJson<Record<string, SecTickerRecord>>(SEC_TICKER_DIRECTORY, userAgent);
  tickerDirectoryCache = { value, expiresAt: Date.now() + TICKER_CACHE_TTL_MS };
  return value;
}

/**
 * Fetch and persist SEC quarterly filing facts for a US equity ticker.
 * SEC filingDate is a daily eligibility boundary; acceptanceDateTime is
 * preserved as source metadata, not asserted to be exact public availability.
 */
export const fetchCompanyFilingHistory = action({
  args: { ticker: v.string() },
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      return { success: false, status: "AUTH_REQUIRED", observationCount: 0 };
    }

    const ticker = args.ticker.trim().toUpperCase();
    if (!/^[A-Z0-9.-]{1,15}$/.test(ticker)) {
      return { success: false, status: "INVALID_TICKER", observationCount: 0 };
    }

    const userAgent = process.env.SEC_USER_AGENT?.trim();
    if (!userAgent || userAgent.length > 250 || /[\r\n]/.test(userAgent) || !/\([^)]*@[^)]+\)/.test(userAgent)) {
      return {
        success: false,
        status: "USER_AGENT_NOT_CONFIGURED",
        requiredEnvVar: "SEC_USER_AGENT",
        observationCount: 0,
      };
    }

    try {
      const directory = await getTickerDirectory(userAgent);
      const company = findSecTickerRecord(ticker, directory);
      if (!company) {
        return { success: false, status: "TICKER_NOT_FOUND", ticker, observationCount: 0 };
      }

      const cik = String(company.cik_str).padStart(10, "0");
      // Keep requests sequential within an invocation; callers must not fan out
      // unbounded ticker batches against the SEC public endpoints.
      const submissions = await fetchSecJson<SecSubmissions>(
        `${SEC_DATA_BASE}/submissions/CIK${cik}.json`,
        userAgent,
      );
      const companyFacts = await fetchSecJson<{
        cik?: number;
        entityName?: string;
        facts?: { "us-gaap"?: Record<string, { units?: Record<string, Array<{
          accn?: string; filed?: string; start?: string; end?: string; val?: number;
          fy?: number; fp?: string; form?: string; frame?: string;
        }>> }> };
      }>(
        `${SEC_DATA_BASE}/api/xbrl/companyfacts/CIK${cik}.json`,
        userAgent,
      );

      const observations = mapSecQuarterlyFundamentals(
        ticker,
        cik,
        companyFacts,
        submissions,
      );
      if (observations.length === 0) {
        return {
          success: true,
          status: "NO_QUARTERLY_FACTS",
          ticker,
          cik,
          observationCount: 0,
          filingDateSemantics: "SEC filing date only; not an exact public-availability timestamp",
        };
      }

      const retrievedAt = Date.now();
      const persistence = await ctx.runMutation(
        internal.historicalIntelligence.persistSecEdgarObservations,
        { ticker, retrievedAt, observations },
      );

      return {
        success: true,
        status: "PERSISTED",
        ticker,
        cik,
        observationCount: observations.length,
        newlyPersistedCount: persistence.inserted,
        filingDateSemantics: "SEC filing date only; not an exact public-availability timestamp",
        source: "SEC EDGAR companyfacts and submissions",
      };
    } catch (error) {
      return {
        success: false,
        status: "PROVIDER_ERROR",
        ticker,
        observationCount: 0,
        error: error instanceof Error ? error.message : "SEC EDGAR request failed",
      };
    }
  },
});
