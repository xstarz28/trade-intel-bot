/**
 * Phase 194 — the single authoritative hardcoded-copy detector.
 *
 * WHY THIS MODULE EXISTS
 * ----------------------
 * The detection logic was written inside `page-localization-guard.phase189`
 * and grew through Phases 191 and 193. Phase 194 needs the SAME logic from a
 * reporting script as well as from the guard. Copying it would create a second
 * scanner that drifts from the first — the guard would pass while the report
 * disagreed, and neither would be trustworthy.
 *
 * So the functions were MOVED here unchanged and both callers import them.
 * There is exactly one definition of "hardcoded user-facing copy" in the
 * codebase, and one place to fix it.
 *
 * SCOPE AND HONESTY
 * -----------------
 * This is a syntactic detector, not a compiler. It is deliberately tuned for
 * ZERO false positives on the current tree, because a noisy guard gets
 * disabled and a disabled guard protects nothing. It therefore accepts false
 * negatives: passing it means "no *detectable* hardcoded copy", not "provably
 * fully localized". Rendering correctness is covered by component tests and
 * HUMAN UAT.
 */

/** Proper nouns that must NOT be translated (invariant 10). */
export const BRAND_LITERALS = new Set(["Xstarz Analysis"]);

/**
 * Technical / financial notation that stays untranslated in every locale.
 *
 * These are product NOTATION, not prose. A German trader reads "FVG" and
 * "H4", not a translated paraphrase — translating them would damage
 * comprehension, not improve it. The i18n contract lists them explicitly.
 *
 * `LIVE`/`STALE` are a deliberate nuance: the TOKEN stays, and the sentence
 * that EXPLAINS the token is what gets translated (see Phase 193 D1).
 */
export const TECHNICAL_TOKENS = new Set([
  // Market-structure / analysis notation
  "BOS", "CHOCH", "FVG", "HTF", "LTF", "MTF", "OHLCV", "RR",
  // Instruments and indices
  "DXY", "WTI", "VIX", "USD", "EUR", "JPY", "GBP", "BTC", "ETH",
  // Timeframes
  "W1", "D1", "H4", "H1", "M15", "M5", "M1",
  // Risk notation
  "SL", "TP",
  // Data-provenance status tokens (the legend explaining them IS translated)
  "LIVE", "STALE",
  // Protocol / format identifiers
  "OTP", "API", "URL", "CSV", "JSON", "UTC", "ID", "PNL", "APK", "PWA",
]);

/** Strip comments so commented-out copy is never reported as shipped. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Extract JSX text nodes: the literal prose a user actually reads.
 *
 * Deliberately narrow. It looks for `>Some words<` spanning a tag boundary
 * and ignores anything containing `{`, because that is an expression rather
 * than a literal. False negatives are acceptable here; false positives would
 * make the guard noisy and it would get disabled.
 */
export function jsxTextNodes(source: string): string[] {
  const withoutComments = stripComments(source);

  const found: string[] = [];
  // Require a CLOSING tag after the text (`>text</`). Without this, TypeScript
  // generics such as `useRef<Foo>(x); ... useRef<` produce `>...<` pairs that
  // look like text nodes but are ordinary code.
  const re = />([^<>{}]+)<\//g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const text = m[1].replace(/\s+/g, " ").trim();
    if (!text) continue;
    // Require two consecutive words: single tokens are usually punctuation,
    // separators, units or symbols rather than translatable sentences.
    if (!/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(text)) continue;
    // Ignore anything that is clearly not prose.
    if (/^[\d\s.,:%/+-]+$/.test(text)) continue;
    // The brand is a proper noun and must stay untranslated (invariant 10).
    if (BRAND_LITERALS.has(text)) continue;
    found.push(text);
  }
  return found;
}

/**
 * An instrument symbol used as an input example: `EUR/USD`, `BTC/USDT`,
 * `XAU/USD`, `BTC-USD`.
 *
 * Phase 194 — these are provider-native INSTRUMENT IDENTIFIERS, not copy.
 * A French or Japanese trader types `EUR/USD` exactly as an English one does;
 * "translating" the example would teach the wrong symbol and break the very
 * identity rule the product is built on (invariant 1: provider-native identity
 * exact, no symbol substitution). So they are notation, and stay untranslated.
 */
function isInstrumentSymbol(value: string): boolean {
  return /^[A-Z]{2,6}\s*[/-]\s*[A-Z]{2,6}$/.test(value.trim());
}

/** Literal user-facing attribute values (placeholder / aria-label / title). */
export function hardcodedAttributes(source: string): string[] {
  const out: string[] = [];
  const re = /\b(placeholder|aria-label|title)\s*=\s*"([^"]{3,})"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source)) !== null) {
    const value = m[2].trim();
    if (!/[A-Za-z]{3,}/.test(value)) continue;
    if (isInstrumentSymbol(value)) continue;
    out.push(`${m[1]}="${value}"`);
  }
  return out;
}

/**
 * Phase 193 — hardcoded STATUS TOKENS inside JSX expressions.
 *
 * `jsxTextNodes` deliberately requires two consecutive words, because single
 * tokens are usually punctuation, units or symbols. That rule has a blind
 * spot: a one-word *claim* rendered from an expression, e.g.
 *
 *   {isLive ? "LIVE" : isStale ? "STALE" : "—"}
 *
 * MarketOverviewPanel shipped exactly that while `market.live` / `market.stale`
 * sat translated in all nine locales.
 *
 * This detector is deliberately NARROW: only ALL-CAPS alphabetic tokens of
 * 3-12 characters appearing as string literals inside a JSX expression
 * container. It does not fire on imports, enum comparisons, object keys or
 * `case "LIVE":` — only on values being rendered.
 */
