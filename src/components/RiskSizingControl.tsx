import { useState } from "react";
import { useI18n } from "@/lib/i18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";

export interface RiskSizingInputs {
  accountEquity?: number;
  riskPercent?: number;
  accountCurrency?: string;
}

interface RiskSizingControlProps {
  value: RiskSizingInputs;
  onChange: (value: RiskSizingInputs) => void;
}

export function RiskSizingControl({ value, onChange }: RiskSizingControlProps) {
  const { locale } = useI18n();
  const isIndonesian = locale === "id";
  const [open, setOpen] = useState(true);

  return (
    <Card className="border-border/50">
      <CardHeader className="px-3 py-2.5">
        <button type="button" className="flex w-full items-center justify-between text-left" onClick={() => setOpen((v) => !v)}>
          <CardTitle className="text-[11px] font-mono">$ risk-sizing</CardTitle>
          <span className="text-[10px] font-mono text-muted-foreground">{open ? "−" : "+"}</span>
        </button>
      </CardHeader>
      {open && (
        <CardContent className="px-3 pb-3 space-y-2">
          <p className="text-[9px] font-mono text-muted-foreground">
            {isIndonesian
              ? "Gunakan input Anda sendiri. Sistem tidak mengasumsikan leverage atau ukuran kontrak. Ukuran posisi dihitung hanya jika spesifikasi kontrak lengkap tersedia dari provider atau Anda memasukkannya berdasarkan data broker."
              : "Your inputs only. No leverage or contract assumptions are used. Position sizing is calculated only when complete contract specifications are supplied by a provider or entered from your broker's specifications."}
          </p>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="text-[9px] font-mono text-muted-foreground">{isIndonesian ? "Ekuitas" : "Equity"}</label>
              <Input
                type="number"
                min="0"
                step="any"
                placeholder="1000"
                value={value.accountEquity ?? ""}
                onChange={(e) => onChange({ ...value, accountEquity: e.target.value ? Number(e.target.value) : undefined })}
                className="h-8 text-[10px] font-mono"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-muted-foreground">{isIndonesian ? "Risiko %" : "Risk %"}</label>
              <Input
                type="number"
                min="0"
                max="10"
                step="0.1"
                placeholder="1.0"
                value={value.riskPercent !== undefined ? value.riskPercent * 100 : ""}
                onChange={(e) => onChange({ ...value, riskPercent: e.target.value ? Number(e.target.value) / 100 : undefined })}
                className="h-8 text-[10px] font-mono"
              />
            </div>
            <div>
              <label className="text-[9px] font-mono text-muted-foreground">{isIndonesian ? "Mata Uang Akun" : "Account CCY"}</label>
              <Input
                placeholder="USD"
                value={value.accountCurrency ?? ""}
                onChange={(e) => onChange({ ...value, accountCurrency: e.target.value.toUpperCase() || undefined })}
                className="h-8 text-[10px] font-mono uppercase"
              />
            </div>
          </div>
        </CardContent>
      )}
    </Card>
  );
}
