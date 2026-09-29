/**
 * Phase 289E — streaming row reader for Twelve Data reference catalogs.
 *
 * WHY THIS EXISTS
 * ---------------
 * The deployed `marketData:discoverTwelveDataInstruments` action was killed by
 * Convex's 512 MB Node.js action limit:
 *
 *   `Node.js action execution ran out of memory (maximum memory usage: 512 MB)`
 *
 * The provider's catalog endpoints do NOT honour `page`: requesting `page=2`
 * returns the SAME complete catalog as page 1 (verified against the live
 * endpoint for `/stocks`, `/forex_pairs` and `/commodities`). So "one page" is
 * the whole catalog — for `/stocks` that is ~124k rows / ~30 MB of JSON — and
 * `res.json()` materializes the entire body text AND the entire parsed object
 * graph inside the action before a single row is normalized.
 *
 * This module reads the same provider JSON incrementally: it walks the body as
 * it arrives, hands each `data` array element to the caller as soon as the
 * element is complete, and keeps only the element currently being read. Peak
 * retained state is one row plus one transport chunk — never the raw catalog.
 *
 * HONESTY RULES
 *   - Every row is `JSON.parse`d from its exact provider text: same values, same
 *     key order semantics, no coercion, no synthesis, no skipped/renamed field.
 *   - A truncated or malformed body is an explicit FAILURE, never a short read
 *     presented as a complete catalog.
 *   - The provider's own `status`/`message`/`count` fields are read verbatim so a
 *     rejection keeps the provider's wording and the total it reported.
 */

export type CatalogRowScanResult =
  | {
      ok: true;
      rowsSeen: number;
      totalCount?: number;
      status?: string;
      message?: string;
    }
  | { ok: false; error: string };

type Mode =
  | "start"
  | "member"
  | "key"
  | "colon"
  | "value"
  | "data"
  | "scalar"
  | "skip"
  | "end";

const isWhitespace = (c: string) => c === " " || c === "\n" || c === "\r" || c === "\t";

/**
 * Read a Twelve Data catalog body row-by-row.
 *
 * `onRow` is called once per `data` array element, in the provider's own order,
 * with the element exactly as the provider sent it.
 */
