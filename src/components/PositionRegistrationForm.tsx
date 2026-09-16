/**
 * Phase 61 — Position Registration Form
 *
 * Allows manual entry of open positions for profit protection monitoring.
 * Validates input, generates a deterministic position ID, and delegates
 * to the usePositionProtection hook.
 *
 * INFORMATIONAL_ONLY — never executes trades.
 */
import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { mapHorizon } from "@/lib/i18n/enum-mapping";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Shield, Plus, Loader2 } from "lucide-react";
import type { PositionRegistration } from "@/lib/position-protection/use-position-protection";

interface PositionRegistrationFormProps {
  onRegister: (reg: PositionRegistration) => void;
  disabled?: boolean;
}

type AssetClass = "crypto" | "forex" | "equity" | "commodity" | "indices";

const HORIZON_OPTIONS = [
  { value: "SCALPING", label: "Scalping" },
  { value: "INTRADAY", label: "Intraday" },
  { value: "SWING", label: "Swing" },
  { value: "INVESTING", label: "Investing" },
] as const;

function generatePositionId(instrument: string): string {
  const ts = Date.now();
  const hash = instrument.replace(/[^a-zA-Z0-9]/g, "").toLowerCase();
  return `pos-${hash}-${ts}`;
}

export function PositionRegistrationForm({ onRegister, disabled }: PositionRegistrationFormProps) {
  const { t } = useI18n();
  const [instrument, setInstrument] = useState("");
  const [side, setSide] = useState<"LONG" | "SHORT">("LONG");
  const [entryPrice, setEntryPrice] = useState("");
  const [currentPrice, setCurrentPrice] = useState("");
  const [stopLoss, setStopLoss] = useState("");
  const [takeProfit, setTakeProfit] = useState("");
  const [leverage, setLeverage] = useState("");
  const [horizon, setHorizon] = useState<"SCALPING" | "INTRADAY" | "SWING" | "INVESTING">("SWING");
  const [submitting, setSubmitting] = useState(false);

  const canSubmit =
    instrument.trim() &&
    entryPrice &&
    parseFloat(entryPrice) > 0 &&
    currentPrice &&
    parseFloat(currentPrice) > 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;

    setSubmitting(true);

    const reg: PositionRegistration = {
      positionId: generatePositionId(instrument.trim()),
      instrument: instrument.trim().toUpperCase(),
      side,
      entryPrice: parseFloat(entryPrice),
      stopLoss: stopLoss ? parseFloat(stopLoss) : undefined,
      takeProfit: takeProfit ? parseFloat(takeProfit) : undefined,
      leverage: leverage ? parseFloat(leverage) : undefined,
      horizon,
    };

    onRegister(reg);

    // Reset form
    setInstrument("");
    setEntryPrice("");
    setCurrentPrice("");
    setStopLoss("");
    setTakeProfit("");
    setLeverage("");
    setSubmitting(false);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-3">
      <div className="flex items-center gap-2 text-xs font-mono font-semibold text-foreground">
        <Shield className="size-3.5 text-primary" />
        {t.entryForm.registerTitle}
      </div>

      {/* Instrument + Side */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.protection.instrumentLabel}</label>
          <Input
            value={instrument}
            onChange={(e) => setInstrument(e.target.value)}
            placeholder="BTC/USDT"
            className="h-8 text-xs font-mono"
            disabled={disabled}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.protection.sideLabel}</label>
          <div className="flex gap-1">
            <Button
              type="button"
              size="sm"
              variant={side === "LONG" ? "default" : "outline"}
              className="h-8 flex-1 text-xs font-mono"
              onClick={() => setSide("LONG")}
              disabled={disabled}
            >
              LONG
            </Button>
            <Button
              type="button"
              size="sm"
              variant={side === "SHORT" ? "default" : "outline"}
              className="h-8 flex-1 text-xs font-mono"
              onClick={() => setSide("SHORT")}
              disabled={disabled}
            >
              SHORT
            </Button>
          </div>
        </div>
      </div>

      {/* Entry + Current Price */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.protection.entryPriceLabel}</label>
          <Input
            type="number"
            step="any"
            value={entryPrice}
            onChange={(e) => setEntryPrice(e.target.value)}
            placeholder="50000"
            className="h-8 text-xs font-mono"
            disabled={disabled}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.entryForm.currentPrice}</label>
          <Input
            type="number"
            step="any"
            value={currentPrice}
            onChange={(e) => setCurrentPrice(e.target.value)}
            placeholder="52000"
            className="h-8 text-xs font-mono"
            disabled={disabled}
          />
        </div>
      </div>

      {/* SL + TP */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.entryForm.stopLossOptional}</label>
          <Input
            type="number"
            step="any"
            value={stopLoss}
            onChange={(e) => setStopLoss(e.target.value)}
            placeholder="49000"
            className="h-8 text-xs font-mono"
            disabled={disabled}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.entryForm.takeProfitOptional}</label>
          <Input
            type="number"
            step="any"
            value={takeProfit}
            onChange={(e) => setTakeProfit(e.target.value)}
            placeholder="56000"
            className="h-8 text-xs font-mono"
            disabled={disabled}
          />
        </div>
      </div>

      {/* Leverage + Horizon */}
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.entryForm.leverageOptional}</label>
          <Input
            type="number"
            step="any"
            value={leverage}
            onChange={(e) => setLeverage(e.target.value)}
            placeholder="10"
            className="h-8 text-xs font-mono"
            disabled={disabled}
          />
        </div>
        <div>
          <label className="text-[10px] font-mono text-muted-foreground mb-1 block">{t.protection.horizonLabel}</label>
          <select
            value={horizon}
            onChange={(e) => setHorizon(e.target.value as typeof horizon)}
            className="h-8 w-full rounded-md border border-input bg-transparent px-2 text-xs font-mono"
            disabled={disabled}
          >
            {HORIZON_OPTIONS.map((h) => (
              <option key={h.value} value={h.value}>{mapHorizon(h.value, t)}</option>
            ))}
          </select>
        </div>
      </div>

      <Button
        type="submit"
        size="sm"
        className="w-full h-8 text-xs font-mono gap-1.5"
        disabled={!canSubmit || disabled || submitting}
      >
        {submitting ? (
          <Loader2 className="size-3 animate-spin" />
        ) : (
          <Plus className="size-3" />
        )}
        {t.entryForm.registerButton}
      </Button>
    </form>
  );
}
