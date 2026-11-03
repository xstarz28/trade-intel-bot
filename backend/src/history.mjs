import { randomUUID } from "node:crypto";
import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";

const SNAPSHOT_LIMIT=50, EVENT_LIMIT=100, HEALTH_LIMIT=100;
function json(response,status,value) {
  const body=JSON.stringify(value);
  response.writeHead(status,{"content-type":"application/json; charset=utf-8",
    "content-length":Buffer.byteLength(body),"cache-control":"no-store","x-content-type-options":"nosniff"});
  response.end(body);
}
async function readBody(request) {
  const chunks=[];let size=0;
  for await(const chunk of request) {
    size+=chunk.length;
    if(size>512_000) throw Object.assign(new Error("Request body too large"),{status:413});
    chunks.push(chunk);
  }
  if(!size) return {};
  try {
    const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error();
    return value;
  } catch { throw Object.assign(new Error("Invalid JSON object"),{status:400}); }
}
function str(v,n) {
  if(typeof v!=="string"||!v.trim()) throw Object.assign(new Error(`${n} is required`),{status:400});
  return v;
}
function num(v,n) {
  if(typeof v!=="number"||!Number.isFinite(v)) throw Object.assign(new Error(`${n} must be finite`),{status:400});
  return v;
}
function arr(v,n) {
  if(!Array.isArray(v)) throw Object.assign(new Error(`${n} must be an array`),{status:400});
  return v;
}
function object(v,n) {
  if(!v||typeof v!=="object"||Array.isArray(v)) throw Object.assign(new Error(`${n} must be an object`),{status:400});
  return v;
}
function parse(v) { return JSON.parse(v); }
function snapshotView(r) {
  return {_id:r.id,positionId:r.position_id,instrument:r.instrument,side:r.side,timestamp:r.timestamp,
    thesisState:r.thesis_state,evidenceQuality:r.evidence_quality,marketRegime:r.market_regime,
    h1Trend:r.h1_trend,m15Trend:r.m15_trend,m5Trend:r.m5_trend,mtfAlignment:r.mtf_alignment,
    momentum:r.momentum,volatility:r.volatility,structure:r.structure,
    supportingCount:r.supporting_count,conflictingCount:r.conflicting_count,
    invalidationCondition:r.invalidation_condition,watchNext:r.watch_next,dataAvailability:r.data_availability};
}
function eventView(r) {
  return {_id:r.id,positionId:r.position_id,instrument:r.instrument,side:r.side,timestamp:r.timestamp,
    eventType:r.event_type,description:r.description,previousState:r.previous_state,
    currentState:r.current_state,category:r.category,strength:r.strength};
}
function healthView(r) {
  return {_id:r.id,timestamp:r.timestamp,overallStatus:r.overall_status,components:parse(r.components),
    intelligenceCycleStatus:r.intelligence_cycle_status,alertPipelineStatus:r.alert_pipeline_status,
    persistenceStatus:r.persistence_status,providerAvailability:parse(r.provider_availability),
    staleComponents:parse(r.stale_components),unavailableComponents:parse(r.unavailable_components)};
}
function positionOwned(database,userId,positionId) {
  return Boolean(database.raw.prepare(
    "SELECT 1 FROM monitored_positions WHERE user_id=? AND position_id=?",
  ).get(userId,positionId));
}
function enforceHistoryRetention(database,userId,positionId) {
  const snapshots=database.raw.prepare(`
    DELETE FROM historical_snapshots WHERE user_id=? AND position_id=? AND id NOT IN (
      SELECT id FROM historical_snapshots WHERE user_id=? AND position_id=? ORDER BY timestamp DESC LIMIT ?
    )
  `).run(userId,positionId,userId,positionId,SNAPSHOT_LIMIT).changes;
  const events=database.raw.prepare(`
    DELETE FROM historical_events WHERE user_id=? AND position_id=? AND id NOT IN (
      SELECT id FROM historical_events WHERE user_id=? AND position_id=? ORDER BY timestamp DESC LIMIT ?
    )
  `).run(userId,positionId,userId,positionId,EVENT_LIMIT).changes;
  return snapshots+events;
}

