import { randomUUID } from "node:crypto";
import { getAuthenticatedUser, isAllowedOrigin } from "./auth.mjs";

const VALID_TRANSITIONS = {
  PLANNED: ["OPEN", "CANCELLED", "INVALIDATED"],
  OPEN: ["CLOSED", "INVALIDATED"],
  WAITING: ["PLANNED", "CANCELLED"],
};
const INITIAL_STATUSES = new Set(["PLANNED", "WAITING", "NO_TRADE"]);

function json(response, status, value) {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
}

async function bodyOf(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > 1_048_576) throw Object.assign(new Error("Request body too large"), { status: 413 });
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString("utf8"));
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw Object.assign(new Error("Invalid JSON object"), { status: 400 });
  }
}

function str(value, name, optional = false) {
  if (optional && value === undefined) return null;
  if (typeof value !== "string" || (!optional && !value.trim())) {
    throw Object.assign(new Error(`${name} must be a string`), { status: 400 });
  }
  return value;
}

function num(value, name, optional = false) {
  if (optional && value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw Object.assign(new Error(`${name} must be a finite number`), { status: 400 });
  }
  return value;
}

function object(value, name) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw Object.assign(new Error(`${name} must be an object`), { status: 400 });
  }
  return value;
}

function decode(value) {
  return value === null || value === undefined ? null : JSON.parse(value);
}

function analysisView(row) {
  return {
    _id: row.id, _creationTime: row.created_at, instrument: row.instrument,
    instrumentType: row.instrument_type, timeframe: row.timeframe, bias: row.bias,
    confidence: row.confidence, recommendation: row.recommendation, conviction: row.conviction,
    noTradeReasons: decode(row.no_trade_reasons), riskReward: row.risk_reward,
    tradingStyle: row.trading_style, technicalSummary: row.technical_summary,
    fundamentalSummary: row.fundamental_summary, breakdown: decode(row.breakdown),
    keyLevels: decode(row.key_levels), riskNote: row.risk_note,
    dataCompleteness: row.data_completeness, dataFlags: decode(row.data_flags),
    price: row.price, dataSource: row.data_source, sentimentSummary: row.sentiment_summary,
    sentimentScore: row.sentiment_score, macroSummary: row.macro_summary,
    derivativesSummary: row.derivatives_summary, calendarSummary: row.calendar_summary,
    timestamp: row.timestamp,
  };
}

function journalView(row) {
  return {
    _id: row.id, _creationTime: row.created_at, instrument: row.instrument,
    instrumentType: row.instrument_type, timeframe: row.timeframe, style: row.style,
    analysisSnapshot: decode(row.analysis_snapshot), status: row.status,
    entry: row.entry, stopLoss: row.stop_loss, takeProfit: row.take_profit,
    riskReward: row.risk_reward, positionSize: row.position_size, notionalValue: row.notional_value,
    exitPrice: row.exit_price, pnl: row.pnl, pnlPercent: row.pnl_percent, outcome: row.outcome,
    closedAt: row.closed_at, entryReason: row.entry_reason, thesisAtEntry: row.thesis_at_entry,
    confirmationObserved: row.confirmation_observed, invalidationObserved: row.invalidation_observed,
    whatWentRight: row.what_went_right, whatWentWrong: row.what_went_wrong,
    lessons: row.lessons, notes: row.notes,
    timestamps: { createdAt: row.created_at, updatedAt: row.updated_at },
  };
}

