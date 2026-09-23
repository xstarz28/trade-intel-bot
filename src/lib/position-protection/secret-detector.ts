/**
 * Phase 226 — credential-shape detector shared by the runtime hardening
 * pipeline (`NO_SECRETS_IN_ALERT`) and the security audit
 * (`NO_EMBEDDED_SECRETS`).
 *
 * Contract:
 *  - It looks for things shaped like CREDENTIALS, not for the English words
 *    "token"/"secret" (which appear legitimately in market prose and made
 *    the previous stage a permanent false-green).
 *  - It reports WHICH pattern class matched, never the matched text.
 *  - Input that cannot be serialised is a FAIL, not a pass: an object we
 *    cannot inspect is not an object we have verified.
 */

export interface SecretScanResult {
  /** True when at least one credential-shaped pattern matched. */
  found: boolean;
  /** Names of the pattern classes that matched (no values). */
  matched: string[];
  /** False when the value could not be serialised for inspection. */
  inspectable: boolean;
  /** Number of characters inspected (0 when not inspectable). */
  inspectedChars: number;
}

/** Pattern classes. Each is credential-shaped; none is a bare English word. */
export const SECRET_PATTERNS: ReadonlyArray<{ name: string; re: RegExp }> = [
  { name: "aws-access-key-id", re: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/ },
  { name: "stripe-key", re: /\b[sr]k_(?:live|test)_[A-Za-z0-9]{8,}\b/ },
  { name: "github-token", re: /\bgh[pousr]_[A-Za-z0-9]{20,}\b/ },
  { name: "slack-token", re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "google-api-key", re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: "jwt", re: /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/ },
  { name: "bearer-token", re: /\bBearer\s+[A-Za-z0-9_\-.=]{16,}/ },
  { name: "private-key-block", re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
  { name: "credential-assignment", re: /\b(?:api[_-]?key|apikey|secret|token|password|passwd|credential)s?["']?\s*[:=]\s*["']?[A-Za-z0-9_\-./+=]{12,}/i },
  { name: "url-credential-param", re: /[?&](?:api[_-]?key|apikey|token|secret|password)=[^&\s"']{8,}/i },
  { name: "env-reference", re: /\bprocess\.env\.[A-Z0-9_]+/ },
];

function safeSerialize(value: unknown): string | null {
  try {
    if (typeof value === "string") return value;
    const s = JSON.stringify(value);
    return typeof s === "string" ? s : null; // undefined/functions/symbols serialise to undefined
  } catch {
    return null; // circular, BigInt, throwing toJSON
  }
}

export function scanForSecrets(value: unknown): SecretScanResult {
  const serialized = safeSerialize(value);
  if (serialized === null) {
    return { found: false, matched: [], inspectable: false, inspectedChars: 0 };
  }
  const matched = SECRET_PATTERNS.filter((p) => p.re.test(serialized)).map((p) => p.name);
  return { found: matched.length > 0, matched, inspectable: true, inspectedChars: serialized.length };
}

/** Human-readable, value-free explanation for stage/check output. */
export function describeSecretScan(scan: SecretScanResult, subject: string): string {
  if (!scan.inspectable) return `${subject} could not be serialised for inspection — cannot verify it is secret-free.`;
  if (scan.found) return `${subject} contains credential-shaped content (${scan.matched.join(", ")}). Value withheld.`;
  return `${subject} inspected (${scan.inspectedChars} chars, ${SECRET_PATTERNS.length} pattern classes): no credential-shaped content.`;
}
