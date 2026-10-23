import { describe, expect, it } from "vitest";
import { calculateTpoProfile, calculateVpvrProfile, type ProfileCandle } from "./market-profile";
function candles(volume: number | null = 10): ProfileCandle[] {
  return Array.from({length:40},(_,i)=>{
    const p=100+Math.sin(i/3)*2;
    return {timestamp:1_800_000_000_000+i*15*60_000,open:p-0.4,high:p+1,low:p-1,close:p+(i%2?0.3:-0.3),volume};
  });
}
describe("TPO and VPVR",()=>{
  it("calculates TPO POC and value area from distinct time blocks",()=>{
    const p=calculateTpoProfile(candles(),{rows:40,blockMinutes:30});
    expect(p.available).toBe(true); expect(p.poc).toBeGreaterThan(0);
    expect(p.val).toBeLessThanOrEqual(p.poc!); expect(p.vah).toBeGreaterThanOrEqual(p.poc!);
  });
  it("calculates approximate VPVR only with positive usable volume",()=>{
    const p=calculateVpvrProfile(candles(100),{rows:32});
    expect(p.available).toBe(true); expect(p.approximation).toContain("not true trade-level");
    expect(p.total).toBeGreaterThan(0);
  });
  it("does not fabricate VPVR for missing or zero volume",()=>{
    expect(calculateVpvrProfile(candles(null)).available).toBe(false);
    expect(calculateVpvrProfile(candles(0)).available).toBe(false);
  });
  it("rejects insufficient candle history",()=>{
    expect(calculateTpoProfile(candles().slice(0,10)).available).toBe(false);
    expect(calculateVpvrProfile(candles().slice(0,2)).available).toBe(false);
  });

  it("does not double-count duplicate provider candle timestamps",()=>{
    const data=candles(100);
    const baseline=calculateVpvrProfile(data,{rows:32});
    const duplicated=calculateVpvrProfile([...data,data[data.length-1]],{rows:32});
    expect(baseline.available).toBe(true);
    expect(duplicated.available).toBe(true);
    expect(duplicated.total).toBeCloseTo(baseline.total!,8);

    const tpoBaseline=calculateTpoProfile(data,{rows:32,blockMinutes:30});
    const tpoDuplicated=calculateTpoProfile([...data,data[data.length-1]],{rows:32,blockMinutes:30});
    expect(tpoBaseline.total).toBe(tpoDuplicated.total);
  });

  it("ignores malformed OHLC candles and sanitizes non-finite options",()=>{
    const data=candles();
    data[0]={...data[0],high:data[0].open-1};
    const profile=calculateVpvrProfile(data,{rows:Number.NaN,valueAreaPercent:Number.NaN,blockMinutes:Number.NaN});
    expect(profile.available).toBe(true);
    expect(profile.rows).toHaveLength(64);
    expect(profile.valueAreaPercent).toBe(0.7);
  });
});
