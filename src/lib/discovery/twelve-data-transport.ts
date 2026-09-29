/**
 * Phase 289E — the HTTP transport Twelve Data catalog discovery runs on.
 *
 * WHY A DEDICATED TRANSPORT
 * -------------------------
 * The deployed discovery action was killed by Convex's 512 MB action limit while
 * reading Twelve Data's catalogs. Probed against the live endpoint, the catalog
 * endpoints ignore `page`: `?page=2` returns the SAME complete catalog as page 1
 * (verified for `/stocks`, `/forex_pairs`, `/commodities`). `/stocks` is ~124k
 * rows / ~30 MB in one response. `res.json()` on that body materializes the whole
 * text AND the whole parsed object graph inside the action at once.
 *
 * This transport hands the caller the RAW BODY STREAM instead, so the catalog can
 * be consumed row-by-row (see `twelve-data-stream.ts`) and the payload is never
 * resident as one array. When a stream is unavailable (an environment or a test
 * transport without `response.body`) it degrades to the buffered JSON contract,
 * which is what every existing caller already expects.
 *
 * HONESTY / SECURITY
 *   - The key is injected into the URL only when it is not already there, exactly
 *     as before; it is never logged, returned, or placed in a diagnostic string.
 *   - A non-2xx response keeps the provider's own error body (bounded) so a plan
 *     or rate rejection stays distinguishable from a transport failure.
 *   - A timeout is a timeout: the stream fails explicitly and the catalog reports
 *     FAILED/PARTIAL rather than a short read.
 */

/** Longest provider error body kept for diagnostics. */
const ERROR_BODY_MAX_CHARS = 2048;

/**
 * Phase 289G/289J — THE CATALOG READ BUDGETS, MEASURED, AND EXACTLY WHAT EACH
 * ONE PROTECTS.
 *
 * The 289F run staged 33,289 of the catalog's rows and then died with
 * `catalog stream failed: The operation was aborted due to timeout`: a SINGLE
 * `AbortSignal.timeout(30_000)` covered the whole streamed body, so a healthy
 * read that had not finished in 30 s was aborted exactly like a dead connection.
 * Worse, the read could not finish sooner: 289F waited for a staging mutation
 * per transport chunk, and the deployed run's own numbers put that path at
 * >=1,110 rows/s (33,289 rows / 30 s) — a 143,300-row catalog needs ~129 s at
 * that observed rate.
 *
 * So the deadline is split by WHAT IT IS PROTECTING, and each guard is armed only
 * while the thing it protects is actually being waited on:
 *
 *   HEADERS — how long the provider may take to answer at all. Armed before the
 *             request, disarmed the moment the response arrives.
 *   STALL   — how long the transport may WAIT FOR THE NEXT BODY BYTES. Armed
 *             immediately after the headers arrive (so a provider that sends
 *             nothing at all is caught before its first chunk), disarmed the
 *             instant a chunk arrives or the body ends, and re-armed when the
 *             next chunk is awaited. Because it is armed ONLY while a chunk is
 *             being awaited, local work — parsing, the bounded staging queue, a
 *             database write — can never be reported as provider silence.
 *   TOTAL   — a finite ceiling on one catalog read, armed for the WHOLE body and
 *             never re-armed. It stays armed while rows are parsed and staged, so
 *             a stream that trickles forever, or a local pipeline that never
 *             finishes, still terminates with an explicit failure. Derived from
 *             the worst rate this path has actually been observed at (1,110
 *             rows/s for the largest provider catalog -> ~129 s), rounded up.
 *             With 289G's batching (4x fewer mutations, ~256x fewer document
 *             writes, writes overlapped with the read) the measured local path
 *             runs at ~70,000-127,000 rows/s, i.e. seconds, not minutes.
 *
 * Every one of them is finite, and a timeout still surfaces as an explicit
 * PARTIAL/FAILED catalog — never as a short catalog presented as complete.
 */
export const CATALOG_HEADERS_TIMEOUT_MS = 20_000;
export const CATALOG_STALL_TIMEOUT_MS = 30_000;
export const CATALOG_TOTAL_TIMEOUT_MS = 180_000;

/** The whole-read budget used when a caller does not override it. */
const DEFAULT_TIMEOUT_MS = CATALOG_TOTAL_TIMEOUT_MS;

export type CatalogTransportResult = {
  ok: boolean;
  status: number;
  json?: unknown;
  body?: AsyncIterable<Uint8Array | string>;
};

export type CatalogTransport = (url: string) => Promise<CatalogTransportResult>;

