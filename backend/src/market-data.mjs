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

export function createMarketDataHandler({database,env=process.env}) {
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
    try {
      const input=await readBody(request);
      const {analyzeMarket}=await import("../dist/market-data-engine.mjs");
      const result=await analyzeMarket({
        instrument:input.instrument,
        instrumentType:input.instrumentType,
        timeframe:input.timeframe,
        tradingStyle:input.tradingStyle,
      });
      json(response,200,result);
    } catch(error) {
      const status=Number.isInteger(error?.status)?error.status:503;
      json(response,status,{success:false,error:error.message||"market_data_unavailable",errorCode:"API_UNAVAILABLE"});
    }
    return true;
  };
}
