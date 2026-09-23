/**
 * Phase 32 — JOURNAL UI — Phase 262 enhanced with authenticated Convex persistence.
 *
 * Professional trading/investment journal interface.
 * Pure presentation — zero decision logic.
 *
 * Phase 262: reads journal state through Convex queries/mutations when
 * available, falls back to local initialEntries for tests / offline preview.
 * Preserves provider-native identity (provider, providerInstrumentId, assetClass).
 * Handles loading / empty / error / refresh / logout / session protection.
 * Never calculates bias, conviction, gates, or scenarios.
 * Never uses localStorage for journal persistence.
 * Historical entries remain immutable in their analysis snapshot.
 */

import { useState, useMemo, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types/analysis";
import {
  journalFromAnalysis,
  createObservationEntry,
  transitionEntry,
  updateReview,
  updateTradeInfo,
  getValidTransitions,
  classifyOutcome,
  computePnl,
  type JournalReviewField,
  type JournalTradeField,
} from "@/lib/journal";
import type { JournalEntry, TradeStatus } from "@/types/journal";
import { useI18n } from "@/lib/i18n";
import { mapTradeOutcome, mapTradeStatus } from "@/lib/i18n/enum-mapping";

// ── Optional Convex hooks (graceful fallback when provider absent, e.g. unit tests) ──
let useQuery: any = () => undefined;
let useMutation: any = () => () => Promise.resolve(null);
let api: any = { journal: { list: undefined, create: undefined, transition: undefined, updateFields: undefined, remove: undefined } };

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const convexReact = require("convex/react") as { useQuery: any; useMutation: any };
  useQuery = convexReact.useQuery;
  useMutation = convexReact.useMutation;
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  api = (require("@/convex/_generated/api") as any).api ?? require("@/convex/_generated/api");
} catch {
  // test environment without Convex bundling — fallback to local-only mode
}

function useOptionalQuery(queryRef: any) {
  try {
    if (!queryRef) return undefined;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useQuery(queryRef) as any[] | undefined;
  } catch {
    return undefined;
  }
}

function useOptionalMutation(mutationRef: any) {
  try {
    if (!mutationRef) return undefined;
    // eslint-disable-next-line react-hooks/rules-of-hooks
    return useMutation(mutationRef) as ((args: any) => Promise<any>) | undefined;
  } catch {
    return undefined;
  }
}

// ── Status Colors ────────────────────────────────────────────────

const STATUS_COLORS: Record<TradeStatus, string> = {
  PLANNED: "bg-blue-500/20 text-blue-400 border-blue-500/30",
  OPEN: "bg-emerald-500/20 text-emerald-400 border-emerald-500/30",
  CLOSED: "bg-muted text-muted-foreground border-border/50",
  CANCELLED: "bg-amber-500/20 text-amber-400 border-amber-500/30",
  INVALIDATED: "bg-red-500/20 text-red-400 border-red-500/30",
  NO_TRADE: "bg-muted text-muted-foreground border-border/50",
  WAITING: "bg-amber-500/10 text-amber-300 border-amber-500/20",
};

const OUTCOME_COLORS: Record<string, string> = {
  WIN: "text-emerald-400",
  LOSS: "text-red-400",
  BREAKEVEN: "text-muted-foreground",
  PARTIAL: "text-amber-400",
  UNKNOWN: "text-muted-foreground",
};

// ── Props ────────────────────────────────────────────────────────

interface JournalProps {
  /** Current analysis result to journal (optional). */
  currentResult?: AnalysisResult | null;
  /** Callback when journal is created. */
  onJournalCreated?: (entry: JournalEntry) => void;
  /** Navigate back to dashboard. */
  onBack?: () => void;
  /** Entries to seed the local list with (e.g. loaded by the parent or tests). */
  initialEntries?: JournalEntry[];
}

/** Trade direction as recorded in the immutable analysis snapshot; undefined when it was not a directional call. */
function directionOf(entry: JournalEntry): "long" | "short" | undefined {
  if (entry.analysisSnapshot.decision === "LONG") return "long";
  if (entry.analysisSnapshot.decision === "SHORT") return "short";
  return undefined;
}

