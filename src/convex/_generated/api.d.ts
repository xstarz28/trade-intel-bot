/* eslint-disable */
/**
 * Generated `api` utility.
 *
 * THIS CODE IS AUTOMATICALLY GENERATED.
 *
 * To regenerate, run `npx convex dev`.
 * @module
 */

import type * as alertRules from "../alertRules.js";
import type * as alphaVantage from "../alphaVantage.js";
import type * as analyses from "../analyses.js";
import type * as auth from "../auth.js";
import type * as auth_emailOtp from "../auth/emailOtp.js";
import type * as coinglass from "../coinglass.js";
import type * as cot from "../cot.js";
import type * as eia from "../eia.js";
import type * as historicalIntelligence from "../historicalIntelligence.js";
import type * as http from "../http.js";
import type * as journal from "../journal.js";
import type * as liveProtection from "../liveProtection.js";
import type * as marketData from "../marketData.js";
import type * as notificationPreferences from "../notificationPreferences.js";
import type * as notifications from "../notifications.js";
import type * as okx from "../okx.js";
import type * as positionProtection from "../positionProtection.js";
import type * as runtimeHealth from "../runtimeHealth.js";
import type * as tradingEconomics from "../tradingEconomics.js";
import type * as treasury from "../treasury.js";
import type * as users from "../users.js";

import type {
  ApiFromModules,
  FilterApi,
  FunctionReference,
} from "convex/server";

declare const fullApi: ApiFromModules<{
  alertRules: typeof alertRules;
  alphaVantage: typeof alphaVantage;
  analyses: typeof analyses;
  auth: typeof auth;
  "auth/emailOtp": typeof auth_emailOtp;
  coinglass: typeof coinglass;
  cot: typeof cot;
  eia: typeof eia;
  historicalIntelligence: typeof historicalIntelligence;
  http: typeof http;
  journal: typeof journal;
  liveProtection: typeof liveProtection;
  marketData: typeof marketData;
  notificationPreferences: typeof notificationPreferences;
  notifications: typeof notifications;
  okx: typeof okx;
  positionProtection: typeof positionProtection;
  runtimeHealth: typeof runtimeHealth;
  tradingEconomics: typeof tradingEconomics;
  treasury: typeof treasury;
  users: typeof users;
}>;

/**
 * A utility for referencing Convex functions in your app's public API.
 *
 * Usage:
 * ```js
 * const myFunctionReference = api.myModule.myFunction;
 * ```
 */
export declare const api: FilterApi<typeof fullApi, FunctionReference<any, "public">>;
export declare const internal: FilterApi<typeof fullApi, FunctionReference<any, "internal">>;
export declare const components: {};