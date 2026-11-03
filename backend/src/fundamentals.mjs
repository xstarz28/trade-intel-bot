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

function view(row) {
  return {
    ticker:row.ticker,cik:row.cik,accessionNumber:row.accession_number,
    form:row.form,filingDate:row.filing_date,
    acceptanceDateTime:row.acceptance_date_time,
    fiscalPeriodStart:row.fiscal_period_start,fiscalPeriodEnd:row.fiscal_period_end,
    fiscalYear:row.fiscal_year,fiscalPeriod:row.fiscal_period,
    eps:row.eps,revenue:row.revenue,epsTag:row.eps_tag,revenueTag:row.revenue_tag,
    sourceUrl:row.source_url,firstObservedAt:row.first_observed_at,
    lastRetrievedAt:row.last_retrieved_at,
    filingDateSemantics:"SEC filing date; not an exact public-availability timestamp",
  };
}

export function createFundamentalsHandler({database,env=process.env}) {
  const buckets=new Map();
  const allowRefresh=(userId)=>{
    const now=Date.now();
    let b=buckets.get(userId);
    if(!b||now-b.startedAt>=60_000){b={startedAt:now,count:0};buckets.set(userId,b);}
    if(b.count>=6)return false;
    b.count++;
    if(buckets.size>5000)for(const [key,value] of buckets)if(now-value.startedAt>=60_000)buckets.delete(key);
    return true;
  };
  return async(request,response,url)=>{
    const match=url.pathname.match(/^\/api\/v1\/fundamentals\/sec(?:\/([A-Za-z0-9.-]{1,15}))?$/);
    if(!match)return false;
    const method=request.method??"GET";
    if(!["GET","POST"].includes(method)){json(response,405,{error:"method_not_allowed"});return true;}
    if(method!=="GET"&&!isAllowedOrigin(request,env)){json(response,403,{error:"origin_not_allowed"});return true;}
    const user=getAuthenticatedUser(database,request,env);
    if(!user){json(response,401,{error:"authentication_required"});return true;}
    try {
      const ticker=(match[1]??url.searchParams.get("ticker")??"").trim().toUpperCase();
      if(!ticker||! /^[A-Z0-9.-]{1,15}$/.test(ticker)){json(response,400,{error:"valid_ticker_required"});return true;}
      if(method==="GET"){
        const rows=database.raw.prepare(
          "SELECT * FROM sec_edgar_observations WHERE ticker=? ORDER BY filing_date DESC,fiscal_period_end DESC LIMIT 100",
        ).all(ticker);
        json(response,200,{ticker,items:rows.map(view)});return true;
      }
      if(!allowRefresh(user.id)){
        response.setHeader("retry-after","60");
        json(response,429,{success:false,status:"RATE_LIMIT",error:"sec_refresh_rate_limited"});return true;
      }
      const {fetchSecFundamentalObservations}=await import("../dist/market-data-engine.mjs");
      const result=await fetchSecFundamentalObservations(ticker,env.SEC_USER_AGENT);
      if(!result.success){
        const status=result.status==="USER_AGENT_NOT_CONFIGURED"?503:
          result.status==="INVALID_TICKER"?400:
          result.status==="TICKER_NOT_FOUND"?404:502;
        json(response,status,{success:false,status:result.status,ticker,error:result.error??result.status,
          ...(result.status==="USER_AGENT_NOT_CONFIGURED"?{requiredEnvVar:"SEC_USER_AGENT"}:{})});
        return true;
      }
      const retrievedAt=Date.now();
      const insert=database.raw.prepare(`
        INSERT INTO sec_edgar_observations (
          id,ticker,cik,accession_number,form,filing_date,acceptance_date_time,
          fiscal_period_start,fiscal_period_end,fiscal_year,fiscal_period,eps,revenue,
          eps_tag,revenue_tag,source_url,first_observed_at,last_retrieved_at
        ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        ON CONFLICT(ticker,accession_number) DO UPDATE SET
          cik=excluded.cik,form=excluded.form,filing_date=excluded.filing_date,
          acceptance_date_time=excluded.acceptance_date_time,
          fiscal_period_start=excluded.fiscal_period_start,fiscal_period_end=excluded.fiscal_period_end,
          fiscal_year=excluded.fiscal_year,fiscal_period=excluded.fiscal_period,
          eps=excluded.eps,revenue=excluded.revenue,eps_tag=excluded.eps_tag,
          revenue_tag=excluded.revenue_tag,source_url=excluded.source_url,
          last_retrieved_at=excluded.last_retrieved_at
      `);
      let inserted=0;
      for(const o of result.observations){
        const existed=database.raw.prepare(
          "SELECT 1 AS found FROM sec_edgar_observations WHERE ticker=? AND accession_number=?",
        ).get(ticker,o.accessionNumber);
        insert.run(randomUUID(),ticker,o.cik,o.accessionNumber,o.form,o.filingDate,
          o.acceptanceDateTime??null,o.fiscalPeriodStart,o.fiscalPeriodEnd,o.fiscalYear??null,
          o.fiscalPeriod??null,o.eps??null,o.revenue??null,o.epsTag??null,o.revenueTag??null,
          o.sourceUrl,retrievedAt,retrievedAt);
        if(!existed)inserted++;
      }
      const rows=database.raw.prepare(
        "SELECT * FROM sec_edgar_observations WHERE ticker=? ORDER BY filing_date DESC,fiscal_period_end DESC LIMIT 100",
      ).all(ticker);
      json(response,200,{success:true,status:result.status,ticker,cik:result.cik,
        observationCount:result.observations.length,newlyPersistedCount:inserted,items:rows.map(view)});
      return true;
    }catch(error){
      console.error("[fundamentals] SEC refresh failed:",error);
      json(response,500,{success:false,status:"INTERNAL_ERROR",error:"sec_fundamentals_request_failed"});
      return true;
    }
  };
}
