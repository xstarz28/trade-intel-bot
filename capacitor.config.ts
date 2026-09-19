/**
 * Phase 179 — Capacitor configuration (Android + iOS).
 *
 * ARCHITECTURE: the existing Vite/React app stays the single product UI.
 * Capacitor wraps the SAME production `dist/` bundle in a native shell on both
 * platforms — there is no second UI implementation and no React Native
 * rewrite, so a change to the web app reaches Android and iOS with one
 * `npm run mobile:sync`.
 *
 * The app is served from the native WebView over a real origin
 * (`https://localhost` on Android, `capacitor://localhost` on iOS) rather than
 * from `file://`. That matters for three existing behaviours:
 *
 *   1. BrowserRouter keeps working. `file://` has no path semantics, which
 *      would have forced HashRouter or MemoryRouter — both of which Phase 169
 *      explicitly rejected because they break `?returnTo` and deep links.
 *   2. `localStorage` (the `freebuff:locale` key) gets a stable origin instead
 *      of being scoped to an opaque `file://` origin.
 *   3. Convex WebSocket/HTTPS calls run under a secure context.
 *
 * No provider credentials appear here or anywhere in the native projects: the
 * mobile clients talk only to Convex, exactly as the web client does.
 */

import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  // Android applicationId AND iOS bundle identifier share this reverse-DNS id.
  appId: "app.xstarz.analysis",
  appName: "Xstarz Analysis",

  // The Vite production build output. `npm run mobile:sync` copies this into
  // both native projects, so the web build is the single source of truth.
  webDir: "dist",

  server: {
    // Serve over http(s)-style schemes so History API routing works.
    androidScheme: "https",
    iosScheme: "capacitor",
    // NOTE: no `url` key. Setting `server.url` would make the packaged app
    // load from a remote/dev server — exactly the localhost dependency this
    // phase forbids in a production artifact.
  },

  android: {
    // Release builds must never ship a debuggable WebView.
    webContentsDebuggingEnabled: false,
  },

  ios: {
    // Match the app's dark chrome while the web layer boots.
    backgroundColor: "#0b1220",
    contentInset: "always",
  },

  plugins: {
    SplashScreen: {
      launchShowDuration: 800,
      launchAutoHide: true,
      backgroundColor: "#0b1220",
      showSpinner: false,
      androidScaleType: "CENTER_CROP",
    },
    StatusBar: {
      style: "DARK",
      backgroundColor: "#0b1220",
    },
    Keyboard: {
      // Resize the web view so focused inputs are never hidden behind the
      // on-screen keyboard.
      resize: "native",
      resizeOnFullScreen: true,
    },
  },
};

export default config;
