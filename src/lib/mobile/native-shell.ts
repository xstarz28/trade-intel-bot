/**
 * Phase 179 — native shell integration (Android + iOS).
 *
 * ONE implementation serves both platforms. Everything here is a no-op in a
 * normal browser, so the web build is completely unaffected: the module never
 * imports a Capacitor plugin unless it is actually running inside the native
 * shell.
 *
 * Deliberately NOT here:
 *   - no provider/network logic (all acquisition stays server-side),
 *   - no auth logic (the web session flow is reused verbatim),
 *   - no routing replacement (BrowserRouter is preserved).
 */

/** True only inside the Capacitor WebView. */
export function isNativeShell(): boolean {
  if (typeof window === "undefined") return false;
  const cap = (window as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor;
  return typeof cap?.isNativePlatform === "function" ? cap.isNativePlatform() : false;
}

/** "android" | "ios" | "web" — reported by the shell, never sniffed from UA. */
export function nativePlatform(): "android" | "ios" | "web" {
  if (typeof window === "undefined") return "web";
  const cap = (window as { Capacitor?: { getPlatform?: () => string } }).Capacitor;
  const p = typeof cap?.getPlatform === "function" ? cap.getPlatform() : "web";
  return p === "android" || p === "ios" ? p : "web";
}

/**
 * Routes the Android hardware BACK button may exit the app from.
 *
 * Anywhere else it must pop history instead, so back does not kill the app
 * mid-flow. `/auth` is included because backing out of sign-in should leave
 * the app rather than bounce to a protected route.
 */
export const EXIT_ROUTES: ReadonlySet<string> = new Set(["/", "/auth"]);

/**
 * Decide what the Android back button does for a given route.
 *
 * Pure and exported so it is testable without a device — the actual button
 * only dispatches to this.
 */
export function backButtonAction(
  pathname: string,
  canGoBack: boolean,
): "exit" | "back" {
  if (canGoBack) return "back";
  return EXIT_ROUTES.has(pathname) ? "exit" : "back";
}

/**
 * Initialise native-only behaviour. Safe to call unconditionally.
 *
 * Returns a cleanup function so tests and hot-reload do not stack listeners.
 */
export async function initNativeShell(): Promise<() => void> {
  if (!isNativeShell()) return () => {};

  const cleanups: Array<() => void> = [];

  try {
    const { StatusBar, Style } = await import("@capacitor/status-bar");
    // Dark chrome to match the app shell; the status bar must not overlay
    // content, which would put text under the notch.
    await StatusBar.setStyle({ style: Style.Dark });
    await StatusBar.setOverlaysWebView({ overlay: false });
    if (nativePlatform() === "android") {
      await StatusBar.setBackgroundColor({ color: "#0b1220" });
    }
  } catch {
    // A missing plugin must never break app start.
  }

  try {
    const { SplashScreen } = await import("@capacitor/splash-screen");
    // Hide only once React has painted, so the user never sees a white flash.
    await SplashScreen.hide();
  } catch {
    /* no-op */
  }

  try {
    const { App } = await import("@capacitor/app");

    // Android hardware back button.
    const backHandle = await App.addListener("backButton", ({ canGoBack }) => {
      const action = backButtonAction(window.location.pathname, canGoBack);
      if (action === "exit") {
        void App.exitApp();
      } else {
        window.history.back();
      }
    });
    cleanups.push(() => void backHandle.remove());

    // Deep links / universal links that arrive while the app is running.
    // Only the PATH is adopted, and only from the app's own origin — an
    // absolute URL from elsewhere must never drive in-app navigation.
    const urlHandle = await App.addListener("appUrlOpen", ({ url }) => {
      const path = safeInAppPath(url);
      if (path) window.history.pushState({}, "", path);
    });
    cleanups.push(() => void urlHandle.remove());
  } catch {
    /* no-op */
  }

  return () => {
    for (const c of cleanups) c();
  };
}

/**
 * Extract a same-app path from a deep link, or null if it is not safe.
 *
 * Mirrors the Phase 169b redirect rules: only same-origin, path-only
 * destinations are accepted. A protocol-relative (`//evil.com`) or absolute
 * external URL returns null, so a malicious link cannot use the app as an
 * open redirect.
 */
export function safeInAppPath(rawUrl: string): string | null {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return null;

  // Custom-scheme links (app.xstarz.analysis://dashboard) carry the route in
  // the host+path portion.
  let candidate = rawUrl;
  try {
    const parsed = new URL(rawUrl);
    const isHttp = parsed.protocol === "http:" || parsed.protocol === "https:";
    const isAppScheme = parsed.protocol.startsWith("app.xstarz") || parsed.protocol === "capacitor:";
    if (!isHttp && !isAppScheme) return null;
    candidate = `${parsed.pathname}${parsed.search}${parsed.hash}`;
    // For a custom scheme the route lands in the HOST component, and
    // `pathname` is "" (not "/") — `app.xstarz.analysis://dashboard` parses
    // as hostname "dashboard" with an empty path. Rebuild the route from the
    // host so custom-scheme deep links resolve to a real in-app path.
    if (isAppScheme && parsed.hostname) {
      const tail = parsed.pathname === "/" ? "" : parsed.pathname;
      candidate = `/${parsed.hostname}${tail}${parsed.search}${parsed.hash}`;
    }
  } catch {
    return null;
  }

  // Reject anything that is not a clean single-slash absolute path.
  if (!candidate.startsWith("/") || candidate.startsWith("//")) return null;
  if (candidate.includes("\\")) return null;
  return candidate;
}
