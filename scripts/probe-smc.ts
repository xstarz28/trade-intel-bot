// Quick probe (temporary, kept for debugging) — inspect SMC outputs
// This script is a dev tool only; it is excluded from the app build.
import { computeSmcContext } from "../src/lib/data/smc";
import type { OhlcvCandle } from "../src/lib/data/market-types";

const mk = (i: number, o: number, h: number, l: number, c: number): OhlcvCandle => ({
  timestamp: 1700000000000 + i * 3600000,
  open: o,
  high: h,
  low: l,
  close: c,
  volume: 1000,
});

// Series with real pullbacks: up-legs of 8 bars, pullbacks of 5 bars
function trendWithPullbacks(): OhlcvCandle[] {
  const out: OhlcvCandle[] = [];
  let price = 100;
  const legs = [
    { bars: 10, step: 1 },
    { bars: 6, step: -0.5 },
    { bars: 10, step: 1 },
    { bars: 6, step: -0.5 },
    { bars: 10, step: 1 },
    { bars: 6, step: -0.5 },
    { bars: 10, step: 1 },
  ];
  for (const leg of legs) {
    for (let b = 0; b < leg.bars; b++) {
      const o = price;
      price += leg.step;
      out.push(mk(out.length, o, Math.max(o, price) + 0.2, Math.min(o, price) - 0.2, price));
    }
  }
  return out;
}

const rising = trendWithPullbacks();
console.log("rising length:", rising.length);
const ctx = computeSmcContext(rising, "H4");
console.log("external:", ctx.internalExternal.external.structure);
console.log("internal:", ctx.internalExternal.internal.structure);
console.log("conflict:", ctx.internalExternal.internalConflict);

// Now append a minor decline: 3 down / 1 up bounce pattern ×2 + 2 down.
// Bounce tops become MINOR (lookback 3) lower-highs, but the pattern is too
// short to create new MAJOR (lookback 5) swing highs — external stays HH/HL.
const tail = [...rising];
let p = tail[tail.length - 1].close;
// 5 down, bounce, 3 down, bounce, 3 down — bounce tops become MINOR lower
// highs; the global top remains the last MAJOR high (external stays HH/HL).
const steps = [-0.5, -0.5, -0.5, -0.5, -0.5, 0.2, -0.5, -0.5, -0.5, 0.2, -0.5, -0.5, -0.5];
for (const step of steps) {
  const o = p;
  p += step;
  tail.push(mk(tail.length, o, Math.max(o, p) + 0.1, Math.min(o, p) - 0.1, p));
}
const ctx2 = computeSmcContext(tail, "H1");
console.log("--- with tail decline ---");
console.log("external:", ctx2.internalExternal.external.structure);
console.log("internal:", ctx2.internalExternal.internal.structure);
console.log("conflict:", ctx2.internalExternal.internalConflict);

// Inspect raw swings near the tail
import { detectSwingPoints } from "../src/lib/data/smc";
const minor = detectSwingPoints(tail, 3);
const major = detectSwingPoints(tail, 5);
console.log("minor highs (last 6):", minor.highs.slice(-6).map((s) => [s.index, +s.price.toFixed(2)]));
console.log("major highs (last 4):", major.highs.slice(-4).map((s) => [s.index, +s.price.toFixed(2)]));
console.log("tail closes (last 12):", tail.slice(-12).map((c) => +c.close.toFixed(2)));
