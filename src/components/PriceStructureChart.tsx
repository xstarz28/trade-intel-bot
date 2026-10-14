import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { OhlcvCandle, TechnicalData } from "@/lib/data/market-types";
import type { KeyLevels, TradePlan } from "@/types/analysis";
import { validateTradePlanAgainstMarket } from "@/lib/trade-plan-validation";
import { useI18n } from "@/lib/i18n";

interface PriceChartProps {
  instrument: string;
  instrumentType: string;
  timeframe: string;
  candles: OhlcvCandle[];
  keyLevels: KeyLevels;
  tradePlan?: TradePlan;
  projectedTradePlan?: TradePlan;
  technicalData?: TechnicalData;
}

const CHART_COPY: Record<string, { title: string; candles: string; lastClose: string; structure: string; plan: string; verify: string; stale: string; rejected: string; unavailable: string; entry: string; stop: string; target: string; resistance: string; support: string; invalidation: string; vwap: string; volumeProfile: string; sweep: string }> = {
  en: { title: "Market structure · provider OHLCV", candles: "candles", lastClose: "LAST CLOSE", structure: "STRUCTURE", plan: "ANALYTICAL PLAN", verify: "VERIFY EXECUTABLE PRICE", stale: "Trade plan hidden: levels no longer match the latest candles. Re-run analysis.", rejected: "No executable entry plan. Rejected projections are not drawn to avoid misleading entry levels.", unavailable: "unavailable", entry: "ENTRY", stop: "SL", target: "TP", resistance: "RES", support: "SUP", invalidation: "INV", vwap: "VWAP", volumeProfile: "Volume Profile", sweep: "SWEEP" },
  id: { title: "Struktur pasar · OHLCV penyedia", candles: "candle", lastClose: "PENUTUP TERAKHIR", structure: "STRUKTUR", plan: "RENCANA ANALISIS", verify: "VERIFIKASI HARGA EKSEKUSI", stale: "Rencana entry disembunyikan: level tidak cocok dengan candle terbaru. Jalankan analisis ulang.", rejected: "Belum ada rencana entry yang layak dieksekusi. Proyeksi yang ditolak tidak digambar agar tidak menyesatkan.", unavailable: "tidak tersedia", entry: "MASUK", stop: "SL", target: "TP", resistance: "RESISTENSI", support: "DUKUNGAN", invalidation: "INVALIDASI", vwap: "VWAP", volumeProfile: "Profil Volume", sweep: "SAPUAN LIKUIDITAS" },
  es: { title: "Estructura de mercado · OHLCV del proveedor", candles: "velas", lastClose: "ÚLTIMO CIERRE", structure: "ESTRUCTURA", plan: "PLAN ANALÍTICO", verify: "VERIFICAR PRECIO EJECUTABLE", stale: "Plan oculto: los niveles no coinciden con las velas recientes. Repite el análisis.", rejected: "No hay un plan de entrada ejecutable. No se dibujan proyecciones rechazadas.", unavailable: "no disponible", entry: "ENTRADA", stop: "SL", target: "TP", resistance: "RESISTENCIA", support: "SOPORTE", invalidation: "INVALIDACIÓN", vwap: "VWAP", volumeProfile: "Perfil de volumen", sweep: "BARRIDO" },
  pt: { title: "Estrutura de mercado · OHLCV do provedor", candles: "velas", lastClose: "ÚLTIMO FECHAMENTO", structure: "ESTRUTURA", plan: "PLANO ANALÍTICO", verify: "VERIFICAR PREÇO EXECUTÁVEL", stale: "Plano oculto: os níveis não correspondem aos candles recentes. Analise novamente.", rejected: "Não há plano de entrada executável. Projeções rejeitadas não são desenhadas.", unavailable: "indisponível", entry: "ENTRADA", stop: "SL", target: "TP", resistance: "RESISTÊNCIA", support: "SUPORTE", invalidation: "INVALIDAÇÃO", vwap: "VWAP", volumeProfile: "Perfil de volume", sweep: "VARREDURA" },
  fr: { title: "Structure du marché · OHLCV fournisseur", candles: "bougies", lastClose: "DERNIÈRE CLÔTURE", structure: "STRUCTURE", plan: "PLAN ANALYTIQUE", verify: "VÉRIFIER LE PRIX EXÉCUTABLE", stale: "Plan masqué : les niveaux ne correspondent plus aux dernières bougies. Relancez l’analyse.", rejected: "Aucun plan d’entrée exécutable. Les projections rejetées ne sont pas affichées.", unavailable: "indisponible", entry: "ENTRÉE", stop: "SL", target: "TP", resistance: "RÉSISTANCE", support: "SUPPORT", invalidation: "INVALIDATION", vwap: "VWAP", volumeProfile: "Profil de volume", sweep: "BALAYAGE" },
  de: { title: "Marktstruktur · Anbieter-OHLCV", candles: "Kerzen", lastClose: "LETZTER SCHLUSSKURS", structure: "STRUKTUR", plan: "ANALYSEPLAN", verify: "AUSFÜHRBAREN PREIS PRÜFEN", stale: "Plan ausgeblendet: Die Levels passen nicht zu den neuesten Kerzen. Analyse erneut ausführen.", rejected: "Kein ausführbarer Einstiegsplan. Abgelehnte Projektionen werden nicht angezeigt.", unavailable: "nicht verfügbar", entry: "EINSTIEG", stop: "SL", target: "TP", resistance: "WIDERSTAND", support: "UNTERSTÜTZUNG", invalidation: "INVALIDIERUNG", vwap: "VWAP", volumeProfile: "Volumenprofil", sweep: "LIQUIDITÄTS-SWEEP" },
  ja: { title: "市場構造 · プロバイダーOHLCV", candles: "本のローソク足", lastClose: "直近終値", structure: "構造", plan: "分析プラン", verify: "実行可能価格を確認", stale: "プランを非表示にしました。最新のローソク足と価格が一致しません。再分析してください。", rejected: "実行可能なエントリープランがありません。却下された予測は表示しません。", unavailable: "利用不可", entry: "エントリー", stop: "損切り", target: "利確", resistance: "抵抗線", support: "支持線", invalidation: "無効化", vwap: "VWAP", volumeProfile: "出来高プロファイル", sweep: "流動性スイープ" },
  ko: { title: "시장 구조 · 공급자 OHLCV", candles: "개 캔들", lastClose: "최근 종가", structure: "구조", plan: "분석 계획", verify: "실행 가능 가격 확인", stale: "최근 캔들과 가격이 일치하지 않아 계획을 숨겼습니다. 다시 분석하세요.", rejected: "실행 가능한 진입 계획이 없습니다. 거부된 예상 수준은 표시하지 않습니다.", unavailable: "사용 불가", entry: "진입", stop: "손절", target: "목표가", resistance: "저항", support: "지지", invalidation: "무효화", vwap: "VWAP", volumeProfile: "거래량 프로파일", sweep: "유동성 스윕" },
  zh: { title: "市场结构 · 数据源 OHLCV", candles: "根K线", lastClose: "最新收盘价", structure: "结构", plan: "分析计划", verify: "核实可执行价格", stale: "已隐藏计划：价位与最新K线不符。请重新分析。", rejected: "当前没有可执行的入场计划。为避免误导，不显示已被拒绝的预测。", unavailable: "不可用", entry: "入场", stop: "止损", target: "止盈", resistance: "阻力", support: "支撑", invalidation: "失效位", vwap: "VWAP", volumeProfile: "成交量分布", sweep: "流动性扫单" },
};
function formatChartPrice(value: number, instrumentType: string, instrument: string, locale: string): string {
  if (!Number.isFinite(value)) return "—";
  const magnitude = Math.abs(value);
  if (instrumentType === "forex") return value.toFixed(/JPY/i.test(instrument) ? 3 : 5);
  if (instrumentType === "crypto") {
    if (magnitude >= 1000) return value.toLocaleString(locale, { maximumFractionDigits: 2 });
    if (magnitude >= 1) return value.toFixed(4);
    if (magnitude >= 0.01) return value.toFixed(6);
    if (magnitude >= 0.0001) return value.toFixed(8);
    return value.toFixed(10);
  }
  if (magnitude >= 1000) return value.toLocaleString(locale, { maximumFractionDigits: 2 });
  if (magnitude >= 1) return value.toFixed(2);
  if (magnitude >= 0.01) return value.toFixed(4);
  if (magnitude >= 0.0001) return value.toFixed(6);
  return value.toFixed(8);
}