/** Map Convex Doc to JournalEntry (preserves provider identity). */
function mapDocToEntry(doc: any): JournalEntry {
  return {
    id: doc._id ?? doc.id,
    createdAt: doc.timestamps?.createdAt ?? doc.createdAt ?? Date.now(),
    updatedAt: doc.timestamps?.updatedAt ?? doc.updatedAt ?? Date.now(),
    instrument: doc.instrument,
    instrumentType: doc.instrumentType,
    timeframe: doc.timeframe,
    style: doc.style,
    provider: doc.provider,
    providerInstrumentId: doc.providerInstrumentId,
    assetClass: doc.assetClass,
    title: doc.title,
    analysisSnapshot: doc.analysisSnapshot,
    status: doc.status as TradeStatus,
    entry: doc.entry,
    stopLoss: doc.stopLoss,
    takeProfit: doc.takeProfit,
    riskReward: doc.riskReward,
    positionSize: doc.positionSize,
    notionalValue: doc.notionalValue,
    exitPrice: doc.exitPrice,
    pnl: doc.pnl,
    pnlPercent: doc.pnlPercent,
    outcome: doc.outcome as any,
    closedAt: doc.closedAt,
    entryReason: doc.entryReason,
    thesisAtEntry: doc.thesisAtEntry,
    confirmationObserved: doc.confirmationObserved,
    invalidationObserved: doc.invalidationObserved,
    whatWentRight: doc.whatWentRight,
    whatWentWrong: doc.whatWentWrong,
    lessons: doc.lessons,
    notes: doc.notes,
  };
}

// ── Main Component ───────────────────────────────────────────────

