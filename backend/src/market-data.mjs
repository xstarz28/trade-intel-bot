import { randomUUID } from "node:crypto";
import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";

function json(response,status,value) {
  const body=JSON.stringify(value);
  response.writeHead(status,{
    "content-type":"application/json; charset=utf-8",
    "content-length":Buffer.byteLength(body),
    "cache-control":"no-store",
    "x-content-type-options":"nosniff",
  });
  response.end(body);
}
async function readBody(request) {
  const chunks=[];let size=0;
  for await(const chunk of request) {
    size+=chunk.length;
    if(size>64_000) throw Object.assign(new Error("Request body too large"),{status:413});
    chunks.push(chunk);
  }
  try {
    const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error();
    return value;
  } catch { throw Object.assign(new Error("Invalid JSON object"),{status:400}); }
}

const SEC_REFRESH_INTERVAL_MS=6*60*60*1000;
const SEC_RETRY_INTERVAL_MS=15*60*1000;
const secRefreshAttempts=new Map();
const secRefreshInflight=new Map();

async function refreshSecObservationsIfStale(database,ticker,userAgent,fetchImpl) {
  if(!userAgent?.trim()) return;
  const latest=database.raw.prepare("SELECT MAX(last_retrieved_at) AS last_retrieved_at FROM sec_edgar_observations WHERE ticker=?").get(ticker)?.last_retrieved_at;
  const now=Date.now();
  if(latest&&now-latest<SEC_REFRESH_INTERVAL_MS) return;
  if(now-(secRefreshAttempts.get(ticker)??0)<SEC_RETRY_INTERVAL_MS) return;
  const pending=secRefreshInflight.get(ticker);
  if(pending) return pending;
  secRefreshAttempts.set(ticker,now);
  if(secRefreshAttempts.size>5000) {
    for(const [key,attemptedAt] of secRefreshAttempts) {
      if(now-attemptedAt>=SEC_RETRY_INTERVAL_MS) secRefreshAttempts.delete(key);
    }
    while(secRefreshAttempts.size>5000) {
      const oldestKey=secRefreshAttempts.keys().next().value;
      if(oldestKey===undefined) break;
      secRefreshAttempts.delete(oldestKey);
    }
  }
  const task=(async()=>{
    const {fetchSecFundamentalObservations}=await import("../dist/market-data-engine.mjs");
    const result=await fetchSecFundamentalObservations(ticker,userAgent,fetchImpl);
    if(!result.success) return;
    const retrievedAt=Date.now();
    const sql="INSERT INTO sec_edgar_observations (id,ticker,cik,accession_number,form,filing_date,acceptance_date_time,fiscal_period_start,fiscal_period_end,fiscal_year,fiscal_period,eps,revenue,eps_tag,revenue_tag,source_url,first_observed_at,last_retrieved_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(ticker,accession_number) DO UPDATE SET cik=excluded.cik,form=excluded.form,filing_date=excluded.filing_date,acceptance_date_time=excluded.acceptance_date_time,fiscal_period_start=excluded.fiscal_period_start,fiscal_period_end=excluded.fiscal_period_end,fiscal_year=excluded.fiscal_year,fiscal_period=excluded.fiscal_period,eps=excluded.eps,revenue=excluded.revenue,eps_tag=excluded.eps_tag,revenue_tag=excluded.revenue_tag,source_url=excluded.source_url,last_retrieved_at=excluded.last_retrieved_at";
    const insert=database.raw.prepare(sql);
    const persist=database.raw.transaction(()=>{
      for(const o of result.observations) insert.run(randomUUID(),ticker,o.cik,o.accessionNumber,o.form,o.filingDate,o.acceptanceDateTime??null,o.fiscalPeriodStart,o.fiscalPeriodEnd,o.fiscalYear??null,o.fiscalPeriod??null,o.eps??null,o.revenue??null,o.epsTag??null,o.revenueTag??null,o.sourceUrl,retrievedAt,retrievedAt);
    });
    persist();
  })().finally(()=>secRefreshInflight.delete(ticker));
  secRefreshInflight.set(ticker,task);
  return task;
}

