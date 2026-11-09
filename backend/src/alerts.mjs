import { randomUUID } from "node:crypto";
import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";

const MAX_RULES = 50;
const MAX_RULE_ALERTS = 200;
const MAX_NOTIFICATIONS = 200;
const SEVERITIES = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];
const CATEGORIES = [
  "THESIS","REGIME","TREND","STRUCTURE","MOMENTUM","VOLATILITY","EVIDENCE",
  "NEWS","MACRO","CROSS_ASSET","PORTFOLIO","DATA_QUALITY","SYSTEM",
];
const SCOPES = ["POSITION","INSTRUMENT","PORTFOLIO","GLOBAL"];
const DEFAULT_PREFERENCES = {
  minimumSeverity: "INFO", enabledCategories: [], enabledScopes: [],
  mutedRuleIds: [], enabledInstruments: [], mutedInstruments: [],
  showReadNotifications: true, showDismissedNotifications: false,
};

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
  const chunks=[]; let size=0;
  for await (const chunk of request) {
    size+=chunk.length;
    if(size>256_000) throw Object.assign(new Error("Request body too large"),{status:413});
    chunks.push(chunk);
  }
  if(!size) return {};
  try {
    const value=JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if(!value||typeof value!=="object"||Array.isArray(value)) throw new Error();
    return value;
  } catch { throw Object.assign(new Error("Invalid JSON object"),{status:400}); }
}
function str(v,n,optional=false) {
  if(optional&&(v===undefined||v===null)) return null;
  if(typeof v!=="string"||(!optional&&!v.trim())) throw Object.assign(new Error(`${n} must be a string`),{status:400});
  return v;
}
function num(v,n,optional=false) {
  if(optional&&(v===undefined||v===null)) return null;
  if(typeof v!=="number"||!Number.isFinite(v)) throw Object.assign(new Error(`${n} must be finite`),{status:400});
  return v;
}
function bool(v,n,optional=false) {
  if(optional&&(v===undefined||v===null)) return null;
  if(typeof v!=="boolean") throw Object.assign(new Error(`${n} must be boolean`),{status:400});
  return v;
}
function stringArray(v,n,max=100) {
  if(!Array.isArray(v)||v.length>max||v.some(x=>typeof x!=="string")) {
    throw Object.assign(new Error(`${n} must be an array of at most ${max} strings`),{status:400});
  }
  return v;
}
function parse(v,fallback=null) { return v===null||v===undefined?fallback:JSON.parse(v); }

function ruleView(r) {
  return {_id:r.id,ruleId:r.rule_id,name:r.name,enabled:Boolean(r.enabled),scope:r.scope,
    instrument:r.instrument,positionId:r.position_id,condition:r.condition,severity:r.severity,
    cooldownMs:r.cooldown_ms,createdAt:r.created_at,updatedAt:r.updated_at};
}
function ruleAlertView(r) {
  return {_id:r.id,alertId:r.alert_id,ruleId:r.rule_id,ruleName:r.rule_name,
    positionId:r.position_id,instrument:r.instrument,condition:r.condition,severity:r.severity,
    description:r.description,previousState:r.previous_state,currentState:r.current_state,
    timestamp:r.timestamp};
}
function notificationView(r) {
  return {_id:r.id,notificationId:r.notification_id,alertIdentity:r.alert_identity,
    ruleId:r.rule_id,ruleName:r.rule_name,timestamp:r.timestamp,instrument:r.instrument,
    positionId:r.position_id,side:r.side,severity:r.severity,title:r.title,message:r.message,
    category:r.category,impact:r.impact,read:Boolean(r.read),dismissed:Boolean(r.dismissed),
    source:r.source,condition:r.condition};
}
function preferencesView(r) {
  if(!r) return DEFAULT_PREFERENCES;
  return {
    minimumSeverity:r.minimum_severity,enabledCategories:parse(r.enabled_categories,[]),
    enabledScopes:parse(r.enabled_scopes,[]),mutedRuleIds:parse(r.muted_rule_ids,[]),
    enabledInstruments:parse(r.enabled_instruments,[]),mutedInstruments:parse(r.muted_instruments,[]),
    showReadNotifications:Boolean(r.show_read_notifications),
    showDismissedNotifications:Boolean(r.show_dismissed_notifications),
  };
}
function checkEnum(value,allowed,name) {
  if(!allowed.includes(value)) throw Object.assign(new Error(`Invalid ${name}: ${value}`),{status:400});
}

