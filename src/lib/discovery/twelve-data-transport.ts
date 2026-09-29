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
 * Phase 289G — THE CATALOG READ BUDGETS, MEASURED.
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
 * So the deadline is split by WHAT IT IS PROTECTING:
 *
 *   HEADERS — how long the provider may take to answer at all.
 *   STALL   — how long the body may go WITHOUT ANY BYTES. This is the one that
 *             catches a real network/provider stall, and it fires in seconds
 *             rather than minutes, because it measures silence, not progress.
 *   TOTAL   — a finite ceiling on one catalog read. Derived from the worst rate
 *             this path has actually been observed at (1,110 rows/s for the
 *             largest provider catalog -> ~129 s), rounded up. It exists so a
 *             stream that trickles forever still terminates; it is NOT the
 *             budget a healthy read is expected to use. With 289G's batching
 *             (4x fewer mutations, ~256x fewer document writes, writes
 *             overlapped with the read) the measured local path runs at
 *             ~70,000-127,000 rows/s, i.e. seconds, not minutes.
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
     * One controller for the whole read, re-armed as the response makes
     * progress. Aborting it fails the body stream with the reason below, which
     * the row scanner reports verbatim as `catalog stream failed: …`, so the
     * catalog stays PARTIAL/FAILED with the real cause attached.
     */
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | null = null;
    const arm = (ms: number, reason: string) => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => controller.abort(new Error(reason)), Math.max(1, ms));
    };
    const disarm = () => {
      if (timer !== null) clearTimeout(timer);
      timer = null;
    };

    arm(headersMs, `no response headers within ${headersMs} ms`);
    let response: Response;
    try {
      response = await doFetch(finalUrl, {
        headers: { Accept: "application/json" },
        signal: controller.signal,
      });
    } catch (error) {
      disarm();
      throw error;
    }

    if (!response.ok) {
      disarm();
      // The provider explains a rejection in the body; keep it (bounded) so the
      // caller can name the cause instead of only the status.
      let json: unknown;
      try {
        const text = (await response.text()).slice(0, ERROR_BODY_MAX_CHARS);
        json = text.trim() === "" ? undefined : (JSON.parse(text) as unknown);
      } catch {
        json = undefined;
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
       * The body is handed over still guarded: the timer is re-armed for every
       * chunk (silence -> stall), and the total ceiling is enforced on the same
       * controller. When the stream ends — normally or by failure — the guard is
       * disarmed, so a long-lived process never keeps a stray timer alive.
       */
      const guarded: AsyncIterable<Uint8Array | string> = {
        async *[Symbol.asyncIterator]() {
          try {
            for await (const chunk of stream as AsyncIterable<Uint8Array | string>) {
              const left = deadline - Date.now();
              if (left <= 0) {
                controller.abort(new Error(`catalog read exceeded ${timeoutMs} ms`));
              }
              arm(
                Math.min(stallMs, left),
                `no catalog bytes for ${stallMs} ms`,
              );
              yield chunk;
            }
          } finally {
            disarm();
          }
        },
      };
      return { ok: true, status: response.status, body: guarded };
    }

    disarm();
    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { ok: true, status: response.status, json };
  };
}
