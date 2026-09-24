/**
 * Phase 182 — desktop shell detection (Tauri, Windows first).
 *
 * The desktop app wraps the SAME production web build that the browser,
 * Android and iOS load. This module exists only so the UI can answer
 * "am I running inside the desktop shell?" — it must never become a place
 * where desktop grows its own behaviour.
 *
 * Deliberately mirrors `src/lib/mobile/native-shell.ts` in shape and intent:
 *   * no provider access (all acquisition stays server-side in Convex),
 *   * no second analysis engine,
 *   * no routing changes — BrowserRouter is preserved on every surface.
 */

/** Surfaces the same product is distributed on. */
export type Surface = "web" | "android" | "ios" | "desktop";

interface TauriGlobals {
  // Tauri 2 exposes these on the window object inside the webview.
  __TAURI_INTERNALS__?: unknown;
  __TAURI__?: unknown;
}

/**
 * True when running inside the Tauri desktop shell.
 *
 * Detection is feature-based rather than user-agent based: the WebView2
 * user-agent on Windows is essentially Edge's, so sniffing it would both miss
 * the desktop app and misclassify ordinary Edge users as desktop.
 */
export function isDesktopShell(): boolean {
  if (typeof window === "undefined") return false;
  const w = window as unknown as TauriGlobals;
  return w.__TAURI_INTERNALS__ !== undefined || w.__TAURI__ !== undefined;
}

/**
 * The desktop OS family, when known.
 *
 * Windows is the first desktop distribution target; macOS and Linux are
 * reported honestly rather than being guessed at or silently treated as
 * Windows.
 */
export function desktopPlatform(): "windows" | "macos" | "linux" | "unknown" {
  if (!isDesktopShell() || typeof navigator === "undefined") return "unknown";
  const ua = navigator.userAgent;
  if (/Windows/i.test(ua)) return "windows";
  if (/Mac OS X|Macintosh/i.test(ua)) return "macos";
  if (/Linux|X11/i.test(ua)) return "linux";
  return "unknown";
}

/**
 * Whether a URL may be handed to the operating system's default browser.
 *
 * A desktop wrapper introduces an external-navigation boundary that does not
 * exist in a browser tab: a link can leave the webview entirely and become an
 * OS-level "open this" request. Phase 169b hardened in-app redirects, so this
 * is the same guarantee applied at the shell edge, and it is intentionally
 * stricter — only explicitly allowed https hosts.
 *
 * Kept deliberately in lockstep with `is_allowed_external_url` in
 * `src-tauri/src/lib.rs`. The Rust side is the real enforcement point (web
 * content cannot bypass it); this mirror lets the UI avoid rendering a link
 * the shell would refuse, and lets the rule be tested deterministically.
 */
const ALLOWED_EXTERNAL_HOSTS: readonly string[] = [];

export function isAllowedExternalUrl(raw: string): boolean {
  const trimmed = raw.trim();

  // Only https is ever eligible. javascript:/data:/file: are code and
  // credential exfiltration vectors; plain http: is downgradeable.
  if (!trimmed.toLowerCase().startsWith("https://")) return false;

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    return false;
  }

  // Embedded credentials (user:pass@host) are never legitimate here.
  if (url.username !== "" || url.password !== "") return false;

  const host = url.hostname.toLowerCase();
  if (host === "") return false;

  // Exact host or a true subdomain. Substring matching would accept
  // "xstarz.app.evil.com" for an allowed "xstarz.app".
  return ALLOWED_EXTERNAL_HOSTS.some(
    (allowed) => host === allowed.toLowerCase() || host.endsWith(`.${allowed.toLowerCase()}`),
  );
}

/**
 * Marks <html> so surface-specific CSS can apply.
 *
 * Styling only — never a behavioural branch. Analysis, entitlement,
 * provenance, cache semantics and routing are identical on every surface.
 */
export function initDesktopShell(): void {
  if (!isDesktopShell() || typeof document === "undefined") return;
  document.documentElement.classList.add("desktop-shell", `platform-${desktopPlatform()}`);
}