export function hardcodedStatusTokens(source: string): string[] {
  const withoutComments = stripComments(source);
  const out: string[] = [];
  const re = /\{([^{}]*?"[A-Z][A-Z_]{2,11}"[^{}]*?)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const body = m[1];
    const tokenMatch = /"([A-Z][A-Z_]{2,11})"/.exec(body);
    if (!tokenMatch) continue;
    const token = tokenMatch[1];
    if (TECHNICAL_TOKENS.has(token)) continue;
    // Phase 194 — OBJECT LITERAL PROPERTY, not rendered text.
    //
    //   quality: "DEGRADED" as const,
    //   overallQuality: fundamentals?.available ? "VERIFIED" : "UNAVAILABLE",
    //
    // These build a DATA object that the engine consumes; the words never
    // reach the DOM. They live inside braces and can contain a ternary, so
    // they look exactly like a JSX expression to a brace-matcher. Requiring
    // the token NOT to be preceded by `identifier:` on its own line removes
    // the whole class without weakening detection of real rendered copy.
    if (new RegExp(`\\b[A-Za-z_$][\\w$]*\\s*:\\s*[^,;{}]*"${token}"`).test(body)) continue;
    // `as const` / `satisfies` annotations are type-level, never rendered.
    if (new RegExp(`"${token}"\\s*(?:as\\s+const|satisfies\\b)`).test(body)) continue;
    // Type unions / declarations, not rendered values.
    if (/^[\s\w]*:\s*"/.test(body) || body.includes("|")) continue;
    // Only flag values produced by a render expression.
    if (!/\?|&&/.test(body)) continue;
    // A COMPARISON against the token selects behaviour (a CSS class, a
    // colour); it does not render the word. `x === "SUPPORTING" ? cls : cls`
    // is correct code.
    if (new RegExp(`[=!]==?\\s*"${token}"`).test(body)) continue;
    // Class-name payloads are styling, not copy.
    if (/\b(?:text|bg|border|fill|stroke)-/.test(body)) continue;
    // The token is an ENUM ARGUMENT handed to a mapper that returns translated
    // copy — `mapSeverity("CAUTION", t)`. That is the CORRECT path.
    if (/\bmap[A-Za-z]*\s*\(/.test(body)) continue;
    // `?? "NONE"` supplies a DATA default that is then mapped downstream.
    if (new RegExp(`\\?\\?\\s*"${token}"`).test(body)) continue;
    // Same for a constant lookup keyed by the token: `COLORS.CAUTION`.
    if (new RegExp(`[A-Z_]+\\.${token}\\b`).test(body)) continue;
    // Ignore non-render contexts that legitimately use caps string literals.
    const context = withoutComments.slice(Math.max(0, m.index - 60), m.index);
    if (/(case|===|!==|includes|Set\(|\bkey=|import|from|type |enum )\s*$/.test(context)) continue;
    if (/[.:]\s*$/.test(context)) continue;
    out.push(`{…"${token}"…}`);
  }
  return out;
}

/**
 * Phase 195 — SINGLE-WORD JSX prose.
 *
 * `jsxTextNodes` requires two consecutive words, so a lowercase one-word label
 * — `entry`, `support`, `invalidation`, `supporting:` — was never reported.
 * AnalysisResult alone carried 109 of them: section headings, evidence labels
 * and, most seriously, the `entry` / `stop loss` / `take profit` trade-plan
 * captions. Those are risk semantics, not decoration.
 *
 * The rule must not fire on notation, so a token is only prose when it is:
 *   - alphabetic (hyphens allowed for `multi-timeframe`, `trade-plan`)
 *   - at least 4 characters (drops `vs`, `EPS`, `TVL`, `COT`, `L/S`)
 *   - not in TECHNICAL_TOKENS, and not an indicator call like `RSI(14)`
 *   - not ALL-CAPS (handled by hardcodedStatusTokens, avoids double-counting)
 *
 * A trailing colon is stripped before the check: `supporting:` is the label
 * `supporting`, and a colon does not make it notation.
 */
export function singleWordJsxProse(source: string): string[] {
  const withoutComments = stripComments(source);
  const out: string[] = [];
  const re = />([^<>{}]+)</g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(withoutComments)) !== null) {
    const raw = m[1].replace(/\s+/g, " ").trim();
    if (!raw) continue;
    // Multi-word prose is already covered; do not report it twice.
    if (/[A-Za-z]{2,}\s+[A-Za-z]{2,}/.test(raw)) continue;
    // Strip decorative leading glyphs and a trailing colon.
    const text = raw.replace(/^[^\w(]+/, "").replace(/:$/, "").trim();
    if (!text) continue;
    // Indicator/period notation: RSI(14), SMA(50), ATR(14), unlocks (30d).
    if (/\(/.test(text)) continue;
    // Pure notation, units, symbols, numbers.
    if (!/^[A-Za-z][A-Za-z-]{3,}$/.test(text)) continue;
    if (TECHNICAL_TOKENS.has(text.toUpperCase())) continue;
    // ALL-CAPS tokens belong to hardcodedStatusTokens.
    if (text === text.toUpperCase()) continue;
    if (BRAND_LITERALS.has(text)) continue;
    out.push(text);
  }
  return out;
}

/** Every detectable violation in one source file. */
export function detectHardcodedCopy(source: string): string[] {
  return [
    ...jsxTextNodes(source),
    ...hardcodedAttributes(source),
    ...hardcodedStatusTokens(source),
    ...singleWordJsxProse(source),
  ];
}
