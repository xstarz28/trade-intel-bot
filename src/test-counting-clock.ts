/**
 * Phase 238 — a clock that advances one millisecond per READ.
 *
 * ── The problem it solves ────────────────────────────────────────────────
 *
 * A provenance defect where code consults the wall clock TWICE for one
 * acquisition is a RACE, and a race is not testable with the real clock: the
 * two reads land in the same millisecond most of the time on an idle machine
 * and in different milliseconds only when the runner is busy. That is exactly
 * how `alphavantage-legs.phase229.test.ts` asserted
 * `r.observedAt === r.fundamentals.timestamp` for a whole phase while the
 * production code read `Date.now()` twice: green on the development sandbox,
 * red on CI (run 35187915524: expected 1789624822121, received 1789624822122).
 *
 * A guard that passes whenever the machine happens to be fast enough is not a
 * guard. Phase 237 drew the same conclusion about hermeticity: enforce at the
 * runtime boundary, not by reading the source.
 *
 * ── What this does ───────────────────────────────────────────────────────
 *
 * `now()` returns a distinct, strictly increasing value on every call. Two
 * reads can therefore NEVER be mistaken for one: any second read inside a
 * single acquisition produces a visibly different instant, so an assertion
 * that the recorded instants agree becomes deterministic in both directions —
 * it passes because the code reads once, not because the millisecond happened
 * not to tick.
 *
 * It also exposes every value it returned (`reads`), which lets a test assert
 * that a recorded instant is a real clock read rather than a fabricated or
 * back-filled number.
 *
 * ── Contract ─────────────────────────────────────────────────────────────
 *
 * Test-only. No application module may import this file; the Phase 238 suite
 * asserts that, so it can never become a runtime dependency.
 *
 * Install it with `vi.spyOn(Date, "now").mockImplementation(clock.now)` and
 * restore with `vi.restoreAllMocks()`.
 */
export interface CountingClock {
  /** Every value this clock has returned, in read order. */
  reads: number[];
  /** The next instant. Distinct from every previous read. */
  now: () => number;
}

/**
 * @param base the instant BEFORE the first read (read #1 returns `base + 1`).
 */
export function createCountingClock(base: number): CountingClock {
  const reads: number[] = [];
  return {
    reads,
    now: () => {
      const value = base + reads.length + 1;
      reads.push(value);
      return value;
    },
  };
}