export function createTwelveDataCatalogTransport(options: {
  apiKey: string;
  /** Whole-read ceiling; defaults to `CATALOG_TOTAL_TIMEOUT_MS`. */
  timeoutMs?: number;
  /** Override the no-bytes-for-this-long guard (tests use a short one). */
  stallMs?: number;
  /** Override the time-to-first-byte guard. */
  headersMs?: number;
  fetchImpl?: typeof fetch;
}): CatalogTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const stallMs = options.stallMs ?? CATALOG_STALL_TIMEOUT_MS;
  const headersMs = options.headersMs ?? CATALOG_HEADERS_TIMEOUT_MS;

  return async (url: string): Promise<CatalogTransportResult> => {
    let finalUrl = url;
    if (
      options.apiKey &&
      url.includes("twelvedata.com") &&
      !/[?&]apikey=/.test(url)
    ) {
      finalUrl = `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(options.apiKey)}`;
    }

    /**
     * One controller for the whole read; the guards below abort it with the
     * reason they were protecting against, and that reason is what the caller
     * reports. The reason is also recorded in `abortReason`, so the failure text
     * is identical no matter how the runtime surfaces an aborted body stream.
     */
    const controller = new AbortController();
    let abortReason: string | null = null;
    let headerTimer: ReturnType<typeof setTimeout> | null = null;
    let stallTimer: ReturnType<typeof setTimeout> | null = null;
    let totalTimer: ReturnType<typeof setTimeout> | null = null;

    /**
     * A guard that has fired must END the read by itself. Aborting the fetch is
     * not enough: an environment whose body stream does not surface the abort
     * would leave the reader waiting forever, which is exactly the semantic hole
     * this phase closes. So each guard rejects this promise, the body loop races
     * every wait against it, and the read fails with the guard's own reason.
     */
    let fireGuard: ((reason: string) => void) | null = null;
    const guardFailure = new Promise<never>((_resolve, reject) => {
      fireGuard = (reason: string) => reject(new Error(reason));
    });
    // Nothing awaits it until the body loop does; keep a rejected guard from
    // ever surfacing as an unhandled rejection in the meantime.
    guardFailure.catch(() => {});

    const timer = (ms: number, reason: string): ReturnType<typeof setTimeout> => {
      const handle = setTimeout(() => {
        abortReason ??= reason;
        controller.abort(new Error(reason));
        fireGuard?.(reason);
      }, Math.max(1, ms));
      // A guard must never hold a process open after its read has ended.
      const unref = (handle as unknown as { unref?: () => void }).unref;
      if (typeof unref === "function") unref.call(handle);
      return handle;
    };
    const clear = (handle: ReturnType<typeof setTimeout> | null) => {
      if (handle !== null) clearTimeout(handle);
    };

    // ── HEADERS: until the provider answers at all. ──────────────────────────
    headerTimer = timer(headersMs, `no response headers within ${headersMs} ms`);
    let response: Response;
    try {
      response = await doFetch(finalUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      clear(headerTimer);
      clear(stallTimer);
      clear(totalTimer);
      throw error;
    }
    clear(headerTimer);

    if (!response.ok) {
      // The provider explains a rejection in the body; keep it (bounded) so the
      // caller can name the cause instead of only the status.
      let json: unknown;
      totalTimer = timer(timeoutMs, `catalog read exceeded ${timeoutMs} ms`);
      try {
        const text = (await response.text()).slice(0, ERROR_BODY_MAX_CHARS);
        json = text.trim() === "" ? undefined : (JSON.parse(text) as unknown);
      } catch (error) {
        if (abortReason !== null) throw new Error(abortReason);
        json = undefined;
      } finally {
        clear(totalTimer);
        totalTimer = null;
      }
      return { ok: false, status: response.status, json };
    }

    const stream = response.body as unknown as
      | AsyncIterable<Uint8Array | string>
      | null
      | undefined;
    if (stream && typeof stream[Symbol.asyncIterator] === "function") {
      const deadline = Date.now() + timeoutMs;
      /**
       * TOTAL — armed ONCE, here, and disarmed only when the body is over.
       *
       * It is deliberately armed before the first chunk is awaited and before any
       * consumer code runs, so the whole body — provider waits, parsing, the
       * bounded write queue, staging mutations — lives inside one finite budget.
       */
      totalTimer = timer(timeoutMs, `catalog read exceeded ${timeoutMs} ms`);

      /**
       * The body is handed over still guarded:
       *
       *   · while the NEXT chunk is awaited, the STALL guard is armed;
       *   · the moment a chunk arrives (or the body ends, or the wait fails) the
       *     STALL guard is disarmed, BEFORE control passes to the consumer — so
       *     the consumer's own duration is never measured as provider silence;
       *   · when the consumer comes back for more, the guard is armed again for
       *     exactly the next wait;
       *   · the TOTAL guard stays armed throughout, consumer time included.
       */
      const guarded: AsyncIterable<Uint8Array | string> = {
        async *[Symbol.asyncIterator]() {
          const iterator = (stream as AsyncIterable<Uint8Array | string>)[
            Symbol.asyncIterator
          ]();
          const remaining = () => deadline - Date.now();
          try {
            for (;;) {
              const left = remaining();
              if (left <= 0) {
                const reason = `catalog read exceeded ${timeoutMs} ms`;
                abortReason ??= reason;
                controller.abort(new Error(reason));
                throw new Error(reason);
              }
              stallTimer = timer(Math.min(stallMs, left), `no catalog bytes for ${stallMs} ms`);
              let step: IteratorResult<Uint8Array | string>;
              // The wait for the next chunk is raced against the guards, so a
              // silent provider (and a body stream that ignores the abort) ends
              // the read with the guard's reason instead of hanging.
              const pending = iterator.next();
              pending.catch(() => {});
              try {
                step = await Promise.race([pending, guardFailure]);
              } catch (error) {
                // A guard that fired reports its own reason verbatim; a real
                // transport error is reported as it is.
                if (abortReason !== null) throw new Error(abortReason);
                throw error;
              } finally {
                clear(stallTimer);
                stallTimer = null;
              }
              if (step.done === true) return;
              // Control passes to the consumer only after the guard is disarmed.
              yield step.value;
            }
          } finally {
            clear(stallTimer);
            clear(totalTimer);
            stallTimer = null;
            totalTimer = null;
          }
        },
      };
      return { ok: true, status: response.status, body: guarded };
    }

    // Buffered transport (no readable body): progress is not observable here, so
    // only the finite TOTAL ceiling applies while the body is read.
    totalTimer = timer(timeoutMs, `catalog read exceeded ${timeoutMs} ms`);
    let json: unknown;
    try {
      json = await response.json();
    } catch (error) {
      if (abortReason !== null) throw new Error(abortReason);
      json = undefined;
    } finally {
      clear(totalTimer);
      totalTimer = null;
    }
    return { ok: true, status: response.status, json };
  };
}
