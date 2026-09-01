/**
 * Phase 93 — Custom Alert Rules Panel
 *
 * Trader-facing UI for managing custom intelligence alert rules.
 * CRUD via Convex mutations. No auto-execution. INFORMATIONAL_ONLY.
 */
import React, { useState, useCallback, useMemo } from "react";
import { useI18n } from "@/lib/i18n";
import { toast } from "sonner";
import { motion, AnimatePresence } from "framer-motion";
import {
  Bell,
  BellOff,
  Plus,
  Trash2,
  RefreshCw,
  ChevronDown,
  ChevronUp,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useQuery, useMutation } from "convex/react";
import { api } from "../convex/_generated/api";
import {
  CONDITION_LABELS,
  SEVERITY_COLORS,
  SEVERITY_BG,
  MAX_RULES_PER_USER,
  type RuleScope,
  type RuleCondition,
  type RuleSeverity,
} from "@/lib/position-protection/alert-rule-engine";

// ═══════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════

const SCOPE_OPTIONS: RuleScope[] = ["POSITION", "INSTRUMENT", "PORTFOLIO", "GLOBAL"];

const SEVERITY_OPTIONS: RuleSeverity[] = ["INFO", "LOW", "MEDIUM", "HIGH", "CRITICAL"];

const CONDITION_OPTIONS: RuleCondition[] = Object.keys(CONDITION_LABELS) as RuleCondition[];

const COOLDOWN_PRESETS: { label: string; ms: number }[] = [
  { label: "1m", ms: 60_000 },
  { label: "5m", ms: 300_000 },
  { label: "15m", ms: 900_000 },
  { label: "1h", ms: 3_600_000 },
  { label: "4h", ms: 14_400_000 },
];

// ═══════════════════════════════════════════════════════════════
// NEW RULE FORM
// ═══════════════════════════════════════════════════════════════