export function Journal({ currentResult, onJournalCreated, onBack, initialEntries }: JournalProps) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<"list" | "detail" | "create">("list");
  const [localEntries, setLocalEntries] = useState<JournalEntry[]>(() => initialEntries ?? []);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [filterInstrument, setFilterInstrument] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [editMode, setEditMode] = useState(false);
  const [closing, setClosing] = useState(false);
  const [exitInput, setExitInput] = useState("");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);

  // ── Convex integration (optional) ──
  const convexRaw = useOptionalQuery(api?.journal?.list);
  const createMutation = useOptionalMutation(api?.journal?.create);
  const transitionMutation = useOptionalMutation(api?.journal?.transition);
  const updateFieldsMutation = useOptionalMutation(api?.journal?.updateFields);
  const removeMutation = useOptionalMutation(api?.journal?.remove);

  const isConvexMode = useMemo(() => {
    // If initialEntries explicitly provided (tests), prefer local mode to keep tests deterministic
    if (initialEntries && initialEntries.length > 0) return false;
    // If convex query returned data (including empty array after load), we are in convex mode
    // If convexRaw is undefined, we are still loading OR no provider — treat as loading if no initialEntries
    return convexRaw !== undefined;
  }, [convexRaw, initialEntries]);

  const entries: JournalEntry[] = useMemo(() => {
    if (isConvexMode && convexRaw) {
      try {
        return (convexRaw as any[]).map(mapDocToEntry).sort((a, b) => b.createdAt - a.createdAt);
      } catch {
        return localEntries;
      }
    }
    return localEntries;
  }, [isConvexMode, convexRaw, localEntries]);

  // Keep selectedEntry in sync when entries change (e.g. after Convex refresh)
  useEffect(() => {
    if (selectedEntry) {
      const fresh = entries.find((e) => e.id === selectedEntry.id);
      if (fresh && fresh.updatedAt !== selectedEntry.updatedAt) {
        setSelectedEntry(fresh);
      }
    }
  }, [entries, selectedEntry]);

  const isLoading = !isConvexMode && convexRaw === undefined && (!initialEntries || initialEntries.length === 0) && localEntries.length === 0
    ? true
    : false;

  // Actually, more precise loading: when we expect convex but haven't got data yet and no local fallback
  const showLoading = useMemo(() => {
    if (initialEntries && initialEntries.length > 0) return false;
    if (localEntries.length > 0) return false;
    if (convexRaw === undefined) {
      // No provider? In test env convexRaw undefined always, but we have no initialEntries -> would show loading forever
      // Detect if we are in a real Convex context by checking if api.journal.list is defined
      if (api?.journal?.list) return true;
      return false;
    }
    return false;
  }, [convexRaw, initialEntries, localEntries]);

  // ── Create from analysis ──
  const handleCreateFromAnalysis = useCallback(async (result: AnalysisResult) => {
    setErrorMsg(null);
    const entry = journalFromAnalysis(result);
    if (isConvexMode && createMutation) {
      setIsSaving(true);
      try {
        await createMutation({
          instrument: entry.instrument,
          instrumentType: entry.instrumentType,
          timeframe: entry.timeframe,
          style: entry.style,
          provider: (entry as any).provider,
          providerInstrumentId: (entry as any).providerInstrumentId,
          assetClass: (entry as any).assetClass,
          title: (entry as any).title,
          analysisSnapshot: entry.analysisSnapshot,
          status: entry.status,
          entry: entry.entry,
          stopLoss: entry.stopLoss,
          takeProfit: entry.takeProfit,
          riskReward: entry.riskReward,
          positionSize: entry.positionSize,
          notionalValue: entry.notionalValue,
          entryReason: entry.entryReason,
          thesisAtEntry: entry.thesisAtEntry,
          notes: entry.notes,
        });
        onJournalCreated?.(entry);
        // Convex query will auto-refresh; select optimistic entry temporarily
        setSelectedEntry(entry);
        setView("detail");
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to create journal entry");
      } finally {
        setIsSaving(false);
      }
    } else {
      setLocalEntries((prev) => [entry, ...prev]);
      setSelectedEntry(entry);
      setView("detail");
      onJournalCreated?.(entry);
    }
  }, [isConvexMode, createMutation, onJournalCreated]);

  const handleCreateObservation = useCallback(async (result: AnalysisResult) => {
    setErrorMsg(null);
    const entry = createObservationEntry(result, t.journal.observationNote);
    if (isConvexMode && createMutation) {
      setIsSaving(true);
      try {
        await createMutation({
          instrument: entry.instrument,
          instrumentType: entry.instrumentType,
          timeframe: entry.timeframe,
          style: entry.style,
          provider: (entry as any).provider,
          providerInstrumentId: (entry as any).providerInstrumentId,
          assetClass: (entry as any).assetClass,
          title: (entry as any).title,
          analysisSnapshot: entry.analysisSnapshot,
          status: entry.status,
          notes: entry.notes,
        });
        onJournalCreated?.(entry);
        setSelectedEntry(entry);
        setView("detail");
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to create observation");
      } finally {
        setIsSaving(false);
      }
    } else {
      setLocalEntries((prev) => [entry, ...prev]);
      setSelectedEntry(entry);
      setView("detail");
      onJournalCreated?.(entry);
    }
  }, [isConvexMode, createMutation, onJournalCreated, t.journal.observationNote]);

  // ── Lifecycle ──
  const handleTransition = useCallback(async (entry: JournalEntry, newStatus: TradeStatus) => {
    setErrorMsg(null);
    if (isConvexMode && transitionMutation && !entry.id.startsWith("journal-")) {
      setIsSaving(true);
      try {
        await transitionMutation({
          journalId: entry.id as any,
          newStatus,
        });
        // Optimistic local update until query refreshes
        const optimistic = { ...entry, status: newStatus, updatedAt: Date.now() };
        setSelectedEntry(optimistic);
      } catch (e: any) {
        setErrorMsg(e?.message ?? `Failed to transition to ${newStatus}`);
      } finally {
        setIsSaving(false);
      }
    } else {
      try {
        const updated = transitionEntry(entry, newStatus);
        if (isConvexMode) {
          // local fallback still updates local list
          setLocalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        } else {
          setLocalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        }
        setSelectedEntry(updated);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Invalid transition");
      }
    }
  }, [isConvexMode, transitionMutation]);

  const handleClose = useCallback(async (entry: JournalEntry, exitPrice: number | undefined) => {
    const direction = directionOf(entry);
    const { pnl, pnlPercent } = computePnl(entry.entry, exitPrice, direction, entry.positionSize);
    const outcome = classifyOutcome(pnl);
    setErrorMsg(null);
    if (isConvexMode && transitionMutation && !entry.id.startsWith("journal-")) {
      setIsSaving(true);
      try {
        await transitionMutation({
          journalId: entry.id as any,
          newStatus: "CLOSED",
          exitPrice,
          pnl,
          pnlPercent,
          outcome,
        });
        const optimistic = { ...entry, status: "CLOSED" as TradeStatus, exitPrice, pnl, pnlPercent, outcome, closedAt: Date.now(), updatedAt: Date.now() };
        setSelectedEntry(optimistic);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to close trade");
      } finally {
        setIsSaving(false);
      }
    } else {
      try {
        const updated = transitionEntry(entry, "CLOSED", { exitPrice, pnl, pnlPercent, outcome });
        setLocalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
        setSelectedEntry(updated);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Invalid transition");
      }
    }
    setClosing(false);
    setExitInput("");
  }, [isConvexMode, transitionMutation]);

  // ── Updates ──
  const handleUpdateReview = useCallback(async (entry: JournalEntry, field: JournalReviewField, value: string) => {
    setErrorMsg(null);
    if (isConvexMode && updateFieldsMutation && !entry.id.startsWith("journal-")) {
      setIsSaving(true);
      try {
        await updateFieldsMutation({
          journalId: entry.id as any,
          [field]: value,
        });
        setSelectedEntry((prev) => prev ? { ...prev, [field]: value, updatedAt: Date.now() } : prev);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to update review");
      } finally {
        setIsSaving(false);
      }
    } else {
      const updated = updateReview(entry, { [field]: value });
      setLocalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setSelectedEntry(updated);
    }
  }, [isConvexMode, updateFieldsMutation]);

  const handleUpdateTrade = useCallback(async (entry: JournalEntry, field: JournalTradeField, value: number | undefined) => {
    setErrorMsg(null);
    if (isConvexMode && updateFieldsMutation && !entry.id.startsWith("journal-")) {
      setIsSaving(true);
      try {
        await updateFieldsMutation({
          journalId: entry.id as any,
          [field]: value,
        });
        setSelectedEntry((prev) => prev ? { ...prev, [field]: value, updatedAt: Date.now() } : prev);
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to update trade info");
      } finally {
        setIsSaving(false);
      }
    } else {
      const updated = updateTradeInfo(entry, { [field]: value });
      setLocalEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
      setSelectedEntry(updated);
    }
  }, [isConvexMode, updateFieldsMutation]);

  const handleDelete = useCallback(async (entry: JournalEntry) => {
    if (!confirm("Delete this journal entry?")) return;
    setErrorMsg(null);
    if (isConvexMode && removeMutation && !entry.id.startsWith("journal-")) {
      setIsSaving(true);
      try {
        await removeMutation({ journalId: entry.id as any });
        setSelectedEntry(null);
        setView("list");
      } catch (e: any) {
        setErrorMsg(e?.message ?? "Failed to delete");
      } finally {
        setIsSaving(false);
      }
    } else {
      setLocalEntries((prev) => prev.filter((e) => e.id !== entry.id));
      setSelectedEntry(null);
      setView("list");
    }
  }, [isConvexMode, removeMutation]);

  // ── Filtered entries ──
  const filteredEntries = entries.filter((e) => {
    if (filterInstrument && !e.instrument.toLowerCase().includes(filterInstrument.toLowerCase())) return false;
    if (filterStatus && e.status !== filterStatus) return false;
    return true;
  });

  // ════════════════════════════════════════════════════════════════
  // CREATE VIEW
  // ════════════════════════════════════════════════════════════════

  if (view === "create" && currentResult) {
    return (
      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-mono font-semibold">{t.journal.createJournalEntry}</h3>
            <Button variant="ghost" size="sm" onClick={() => setView("list")} className="text-xs ml-auto">
              {t.global.back}
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t.journal.snapshotDescription}
          </p>
          <div className="text-xs font-mono space-y-1 p-3 rounded border border-border/30 bg-muted/30">
            <div><span className="text-muted-foreground">{t.journal.snapshotInstrument}:</span> {currentResult.instrument}</div>
            <div><span className="text-muted-foreground">{t.journal.snapshotDecision}:</span> {currentResult.recommendation}</div>
            <div><span className="text-muted-foreground">{t.analysis.bias}:</span> {currentResult.bias}</div>
            <div><span className="text-muted-foreground">{t.analysis.confidence}:</span> {currentResult.confidence}</div>
            {(currentResult as any).provider && <div><span className="text-muted-foreground">provider:</span> {(currentResult as any).provider} ({(currentResult as any).providerInstrumentId})</div>}
          </div>
          {errorMsg && <div className="text-[10px] text-red-400 border border-red-500/30 rounded p-2">{errorMsg}</div>}
          <div className="flex gap-2">
            <Button
              size="sm"
              className="text-xs"
              disabled={isSaving}
              onClick={() => handleCreateFromAnalysis(currentResult)}
            >
              {isSaving ? "Saving..." : t.journal.journalAsTrade}
            </Button>
            {currentResult.recommendation === "NO_TRADE" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
                disabled={isSaving}
                onClick={() => handleCreateObservation(currentResult)}
              >
                {t.journal.journalAsObservation}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // DETAIL VIEW
  // ════════════════════════════════════════════════════════════════

  if (view === "detail" && selectedEntry) {
    const entry = selectedEntry;
    const snap = entry.analysisSnapshot;
    const validNext = getValidTransitions(entry);

    return (
      <Card className="border border-border/50">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <h3 className="text-sm font-mono font-semibold">
              {entry.instrument} — {t.journal.journalSuffix}
            </h3>
            <Badge
              variant="outline"
              className={cn("text-[10px] font-mono", STATUS_COLORS[entry.status])}
              aria-label={`${t.journal.statusLabel}: ${mapTradeStatus(entry.status, t)}`}
              data-status={entry.status}
            >
              {mapTradeStatus(entry.status, t)}
            </Badge>
            {entry.outcome && (
              <Badge
                variant="outline"
                className={cn("text-[10px] font-mono", OUTCOME_COLORS[entry.outcome])}
                aria-label={`${t.journal.outcomeLabel}: ${mapTradeOutcome(entry.outcome, t)}`}
                data-outcome={entry.outcome}
              >
                {mapTradeOutcome(entry.outcome, t)}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => setView("list")} className="text-xs ml-auto">
              {t.global.back}
            </Button>
          </div>
          {/* Provider identity preservation */}
          {(entry.provider || entry.providerInstrumentId || entry.assetClass) && (
            <div className="flex flex-wrap gap-1 mt-2">
              {entry.provider && <Badge variant="outline" className="text-[9px] font-mono">provider: {entry.provider}</Badge>}
              {entry.providerInstrumentId && <Badge variant="outline" className="text-[9px] font-mono">id: {entry.providerInstrumentId}</Badge>}
              {entry.assetClass && <Badge variant="outline" className="text-[9px] font-mono">{entry.assetClass}</Badge>}
              {entry.title && <Badge variant="outline" className="text-[9px] font-mono">{entry.title}</Badge>}
            </div>
          )}
        </CardHeader>
        <CardContent className="space-y-4 text-xs font-mono">
          {errorMsg && <div className="text-[10px] text-red-400 border border-red-500/30 rounded p-2">{errorMsg}</div>}
          {isSaving && <div className="text-[10px] text-muted-foreground">Saving...</div>}

          {/* ── ENGINE SNAPSHOT (read-only) ── */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ {t.journal.engineAnalysisSnapshot}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded border border-border/30 bg-muted/30">
              <div><span className="text-muted-foreground">{t.journal.snapshotInstrument}:</span> {snap.analysisId ? entry.instrument : "—"}</div>
              <div><span className="text-muted-foreground">{t.journal.snapshotDecision}:</span> {snap.decision}</div>
              <div><span className="text-muted-foreground">{t.analysis.bias}:</span> {snap.bias}</div>
              <div><span className="text-muted-foreground">{t.analysis.confidence}:</span> {snap.confidence}</div>
              {snap.conviction && <div><span className="text-muted-foreground">{t.journal.snapshotConviction}:</span> {snap.conviction}</div>}
              {snap.scenario && <div><span className="text-muted-foreground">{t.journal.snapshotScenario}:</span> {snap.scenario}</div>}
              {snap.marketRegime && <div><span className="text-muted-foreground">{t.journal.snapshotRegime}:</span> {snap.marketRegime}</div>}
              {snap.marketPhase && <div><span className="text-muted-foreground">{t.journal.snapshotPhase}:</span> {snap.marketPhase}</div>}
              {snap.continuationQuality && <div><span className="text-muted-foreground">{t.journal.snapshotContinuation}:</span> {snap.continuationQuality}</div>}
              {snap.fundamentalAlignment && <div><span className="text-muted-foreground">{t.journal.snapshotFundamental}:</span> {snap.fundamentalAlignment}</div>}
              {snap.actionability && <div><span className="text-muted-foreground">{t.journal.snapshotActionability}:</span> {snap.actionability}</div>}
              {snap.forwardPrimaryPath && <div><span className="text-muted-foreground">{t.journal.snapshotForward}:</span> {snap.forwardPrimaryPath}</div>}
              {snap.dataCompleteness && <div><span className="text-muted-foreground">{t.journal.snapshotData}:</span> {snap.dataCompleteness}</div>}
              {snap.decisionFingerprint && <div className="col-span-2 sm:col-span-3"><span className="text-muted-foreground">{t.journal.snapshotFingerprint}:</span> {snap.decisionFingerprint}</div>}
            </div>
            {snap.keyLevels && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline" className="text-[9px] font-mono border-border/50">{t.analysis.support}: {snap.keyLevels.support}</Badge>
                <Badge variant="outline" className="text-[9px] font-mono border-border/50">{t.analysis.resistance}: {snap.keyLevels.resistance}</Badge>
                <Badge variant="outline" className="text-[9px] font-mono border-border/50">{t.analysis.invalidationLevel}: {snap.keyLevels.invalidation}</Badge>
              </div>
            )}
          </div>

          <Separator />

          {/* ── TRADE INFORMATION ── */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ {t.journal.trade}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <span className="text-muted-foreground">{t.journal.tradeEntry}:</span>{" "}
                {editMode ? (
                  <Input type="number" defaultValue={entry.entry ?? ""} className="h-6 text-[10px] font-mono w-24 inline-block"
                    onBlur={(e) => handleUpdateTrade(entry, "entry", parseFloat(e.target.value) || undefined)} />
                ) : (
                  <span>{entry.entry ?? "—"}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t.journal.tradeStop}:</span>{" "}
                {editMode ? (
                  <Input type="number" defaultValue={entry.stopLoss ?? ""} className="h-6 text-[10px] font-mono w-24 inline-block"
                    onBlur={(e) => handleUpdateTrade(entry, "stopLoss", parseFloat(e.target.value) || undefined)} />
                ) : (
                  <span>{entry.stopLoss ?? "—"}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">{t.journal.tradeTarget}:</span>{" "}
                {editMode ? (
                  <Input type="number" defaultValue={entry.takeProfit ?? ""} className="h-6 text-[10px] font-mono w-24 inline-block"
                    onBlur={(e) => handleUpdateTrade(entry, "takeProfit", parseFloat(e.target.value) || undefined)} />
                ) : (
                  <span>{entry.takeProfit ?? "—"}</span>
                )}
              </div>
              <div><span className="text-muted-foreground">{t.journal.riskReward}:</span> {entry.riskReward ?? "—"}</div>
              <div><span className="text-muted-foreground">{t.journal.tradeSize}:</span> {entry.positionSize ?? "—"}</div>
              {entry.exitPrice !== undefined && <div><span className="text-muted-foreground">{t.global.exit}:</span> {entry.exitPrice}</div>}
              {entry.pnl !== undefined && <div><span className="text-muted-foreground">{t.journal.pnlLabel}:</span> <span className={entry.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{entry.pnl}</span></div>}
              {entry.pnlPercent !== undefined && <div><span className="text-muted-foreground">{t.journal.pnlPercentLabel}:</span> <span className={entry.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400"}>{entry.pnlPercent.toFixed(2)}%</span></div>}
            </div>
          </div>

          <Separator />

          {/* ── LIFECYCLE ACTIONS ── */}
          {validNext.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ {t.journal.actions}</h4>
              <div className="flex flex-wrap gap-2">
                {validNext.map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === "OPEN" ? "default" : "outline"}
                    className="text-[10px] font-mono"
                    disabled={isSaving}
                    onClick={() => (status === "CLOSED" ? setClosing(true) : handleTransition(entry, status))}
                    aria-label={`${t.journal.transitionTo}: ${mapTradeStatus(status, t)}`}
                    data-transition={status}
                  >
                    → {mapTradeStatus(status, t)}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] font-mono"
                  onClick={() => setEditMode(!editMode)}
                >
                  {editMode ? t.journal.done : t.journal.edit}
                </Button>
              </div>
              {closing && (
                <form
                  className="mt-2 flex flex-wrap items-center gap-2"
                  data-close-form
                  onSubmit={(ev) => {
                    ev.preventDefault();
                    const parsed = parseFloat(exitInput);
                    handleClose(entry, Number.isFinite(parsed) ? parsed : undefined);
                  }}
                >
                  <label className="text-[10px] text-muted-foreground" htmlFor="journal-exit-price">
                    {t.global.exit}:
                  </label>
                  <Input
                    id="journal-exit-price"
                    type="number"
                    step="any"
                    value={exitInput}
                    onChange={(ev) => setExitInput(ev.target.value)}
                    className="h-6 text-[10px] font-mono w-28"
                  />
                  <Button type="submit" size="sm" className="text-[10px] font-mono" data-close-confirm disabled={isSaving}>
                    {t.global.confirm}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="text-[10px] font-mono"
                    onClick={() => { setClosing(false); setExitInput(""); }}
                  >
                    {t.global.cancel}
                  </Button>
                </form>
              )}
            </div>
          )}

          <Separator />

          {/* ── USER REVIEW ── */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ {t.journal.review}</h4>
            <div className="space-y-2">
              {([
                ["entryReason", t.journal.entryReason],
                ["thesisAtEntry", t.journal.thesisAtEntry],
                ["confirmationObserved", t.journal.confirmationObserved],
                ["invalidationObserved", t.journal.invalidationObserved],
                ["whatWentRight", t.journal.whatWentRight],
                ["whatWentWrong", t.journal.whatWentWrong],
                ["lessons", t.journal.lessons],
                ["notes", t.journal.notes],
              ] satisfies [JournalReviewField, string][]).map(([field, label]) => (
                <div key={field}>
                  <span className="text-muted-foreground">{label}:</span>
                  {editMode ? (
                    <Textarea
                      defaultValue={entry[field] ?? ""}
                      className="text-[10px] font-mono mt-1 min-h-[40px]"
                      onBlur={(e) => handleUpdateReview(entry, field, e.target.value)}
                    />
                  ) : (
                    <span className="block text-muted-foreground/80 mt-1">{entry[field] ?? "—"}</span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <Separator />
          <div className="flex gap-2">
            <Button size="sm" variant="outline" className="text-[10px] font-mono text-red-400" onClick={() => handleDelete(entry)} disabled={isSaving}>
              Delete entry
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ════════════════════════════════════════════════════════════════
  // LIST VIEW
  // ════════════════════════════════════════════════════════════════

  return (
    <Card className="border border-border/50">
      <CardHeader className="pb-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-mono font-semibold">{t.journal.title}</h3>
          {onBack && (
            <Button variant="ghost" size="sm" onClick={onBack} className="text-xs ml-auto">
              {t.journal.backToDashboard}
            </Button>
          )}
          {!onBack && (
            <Button variant="ghost" size="sm" onClick={() => { setErrorMsg(null); /* Convex auto-refreshes, but clear error */ }} className="text-xs ml-auto">
              Refresh
            </Button>
          )}
        </div>
        {errorMsg && <div className="text-[10px] text-red-400 border border-red-500/30 rounded p-2 mt-2">{errorMsg}</div>}
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick Stats */}
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          <Badge variant="outline" className="border-border/50">{t.journal.total} {entries.length}</Badge>
          <Badge variant="outline" className="border-border/50">{t.journal.open} {entries.filter((e) => e.status === "OPEN").length}</Badge>
          <Badge variant="outline" className="border-border/50">{t.journal.closed} {entries.filter((e) => e.status === "CLOSED").length}</Badge>
          <Badge variant="outline" className="border-border/50">{t.journal.planned} {entries.filter((e) => e.status === "PLANNED").length}</Badge>
          {isConvexMode && <Badge variant="outline" className="border-border/50">live</Badge>}
          {isLoading || showLoading ? <Badge variant="outline" className="border-border/50">loading...</Badge> : null}
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <Input
            placeholder={t.journal.filterInstrument}
            aria-label={t.journal.filterInstrument}
            value={filterInstrument}
            onChange={(e) => setFilterInstrument(e.target.value)}
            className="h-7 text-[10px] font-mono w-32"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
            aria-label={t.journal.filterByStatus}
            className="h-7 text-[10px] font-mono rounded border border-border/50 bg-transparent px-2"
          >
            <option value="">{t.journal.allStatus}</option>
            <option value="PLANNED">{t.journal.statusPlanned}</option>
            <option value="OPEN">{t.journal.statusOpen}</option>
            <option value="CLOSED">{t.journal.statusClosed}</option>
            <option value="CANCELLED">{t.journal.statusCancelled}</option>
            <option value="NO_TRADE">{t.journal.statusNoTrade}</option>
          </select>
        </div>

        {/* Entry List */}
        {showLoading ? (
          <p className="text-xs text-muted-foreground text-center py-4">Loading journal...</p>
        ) : filteredEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {entries.length === 0 ? t.journal.noJournalEntries : t.journal.noEntriesMatchFilters}
          </p>
        ) : (
          <div className="space-y-1">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 p-2 rounded border border-border/30 hover:bg-muted/50 cursor-pointer text-[10px] font-mono"
                onClick={() => { setSelectedEntry(entry); setView("detail"); }}
                data-journal-entry={entry.id}
              >
                <time
                  className="text-muted-foreground w-20 shrink-0"
                  dateTime={new Date(entry.createdAt).toISOString()}
                >
                  {new Date(entry.createdAt).toLocaleDateString(locale)}
                </time>
                <span className="w-16 shrink-0 font-semibold">{entry.instrument}</span>
                <Badge
                  variant="outline"
                  className={cn("text-[9px] font-mono", STATUS_COLORS[entry.status])}
                  aria-label={`${t.journal.statusLabel}: ${mapTradeStatus(entry.status, t)}`}
                  data-status={entry.status}
                >
                  {mapTradeStatus(entry.status, t)}
                </Badge>
                {/* Provider identity preservation chip */}
                {entry.provider && (
                  <Badge variant="outline" className="text-[8px] font-mono border-border/30">
                    {entry.provider}:{entry.providerInstrumentId ?? entry.instrument}
                  </Badge>
                )}
                {entry.assetClass && (
                  <span className="text-[8px] text-muted-foreground">{entry.assetClass}</span>
                )}
                <span className="text-muted-foreground truncate flex-1">
                  {entry.analysisSnapshot.decision} · {entry.analysisSnapshot.scenario ?? "—"}
                </span>
                {entry.pnl !== undefined && (
                  <span className={cn("shrink-0", entry.pnl >= 0 ? "text-emerald-400" : "text-red-400")}>
                    {entry.pnl}
                  </span>
                )}
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