function timeLabel(timestamp: number, locale: string): string {
  return new Date(timestamp).toLocaleTimeString(locale, {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

/**
 * Price-first market chart.
 *
 * The chart intentionally follows a TradingView-like hierarchy:
 * candles and axes first, trade plan second, only the most relevant structural
 * levels as overlays. SMC/VWAP/profile data remains available as compact context
 * instead of painting every available object over the price action.
 */
export function PriceStructureChart({
  instrument,
  instrumentType,
  timeframe,
  candles,
  keyLevels,
  tradePlan,
  projectedTradePlan,
  technicalData,
}: PriceChartProps) {
  const { locale } = useI18n();
  const copy = CHART_COPY[locale] ?? CHART_COPY.en;
  const data = candles
    .filter((c) =>
      [c.open, c.high, c.low, c.close, c.timestamp].every(Number.isFinite) &&
      c.high >= Math.max(c.open, c.close, c.low) &&
      c.low <= Math.min(c.open, c.close, c.high)
    )
    // Providers differ on candle order. Normalize chronologically before
    // selecting the visible window so "last close" is truly the newest bar.
    .sort((a, b) => a.timestamp - b.timestamp)
    .slice(-90);

  if (data.length < 5) return null;

  const fmt = (value: number) => formatChartPrice(value, instrumentType, instrument, locale);
  const smc = technicalData?.smc;
  // Only executable plans belong on the price chart. Rejected projections must not look like entry signals.
  const candidatePlan = tradePlan;
  const planValidation = candidatePlan
    ? validateTradePlanAgainstMarket(candidatePlan, data, technicalData?.atr14)
    : undefined;
  // Final safety boundary: persisted results must not draw stale entry levels.
  const plan = candidatePlan && planValidation?.valid ? candidatePlan : undefined;
  const rejectedPlan = (!!candidatePlan && !plan) || (!!projectedTradePlan && !tradePlan);
  const projected = false;
  const highs = data.map((c) => c.high);
  const lows = data.map((c) => c.low);
  // Keep the visible price scale anchored to recent candles plus the
  // entry/SL/TP levels. Historical support/resistance may sit far outside this
  // M5 window; allowing those distant levels to set the scale crushes candles
  // and makes the chart unreadable. Out-of-window structural levels are omitted.
  const overlayPrices = (plan
    ? [Number(plan.entry), Number(plan.stopLoss), Number(plan.takeProfit)]
    : []
  ).filter((value) => Number.isFinite(value) && value > 0);
  const max = Math.max(...highs, ...overlayPrices);
  const min = Math.min(...lows, ...overlayPrices);
  const spanRaw = Math.max(max - min, Number.EPSILON);
  const pad = spanRaw * 0.07;
  const topPrice = max + pad;
  const bottomPrice = Math.max(0, min - pad);
  const priceSpan = Math.max(topPrice - bottomPrice, Number.EPSILON);

  const width = 1000;
  const height = 480;
  const left = 18;
  const right = 82;
  const top = 18;
  const bottom = 58;
  const volumeHeight = 72;
  const gap = 12;
  const priceHeight = height - top - bottom - volumeHeight - gap;
  const plotWidth = width - left - right;
  const volumeTop = top + priceHeight + gap;
  const x = (i: number) => left + (i / Math.max(data.length - 1, 1)) * plotWidth;
  const y = (price: number) => top + ((topPrice - price) / priceSpan) * priceHeight;
  const visible = (price: number) => price >= bottomPrice && price <= topPrice;

  const volumes = data.map((c) => Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0);
  const maxVolume = Math.max(...volumes, 0);
  const hasVolume = maxVolume > 0;
  const candleWidth = Math.max(3, Math.min(10, (plotWidth / data.length) * 0.62));
  const volumeY = (v: number) =>
    volumeTop + volumeHeight - (v / Math.max(maxVolume, 1)) * volumeHeight;

  const levelY = (value: number | undefined): number | null =>
    value !== undefined && Number.isFinite(value) && visible(value) ? y(value) : null;

  const support = Number(keyLevels.support);
  const resistance = Number(keyLevels.resistance);
  const invalidation = Number(keyLevels.invalidation);

  const planLevels = plan
    ? [
        { key: "entry", label: projected ? `P-${copy.entry}` : copy.entry, value: Number(plan.entry), cls: "text-sky-300", dash: "7 4" },
        { key: "sl", label: projected ? `P-${copy.stop}` : copy.stop, value: Number(plan.stopLoss), cls: "text-red-300", dash: "5 4" },
        { key: "tp", label: projected ? `P-${copy.target}` : copy.target, value: Number(plan.takeProfit), cls: "text-emerald-300", dash: "5 4" },
      ]
    : [];

  const last = data[data.length - 1];
  const currentY = y(last.close);
  const risk = plan ? Math.abs(Number(plan.entry) - Number(plan.stopLoss)) : NaN;
  const reward = plan ? Math.abs(Number(plan.takeProfit) - Number(plan.entry)) : NaN;
  const rr = risk > 0 && Number.isFinite(reward) ? reward / risk : undefined;

  // Only the nearest fresh zones are shown. The full SMC payload remains in
  // the analysis data; the chart should not become an indicator dump.
  const relevantZones = [
    ...(smc?.fvgs ?? [])
      .filter((f) => f.status === "fresh" && visible((f.lower + f.upper) / 2))
      .slice(0, 1)
      .map((f) => ({ lower: f.lower, upper: f.upper, label: "FVG", positive: f.direction === "bullish" })),
    ...(smc?.orderBlocks ?? [])
      .filter((o) => o.status === "fresh" && visible((o.lower + o.upper) / 2))
      .slice(0, 1)
      .map((o) => ({ lower: o.lower, upper: o.upper, label: "OB", positive: o.direction === "bullish" })),
  ];

  const compactContext = [
    smc?.vwap.available ? `${copy.vwap} ${fmt(smc.vwap.sessionVwap ?? NaN)}` : null,
    smc?.volumeProfile.available ? `POC ${fmt(smc.volumeProfile.poc ?? NaN)}` : null,
    smc?.recentSweep ? `${copy.sweep} ${smc.recentSweep.side.replace("_", "-")}` : null,
  ].filter(Boolean);

  return (
    <Card className="border-border/50 overflow-hidden" data-testid="price-structure-chart" data-instrument={instrument} data-timeframe={timeframe} data-last-close={last.close} data-last-candle-timestamp={last.timestamp}>
      <CardHeader className="px-4 py-3 border-b border-border/30">
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-xs font-mono" data-testid="price-structure-chart-title">{instrument} · {timeframe} · {copy.title}</CardTitle>
          <div className="flex items-center gap-2 text-[9px] font-mono text-muted-foreground">
            <span>{data.length} {copy.candles}</span>
            <span>·</span>
            <span className="text-foreground">{copy.lastClose} {fmt(last.close)}</span>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
          <span>{copy.structure} <b className="text-foreground">{smc?.internalExternal.external.structure ?? technicalData?.structure ?? "unknown"}</b></span>
          {smc?.internalExternal.external.bosDirection && smc.internalExternal.external.bosDirection !== "none" && (
            <span>BOS {smc.internalExternal.external.bosDirection}</span>
          )}
          {smc?.internalExternal.external.chochDirection && smc.internalExternal.external.chochDirection !== "none" && (
            <span>CHoCH {smc.internalExternal.external.chochDirection}</span>
          )}
          {compactContext.map((item) => <span key={item}>{item}</span>)}
        </div>
        {rejectedPlan && (
          <div role="status" className="mt-2 text-[10px] font-mono text-amber-300">
            {tradePlan ? copy.stale : copy.rejected}
          </div>
        )}
        {plan && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[9px] font-mono">
            <span className={projected ? "text-amber-300" : "text-sky-300"}>
              {projected ? "PROJECTED SETUP · NOT EXECUTABLE" : `${copy.plan} · ${copy.verify}`}
            </span>
            <span>{copy.entry} {fmt(Number(plan.entry))}</span>
            <span>{copy.stop} {fmt(Number(plan.stopLoss))}</span>
            <span>{copy.target} {fmt(Number(plan.takeProfit))}</span>
            {rr !== undefined && <span className={rr >= 1.5 ? "text-emerald-300" : "text-red-300"}>R:R {rr.toFixed(2)}R</span>}
          </div>
        )}
      </CardHeader>

      <CardContent className="px-2 sm:px-3 pb-3">
        <div className="w-full">
          <svg
            viewBox={`0 0 ${width} ${height}`}
            className="w-full h-auto min-h-[300px]"
            role="img"
            aria-label={`Provider OHLCV market structure chart for ${instrument} ${timeframe}`}
          >
            {/* TradingView-like grid: deliberately subtle. */}
            {[0, 1, 2, 3, 4].map((i) => {
              const gy = top + (i / 4) * priceHeight;
              const value = topPrice - (i / 4) * priceSpan;
              return (
                <g key={`h-${i}`}>
                  <line x1={left} x2={width - right} y1={gy} y2={gy} className="stroke-border/30" />
                  <text x={width - right + 7} y={gy + 3} className="fill-muted-foreground text-[10px] font-mono">{fmt(value)}</text>
                </g>
              );
            })}
            {[0, 1, 2, 3, 4, 5].map((i) => {
              const gx = left + (i / 5) * plotWidth;
              const candle = data[Math.min(data.length - 1, Math.round((i / 5) * (data.length - 1)))];
              return (
                <g key={`v-${i}`}>
                  <line x1={gx} x2={gx} y1={top} y2={volumeTop + volumeHeight} className="stroke-border/15" />
                  <text x={gx} y={height - 16} textAnchor="middle" className="fill-muted-foreground text-[10px] font-mono">
                    {timeLabel(candle.timestamp, locale)}
                  </text>
                </g>
              );
            })}

            {/* One or two nearest fresh structural zones, not the entire SMC set. */}
            {relevantZones.map((z, i) => {
              const y1 = y(z.upper);
              const y2 = y(z.lower);
              return (
                <g key={`${z.label}-${i}`} opacity="0.35">
                  <rect
                    x={left}
                    y={Math.min(y1, y2)}
                    width={plotWidth}
                    height={Math.max(2, Math.abs(y2 - y1))}
                    className={z.positive ? "fill-emerald-400" : "fill-red-400"}
                  />
                  <text x={left + 6} y={Math.min(y1, y2) + 12} className="fill-foreground text-[9px] font-mono">
                    {z.label}
                  </text>
                </g>
              );
            })}

            {/* Candles are the dominant visual layer. */}
            {data.map((c, i) => {
              const cx = x(i);
              const bullish = c.close >= c.open;
              const bodyTop = y(Math.max(c.open, c.close));
              const bodyBottom = y(Math.min(c.open, c.close));
              return (
                <g key={`${c.timestamp}-${i}`}>
                  <line
                    x1={cx}
                    x2={cx}
                    y1={y(c.high)}
                    y2={y(c.low)}
                    className={bullish ? "stroke-emerald-400" : "stroke-red-400"}
                    strokeWidth="1.2"
                  />
                  <rect
                    x={cx - candleWidth / 2}
                    y={bodyTop}
                    width={candleWidth}
                    height={Math.max(1.5, bodyBottom - bodyTop)}
                    className={bullish ? "fill-emerald-400/80" : "fill-red-400/80"}
                    rx="0.5"
                  />
                </g>
              );
            })}

            {/* Key levels: only the levels a trader actually needs immediately. */}
            {[
              { label: copy.resistance, value: resistance, cls: "text-red-300", dash: "6 4" },
              { label: copy.support, value: support, cls: "text-emerald-300", dash: "6 4" },
              { label: copy.invalidation, value: invalidation, cls: "text-amber-300", dash: "2 5" },
            ].map((l) => {
              const ly = levelY(l.value);
              if (ly === null) return null;
              return (
                <g key={l.label}>
                  <line x1={left} x2={width - right} y1={ly} y2={ly} className={`stroke-current ${l.cls}`} strokeOpacity="0.5" strokeDasharray={l.dash} />
                  <rect x={width - right - 67} y={ly - 10} width="63" height="18" rx="3" className="fill-background/85" />
                  <text x={width - right - 6} y={ly + 3} textAnchor="end" className={`fill-current ${l.cls} text-[9px] font-mono`}>{l.label} {fmt(l.value)}</text>
                </g>
              );
            })}

            {/* Trade plan is a single coherent visual block. */}
            {planLevels.map((l) => {
              const ly = levelY(l.value);
              if (ly === null) return null;
              return (
                <g key={l.key}>
                  <line x1={left} x2={width - right} y1={ly} y2={ly} className={`stroke-current ${l.cls}`} strokeOpacity="0.75" strokeDasharray={l.dash} />
                  <rect x={left + 6} y={ly - 10} width={l.label.length > 5 ? 76 : 50} height="18" rx="3" className="fill-background/90" />
                  <text x={left + 11} y={ly + 3} className={`fill-current ${l.cls} text-[9px] font-mono`}>{l.label}</text>
                </g>
              );
            })}

            {plan && rr !== undefined && (() => {
              const entryY = levelY(Number(plan.entry));
              const slY = levelY(Number(plan.stopLoss));
              const tpY = levelY(Number(plan.takeProfit));
              if (entryY === null || slY === null || tpY === null) return null;
              const boxX = left + plotWidth * 0.72;
              const boxW = plotWidth * 0.22;
              const riskTop = Math.min(entryY, slY);
              const riskBottom = Math.max(entryY, slY);
              const rewardTop = Math.min(entryY, tpY);
              const rewardBottom = Math.max(entryY, tpY);
              return (
                <g opacity="0.18">
                  <rect x={boxX} y={riskTop} width={boxW} height={Math.max(2, riskBottom - riskTop)} className="fill-red-500" />
                  <rect x={boxX} y={rewardTop} width={boxW} height={Math.max(2, rewardBottom - rewardTop)} className="fill-emerald-500" />
                </g>
              );
            })()}

            {/* Current-price line. */}
            <line x1={left} x2={width - right} y1={currentY} y2={currentY} className="stroke-foreground/50" strokeDasharray="2 5" />
            <rect x={width - right - 70} y={currentY - 10} width="66" height="18" rx="3" className="fill-foreground" />
            <text x={width - right - 6} y={currentY + 3} textAnchor="end" className="fill-background text-[9px] font-mono">{fmt(last.close)}</text>

            {/* Volume is a separate lower pane, never painted through candles. */}
            <line x1={left} x2={width - right} y1={volumeTop - 6} y2={volumeTop - 6} className="stroke-border/30" />
            {hasVolume && data.map((c, i) => {
              const volume = Number.isFinite(c.volume) && c.volume > 0 ? c.volume : 0;
              if (volume === 0) return null;
              const cx = x(i);
              const bullish = c.close >= c.open;
              const vy = volumeY(volume);
              return (
                <rect
                  key={`vol-${c.timestamp}-${i}`}
                  x={cx - candleWidth / 2}
                  y={vy}
                  width={candleWidth}
                  height={Math.max(1, volumeTop + volumeHeight - vy)}
                  className={bullish ? "fill-emerald-400/25" : "fill-red-400/25"}
                />
              );
            })}
            <text x={left} y={volumeTop + 12} className="fill-muted-foreground text-[9px] font-mono">
              {hasVolume ? "VOLUME · provider" : "VOLUME · unavailable"}
            </text>
          </svg>
        </div>

        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[9px] font-mono text-muted-foreground">
          <span>Price action first</span>
          {smc?.vwap.available ? <span>{copy.vwap} {fmt(smc.vwap.sessionVwap ?? NaN)}</span> : <span>{copy.vwap} {copy.unavailable}</span>}
          {smc?.volumeProfile.available ? <span>POC {fmt(smc.volumeProfile.poc ?? NaN)}</span> : <span>{copy.volumeProfile} {copy.unavailable}</span>}
          {smc?.recentSweep && <span>{copy.sweep} {smc.recentSweep.side.replace("_", "-")}</span>}
          {rr !== undefined ? <span className={rr >= 1.5 ? "text-emerald-300" : "text-red-300"}>R:R {rr.toFixed(2)}R</span> : <span>R:R unavailable</span>}
        </div>
      </CardContent>
    </Card>
  );
}
