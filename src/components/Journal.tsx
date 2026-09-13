/**
 * Phase 32 — JOURNAL UI.
 *
 * Professional trading/investment journal interface.
 * Pure presentation — zero decision logic.
 *
 * Reads journal state through Convex queries/mutations.
 * Never calculates bias, conviction, gates, or scenarios.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import type { AnalysisResult } from "@/types/analysis";
import {
  createAnalysisSnapshot,
  journalFromAnalysis,
  createObservationEntry,
  transitionEntry,
  updateReview,
  updateTradeInfo,
  isValidTransition,
  isTerminal,
  getValidTransitions,
  computePnl,
  classifyOutcome,
} from "@/lib/journal";
import type { JournalEntry, TradeStatus } from "@/types/journal";
import { useI18n } from "@/lib/i18n";

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
}

// ── Main Component ───────────────────────────────────────────────

export function Journal({ currentResult, onJournalCreated, onBack }: JournalProps) {
  const { t } = useI18n();
  const [view, setView] = useState<"list" | "detail" | "create">("list");
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [filterInstrument, setFilterInstrument] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [editMode, setEditMode] = useState(false);

  // ── Create from analysis ──
  const handleCreateFromAnalysis = (result: AnalysisResult) => {
    const entry = journalFromAnalysis(result);
    setEntries((prev) => [entry, ...prev]);
    setSelectedEntry(entry);
    setView("detail");
    onJournalCreated?.(entry);
  };

  const handleCreateObservation = (result: AnalysisResult) => {
    const entry = createObservationEntry(result, "Observation — no trade taken");
    setEntries((prev) => [entry, ...prev]);
    setSelectedEntry(entry);
    setView("detail");
    onJournalCreated?.(entry);
  };

  // ── Lifecycle ──
  const handleTransition = (entry: JournalEntry, newStatus: TradeStatus) => {
    try {
      const updated = transitionEntry(entry, newStatus);
      updateEntryInList(updated);
      setSelectedEntry(updated);
    } catch (e) {
      console.error("Invalid transition:", e);
    }
  };

  const handleClose = (entry: JournalEntry, exitPrice?: number, pnl?: number) => {
    const outcome = classifyOutcome(pnl);
    const updated = transitionEntry(entry, "CLOSED", { exitPrice, pnl, outcome });
    updateEntryInList(updated);
    setSelectedEntry(updated);
  };

  // ── Updates ──
  const updateEntryInList = (updated: JournalEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const handleUpdateNotes = (entry: JournalEntry, notes: string) => {
    const updated = updateReview(entry, { notes });
    updateEntryInList(updated);
    setSelectedEntry(updated);
  };

  const handleUpdateReview = (entry: JournalEntry, field: string, value: string) => {
    const updated = updateReview(entry, { [field]: value });
    updateEntryInList(updated);
    setSelectedEntry(updated);
  };

  const handleUpdateTrade = (entry: JournalEntry, field: string, value: number | undefined) => {
    const updated = updateTradeInfo(entry, { [field]: value });
    updateEntryInList(updated);
    setSelectedEntry(updated);
  };

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
              ← Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs text-muted-foreground">
            {t.journal.snapshotDescription}
          </p>
          <div className="text-xs font-mono space-y-1 p-3 rounded border border-border/30 bg-muted/30">
            <div><span className="text-muted-foreground">instrument:</span> {currentResult.instrument}</div>
            <div><span className="text-muted-foreground">decision:</span> {currentResult.recommendation}</div>
            <div><span className="text-muted-foreground">bias:</span> {currentResult.bias}</div>
            <div><span className="text-muted-foreground">confidence:</span> {currentResult.confidence}</div>
          </div>
          <div className="flex gap-2">
            <Button
              size="sm"
              className="text-xs"
              onClick={() => handleCreateFromAnalysis(currentResult)}
            >
              {t.journal.journalAsTrade}
            </Button>
            {currentResult.recommendation === "NO_TRADE" && (
              <Button
                size="sm"
                variant="outline"
                className="text-xs"
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
              {entry.instrument} — Journal
            </h3>
            <Badge variant="outline" className={cn("text-[10px] font-mono", STATUS_COLORS[entry.status])}>
              {entry.status}
            </Badge>
            {entry.outcome && (
              <Badge variant="outline" className={cn("text-[10px] font-mono", OUTCOME_COLORS[entry.outcome])}>
                {entry.outcome}
              </Badge>
            )}
            <Button variant="ghost" size="sm" onClick={() => setView("list")} className="text-xs ml-auto">
              ← Back
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4 text-xs font-mono">

          {/* ── ENGINE SNAPSHOT (read-only) ── */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ {t.journal.engineAnalysisSnapshot}</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 p-3 rounded border border-border/30 bg-muted/30">
              <div><span className="text-muted-foreground">instrument:</span> {snap.analysisId ? entry.instrument : "—"}</div>
              <div><span className="text-muted-foreground">decision:</span> {snap.decision}</div>
              <div><span className="text-muted-foreground">bias:</span> {snap.bias}</div>
              <div><span className="text-muted-foreground">confidence:</span> {snap.confidence}</div>
              {snap.conviction && <div><span className="text-muted-foreground">conviction:</span> {snap.conviction}</div>}
              {snap.scenario && <div><span className="text-muted-foreground">scenario:</span> {snap.scenario}</div>}
              {snap.marketRegime && <div><span className="text-muted-foreground">regime:</span> {snap.marketRegime}</div>}
              {snap.marketPhase && <div><span className="text-muted-foreground">phase:</span> {snap.marketPhase}</div>}
              {snap.continuationQuality && <div><span className="text-muted-foreground">continuation:</span> {snap.continuationQuality}</div>}
              {snap.fundamentalAlignment && <div><span className="text-muted-foreground">fundamental:</span> {snap.fundamentalAlignment}</div>}
              {snap.actionability && <div><span className="text-muted-foreground">actionability:</span> {snap.actionability}</div>}
              {snap.forwardPrimaryPath && <div><span className="text-muted-foreground">forward:</span> {snap.forwardPrimaryPath}</div>}
              {snap.dataCompleteness && <div><span className="text-muted-foreground">data:</span> {snap.dataCompleteness}</div>}
              {snap.decisionFingerprint && <div className="col-span-2 sm:col-span-3"><span className="text-muted-foreground">fingerprint:</span> {snap.decisionFingerprint}</div>}
            </div>
            {snap.keyLevels && (
              <div className="mt-2 flex flex-wrap gap-2">
                <Badge variant="outline" className="text-[9px] font-mono border-border/50">support: {snap.keyLevels.support}</Badge>
                <Badge variant="outline" className="text-[9px] font-mono border-border/50">resistance: {snap.keyLevels.resistance}</Badge>
                <Badge variant="outline" className="text-[9px] font-mono border-border/50">invalidation: {snap.keyLevels.invalidation}</Badge>
              </div>
            )}
          </div>

          <Separator />

          {/* ── TRADE INFORMATION ── */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ TRADE</h4>
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              <div>
                <span className="text-muted-foreground">entry:</span>{" "}
                {editMode ? (
                  <Input type="number" defaultValue={entry.entry ?? ""} className="h-6 text-[10px] font-mono w-24 inline-block"
                    onBlur={(e) => handleUpdateTrade(entry, "entry", parseFloat(e.target.value) || undefined)} />
                ) : (
                  <span>{entry.entry ?? "—"}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">stop:</span>{" "}
                {editMode ? (
                  <Input type="number" defaultValue={entry.stopLoss ?? ""} className="h-6 text-[10px] font-mono w-24 inline-block"
                    onBlur={(e) => handleUpdateTrade(entry, "stopLoss", parseFloat(e.target.value) || undefined)} />
                ) : (
                  <span>{entry.stopLoss ?? "—"}</span>
                )}
              </div>
              <div>
                <span className="text-muted-foreground">target:</span>{" "}
                {editMode ? (
                  <Input type="number" defaultValue={entry.takeProfit ?? ""} className="h-6 text-[10px] font-mono w-24 inline-block"
                    onBlur={(e) => handleUpdateTrade(entry, "takeProfit", parseFloat(e.target.value) || undefined)} />
                ) : (
                  <span>{entry.takeProfit ?? "—"}</span>
                )}
              </div>
              <div><span className="text-muted-foreground">R:R:</span> {entry.riskReward ?? "—"}</div>
              <div><span className="text-muted-foreground">size:</span> {entry.positionSize ?? "—"}</div>
              {entry.exitPrice !== undefined && <div><span className="text-muted-foreground">exit:</span> {entry.exitPrice}</div>}
              {entry.pnl !== undefined && <div><span className="text-muted-foreground">P/L:</span> <span className={entry.pnl >= 0 ? "text-emerald-400" : "text-red-400"}>{entry.pnl}</span></div>}
              {entry.pnlPercent !== undefined && <div><span className="text-muted-foreground">P/L%:</span> <span className={entry.pnlPercent >= 0 ? "text-emerald-400" : "text-red-400"}>{entry.pnlPercent.toFixed(2)}%</span></div>}
            </div>
          </div>

          <Separator />

          {/* ── LIFECYCLE ACTIONS ── */}
          {validNext.length > 0 && (
            <div>
              <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ ACTIONS</h4>
              <div className="flex flex-wrap gap-2">
                {validNext.map((status) => (
                  <Button
                    key={status}
                    size="sm"
                    variant={status === "OPEN" ? "default" : "outline"}
                    className="text-[10px] font-mono"
                    onClick={() => handleTransition(entry, status)}
                  >
                    → {status}
                  </Button>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  className="text-[10px] font-mono"
                  onClick={() => setEditMode(!editMode)}
                >
                  {editMode ? "Done" : "Edit"}
                </Button>
              </div>
            </div>
          )}

          <Separator />

          {/* ── USER REVIEW ── */}
          <div>
            <h4 className="text-[10px] font-semibold text-muted-foreground mb-2">$ REVIEW</h4>
            <div className="space-y-2">
              {([
                ["entryReason", "Entry Reason"],
                ["thesisAtEntry", "Thesis at Entry"],
                ["confirmationObserved", "Confirmation Observed"],
                ["invalidationObserved", "Invalidation Observed"],
                ["whatWentRight", "What Went Right"],
                ["whatWentWrong", "What Went Wrong"],
                ["lessons", "Lessons"],
                ["notes", "Notes"],
              ] as [string, string][]).map(([field, label]) => (
                <div key={field}>
                  <span className="text-muted-foreground">{label}:</span>
                  {editMode ? (
                    <Textarea
                      defaultValue={(entry as any)[field] ?? ""}
                      className="text-[10px] font-mono mt-1 min-h-[40px]"
                      onBlur={(e) => handleUpdateReview(entry, field, e.target.value)}
                    />
                  ) : (
                    <span className="block text-muted-foreground/80 mt-1">{(entry as any)[field] ?? "—"}</span>
                  )}
                </div>
              ))}
            </div>
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
              ← Dashboard
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick Stats */}
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          <Badge variant="outline" className="border-border/50">total: {entries.length}</Badge>
          <Badge variant="outline" className="border-border/50">open: {entries.filter((e) => e.status === "OPEN").length}</Badge>
          <Badge variant="outline" className="border-border/50">closed: {entries.filter((e) => e.status === "CLOSED").length}</Badge>
          <Badge variant="outline" className="border-border/50">planned: {entries.filter((e) => e.status === "PLANNED").length}</Badge>
        </div>

        {/* Filters */}
        <div className="flex gap-2">
          <Input
            placeholder={t.journal.filterInstrument}
            value={filterInstrument}
            onChange={(e) => setFilterInstrument(e.target.value)}
            className="h-7 text-[10px] font-mono w-32"
          />
          <select
            value={filterStatus}
            onChange={(e) => setFilterStatus(e.target.value)}
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
        {filteredEntries.length === 0 ? (
          <p className="text-xs text-muted-foreground text-center py-4">
            {entries.length === 0 ? "No journal entries yet." : "No entries match filters."}
          </p>
        ) : (
          <div className="space-y-1">
            {filteredEntries.map((entry) => (
              <div
                key={entry.id}
                className="flex items-center gap-2 p-2 rounded border border-border/30 hover:bg-muted/50 cursor-pointer text-[10px] font-mono"
                onClick={() => { setSelectedEntry(entry); setView("detail"); }}
              >
                <span className="text-muted-foreground w-20 shrink-0">
                  {new Date(entry.createdAt).toLocaleDateString()}
                </span>
                <span className="w-16 shrink-0 font-semibold">{entry.instrument}</span>
                <Badge variant="outline" className={cn("text-[9px] font-mono", STATUS_COLORS[entry.status])}>
                  {entry.status}
                </Badge>
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
