import { createTool, McpServer } from "@convex-dev/mcp";
import { getAuthUserId } from "@convex-dev/auth/server";
import { v } from "convex/values";
import { components, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";

const tool = createTool<Id<"users">>();
const component = (components as any).mcp;
const internalMcpData = (internal as any).mcpData;

export const mcp: McpServer<Id<"users">> = new McpServer(component, {
  name: "xstarz-analysis",
  title: "XSTARZG Analysis",
  version: "1.0.0",
  instructions:
    "Read the authenticated user's XSTARZG trading and investing analysis data. " +
    "All tools are read-only and scoped to the account that approved this connection. " +
    "Use analysis history for prior signals, the journal for recorded trade plans/outcomes, " +
    "monitored positions for current risk state, and runtime health for provider/pipeline status. " +
    "Never infer a live price or current recommendation from historical records.",
  consentUrl:
    process.env.MCP_CONSENT_URL ??
    "https://xstarzanalysis.vercel.app/connect",
  // ChatGPT publishes its OAuth client metadata on this host. Keeping the
  // allowlist exact enables CIMD without allowing arbitrary backend fetches.
  clientMetadataDocumentHosts: ["chatgpt.com"],
  scopes: {
    "analysis:read": "Read your own analyses, journal, monitored positions, and runtime health",
  },
  tools: {
    list_recent_analyses: tool({
      description:
        "List the authenticated user's most recent saved trading/investing analyses. " +
        "Returns historical snapshots only; it does not run a new market analysis or imply prices are live.",
      args: { limit: v.optional(v.number()) },
      returns: v.object({
        analyses: v.array(v.object({
          id: v.string(),
          instrument: v.string(),
          instrumentType: v.string(),
          timeframe: v.string(),
          bias: v.string(),
          confidence: v.number(),
          recommendation: v.optional(v.string()),
          riskReward: v.optional(v.number()),
          price: v.optional(v.number()),
          dataCompleteness: v.string(),
          keyLevels: v.object({
            support: v.string(),
            resistance: v.string(),
            invalidation: v.string(),
          }),
          timestamp: v.number(),
        })),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      scope: "analysis:read",
      handler: async (ctx, args, user) => ({
        analyses: await ctx.runQuery(internalMcpData.listRecentAnalyses, {
          userId: user.userId,
          limit: args.limit ?? 10,
        }),
      }),
    }),
    list_trade_journal: tool({
      description:
        "List the authenticated user's recorded trade plans and outcomes. " +
        "Returns structured position levels and status; private free-text notes are excluded.",
      args: { limit: v.optional(v.number()) },
      returns: v.object({
        entries: v.array(v.object({
          id: v.string(),
          instrument: v.string(),
          instrumentType: v.string(),
          timeframe: v.string(),
          style: v.string(),
          status: v.string(),
          entry: v.optional(v.number()),
          stopLoss: v.optional(v.number()),
          takeProfit: v.optional(v.number()),
          riskReward: v.optional(v.number()),
          pnl: v.optional(v.number()),
          outcome: v.optional(v.string()),
          createdAt: v.number(),
          updatedAt: v.number(),
        })),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      scope: "analysis:read",
      handler: async (ctx, args, user) => ({
        entries: await ctx.runQuery(internalMcpData.listTradeJournal, {
          userId: user.userId,
          limit: args.limit ?? 10,
        }),
      }),
    }),
    list_monitored_positions: tool({
      description:
        "List the authenticated user's monitored positions and current protection lifecycle/severity. " +
        "This is persisted monitoring state, not a fresh quote.",
      args: { limit: v.optional(v.number()) },
      returns: v.object({
        positions: v.array(v.object({
          positionId: v.string(),
          instrument: v.string(),
          side: v.string(),
          entryPrice: v.number(),
          stopLoss: v.optional(v.number()),
          takeProfit: v.optional(v.number()),
          horizon: v.string(),
          currentSeverity: v.string(),
          lifecycleState: v.string(),
          monitoringLifecycle: v.string(),
          openedAt: v.number(),
          lastUpdateAt: v.number(),
        })),
      }),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      scope: "analysis:read",
      handler: async (ctx, args, user) => ({
        positions: await ctx.runQuery(internalMcpData.listMonitoredPositions, {
          userId: user.userId,
          limit: args.limit ?? 20,
        }),
      }),
    }),
    get_runtime_health: tool({
      description:
        "Get the latest persisted runtime health snapshot for the authenticated user's account. " +
        "Reports component freshness and pipeline status; it does not trigger jobs or repair services.",
      args: {},
      returns: v.union(
        v.null(),
        v.object({
          overallStatus: v.string(),
          timestamp: v.number(),
          intelligenceCycleStatus: v.string(),
          alertPipelineStatus: v.string(),
          persistenceStatus: v.string(),
          staleComponents: v.array(v.string()),
          unavailableComponents: v.array(v.string()),
          components: v.array(v.object({
            component: v.string(),
            status: v.string(),
            freshness: v.string(),
            consecutiveFailures: v.number(),
          })),
        }),
      ),
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
      scope: "analysis:read",
      handler: async (ctx, _args, user) =>
        await ctx.runQuery(internalMcpData.getRuntimeHealth, {
          userId: user.userId,
        }),
    }),
  },
});

export const {
  getAuthRequest,
  findAuthRequest,
  authorize,
  listConnections,
  revokeConnection,
  createApiKey,
} = mcp.api({ getUserId: getAuthUserId });

export const { createApiKeyForUser } = mcp.internalApi();
