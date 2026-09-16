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
  /** Entries to seed the local list with (e.g. loaded by the parent). */
  initialEntries?: JournalEntry[];
}

/** Trade direction as recorded in the immutable analysis snapshot; undefined when it was not a directional call. */
function directionOf(entry: JournalEntry): "long" | "short" | undefined {
  if (entry.analysisSnapshot.decision === "LONG") return "long";
  if (entry.analysisSnapshot.decision === "SHORT") return "short";
  return undefined;
}

// ── Main Component ───────────────────────────────────────────────

export function Journal({ currentResult, onJournalCreated, onBack, initialEntries }: JournalProps) {
  const { t, locale } = useI18n();
  const [view, setView] = useState<"list" | "detail" | "create">("list");
  const [entries, setEntries] = useState<JournalEntry[]>(() => initialEntries ?? []);
  const [selectedEntry, setSelectedEntry] = useState<JournalEntry | null>(null);
  const [filterInstrument, setFilterInstrument] = useState("");
  const [filterStatus, setFilterStatus] = useState("");
  const [editMode, setEditMode] = useState(false);
  /** Exit-price prompt shown while the user is closing an OPEN entry. */
  const [closing, setClosing] = useState(false);
  const [exitInput, setExitInput] = useState("");

  // ── Create from analysis ──
  const handleCreateFromAnalysis = (result: AnalysisResult) => {
    const entry = journalFromAnalysis(result);
    setEntries((prev) => [entry, ...prev]);
    setSelectedEntry(entry);
    setView("detail");
    onJournalCreated?.(entry);
  };

  const handleCreateObservation = (result: AnalysisResult) => {
    const entry = createObservationEntry(result, t.journal.observationNote);
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

  /**
   * Close an OPEN entry with an exit price. P/L is derived only when entry
   * price, exit price and a LONG/SHORT direction are all known; otherwise
   * pnl stays undefined and the outcome is UNKNOWN — never a fabricated 0.
   */
  const handleClose = (entry: JournalEntry, exitPrice: number | undefined) => {
    const direction = directionOf(entry);
    const { pnl, pnlPercent } = computePnl(entry.entry, exitPrice, direction, entry.positionSize);
    const outcome = classifyOutcome(pnl);
    try {
      const updated = transitionEntry(entry, "CLOSED", { exitPrice, pnl, pnlPercent, outcome });
      updateEntryInList(updated);
      setSelectedEntry(updated);
    } catch (e) {
      console.error("Invalid transition:", e);
    }
    setClosing(false);
    setExitInput("");
  };

  // ── Updates ──
  const updateEntryInList = (updated: JournalEntry) => {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  };

  const handleUpdateReview = (entry: JournalEntry, field: JournalReviewField, value: string) => {
    const updated = updateReview(entry, { [field]: value });
    updateEntryInList(updated);
    setSelectedEntry(updated);
  };

  const handleUpdateTrade = (entry: JournalEntry, field: JournalTradeField, value: number | undefined) => {
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
        </CardHeader>
        <CardContent className="space-y-4 text-xs font-mono">

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
                  <Button type="submit" size="sm" className="text-[10px] font-mono" data-close-confirm>
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
              {/*
                The field name is the STORED key and must never be localized;
                only the label beside it is translated (§10). Pairing them in
                one array keeps that mapping visible at a glance.
              */}
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
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Quick Stats */}
        <div className="flex flex-wrap gap-2 text-[10px] font-mono">
          <Badge variant="outline" className="border-border/50">{t.journal.total} {entries.length}</Badge>
          <Badge variant="outline" className="border-border/50">{t.journal.open} {entries.filter((e) => e.status === "OPEN").length}</Badge>
          <Badge variant="outline" className="border-border/50">{t.journal.closed} {entries.filter((e) => e.status === "CLOSED").length}</Badge>
          <Badge variant="outline" className="border-border/50">{t.journal.planned} {entries.filter((e) => e.status === "PLANNED").length}</Badge>
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
        {filteredEntries.length === 0 ? (
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
                {/*
                  §5: presentation follows the APP locale (previously it
                  followed the browser, so a user reading Japanese could see
                  US-ordered dates). The instant is unchanged — no timezone
                  conversion is introduced, preserving the existing local-time
                  convention. The machine-readable value stays ISO in dateTime.
                */}
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
