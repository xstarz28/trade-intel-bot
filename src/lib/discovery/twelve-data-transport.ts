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

/** Catalog responses are large; the old 10 s budget could abort a healthy read. */
const DEFAULT_TIMEOUT_MS = 30_000;

export type CatalogTransportResult = {
  ok: boolean;
  status: number;
  json?: unknown;
  body?: AsyncIterable<Uint8Array | string>;
};

export type CatalogTransport = (url: string) => Promise<CatalogTransportResult>;

export function createTwelveDataCatalogTransport(options: {
  apiKey: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
}): CatalogTransport {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  return async (url: string): Promise<CatalogTransportResult> => {
    let finalUrl = url;
    if (
      options.apiKey &&
      url.includes("twelvedata.com") &&
      !/[?&]apikey=/.test(url)
    ) {
      finalUrl = `${url}${url.includes("?") ? "&" : "?"}apikey=${encodeURIComponent(options.apiKey)}`;
    }

    const response = await doFetch(finalUrl, {
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });

    if (!response.ok) {
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
      return { ok: true, status: response.status, body: stream };
    }

    let json: unknown;
    try {
      json = await response.json();
    } catch {
      json = undefined;
    }
    return { ok: true, status: response.status, json };
  };
}