function NewRuleForm({
  onClose,
  onCreate,
}: {
  onClose: () => void;
  onCreate: (rule: {
    name: string;
    scope: RuleScope;
    condition: RuleCondition;
    severity: RuleSeverity;
    cooldownMs: number;
    instrument?: string;
    positionId?: string;
  }) => void;
}) {
  const { t } = useI18n();
  const [name, setName] = useState("");
  const [scope, setScope] = useState<RuleScope>("POSITION");
  const [condition, setCondition] = useState<RuleCondition>("THESIS_STATE_CHANGED");
  const [severity, setSeverity] = useState<RuleSeverity>("MEDIUM");
  const [cooldownMs, setCooldownMs] = useState(300_000);
  const [instrument, setInstrument] = useState("");
  const [positionId, setPositionId] = useState("");

  const canSubmit = name.trim().length > 0;

  const handleSubmit = () => {
    if (!canSubmit) return;
    onCreate({
      name: name.trim(),
      scope,
      condition,
      severity,
      cooldownMs,
      instrument: instrument.trim() || undefined,
      positionId: positionId.trim() || undefined,
    });
    onClose();
  };

  return (
    <motion.div
      initial={{ opacity: 0, height: 0 }}
      animate={{ opacity: 1, height: "auto" }}
      exit={{ opacity: 0, height: 0 }}
      className="overflow-hidden"
    >
      <div className="border border-border/30 rounded-lg p-3 space-y-3">
        <div className="flex items-center gap-2">
          <Plus className="size-3 text-primary" />
          <span className="text-[10px] font-mono font-semibold text-foreground">
            New Alert Rule
          </span>
          <Button
            variant="ghost"
            size="sm"
            className="h-5 text-[9px] font-mono ml-auto"
            onClick={onClose}
          >
            Cancel
          </Button>
        </div>

        {/* Name */}
        <div>
          <label className="text-[9px] font-mono text-muted-foreground block mb-1">
            {t.alerts.ruleName}
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g. BTC Thesis Deterioration Alert"
            className="w-full h-7 text-[10px] font-mono rounded border border-border/50 bg-transparent px-2 placeholder:text-muted-foreground/40"
          />
        </div>

        {/* Scope */}
        <div>
          <label className="text-[9px] font-mono text-muted-foreground block mb-1">
            {t.alerts.scope}
          </label>
          <div className="flex gap-1">
            {SCOPE_OPTIONS.map((s) => (
              <button
                key={s}
                className={`text-[9px] font-mono py-1 px-2 rounded border transition-colors ${
                  scope === s
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-muted-foreground border-border/30 hover:text-foreground"
                }`}
                onClick={() => setScope(s)}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {/* Instrument & PositionId (conditional) */}
        {(scope === "INSTRUMENT" || scope === "POSITION") && (
          <div className="grid grid-cols-2 gap-2">
            {scope === "INSTRUMENT" && (
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-1">
                  Instrument
                </label>
                <input
                  type="text"
                  value={instrument}
                  onChange={(e) => setInstrument(e.target.value)}
                  placeholder="e.g. BTC/USDT"
                  className="w-full h-7 text-[10px] font-mono rounded border border-border/50 bg-transparent px-2 placeholder:text-muted-foreground/40"
                />
              </div>
            )}
            {scope === "POSITION" && (
              <div>
                <label className="text-[9px] font-mono text-muted-foreground block mb-1">
                  Position ID
                </label>
                <input
                  type="text"
                  value={positionId}
                  onChange={(e) => setPositionId(e.target.value)}
                  placeholder="e.g. pos-abc123"
                  className="w-full h-7 text-[10px] font-mono rounded border border-border/50 bg-transparent px-2 placeholder:text-muted-foreground/40"
                />
              </div>
            )}
          </div>
        )}

        {/* Condition */}
        <div>
          <label className="text-[9px] font-mono text-muted-foreground block mb-1">
            {t.alerts.condition}
          </label>
          <select
            value={condition}
            onChange={(e) => setCondition(e.target.value as RuleCondition)}
            className="w-full h-7 text-[10px] font-mono rounded border border-border/50 bg-transparent px-2"
          >
            {CONDITION_OPTIONS.map((c) => (
              <option key={c} value={c}>
                {CONDITION_LABELS[c]}
              </option>
            ))}
          </select>
        </div>

        {/* Severity */}
        <div>
          <label className="text-[9px] font-mono text-muted-foreground block mb-1">
            {t.alerts.severity}
          </label>
          <div className="flex gap-1">
            {SEVERITY_OPTIONS.map((sev) => (
              <button
                key={sev}
                className={`text-[9px] font-mono py-1 px-2 rounded border transition-colors ${
                  severity === sev
                    ? `${SEVERITY_BG[sev]} ${SEVERITY_COLORS[sev]} border-current/30`
                    : "text-muted-foreground border-border/30 hover:text-foreground"
                }`}
                onClick={() => setSeverity(sev)}
              >
                {sev}
              </button>
            ))}
          </div>
        </div>

        {/* Cooldown */}
        <div>
          <label className="text-[9px] font-mono text-muted-foreground block mb-1">
            {t.alerts.cooldown}
          </label>
          <div className="flex gap-1">
            {COOLDOWN_PRESETS.map((p) => (
              <button
                key={p.ms}
                className={`text-[9px] font-mono py-1 px-2 rounded border transition-colors ${
                  cooldownMs === p.ms
                    ? "bg-primary/15 text-primary border-primary/30"
                    : "text-muted-foreground border-border/30 hover:text-foreground"
                }`}
                onClick={() => setCooldownMs(p.ms)}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Submit */}
        <Button
          size="sm"
          className="h-7 text-[10px] font-mono gap-1"
          disabled={!canSubmit}
          onClick={handleSubmit}
        >
          <Plus className="size-3" />
          {t.alerts.createRule}
        </Button>
      </div>
    </motion.div>
  );
}

// ═══════════════════════════════════════════════════════════════
// RULE ROW
// ═══════════════════════════════════════════════════════════════

function RuleRow({
  rule,
  onToggle,
  onDelete,
}: {
  rule: {
    _id: string;
    ruleId: string;
    name: string;
    enabled: boolean;
    scope: string;
    instrument?: string;
    positionId?: string;
    condition: string;
    severity: string;
    cooldownMs: number;
    createdAt: number;
  };
  onToggle: (ruleId: string, enabled: boolean) => void;
  onDelete: (ruleId: string) => void;
}) {
  const cooldownLabel = useMemo(() => {
    const ms = rule.cooldownMs;
    if (ms < 60_000) return `${Math.round(ms / 1000)}s`;
    if (ms < 3_600_000) return `${Math.round(ms / 60_000)}m`;
    return `${Math.round(ms / 3_600_000)}h`;
  }, [rule.cooldownMs]);

  return (
    <div className="border border-border/30 rounded-lg p-3 hover:bg-muted/20 transition-colors">
      <div className="flex items-center gap-2">
        {/* Toggle */}
        <button
          className="shrink-0"
          onClick={() => onToggle(rule.ruleId, !rule.enabled)}
          title={rule.enabled ? "Disable rule" : "Enable rule"}
        >
          {rule.enabled ? (
            <Bell className="size-3.5 text-primary" />
          ) : (
            <BellOff className="size-3.5 text-muted-foreground/40" />
          )}
        </button>

        {/* Name + scope */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span
              className={`text-[10px] font-mono font-semibold truncate ${
                rule.enabled ? "text-foreground" : "text-muted-foreground/60"
              }`}
            >
              {rule.name}
            </span>
            <span className="text-[9px] font-mono text-muted-foreground px-1 py-0.5 rounded bg-muted/30 shrink-0">
              {rule.scope}
            </span>
          </div>
        </div>

        {/* Severity badge */}
        <span
          className={`text-[9px] font-mono px-1.5 py-0.5 rounded shrink-0 ${
            SEVERITY_BG[rule.severity as RuleSeverity] ?? "bg-muted/30"
          } ${SEVERITY_COLORS[rule.severity as RuleSeverity] ?? "text-muted-foreground"}`}
        >
          {rule.severity}
        </span>

        {/* Cooldown */}
        <span className="text-[9px] font-mono text-muted-foreground shrink-0">
          cd:{cooldownLabel}
        </span>

        {/* Delete */}
        <button
          className="shrink-0 text-muted-foreground/40 hover:text-red-400 transition-colors"
          onClick={() => onDelete(rule.ruleId)}
          title="Delete rule"
        >
          <Trash2 className="size-3" />
        </button>
      </div>

      {/* Condition + target */}
      <div className="mt-1 flex items-center gap-2 pl-5">
        <span className="text-[9px] font-mono text-muted-foreground">
          {CONDITION_LABELS[rule.condition as RuleCondition] ?? rule.condition}
        </span>
        {rule.instrument && (
          <span className="text-[9px] font-mono text-primary/70">
            {rule.instrument}
          </span>
        )}
        {rule.positionId && (
          <span className="text-[9px] font-mono text-primary/70">
            pos:{rule.positionId}
          </span>
        )}
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════
// MAIN PANEL
// ═══════════════════════════════════════════════════════════════

export function CustomAlertRulesPanel() {
  const { t } = useI18n();
  const [showForm, setShowForm] = useState(false);
  const [showAlerts, setShowAlerts] = useState(false);

  // Convex reactive queries
  const rules = useQuery(api.alertRules.listRules);
  const recentAlerts = useQuery(
    api.alertRules.getRecentAlerts,
    showAlerts ? { limit: 20 } : "skip",
  );

  // Convex mutations
  const createRule = useMutation(api.alertRules.createRule);
  const updateRule = useMutation(api.alertRules.updateRule);
  const deleteRule = useMutation(api.alertRules.deleteRule);

  const ruleCount = rules?.length ?? 0;
  const atLimit = ruleCount >= MAX_RULES_PER_USER;

  const handleCreate = useCallback(
    async (opts: {
      name: string;
      scope: RuleScope;
      condition: RuleCondition;
      severity: RuleSeverity;
      cooldownMs: number;
      instrument?: string;
      positionId?: string;
    }) => {
      try {
        const ruleId = `rule-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        await createRule({
          ruleId,
          name: opts.name,
          enabled: true,
          scope: opts.scope,
          instrument: opts.instrument,
          positionId: opts.positionId,
          condition: opts.condition,
          severity: opts.severity,
          cooldownMs: opts.cooldownMs,
        });
        toast.success(`Rule "${opts.name}" created`);
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to create rule");
      }
    },
    [createRule],
  );

  const handleToggle = useCallback(
    async (ruleId: string, enabled: boolean) => {
      try {
        await updateRule({ ruleId, enabled });
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to update rule");
      }
    },
    [updateRule],
  );

  const handleDelete = useCallback(
    async (ruleId: string) => {
      try {
        await deleteRule({ ruleId });
        toast.success("Rule deleted");
      } catch (err: any) {
        toast.error(err?.message ?? "Failed to delete rule");
      }
    },
    [deleteRule],
  );

  return (
    <div className="space-y-3">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Bell className="size-3.5 text-primary" />
          <span className="text-[10px] font-mono font-semibold text-foreground">
            Alert Rules
          </span>
          <span className="text-[9px] font-mono text-muted-foreground">
            {ruleCount}/{MAX_RULES_PER_USER}
          </span>
        </div>
        <div className="flex items-center gap-1">
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-[9px] font-mono gap-1"
            onClick={() => setShowAlerts(!showAlerts)}
          >
            {showAlerts ? (
              <ChevronUp className="size-3" />
            ) : (
              <ChevronDown className="size-3" />
            )}
            History
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-6 text-[9px] font-mono gap-1"
            disabled={atLimit}
            onClick={() => setShowForm(!showForm)}
          >
            <Plus className="size-3" />
            {showForm ? "Cancel" : "New Rule"}
          </Button>
        </div>
      </div>

      {/* New Rule Form */}
      <AnimatePresence>
        {showForm && (
          <NewRuleForm onClose={() => setShowForm(false)} onCreate={handleCreate} />
        )}
      </AnimatePresence>

      {/* Rules List */}
      {rules === undefined ? (
        <div className="flex items-center gap-2 py-4 justify-center">
          <RefreshCw className="size-3 animate-spin text-muted-foreground" />
          <span className="text-[10px] font-mono text-muted-foreground">
            Loading rules...
          </span>
        </div>
      ) : rules.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 text-center">
          <Bell className="size-5 text-muted-foreground/30 mb-2" />
          <p className="text-[10px] font-mono text-muted-foreground max-w-xs">
            {t.alerts.noRules} {t.alerts.noRulesHint}
          </p>
        </div>
      ) : (
        <div className="space-y-1">
          {rules.map((rule) => (
            <RuleRow
              key={rule.ruleId}
              rule={rule}
              onToggle={handleToggle}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* Alert History (collapsible) */}
      <AnimatePresence>
        {showAlerts && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="border border-border/30 rounded-lg p-3">
              <div className="flex items-center gap-2 mb-2">
                <span className="text-[10px] font-mono font-semibold text-foreground">
                  Recent Alerts
                </span>
                <span className="text-[9px] font-mono text-muted-foreground">
                  {recentAlerts?.length ?? 0}
                </span>
              </div>

              {recentAlerts === undefined ? (
                <div className="flex items-center gap-2 py-2 justify-center">
                  <RefreshCw className="size-3 animate-spin text-muted-foreground" />
                  <span className="text-[9px] font-mono text-muted-foreground">
                    Loading...
                  </span>
                </div>
              ) : recentAlerts.length === 0 ? (
                <p className="text-[9px] font-mono text-muted-foreground text-center py-2">
                  No alerts triggered yet.
                </p>
              ) : (
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {recentAlerts.map((alert) => (
                    <div
                      key={alert.alertId}
                      className="flex items-start gap-2 p-2 rounded border border-border/20 bg-muted/10"
                    >
                      <span
                        className={`text-[9px] font-mono px-1 py-0.5 rounded shrink-0 ${
                          SEVERITY_BG[alert.severity as RuleSeverity] ?? "bg-muted/30"
                        } ${SEVERITY_COLORS[alert.severity as RuleSeverity] ?? "text-muted-foreground"}`}
                      >
                        {alert.severity}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[9px] font-mono text-foreground truncate">
                          {alert.ruleName}
                        </p>
                        <p className="text-[9px] font-mono text-muted-foreground">
                          {alert.description}
                        </p>
                      </div>
                      <span className="text-[8px] font-mono text-muted-foreground/50 shrink-0">
                        {new Date(alert.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