export function createAlertHandler({database,env=process.env}) {
  return async (request,response,url)=>{
    const path=url.pathname,method=request.method??"GET";
    if(!path.startsWith("/api/v1/alert-rules")&&
       !path.startsWith("/api/v1/notifications")&&
       path!=="/api/v1/notification-preferences") return false;
    if(method!=="GET"&&!isAllowedOrigin(request,env)) {
      json(response,403,{error:"origin_not_allowed"}); return true;
    }
    const user=getAuthenticatedUser(database,request,env);
    if(!user) { json(response,401,{error:"authentication_required"}); return true; }

    try {
      if(path==="/api/v1/alert-rules"&&method==="GET") {
        const rows=database.raw.prepare("SELECT * FROM alert_rules WHERE user_id=? ORDER BY created_at DESC").all(user.id);
        json(response,200,{items:rows.map(ruleView)}); return true;
      }
      if(path==="/api/v1/alert-rules"&&method==="POST") {
        const b=await readBody(request);
        const existing=database.raw.prepare("SELECT COUNT(*) AS count FROM alert_rules WHERE user_id=?").get(user.id);
        if(existing.count>=MAX_RULES) { json(response,409,{error:"maximum_rules_reached"}); return true; }
        const id=randomUUID(),now=Date.now();
        const value={ruleId:str(b.ruleId,"ruleId"),name:str(b.name,"name"),
          enabled:bool(b.enabled,"enabled"),scope:str(b.scope,"scope"),
          instrument:str(b.instrument,"instrument",true),positionId:str(b.positionId,"positionId",true),
          condition:str(b.condition,"condition"),severity:str(b.severity,"severity"),
          cooldownMs:num(b.cooldownMs,"cooldownMs")};
        checkEnum(value.scope,SCOPES,"scope");
        checkEnum(value.severity,SEVERITIES,"severity");
        database.raw.prepare(`
          INSERT INTO alert_rules (id,user_id,rule_id,name,enabled,scope,instrument,position_id,condition,severity,cooldown_ms,created_at,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(id,user.id,value.ruleId,value.name,value.enabled?1:0,value.scope,value.instrument,
          value.positionId,value.condition,value.severity,value.cooldownMs,now,now);
        const row=database.raw.prepare("SELECT * FROM alert_rules WHERE user_id=? AND rule_id=?").get(user.id,value.ruleId);
        json(response,201,{item:ruleView(row)}); return true;
      }

      if(path==="/api/v1/alert-rules/history"&&method==="GET") {
        const limit=Math.max(1,Math.min(100,Number(url.searchParams.get("limit")??50)||50));
        const rows=database.raw.prepare("SELECT * FROM rule_alert_history WHERE user_id=? ORDER BY timestamp DESC LIMIT ?").all(user.id,limit);
        json(response,200,{items:rows.map(ruleAlertView)}); return true;
      }
      if(path==="/api/v1/alert-rules/history"&&method==="POST") {
        const b=await readBody(request),id=randomUUID();
        const v={alertId:str(b.alertId,"alertId"),ruleId:str(b.ruleId,"ruleId"),
          ruleName:str(b.ruleName,"ruleName"),positionId:str(b.positionId,"positionId",true),
          instrument:str(b.instrument,"instrument",true),condition:str(b.condition,"condition"),
          severity:str(b.severity,"severity"),description:str(b.description,"description"),
          previousState:str(b.previousState,"previousState",true),
          currentState:str(b.currentState,"currentState",true),timestamp:num(b.timestamp,"timestamp")};
        database.raw.prepare(`
          INSERT INTO rule_alert_history (id,user_id,alert_id,rule_id,rule_name,position_id,instrument,condition,severity,description,previous_state,current_state,timestamp)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id,alert_id) DO UPDATE SET
            rule_id=excluded.rule_id,rule_name=excluded.rule_name,condition=excluded.condition,
            severity=excluded.severity,description=excluded.description,
            previous_state=excluded.previous_state,current_state=excluded.current_state,timestamp=excluded.timestamp
        `).run(id,user.id,v.alertId,v.ruleId,v.ruleName,v.positionId,v.instrument,v.condition,
          v.severity,v.description,v.previousState,v.currentState,v.timestamp);
        database.raw.prepare(`
          DELETE FROM rule_alert_history WHERE user_id=? AND id NOT IN (
            SELECT id FROM rule_alert_history WHERE user_id=? ORDER BY timestamp DESC LIMIT ?
          )
        `).run(user.id,user.id,MAX_RULE_ALERTS);
        const row=database.raw.prepare("SELECT * FROM rule_alert_history WHERE user_id=? AND alert_id=?").get(user.id,v.alertId);
        json(response,201,{item:ruleAlertView(row)}); return true;
      }
      if(path==="/api/v1/alert-rules/history"&&method==="DELETE") {
        const result=database.raw.prepare("DELETE FROM rule_alert_history WHERE user_id=?").run(user.id);
        json(response,200,{deleted:result.changes}); return true;
      }

      const rule=path.match(/^\/api\/v1\/alert-rules\/([^/]+)$/);
      if(rule&&method==="PATCH") {
        const b=await readBody(request),sets=[],values=[];
        const fields={name:["name","string"],enabled:["enabled","boolean"],severity:["severity","string"],cooldownMs:["cooldown_ms","number"]};
        for(const [key,val] of Object.entries(b)) {
          const spec=fields[key]; if(!spec) continue;
          if(spec[1]==="string") values.push(str(val,key));
          else if(spec[1]==="boolean") values.push(bool(val,key)?1:0);
          else values.push(num(val,key));
          if(key==="severity") checkEnum(val,SEVERITIES,"severity");
          sets.push(`${spec[0]}=?`);
        }
        if(!sets.length) { json(response,400,{error:"no_mutable_fields"}); return true; }
        sets.push("updated_at=?"); values.push(Date.now(),user.id,decodeURIComponent(rule[1]));
        const result=database.raw.prepare(`UPDATE alert_rules SET ${sets.join(",")} WHERE user_id=? AND rule_id=?`).run(...values);
        if(!result.changes) { json(response,404,{error:"rule_not_found"}); return true; }
        const row=database.raw.prepare("SELECT * FROM alert_rules WHERE user_id=? AND rule_id=?").get(user.id,decodeURIComponent(rule[1]));
        json(response,200,{item:ruleView(row)}); return true;
      }
      if(rule&&method==="DELETE") {
        const ruleId=decodeURIComponent(rule[1]);
        const result=database.raw.prepare("DELETE FROM alert_rules WHERE user_id=? AND rule_id=?").run(user.id,ruleId);
        database.raw.prepare("DELETE FROM rule_alert_history WHERE user_id=? AND rule_id=?").run(user.id,ruleId);
        json(response,result.changes?200:404,result.changes?{success:true}:{error:"rule_not_found"}); return true;
      }

      if(path==="/api/v1/notifications"&&method==="GET") {
        const limit=Math.max(1,Math.min(200,Number(url.searchParams.get("limit")??100)||100));
        const rows=database.raw.prepare("SELECT * FROM notifications WHERE user_id=? ORDER BY timestamp DESC LIMIT ?").all(user.id,limit);
        json(response,200,{items:rows.map(notificationView)}); return true;
      }
      if(path==="/api/v1/notifications/unread"&&method==="GET") {
        const rows=database.raw.prepare("SELECT * FROM notifications WHERE user_id=? AND read=0 ORDER BY timestamp DESC LIMIT 100").all(user.id);
        json(response,200,{items:rows.map(notificationView)}); return true;
      }
      if(path==="/api/v1/notifications/unread-count"&&method==="GET") {
        const row=database.raw.prepare("SELECT COUNT(*) AS count FROM (SELECT id FROM notifications WHERE user_id=? AND read=0 LIMIT 200)").get(user.id);
        json(response,200,{count:row.count}); return true;
      }
      if(path==="/api/v1/notifications"&&method==="POST") {
        const b=await readBody(request),id=randomUUID();
        const v={notificationId:str(b.notificationId,"notificationId"),alertIdentity:str(b.alertIdentity,"alertIdentity"),
          ruleId:str(b.ruleId,"ruleId"),ruleName:str(b.ruleName,"ruleName"),timestamp:num(b.timestamp,"timestamp"),
          instrument:str(b.instrument,"instrument",true),positionId:str(b.positionId,"positionId",true),
          side:str(b.side,"side",true),severity:str(b.severity,"severity"),title:str(b.title,"title"),
          message:str(b.message,"message"),category:str(b.category,"category"),impact:str(b.impact,"impact"),
          source:str(b.source,"source"),condition:str(b.condition,"condition")};
        const existing=database.raw.prepare("SELECT * FROM notifications WHERE user_id=? AND notification_id=?").get(user.id,v.notificationId);
        if(existing) { json(response,200,{item:notificationView(existing),deduplicated:true}); return true; }
        database.raw.prepare(`
          INSERT INTO notifications (id,user_id,notification_id,alert_identity,rule_id,rule_name,timestamp,
            instrument,position_id,side,severity,title,message,category,impact,read,dismissed,source,condition)
          VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?,?)
        `).run(id,user.id,v.notificationId,v.alertIdentity,v.ruleId,v.ruleName,v.timestamp,v.instrument,
          v.positionId,v.side,v.severity,v.title,v.message,v.category,v.impact,v.source,v.condition);
        database.raw.prepare(`
          DELETE FROM notifications WHERE user_id=? AND id NOT IN (
            SELECT id FROM notifications WHERE user_id=? ORDER BY timestamp DESC LIMIT ?
          )
        `).run(user.id,user.id,MAX_NOTIFICATIONS);
        const row=database.raw.prepare("SELECT * FROM notifications WHERE user_id=? AND notification_id=?").get(user.id,v.notificationId);
        json(response,201,{item:notificationView(row)}); return true;
      }
      if(path==="/api/v1/notifications/read-all"&&method==="POST") {
        const result=database.raw.prepare("UPDATE notifications SET read=1 WHERE user_id=? AND read=0 AND id IN (SELECT id FROM notifications WHERE user_id=? AND read=0 ORDER BY timestamp DESC LIMIT 200)").run(user.id,user.id);
        json(response,200,{updated:result.changes}); return true;
      }
      const notif=path.match(/^\/api\/v1\/notifications\/([^/]+)(?:\/(read|dismiss))?$/);
      if(notif&&notif[2]&&method==="POST") {
        const id=decodeURIComponent(notif[1]);
        const sql=notif[2]==="read"
          ? "UPDATE notifications SET read=1 WHERE user_id=? AND notification_id=?"
          : "UPDATE notifications SET dismissed=1,read=1 WHERE user_id=? AND notification_id=?";
        const result=database.raw.prepare(sql).run(user.id,id);
        json(response,result.changes?200:404,result.changes?{success:true}:{error:"notification_not_found"}); return true;
      }
      if(notif&&!notif[2]&&method==="DELETE") {
        const result=database.raw.prepare("DELETE FROM notifications WHERE user_id=? AND notification_id=?").run(user.id,decodeURIComponent(notif[1]));
        json(response,result.changes?200:404,result.changes?{success:true}:{error:"notification_not_found"}); return true;
      }

      if(path==="/api/v1/notification-preferences"&&method==="GET") {
        const row=database.raw.prepare("SELECT * FROM notification_preferences WHERE user_id=?").get(user.id);
        json(response,200,{preferences:preferencesView(row)}); return true;
      }
      if(path==="/api/v1/notification-preferences"&&method==="PUT") {
        const b=await readBody(request);
        const minimumSeverity=str(b.minimumSeverity,"minimumSeverity");
        checkEnum(minimumSeverity,SEVERITIES,"minimumSeverity");
        const enabledCategories=stringArray(b.enabledCategories,"enabledCategories");
        const enabledScopes=stringArray(b.enabledScopes,"enabledScopes");
        const mutedRuleIds=stringArray(b.mutedRuleIds,"mutedRuleIds");
        const enabledInstruments=stringArray(b.enabledInstruments,"enabledInstruments");
        const mutedInstruments=stringArray(b.mutedInstruments,"mutedInstruments");
        enabledCategories.forEach(x=>checkEnum(x,CATEGORIES,"category"));
        enabledScopes.forEach(x=>checkEnum(x,SCOPES,"scope"));
        const showRead=bool(b.showReadNotifications,"showReadNotifications");
        const showDismissed=bool(b.showDismissedNotifications,"showDismissedNotifications");
        const id=randomUUID(),now=Date.now();
        database.raw.prepare(`
          INSERT INTO notification_preferences (id,user_id,minimum_severity,enabled_categories,enabled_scopes,
            muted_rule_ids,enabled_instruments,muted_instruments,show_read_notifications,show_dismissed_notifications,updated_at)
          VALUES (?,?,?,?,?,?,?,?,?,?,?)
          ON CONFLICT(user_id) DO UPDATE SET minimum_severity=excluded.minimum_severity,
            enabled_categories=excluded.enabled_categories,enabled_scopes=excluded.enabled_scopes,
            muted_rule_ids=excluded.muted_rule_ids,enabled_instruments=excluded.enabled_instruments,
            muted_instruments=excluded.muted_instruments,show_read_notifications=excluded.show_read_notifications,
            show_dismissed_notifications=excluded.show_dismissed_notifications,updated_at=excluded.updated_at
        `).run(id,user.id,minimumSeverity,JSON.stringify(enabledCategories),JSON.stringify(enabledScopes),
          JSON.stringify(mutedRuleIds),JSON.stringify(enabledInstruments),JSON.stringify(mutedInstruments),
          showRead?1:0,showDismissed?1:0,now);
        const row=database.raw.prepare("SELECT * FROM notification_preferences WHERE user_id=?").get(user.id);
        json(response,200,{preferences:preferencesView(row)}); return true;
      }
      if(path==="/api/v1/notification-preferences"&&method==="DELETE") {
        database.raw.prepare("DELETE FROM notification_preferences WHERE user_id=?").run(user.id);
        json(response,200,{preferences:DEFAULT_PREFERENCES}); return true;
      }

      json(response,404,{error:"route_not_found"}); return true;
    } catch(error) {
      json(response,Number.isInteger(error?.status)?error.status:400,{error:error.message||"invalid_request"});
      return true;
    }
  };
}
