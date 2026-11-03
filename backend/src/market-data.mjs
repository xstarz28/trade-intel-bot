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
    if(url.pathname!=="/api/v1/market-data/analyze") return false;
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
      const {analyzeMarket,fetchAlphaVantageIntelligence}=await import("../dist/market-data-engine.mjs");
      const instrument=typeof input.instrument==="string"?input.instrument.trim().toUpperCase():"";
      const instrumentType=input.instrumentType;
      let fundamentalData;
      if(instrumentType==="stock"&&/^[A-Z0-9.-]{1,15}$/.test(instrument)) {
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