export function createMarketDataHandler({database,env=process.env,fetchImpl=fetch}) {
  const buckets=new Map();
  const allowAnalysis=(userId)=>{
    const now=Date.now();
    let bucket=buckets.get(userId);
    if(!bucket||now-bucket.startedAt>=60_000) {
      bucket={startedAt:now,count:0};
      buckets.set(userId,bucket);
    }
    if(bucket.count>=20) return false;
    bucket.count+=1;
    if(buckets.size>5000) {
      for(const [key,value] of buckets) if(now-value.startedAt>=60_000) buckets.delete(key);
    }
    return true;
  };
  return async(request,response,url)=>{
    const providerPaths=new Set([
      "/api/v1/intelligence/cot",
      "/api/v1/intelligence/eia",
      "/api/v1/intelligence/treasury",
      "/api/v1/intelligence/fx-rate",
      "/api/v1/intelligence/calendar",
      "/api/v1/intelligence/okx-spec",
      "/api/v1/intelligence/okx-orderbook",
      "/api/v1/intelligence/okx-futures-open-interest",
      "/api/v1/market-data/analyze",
    ]);
    if(!providerPaths.has(url.pathname)) return false;
    if(request.method!=="POST") {
      json(response,405,{error:"method_not_allowed"});
      return true;
    }
    if(!isAllowedOrigin(request,env)) {
      json(response,403,{error:"origin_not_allowed"});
      return true;
    }
    const user=getAuthenticatedUser(database,request,env);
    if(!user) {
      json(response,401,{error:"authentication_required"});
      return true;
    }
    if(!allowAnalysis(user.id)) {
      response.setHeader("retry-after","60");
      json(response,429,{success:false,error:"market_analysis_rate_limited",errorCode:"RATE_LIMIT"});
      return true;
    }
    try {
      const input=await readBody(request);
      if(url.pathname!=="/api/v1/market-data/analyze") {
        const engine=await import("../dist/market-data-engine.mjs");
        let result;
        if(url.pathname==="/api/v1/intelligence/cot") {
          const instrument=typeof input.instrument==="string"?input.instrument.trim().toUpperCase():"";
          if(!/^[A-Z0-9._-]{1,30}$/.test(instrument)) {
            json(response,400,{success:false,error:"invalid_instrument"});
            return true;
          }
          result=await engine.fetchCotPositioning(instrument,fetchImpl);
        } else if(url.pathname==="/api/v1/intelligence/eia") {
          result=await engine.fetchEiaInventory(env.EIA_API_KEY,fetchImpl);
        } else if(url.pathname==="/api/v1/intelligence/treasury") {
          result=await engine.fetchTreasuryYields(fetchImpl);
        } else if(url.pathname==="/api/v1/intelligence/calendar") {
          const instrument=typeof input.instrument==="string"?input.instrument.trim():"";
          const instrumentType=typeof input.instrumentType==="string"?input.instrumentType.trim():"";
          if(!instrument||instrument.length>80||!["crypto","stock","forex","commodity","indices"].includes(instrumentType)) {
            json(response,400,{success:false,error:"invalid_calendar_instrument"});
            return true;
          }
          result=await engine.fetchEconomicCalendar(instrument,instrumentType,env.TICKATLAS_API_KEY,fetchImpl);
        } else if(url.pathname==="/api/v1/intelligence/okx-spec") {
          const instrument=typeof input.instrument==="string"?input.instrument.trim():"";
          if(!instrument||instrument.length>80) {
            json(response,400,{success:false,error:"invalid_instrument"});
            return true;
          }
          result=await engine.fetchOkxInstrumentSpec(instrument,fetchImpl);
        } else if(url.pathname==="/api/v1/intelligence/okx-orderbook") {
          const instrument=typeof input.instrument==="string"?input.instrument.trim():"";
          if(!instrument||instrument.length>80) {
            json(response,400,{success:false,error:"invalid_instrument"});
            return true;
          }
          result=await engine.fetchOkxOrderBook(instrument,fetchImpl);
        } else if(url.pathname==="/api/v1/intelligence/okx-futures-open-interest") {
          const instrument=typeof input.instrument==="string"?input.instrument.trim():"";
          if(!instrument||instrument.length>80) {
            json(response,400,{success:false,error:"invalid_instrument"});
            return true;
          }
          result=await engine.fetchOkxFuturesOpenInterest(instrument,fetchImpl);
        } else {
          const from=typeof input.from==="string"?input.from.trim().toUpperCase():"";
          const to=typeof input.to==="string"?input.to.trim().toUpperCase():"";
          if(!/^[A-Z]{3}$/.test(from)||!/^[A-Z]{3}$/.test(to)||from===to) {
            json(response,400,{success:false,error:"invalid_fx_currency_pair"});
            return true;
          }
          result=await engine.fetchFxReference(from,to,fetchImpl);
        }
        json(response,result.success?200:503,result);
        return true;
      }
      const {analyzeMarket,fetchAlphaVantageIntelligence}=await import("../dist/market-data-engine.mjs");
      const instrument=typeof input.instrument==="string"?input.instrument.trim().toUpperCase():"";
      const instrumentType=input.instrumentType;
      let fundamentalData;
      if(instrumentType==="stock"&&/^[A-Z0-9.-]{1,15}$/.test(instrument)) {
        // Refresh stale SEC evidence when configured; keep persisted evidence usable during outages.
        try { await refreshSecObservationsIfStale(database,instrument,env.SEC_USER_AGENT,fetchImpl); }
        catch(error) { console.warn("[market-data] SEC refresh unavailable; using persisted observations:",error instanceof Error?error.message:"unknown error"); }
        const observations=database.raw.prepare(
          "SELECT eps,revenue,fiscal_period_end,filing_date,last_retrieved_at FROM sec_edgar_observations WHERE ticker=? ORDER BY filing_date DESC,fiscal_period_end DESC LIMIT 12",
        ).all(instrument);
        // Keep the analysis payload bounded while reporting the true persisted
        // history size rather than the size of this latest-observation window.
        const observationCount=database.raw.prepare(
          "SELECT COUNT(*) AS count FROM sec_edgar_observations WHERE ticker=?",
        ).get(instrument).count;
        const latest=observations[0];
        if(latest&&(latest.eps!==null||latest.revenue!==null)) {
          fundamentalData={
            provider:"sec-edgar",timestamp:latest.last_retrieved_at,
            instrumentType:"stock",symbol:instrument,available:true,
            ...(latest.eps!==null?{earningsPerShare:latest.eps,dilutedEPS:latest.eps}:{}),
            latestEarnings:{date:latest.fiscal_period_end,...(latest.revenue!==null?{revenue:latest.revenue}:{}),...(latest.eps!==null?{eps:latest.eps}:{})},
            pointInTimeHistory:{status:"PERSISTED",providerObservationCount:observationCount,newlyPersistedCount:0},
          };
        }
      }
      let sentimentData;
      let macroData;
      if(instrumentType==="stock"&&env.ALPHA_VANTAGE_API_KEY?.trim()) {
        const intelligence=await fetchAlphaVantageIntelligence(instrument,env.ALPHA_VANTAGE_API_KEY,fetchImpl);
        if(intelligence.fundamentals?.available) fundamentalData=intelligence.fundamentals;
        if(intelligence.sentiment?.confidence!=="unavailable") sentimentData=intelligence.sentiment;
        if(intelligence.macro?.confidence!=="unavailable") macroData=intelligence.macro;
      }
      const result=await analyzeMarket({
        instrument,
        instrumentType,
        timeframe:input.timeframe,
        tradingStyle:input.tradingStyle,
        ...(fundamentalData?{fundamentalData}:{}),
        ...(sentimentData?{sentimentData}:{}),
        ...(macroData?{macroData}:{}),
      },fetchImpl);
      json(response,200,result);
    } catch(error) {
      const status=Number.isInteger(error?.status)?error.status:503;
      json(response,status,{success:false,error:error.message||"market_data_unavailable",errorCode:"API_UNAVAILABLE"});
    }
    return true;
  };
}
