/**
 * Phase 61 — Position Registration Panel
 *
 * UI for registering active trading positions with the profit protection system.
 * Supports LONG/SHORT across all asset classes.
 *
 * INFORMATIONAL_ONLY — no trade execution.
 */

import React, { useState, useCallback } from "react";
import {
  Plus,
  Shield,
  AlertTriangle,
  CheckCircle,
  Info,
  ChevronDown,
  ChevronRight,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  type PositionRegistrationInput,
  validateRegistration,
  inferAssetClass,
} from "@/lib/position-protection/position-registration";

interface PositionRegistrationPanelProps {
  onRegister: (input: PositionRegistrationInput) => void;
  registeredCount?: number;
}

export function PositionRegistrationPanel({
  onRegister,
  registeredCount = 0,
}: PositionRegistrationPanelProps) {
  const [expanded, setExpanded] = useState(false);
  const [instrument, setInstrument] = useState("");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [entryPrice, setEntryPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [leverage, setLeverage] = useState("");
  const [horizon, setHorizon] = useState<"SCALPING" | "INTRADAY" | "SWING" | "INVESTING">("SWING");
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const [showAdvanced, setShowAdvanced] = useState(false);

  const handleRegister = useCallback(() => {
    const input: PositionRegistrationInput = {
      positionId: `pos-${instrument.replace(/[^a-zA-Z0-9]/g, "").toUpperCase()}-${side}-${Date.now()}`,
      instrument: instrument.trim(),
      side,
      entryPrice: parseFloat(entryPrice) || 0,
      currentPrice: currentPrice ? parseFloat(currentPrice) : undefined,
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
      leverage: leverage ? parseFloat(leverage) : undefined,
      horizon,
      openedAt: Date.now(),
      assetClass: inferAssetClass(instrument),
    };

    const validation = validateRegistration(input);
    if (!validation.valid) {
      setValidationErrors(validation.errors);
      return;
    }

    setValidationErrors([]);
    onRegister(input);

    // Reset form
    setInstrument("");
    setEntryPrice("");
    setCurrentPrice("");
    setStopLoss("");
    setTakeProfit("");
    setLeverage("");
    setExpanded(false);
  }, [instrument, side, entryPrice, currentPrice, stopLoss, takeProfit, leverage, horizon, onRegister]);

  const inferredAsset = instrument ? inferAssetClass(instrument) : null;

  return (
    <div className="rounded-xl border border-border/30 bg-card overflow-hidden">
      {/* Header */}
      <button
        className="flex items-center justify-between w-full px-4 py-3 hover:bg-muted/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2.5">
          <div className="flex items-center justify-center size-8 rounded-lg bg-primary/10">
            <Shield className="size-4 text-primary" />
          </div>
          <div className="text-left">
            <div className="text-sm font-mono font-semibold">Register Position</div>
            <div className="text-[10px] text-muted-foreground font-mono">
              {registeredCount} position{registeredCount !== 1 ? "s" : ""} monitored
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {registeredCount > 0 && (
            <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded">
              ACTIVE
            </span>
          )}
          {expanded ? (
            <ChevronDown className="size-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="size-4 text-muted-foreground" />
          )}
        </div>
      </button>

      {/* Form */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3">
          {/* Validation errors */}
          {validationErrors.length > 0 && (
            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2 space-y-1">
              {validationErrors.map((err, i) => (
                <div key={i} className="flex items-start gap-1.5 text-[10px] font-mono text-red-400">
                  <AlertTriangle className="size-3 mt-0.5 shrink-0" />
                  {err}
                </div>
              ))}
            </div>
          )}

          {/* Instrument + Side */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground block mb-1">Instrument</label>
              <input
                type="text"
                value={instrument}
                onChange={e => setInstrument(e.target.value)}
                placeholder="BTC/USDT"
                className="w-full h-8 text-xs font-mono rounded-md border border-border/50 bg-background px-2 focus:outline-none focus:border-primary/50"
              />
              {inferredAsset && (
                <div className="text-[9px] font-mono text-muted-foreground mt-0.5">
                  Inferred: {inferredAsset}
                </div>
              )}
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground block mb-1">Side</label>
              <div className="flex gap-1">
                <button
                  onClick={() => setSide("LONG")}
                  className={cn(
                    "flex-1 h-8 text-xs font-mono font-semibold rounded-md border transition-colors",
                    side === "LONG"
                      ? "bg-emerald-500/20 border-emerald-500/30 text-emerald-400"
                      : "border-border/50 text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  LONG
                </button>
                <button
                  onClick={() => setSide("SHORT")}
                  className={cn(
                    "flex-1 h-8 text-xs font-mono font-semibold rounded-md border transition-colors",
                    side === "SHORT"
                      ? "bg-red-500/20 border-red-500/30 text-red-400"
                      : "border-border/50 text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  SHORT
                </button>
              </div>
            </div>
          </div>

          {/* Entry Price + Current Price */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] font-mono text-muted-foreground block mb-1">Entry Price *</label>
              <input
                type="number"
                value={entryPrice}
                onChange={e => setEntryPrice(e.target.value)}
                placeholder="50000"
                className="w-full h-8 text-xs font-mono rounded-md border border-border/50 bg-background px-2 focus:outline-none focus:border-primary/50"
              />
            </div>
            <div>
              <label className="text-[10px] font-mono text-muted-foreground block mb-1">Current Price</label>
              <input
                type="number"
                value={currentPrice}
                onChange={e => setCurrentPrice(e.target.value)}
                placeholder="Optional"
                className="w-full h-8 text-xs font-mono rounded-md border border-border/50 bg-background px-2 focus:outline-none focus:border-primary/50"
              />
            </div>
          </div>

          {/* Horizon */}
          <div>
            <label className="text-[10px] font-mono text-muted-foreground block mb-1">Horizon</label>
            <div className="grid grid-cols-4 gap-1">
              {(["SCALPING", "INTRADAY", "SWING", "INVESTING"] as const).map(h => (
                <button
                  key={h}
                  onClick={() => setHorizon(h)}
                  className={cn(
                    "h-7 text-[10px] font-mono font-semibold rounded-md border transition-colors",
                    horizon === h
                      ? "bg-primary/20 border-primary/30 text-primary"
                      : "border-border/50 text-muted-foreground hover:bg-muted/50"
                  )}
                >
                  {h}
                </button>
              ))}
            </div>
          </div>

          {/* Advanced toggle */}
          <button
            className="flex items-center gap-1 text-[10px] font-mono text-muted-foreground hover:text-foreground"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            {showAdvanced ? <ChevronDown className="size-3" /> : <ChevronRight className="size-3" />}
            Advanced (SL / TP / Leverage)
          </button>

          {showAdvanced && (
            <div className="grid grid-cols-3 gap-2">
              <div>
                <label className="text-[10px] font-mono text-muted-foreground block mb-1">Stop Loss</label>
                <input
                  type="number"
                  value={stopLoss}
                  onChange={e => setStopLoss(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-8 text-xs font-mono rounded-md border border-border/50 bg-background px-2 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-muted-foreground block mb-1">Take Profit</label>
                <input
                  type="number"
                  value={takeProfit}
                  onChange={e => setTakeProfit(e.target.value)}
                  placeholder="Optional"
                  className="w-full h-8 text-xs font-mono rounded-md border border-border/50 bg-background px-2 focus:outline-none focus:border-primary/50"
                />
              </div>
              <div>
                <label className="text-[10px] font-mono text-muted-foreground block mb-1">Leverage</label>
                <input
                  type="number"
                  value={leverage}
                  onChange={e => setLeverage(e.target.value)}
                  placeholder="1"
                  className="w-full h-8 text-xs font-mono rounded-md border border-border/50 bg-background px-2 focus:outline-none focus:border-primary/50"
                />
              </div>
            </div>
          )}

          {/* Register button */}
          <button
            onClick={handleRegister}
            disabled={!instrument || !entryPrice}
            className={cn(
              "w-full h-9 rounded-lg text-xs font-mono font-semibold transition-colors flex items-center justify-center gap-2",
              instrument && entryPrice
                ? "bg-primary text-primary-foreground hover:bg-primary/90"
                : "bg-muted text-muted-foreground cursor-not-allowed"
            )}
          >
            <Plus className="size-3.5" />
            Register for Monitoring
          </button>

          {/* Disclaimer */}
          <div className="text-[9px] font-mono text-muted-foreground/50 flex items-start gap-1">
            <Info className="size-3 mt-0.5 shrink-0" />
            Informational only. No trades are executed automatically.
          </div>
        </div>
      )}
    </div>
  );
}
