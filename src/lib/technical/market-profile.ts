/**
 * TPO and visible-range volume profile derived from provider OHLCV.
 * VPVR is an approximation: candle volume is spread across price rows touched
 * by each candle, not true exchange trade-level volume-at-price.
 */
export interface ProfileCandle {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}
export interface ProfileLevel { price: number; value: number; }
export interface MarketProfile {
  available: boolean;
  reason?: string;
  method: "ohlcv-range-allocation" | "time-price-opportunity";
  rows: ProfileLevel[];
  poc?: number;
  vah?: number;
  val?: number;
  total?: number;
  valueAreaPercent: number;
  approximation?: string;
}
export interface ProfileOptions {
  rows?: number;
  valueAreaPercent?: number;
  blockMinutes?: number;
}
const validCandles = (input: ProfileCandle[]) => input.filter(c =>
  Number.isFinite(c.timestamp) && Number.isFinite(c.open) &&
  Number.isFinite(c.high) && Number.isFinite(c.low) &&
  Number.isFinite(c.close) && c.low > 0 && c.open > 0 &&
  c.close > 0 && c.high >= c.low
).sort((a,b) => a.timestamp-b.timestamp);
const optionsOf = (o: ProfileOptions) => ({
  rows: Math.max(8, Math.min(200, Math.floor(o.rows ?? 64))),
  valueAreaPercent: Math.max(0.5, Math.min(0.9, o.valueAreaPercent ?? 0.7)),
  blockMs: Math.max(1, o.blockMinutes ?? 30) * 60_000,
});
function levelsFor(candles: ProfileCandle[], rows: number) {
  const low = Math.min(...candles.map(c=>c.low));
  const high = Math.max(...candles.map(c=>c.high));
  return { low, high, step: (high-low)/rows };
}
function areaFor(values: number[], low: number, step: number, percent: number) {
  const total = values.reduce((a,b)=>a+b,0);
  if (!(total > 0)) return undefined;
  let pocIndex = 0;
  for (let i=1;i<values.length;i++) if (values[i] > values[pocIndex]) pocIndex=i;
  let left=pocIndex, right=pocIndex, included=values[pocIndex];
  while (included < total*percent && (left>0 || right<values.length-1)) {
    const below=left>0 ? values[left-1] : -1;
    const above=right<values.length-1 ? values[right+1] : -1;
    if (above > below || (above===below && above>=0 && right+1-pocIndex <= pocIndex-(left-1))) {
      right++; included+=values[right];
    } else if (below>=0) { left--; included+=values[left]; }
    else break;
  }
  return { poc: low+(pocIndex+0.5)*step, vah: low+(right+1)*step, val: low+left*step, total };
}
export function calculateTpoProfile(input: ProfileCandle[], options: ProfileOptions = {}): MarketProfile {
  const candles=validCandles(input), o=optionsOf(options);
  if (candles.length<20) return {available:false,reason:"At least 20 valid candles are required.",method:"time-price-opportunity",rows:[],valueAreaPercent:o.valueAreaPercent};
  const {low,high,step}=levelsFor(candles,o.rows);
  if (!(high>low)) return {available:false,reason:"Price range is degenerate.",method:"time-price-opportunity",rows:[],valueAreaPercent:o.valueAreaPercent};
  const blocks=Array.from({length:o.rows},()=>new Set<number>());
  for (const c of candles) {
    const block=Math.floor(c.timestamp/o.blockMs);
    let first=Math.max(0,Math.min(o.rows-1,Math.floor((c.low-low)/step)));
    let last=Math.max(0,Math.min(o.rows-1,Math.floor((c.high-low)/step)));
    if(c.high===high) last=o.rows-1;
    for(let i=first;i<=last;i++) blocks[i].add(block);
  }
  const values=blocks.map(b=>b.size), rows=values.map((value,i)=>({price:low+(i+0.5)*step,value}));
  const area=areaFor(values,low,step,o.valueAreaPercent);
  return area ? {available:true,method:"time-price-opportunity",rows,...area,valueAreaPercent:o.valueAreaPercent}
    : {available:false,reason:"No TPO observations were produced.",method:"time-price-opportunity",rows,valueAreaPercent:o.valueAreaPercent};
}
export function calculateVpvrProfile(input: ProfileCandle[], options: ProfileOptions = {}): MarketProfile {
  const candles=validCandles(input), o=optionsOf(options);
  if(candles.length<3) return {available:false,reason:"At least 3 valid candles are required for a minimal volume profile.",method:"ohlcv-range-allocation",rows:[],valueAreaPercent:o.valueAreaPercent};
  if(candles.some(c=>c.volume==null || !Number.isFinite(c.volume) || c.volume<0) || !candles.some(c=>(c.volume??0)>0))
    return {available:false,reason:"Representative positive volume is unavailable; VPVR was not fabricated.",method:"ohlcv-range-allocation",rows:[],valueAreaPercent:o.valueAreaPercent};
  const {low,high,step}=levelsFor(candles,o.rows);
  if(!(high>low)) return {available:false,reason:"Price range is degenerate.",method:"ohlcv-range-allocation",rows:[],valueAreaPercent:o.valueAreaPercent};
  const values=Array.from({length:o.rows},()=>0);
  for(const c of candles) {
    const volume=c.volume??0; if(volume===0) continue;
    let first=Math.max(0,Math.min(o.rows-1,Math.floor((c.low-low)/step)));
    let last=Math.max(0,Math.min(o.rows-1,Math.floor((c.high-low)/step)));
    if(c.high===high) last=o.rows-1;
    const share=volume/Math.max(1,last-first+1);
    for(let i=first;i<=last;i++) values[i]+=share;
  }
  const rows=values.map((value,i)=>({price:low+(i+0.5)*step,value}));
  const area=areaFor(values,low,step,o.valueAreaPercent);
  return area ? {available:true,method:"ohlcv-range-allocation",rows,...area,valueAreaPercent:o.valueAreaPercent,
    approximation:"Candle volume is allocated evenly across price rows touched by each OHLC range; this is not true trade-level volume-at-price."}
    : {available:false,reason:"No volume could be allocated.",method:"ohlcv-range-allocation",rows,valueAreaPercent:o.valueAreaPercent};
}