export function createHistoryHandler({database,env=process.env}) {
  return async(request,response,url)=>{
    const path=url.pathname,method=request.method??"GET";
    if(!path.startsWith("/api/v1/history/")&&!path.startsWith("/api/v1/runtime-health")) return false;
    if(method!=="GET"&&!isAllowedOrigin(request,env)) {json(response,403,{error:"origin_not_allowed"});return true;}
    const user=getAuthenticatedUser(database,request,env);
    if(!user) {json(response,401,{error:"authentication_required"});return true;}

    try {
      if(path==="/api/v1/history/snapshots"&&method==="POST") {
        const b=await readBody(request),positionId=str(b.positionId,"positionId");
        if(!positionOwned(database,user.id,positionId)) {json(response,404,{error:"position_not_found"});return true;}
        const fields={
          instrument:str(b.instrument,"instrument"),side:str(b.side,"side"),timestamp:num(b.timestamp,"timestamp"),
          thesisState:str(b.thesisState,"thesisState"),evidenceQuality:str(b.evidenceQuality,"evidenceQuality"),
          marketRegime:str(b.marketRegime,"marketRegime"),h1Trend:str(b.h1Trend,"h1Trend"),
          m15Trend:str(b.m15Trend,"m15Trend"),m5Trend:str(b.m5Trend,"m5Trend"),
          mtfAlignment:str(b.mtfAlignment,"mtfAlignment"),momentum:str(b.momentum,"momentum"),
          volatility:str(b.volatility,"volatility"),structure:str(b.structure,"structure"),
          supportingCount:num(b.supportingCount,"supportingCount"),conflictingCount:num(b.conflictingCount,"conflictingCount"),
          invalidationCondition:str(b.invalidationCondition,"invalidationCondition"),
          watchNext:str(b.watchNext,"watchNext"),dataAvailability:str(b.dataAvailability,"dataAvailability"),
        };
        const id=randomUUID();
        database.raw.prepare(`
          INSERT INTO historical_snapshots (id,user_id,position_id,instrument,side,timestamp,thesis_state,
            evidence_quality,market_regime,h1_trend,m15_trend,m5_trend,mtf_alignment,momentum,volatility,
            structure,supporting_count,conflicting_count,invalidation_condition,watch_next,data_availability)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(id,user.id,positionId,fields.instrument,fields.side,fields.timestamp,fields.thesisState,
          fields.evidenceQuality,fields.marketRegime,fields.h1Trend,fields.m15Trend,fields.m5Trend,
          fields.mtfAlignment,fields.momentum,fields.volatility,fields.structure,fields.supportingCount,
          fields.conflictingCount,fields.invalidationCondition,fields.watchNext,fields.dataAvailability);
        const pruned=enforceHistoryRetention(database,user.id,positionId);
        json(response,201,{id,pruned});return true;
      }

      if(path==="/api/v1/history/events"&&method==="POST") {
        const b=await readBody(request),positionId=str(b.positionId,"positionId");
        if(!positionOwned(database,user.id,positionId)) {json(response,404,{error:"position_not_found"});return true;}
        const events=arr(b.events,"events");
        if(events.length>100) {json(response,400,{error:"maximum_100_events_per_batch"});return true;}
        const insert=database.raw.prepare(`
          INSERT INTO historical_events (id,user_id,position_id,instrument,side,timestamp,event_type,
            description,previous_state,current_state,category,strength)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
        `);
        const find=database.raw.prepare(`
          SELECT 1 FROM historical_events WHERE user_id=? AND position_id=? AND timestamp=? AND event_type=? AND description=? LIMIT 1
        `);
        const ids=[];
        for(const raw of events) {
          const e=object(raw,"event");
          const value={
            timestamp:num(e.timestamp,"event.timestamp"),eventType:str(e.eventType,"event.eventType"),
            description:str(e.description,"event.description"),previousState:str(e.previousState,"event.previousState"),
            currentState:str(e.currentState,"event.currentState"),category:str(e.category,"event.category"),
            strength:str(e.strength,"event.strength"),
          };
          if(find.get(user.id,positionId,value.timestamp,value.eventType,value.description)) continue;
          const id=randomUUID();
          insert.run(id,user.id,positionId,str(b.instrument,"instrument"),str(b.side,"side"),
            value.timestamp,value.eventType,value.description,value.previousState,value.currentState,value.category,value.strength);
          ids.push(id);
        }
        const pruned=enforceHistoryRetention(database,user.id,positionId);
        json(response,201,{ids,inserted:ids.length,pruned});return true;
      }

      if(path==="/api/v1/history/timeline"&&method==="GET") {
        const positionId=url.searchParams.get("positionId");
        if(!positionId) {json(response,400,{error:"positionId_required"});return true;}
        if(!positionOwned(database,user.id,positionId)) {json(response,404,{error:"position_not_found"});return true;}
        const snapshots=database.raw.prepare(
          "SELECT * FROM historical_snapshots WHERE user_id=? AND position_id=? ORDER BY timestamp DESC LIMIT 2",
        ).all(user.id,positionId);
        const events=database.raw.prepare(
          "SELECT * FROM historical_events WHERE user_id=? AND position_id=? ORDER BY timestamp DESC LIMIT 100",
        ).all(user.id,positionId);
        json(response,200,{positionId,latestSnapshot:snapshots[0]?snapshotView(snapshots[0]):null,
          previousSnapshot:snapshots[1]?snapshotView(snapshots[1]):null,events:events.map(eventView)});
        return true;
      }

      const deleteHistory=path.match(/^\/api\/v1\/history\/positions\/([a-zA-Z0-9_-]+)$/);
      if(deleteHistory&&method==="DELETE") {
        const positionId=deleteHistory[1];
        if(!positionOwned(database,user.id,positionId)) {json(response,404,{error:"position_not_found"});return true;}
        const snapshots=database.raw.prepare("DELETE FROM historical_snapshots WHERE user_id=? AND position_id=?").run(user.id,positionId).changes;
        const events=database.raw.prepare("DELETE FROM historical_events WHERE user_id=? AND position_id=?").run(user.id,positionId).changes;
        json(response,200,{deleted:snapshots+events});return true;
      }

      if(path==="/api/v1/history/prune"&&method==="POST") {
        const b=await readBody(request),positionId=str(b.positionId,"positionId");
        if(!positionOwned(database,user.id,positionId)) {json(response,404,{error:"position_not_found"});return true;}
        json(response,200,{pruned:enforceHistoryRetention(database,user.id,positionId)});return true;
      }

      if(path==="/api/v1/runtime-health/latest"&&method==="GET") {
        const row=database.raw.prepare("SELECT * FROM runtime_health_snapshots WHERE user_id=? ORDER BY timestamp DESC LIMIT 1").get(user.id);
        json(response,200,{item:row?healthView(row):null});return true;
      }
      if(path==="/api/v1/runtime-health/history"&&method==="GET") {
        const limit=Math.max(1,Math.min(100,Number(url.searchParams.get("limit")??20)||20));
        const rows=database.raw.prepare("SELECT * FROM runtime_health_snapshots WHERE user_id=? ORDER BY timestamp DESC LIMIT ?").all(user.id,limit);
        json(response,200,{items:rows.map(healthView)});return true;
      }
      if(path==="/api/v1/runtime-health"&&method==="POST") {
        const b=await readBody(request);
        const components=arr(b.components,"components");
        const providerAvailability=object(b.providerAvailability,"providerAvailability");
        const staleComponents=arr(b.staleComponents,"staleComponents");
        const unavailableComponents=arr(b.unavailableComponents,"unavailableComponents");
        for(const item of components) {
          object(item,"component");
          str(item.component,"component.component");str(item.status,"component.status");
          num(item.consecutiveFailures,"component.consecutiveFailures");
          str(item.message,"component.message");str(item.freshness,"component.freshness");
        }
        for(const value of Object.values(providerAvailability)) if(typeof value!=="string") {
          throw Object.assign(new Error("providerAvailability values must be strings"),{status:400});
        }
        for(const value of [...staleComponents,...unavailableComponents]) if(typeof value!=="string") {
          throw Object.assign(new Error("stale/unavailable component names must be strings"),{status:400});
        }
        const timestamp=num(b.timestamp,"timestamp");
        const existing=database.raw.prepare("SELECT id FROM runtime_health_snapshots WHERE user_id=? AND timestamp=?").get(user.id,timestamp);
        if(existing) {json(response,200,{id:existing.id,deduplicated:true});return true;}
        const id=randomUUID();
        database.raw.prepare(`
          INSERT INTO runtime_health_snapshots (id,user_id,timestamp,overall_status,components,
            intelligence_cycle_status,alert_pipeline_status,persistence_status,provider_availability,
            stale_components,unavailable_components)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
        `).run(id,user.id,timestamp,str(b.overallStatus,"overallStatus"),JSON.stringify(components),
          str(b.intelligenceCycleStatus,"intelligenceCycleStatus"),str(b.alertPipelineStatus,"alertPipelineStatus"),
          str(b.persistenceStatus,"persistenceStatus"),JSON.stringify(providerAvailability),
          JSON.stringify(staleComponents),JSON.stringify(unavailableComponents));
        database.raw.prepare(`
          DELETE FROM runtime_health_snapshots WHERE user_id=? AND id NOT IN (
            SELECT id FROM runtime_health_snapshots WHERE user_id=? ORDER BY timestamp DESC LIMIT ?
          )
        `).run(user.id,user.id,HEALTH_LIMIT);
        json(response,201,{id});return true;
      }

      json(response,404,{error:"route_not_found"});return true;
    } catch(error) {
      json(response,Number.isInteger(error?.status)?error.status:400,{error:error.message||"invalid_request"});
      return true;
    }
  };
}