export async function scanTwelveDataCatalogRows(
  body: AsyncIterable<Uint8Array | string>,
  onRow: (row: unknown) => void,
  /**
   * Phase 289F — awaited after each transport chunk is processed. A caller that
   * persists rows uses this as backpressure: its pending-write queue is drained
   * before more body text is read, so a 30 MB catalog never turns into 30 MB of
   * queued writes. Purely optional — every existing caller passes nothing.
   */
  hooks: { onChunk?: () => Promise<void> } = {},
): Promise<CatalogRowScanResult> {
  const decoder = new TextDecoder();

  let mode: Mode = "start";
  let pendingKey: string | null = null;
  let keyChars = "";
  let scalarChars = "";
  let scalarQuoted = false;
  let scalarEscaped = false;

  let rowChars: string[] = [];
  let rowDepth = 0;
  let rowInString = false;
  let rowEscaped = false;
  let rowStarted = false;

  let skipDepth = 0;
  let skipInString = false;
  let skipEscaped = false;

  let rowsSeen = 0;
  let sawDataArray = false;
  let totalCount: number | undefined;
  let status: string | undefined;
  let message: string | undefined;
  let failure: string | null = null;

  const decodeScalar = (raw: string): string | undefined => {
    const text = raw.trim();
    if (text === "") return undefined;
    if (text.startsWith('"')) {
      try {
        const parsed = JSON.parse(text) as unknown;
        return typeof parsed === "string" ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
    return text;
  };

  const finishScalar = () => {
    const raw = scalarQuoted ? scalarChars : scalarChars.trim();
    const key = pendingKey;
    scalarChars = "";
    scalarQuoted = false;
    scalarEscaped = false;
    pendingKey = null;
    if (key === null) return;
    if (key === "count") {
      const n = Number(raw.trim());
      if (Number.isFinite(n) && n >= 0) totalCount = n;
      return;
    }
    const value = decodeScalar(raw);
    if (value === undefined) return;
    if (key === "status") status = value;
    if (key === "message") message = value;
  };

  const finishRow = (text: string) => {
    const raw = text.trim();
    rowChars = [];
    rowStarted = false;
    if (raw === "") return;
    try {
      onRow(JSON.parse(raw) as unknown);
      rowsSeen += 1;
    } catch {
      failure = "catalog row is not valid JSON";
    }
  };

  const process = (text: string) => {
    for (let i = 0; i < text.length && failure === null; i += 1) {
      const c = text[i];

      switch (mode) {
        case "start": {
          if (isWhitespace(c) || c === "\uFEFF") continue;
          if (c === "{") {
            mode = "member";
            continue;
          }
          failure = "catalog payload is not an object";
          continue;
        }

        case "member": {
          if (isWhitespace(c) || c === ",") continue;
          if (c === "}") {
            mode = "end";
            continue;
          }
          if (c === '"') {
            keyChars = "";
            mode = "key";
            continue;
          }
          failure = "catalog payload is not an object";
          continue;
        }

        case "key": {
          if (c === '"') {
            try {
              const decoded = JSON.parse(`"${keyChars}"`) as unknown;
              pendingKey = typeof decoded === "string" ? decoded : null;
            } catch {
              pendingKey = null;
            }
            mode = "colon";
            continue;
          }
          keyChars += c;
          continue;
        }

        case "colon": {
          if (isWhitespace(c)) continue;
          if (c === ":") {
            mode = "value";
            continue;
          }
          failure = "catalog payload is malformed";
          continue;
        }

        case "value": {
          if (isWhitespace(c)) continue;
          if (pendingKey === "data") {
            if (c === "[") {
              sawDataArray = true;
              mode = "data";
              continue;
            }
            failure = "catalog returned no instrument array";
            continue;
          }
          if (c === "{" || c === "[") {
            skipDepth = 1;
            skipInString = false;
            skipEscaped = false;
            mode = "skip";
            continue;
          }
          // A string or bare scalar at the top level (status / count / message).
          scalarChars = "";
          scalarQuoted = c === '"';
          scalarEscaped = false;
          if (scalarQuoted) scalarChars += c;
          else scalarChars += c;
          mode = "scalar";
          continue;
        }

        case "scalar": {
          if (scalarQuoted) {
            scalarChars += c;
            if (scalarEscaped) {
              scalarEscaped = false;
              continue;
            }
            if (c === "\\") {
              scalarEscaped = true;
              continue;
            }
            if (c === '"') {
              finishScalar();
              mode = "member";
            }
            continue;
          }
          if (c === "," || c === "}" || isWhitespace(c)) {
            finishScalar();
            mode = "member";
            // Re-handle the delimiter inside `member` on the next pass.
            continue;
          }
          scalarChars += c;
          continue;
        }

        case "skip": {
          if (skipInString) {
            if (skipEscaped) skipEscaped = false;
            else if (c === "\\") skipEscaped = true;
            else if (c === '"') skipInString = false;
            continue;
          }
          if (c === '"') {
            skipInString = true;
            continue;
          }
          if (c === "{" || c === "[") {
            skipDepth += 1;
            continue;
          }
          if (c === "}" || c === "]") {
            skipDepth -= 1;
            if (skipDepth === 0) mode = "member";
            continue;
          }
          continue;
        }

        case "data": {
          if (!rowStarted) {
            if (isWhitespace(c) || c === ",") continue;
            if (c === "]") {
              mode = "member";
              continue;
            }
            rowStarted = true;
            rowDepth = 0;
            rowInString = false;
            rowEscaped = false;
            rowChars = [];
          }

          if (rowInString) {
            rowChars.push(c);
            if (rowEscaped) rowEscaped = false;
            else if (c === "\\") rowEscaped = true;
            else if (c === '"') rowInString = false;
            continue;
          }

          if (c === '"') {
            rowInString = true;
            rowChars.push(c);
            continue;
          }

          if (c === "{" || c === "[") {
            rowDepth += 1;
            rowChars.push(c);
            continue;
          }

          if (c === "}" || c === "]") {
            // The closing bracket belongs to the row text: without it the
            // element is not valid JSON.
            rowChars.push(c);
            rowDepth -= 1;
            if (rowDepth <= 0) {
              finishRow(rowChars.join(""));
              continue;
            }
            continue;
          }

          if (rowDepth === 0) {
            // A bare scalar element (number / true / false / null).
            if (c === ",") {
              finishRow(rowChars.join(""));
              continue;
            }
            rowChars.push(c);
            continue;
          }

          rowChars.push(c);
          continue;
        }

        case "end": {
          // Nothing follows the top-level object.
          if (isWhitespace(c)) continue;
          continue;
        }
      }
    }
  };

  let carry = "";
  try {
    for await (const chunk of body) {
      const text =
        typeof chunk === "string" ? chunk : decoder.decode(chunk, { stream: true });
      if (text === "") continue;
      let slice = carry + text;
      // A trailing high surrogate would be split across chunks; hold it back so
      // multi-byte characters are never corrupted.
      const lastUnit = slice.charCodeAt(slice.length - 1);
      if (lastUnit >= 0xd800 && lastUnit <= 0xdbff) {
        carry = slice.slice(-1);
        slice = slice.slice(0, -1);
      } else {
        carry = "";
      }
      process(slice);
      if (hooks.onChunk) await hooks.onChunk();
      if (failure !== null) return { ok: false, error: failure };
    }
  } catch (error) {
    return {
      ok: false,
      error: `catalog stream failed: ${
        error instanceof Error ? error.message : "transport error"
      }`,
    };
  }

  if (carry !== "") process(carry);
  if (failure !== null) return { ok: false, error: failure };

  // `mode` is mutated inside `process`, so read it once into a value the
  // compiler will not narrow to the "start" literal it saw at declaration.
  const finalMode = mode as Mode;
  if (finalMode === "data") return { ok: false, error: "catalog payload ended inside the data array" };
  if (finalMode === "start") return { ok: false, error: "catalog payload is not an object" };
  if (finalMode !== "end" && finalMode !== "member") {
    return { ok: false, error: "catalog payload ended unexpectedly" };
  }

  if (status === "error") {
    return { ok: false, error: message ?? "provider returned a catalog error" };
  }
  if (!sawDataArray) return { ok: false, error: "catalog returned no instrument array" };

  return {
    ok: true,
    rowsSeen,
    ...(totalCount !== undefined ? { totalCount } : {}),
    ...(status !== undefined ? { status } : {}),
    ...(message !== undefined ? { message } : {}),
  };
}