function validateAnalysis(input) {
  const breakdown = object(input.breakdown, "breakdown");
  const levels = object(input.keyLevels, "keyLevels");
  if (!Array.isArray(input.dataFlags) || input.dataFlags.some((x) => typeof x !== "string")) {
    throw Object.assign(new Error("dataFlags must be an array of strings"), { status: 400 });
  }
  if (input.noTradeReasons !== undefined &&
      (!Array.isArray(input.noTradeReasons) || input.noTradeReasons.some((x) => typeof x !== "string"))) {
    throw Object.assign(new Error("noTradeReasons must be an array of strings"), { status: 400 });
  }
  return {
    instrument: str(input.instrument, "instrument"),
    instrumentType: str(input.instrumentType, "instrumentType"),
    timeframe: str(input.timeframe, "timeframe"),
    bias: str(input.bias, "bias"),
    confidence: num(input.confidence, "confidence"),
    recommendation: str(input.recommendation, "recommendation", true),
    conviction: str(input.conviction, "conviction", true),
    noTradeReasons: input.noTradeReasons ?? null,
    riskReward: num(input.riskReward, "riskReward", true),
    tradingStyle: str(input.tradingStyle, "tradingStyle", true),
    technicalSummary: str(input.technicalSummary, "technicalSummary"),
    fundamentalSummary: str(input.fundamentalSummary, "fundamentalSummary"),
    breakdown: {
      trend: num(breakdown.trend, "breakdown.trend"),
      indicator: num(breakdown.indicator, "breakdown.indicator"),
      fundamental: num(breakdown.fundamental, "breakdown.fundamental"),
      sentiment: num(breakdown.sentiment, "breakdown.sentiment"),
    },
    keyLevels: {
      support: str(levels.support, "keyLevels.support"),
      resistance: str(levels.resistance, "keyLevels.resistance"),
      invalidation: str(levels.invalidation, "keyLevels.invalidation"),
    },
    riskNote: str(input.riskNote, "riskNote"),
    dataCompleteness: str(input.dataCompleteness, "dataCompleteness"),
    dataFlags: input.dataFlags,
    price: num(input.price, "price", true),
    dataSource: str(input.dataSource, "dataSource", true),
    sentimentSummary: str(input.sentimentSummary, "sentimentSummary", true),
    sentimentScore: num(input.sentimentScore, "sentimentScore", true),
    macroSummary: str(input.macroSummary, "macroSummary", true),
    derivativesSummary: str(input.derivativesSummary, "derivativesSummary", true),
    calendarSummary: str(input.calendarSummary, "calendarSummary", true),
  };
}

export function createDomainHandler({ database, env = process.env }) {
  return async (request, response, url) => {
    const path = url.pathname;
    const method = request.method ?? "GET";
    if (!path.startsWith("/api/v1/analyses") && !path.startsWith("/api/v1/journal")) return false;

    if (method !== "GET" && !isAllowedOrigin(request, env)) {
      json(response, 403, { error: "origin_not_allowed" });
      return true;
    }
    const user = getAuthenticatedUser(database, request, env);
    if (!user) {
      json(response, 401, { error: "authentication_required" });
      return true;
    }

    try {
      if (path === "/api/v1/analyses" && method === "GET") {
        const rows = database.raw.prepare(
          "SELECT * FROM analyses WHERE user_id = ? ORDER BY timestamp DESC LIMIT 20",
        ).all(user.id);
        json(response, 200, { items: rows.map(analysisView) });
        return true;
      }

      if (path === "/api/v1/analyses" && method === "POST") {
        const value = validateAnalysis(await bodyOf(request));
        const id = randomUUID();
        const now = Date.now();
        database.raw.prepare(`
          INSERT INTO analyses (
            id,user_id,instrument,instrument_type,timeframe,bias,confidence,recommendation,
            conviction,no_trade_reasons,risk_reward,trading_style,technical_summary,
            fundamental_summary,breakdown,key_levels,risk_note,data_completeness,data_flags,
            price,data_source,sentiment_summary,sentiment_score,macro_summary,
            derivatives_summary,calendar_summary,timestamp,created_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          id,user.id,value.instrument,value.instrumentType,value.timeframe,value.bias,value.confidence,
          value.recommendation,value.conviction,
          value.noTradeReasons === null ? null : JSON.stringify(value.noTradeReasons),
          value.riskReward,value.tradingStyle,value.technicalSummary,value.fundamentalSummary,
          JSON.stringify(value.breakdown),JSON.stringify(value.keyLevels),value.riskNote,
          value.dataCompleteness,JSON.stringify(value.dataFlags),value.price,value.dataSource,
          value.sentimentSummary,value.sentimentScore,value.macroSummary,value.derivativesSummary,
          value.calendarSummary,now,now,
        );
        database.raw.prepare(`
          DELETE FROM analyses WHERE user_id = ? AND id NOT IN (
            SELECT id FROM analyses WHERE user_id = ? ORDER BY timestamp DESC LIMIT 100
          )
        `).run(user.id,user.id);
        const row = database.raw.prepare("SELECT * FROM analyses WHERE id = ? AND user_id = ?").get(id,user.id);
        json(response, 201, { item: analysisView(row) });
        return true;
      }

      if (path === "/api/v1/analyses" && method === "DELETE") {
        const result = database.raw.prepare("DELETE FROM analyses WHERE user_id = ?").run(user.id);
        json(response, 200, { deleted: result.changes });
        return true;
      }

      if (path === "/api/v1/journal" && method === "GET") {
        const instrument = url.searchParams.get("instrument");
        const status = url.searchParams.get("status");
        const rows = instrument
          ? database.raw.prepare("SELECT * FROM journal WHERE user_id = ? AND instrument = ? ORDER BY created_at DESC LIMIT 50").all(user.id,instrument)
          : status
            ? database.raw.prepare("SELECT * FROM journal WHERE user_id = ? AND status = ? ORDER BY created_at DESC LIMIT 50").all(user.id,status)
            : database.raw.prepare("SELECT * FROM journal WHERE user_id = ? ORDER BY created_at DESC LIMIT 100").all(user.id);
        json(response, 200, { items: rows.map(journalView) });
        return true;
      }

      if (path === "/api/v1/journal" && method === "POST") {
        const input = await bodyOf(request);
        const snapshot = object(input.analysisSnapshot, "analysisSnapshot");
        const status = input.status ?? "PLANNED";
        if (!INITIAL_STATUSES.has(status)) throw Object.assign(new Error("Invalid initial journal status"), { status: 400 });
        const id = randomUUID();
        const now = Date.now();
        database.raw.prepare(`
          INSERT INTO journal (
            id,user_id,instrument,instrument_type,timeframe,style,analysis_snapshot,status,
            entry,stop_loss,take_profit,risk_reward,position_size,notional_value,
            entry_reason,thesis_at_entry,notes,created_at,updated_at
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
        `).run(
          id,user.id,str(input.instrument,"instrument"),str(input.instrumentType,"instrumentType"),
          str(input.timeframe,"timeframe"),str(input.style,"style"),JSON.stringify(snapshot),status,
          num(input.entry,"entry",true),num(input.stopLoss,"stopLoss",true),
          num(input.takeProfit,"takeProfit",true),num(input.riskReward,"riskReward",true),
          num(input.positionSize,"positionSize",true),num(input.notionalValue,"notionalValue",true),
          str(input.entryReason,"entryReason",true),str(input.thesisAtEntry,"thesisAtEntry",true),
          str(input.notes,"notes",true),now,now,
        );
        const row = database.raw.prepare("SELECT * FROM journal WHERE id = ? AND user_id = ?").get(id,user.id);
        json(response, 201, { item: journalView(row) });
        return true;
      }

      const transition = path.match(/^\/api\/v1\/journal\/([0-9a-f-]+)\/transition$/i);
      const entryPath = path.match(/^\/api\/v1\/journal\/([0-9a-f-]+)$/i);
      if (transition && method === "PATCH") {
        const id = transition[1];
        const input = await bodyOf(request);
        const row = database.raw.prepare("SELECT * FROM journal WHERE id = ? AND user_id = ?").get(id,user.id);
        if (!row) { json(response,404,{error:"journal_entry_not_found"}); return true; }
        const next = str(input.newStatus,"newStatus");
        if (!(VALID_TRANSITIONS[row.status] ?? []).includes(next)) {
          json(response,409,{error:"invalid_status_transition",from:row.status,to:next});
          return true;
        }
        const now = Date.now();
        database.raw.prepare(`
          UPDATE journal SET status = ?,
            exit_price = CASE WHEN ? = 'CLOSED' THEN ? ELSE exit_price END,
            pnl = CASE WHEN ? = 'CLOSED' THEN ? ELSE pnl END,
            pnl_percent = CASE WHEN ? = 'CLOSED' THEN ? ELSE pnl_percent END,
            outcome = CASE WHEN ? = 'CLOSED' THEN ? ELSE outcome END,
            closed_at = CASE WHEN ? = 'CLOSED' THEN ? ELSE closed_at END,
            updated_at = ?
          WHERE id = ? AND user_id = ?
        `).run(
          next,next,num(input.exitPrice,"exitPrice",true),next,num(input.pnl,"pnl",true),
          next,num(input.pnlPercent,"pnlPercent",true),next,str(input.outcome,"outcome",true),
          next,now,now,id,user.id,
        );
        const updated = database.raw.prepare("SELECT * FROM journal WHERE id = ? AND user_id = ?").get(id,user.id);
        json(response,200,{item:journalView(updated)});
        return true;
      }

      if (entryPath && method === "GET") {
        const row = database.raw.prepare("SELECT * FROM journal WHERE id = ? AND user_id = ?").get(entryPath[1],user.id);
        json(response,row ? 200 : 404,row ? {item:journalView(row)} : {error:"journal_entry_not_found"});
        return true;
      }

      if (entryPath && method === "PATCH") {
        const input = await bodyOf(request);
        const columns = {
          entry:["entry","number"], stopLoss:["stop_loss","number"], takeProfit:["take_profit","number"],
          riskReward:["risk_reward","number"], positionSize:["position_size","number"],
          notionalValue:["notional_value","number"], entryReason:["entry_reason","string"],
          thesisAtEntry:["thesis_at_entry","string"], confirmationObserved:["confirmation_observed","string"],
          invalidationObserved:["invalidation_observed","string"], whatWentRight:["what_went_right","string"],
          whatWentWrong:["what_went_wrong","string"], lessons:["lessons","string"], notes:["notes","string"],
        };
        const sets = [], values = [];
        for (const [key,value] of Object.entries(input)) {
          const spec = columns[key];
          if (!spec) continue;
          values.push(spec[1] === "number" ? num(value,key,true) : str(value,key,true));
          sets.push(`${spec[0]} = ?`);
        }
        if (!sets.length) { json(response,400,{error:"no_mutable_fields"}); return true; }
        sets.push("updated_at = ?");
        values.push(Date.now(),entryPath[1],user.id);
        const result = database.raw.prepare(`UPDATE journal SET ${sets.join(",")} WHERE id = ? AND user_id = ?`).run(...values);
        if (!result.changes) { json(response,404,{error:"journal_entry_not_found"}); return true; }
        const updated = database.raw.prepare("SELECT * FROM journal WHERE id = ? AND user_id = ?").get(entryPath[1],user.id);
        json(response,200,{item:journalView(updated)});
        return true;
      }

      if (entryPath && method === "DELETE") {
        const result = database.raw.prepare("DELETE FROM journal WHERE id = ? AND user_id = ?").run(entryPath[1],user.id);
        json(response,result.changes ? 200 : 404,result.changes ? {success:true} : {error:"journal_entry_not_found"});
        return true;
      }

      json(response,404,{error:"route_not_found"});
      return true;
    } catch (error) {
      json(response,Number.isInteger(error?.status) ? error.status : 400,{error:error.message || "invalid_request"});
      return true;
    }
  };
}
