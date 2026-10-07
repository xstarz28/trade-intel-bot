import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "node:child_process";
import { defineConfig, type Plugin } from "vite";
import {
  buildInfoJson,
  buildInfoMetaTags,
  buildProvenance,
  resolveBuildCommit,
  resolveBuildRef,
} from "./src/lib/build-provenance";

/**
 * Phase 180 — build provenance.
 *
 * Production must be traceable to an exact commit, so a deployed bug can be
 * matched to source without guessing which revision shipped. Only the short
 * SHA, branch and commit timestamp are exposed: no author, no message, no
 * remote URL, nothing that could carry a credential.
 *
 * Falls back to "unknown" outside a git checkout (e.g. a CI tarball build)
 * rather than failing the build.
 *
 * REPRODUCIBILITY (Phase 181).
 * The build time is the COMMIT timestamp, never `new Date()`. Wall-clock time
 * would make every build of the same source produce a different artifact,
 * which destroys the one property that makes provenance worth having: the
 * ability to rebuild a commit and confirm byte-for-byte that a deployed
 * artifact really came from it. An RC you cannot re-derive is an RC you are
 * trusting on faith.
 *
 * CI override: SOURCE_DATE_EPOCH (the reproducible-builds standard) is
 * honoured when set, so a tarball build with no git metadata is still
 * deterministic.
 *
 * Phase 299 — the SAME derivation now also emits `dist/build-info.json` and
 * `<meta name="xstarz-build-*">` tags, so a deployed artifact answers "which
 * commit am I?" over plain HTTP (see `src/lib/build-provenance.ts`). The ref
 * and commit come from `XSTARZ_BUILD_REF` / `SOURCE_REF` / `GITHUB_REF_NAME`
 * and `XSTARZ_BUILD_COMMIT` / `GITHUB_SHA` first, because a CI checkout is
 * usually detached and `git rev-parse --abbrev-ref HEAD` then answers "HEAD".
 */
function gitInfo() {
  const read = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "";
    }
  };

  const envCommit = resolveBuildCommit(process.env);
  const envRef = resolveBuildRef(process.env);

  const gitCommit = read("git rev-parse HEAD");
  const commit = envCommit || gitCommit || "unknown";

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const commitEpoch = epoch ?? read("git log -1 --format=%ct");
  const time = /^\d+$/.test(commitEpoch)
    ? new Date(Number(commitEpoch) * 1000).toISOString()
    : "unknown";

  // Detached HEAD reports the literal "HEAD"; recording that as the branch
  // would be a claim no reader could act on, so it degrades to `unknown`
  // rather than to a plausible-looking wrong answer.
  const gitBranch = read("git rev-parse --abbrev-ref HEAD");
  const branch =
    envRef ||
    (gitBranch && gitBranch !== "HEAD" ? gitBranch : "") ||
    "unknown";

  const source = envCommit
    ? ("xstarz-env" as const)
    : envRef
      ? ("ci-env" as const)
      : commit !== "unknown"
        ? ("git" as const)
        : ("unknown" as const);

  // An uncommitted tree does not correspond to the commit it names, so the
  // artifact says so rather than implying reproducibility it does not have.
  const status = read("git status --porcelain");
  const worktreeDirty =
    gitCommit.length === 0 ? null : status.trim().length > 0;

  return buildProvenance({ commit, branch, builtAt: time, source, worktreeDirty });
}

const BUILD = gitInfo();

/**
 * Phase 299 — provenance at the artifact boundary.
 *
 * The metadata is emitted where a deployed artifact can be inspected without
 * running it: a static JSON file next to `index.html`, and `<meta>` tags inside
 * it. Both are generated from the same object the runtime logs, so the three
 * surfaces cannot disagree.
 */
function buildProvenancePlugin(): Plugin {
  return {
    name: "xstarz-build-provenance",
    transformIndexHtml() {
      return buildInfoMetaTags(BUILD).map((tag) => ({
        tag: "meta",
        attrs: { name: tag.name, content: tag.content },
        injectTo: "head" as const,
      }));
    },
    generateBundle() {
      this.emitFile({
        type: "asset",
        fileName: "build-info.json",
        source: buildInfoJson(BUILD),
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  // Asset base.
  //
  // Relative ('./') is required by the EDITOR PREVIEW iframe so asset URLs
  // resolve inside the frame instead of leaking to the parent domain. That is
  // a dev-time concern only.
  //
  // Absolute ('/') is required by every real deployment target, because the
  // app uses BrowserRouter:
  //
  //   Phase 179 (mobile) — Capacitor serves over a real origin, so a deep
  //   link to /dashboard resolves './assets/x.js' against '/dashboard/'.
  //
  //   Phase 180 (web hosting) — the SAME bug exists on production hosting and
  //   is worse there, because the SPA rewrite ('/*' -> index.html) makes
  //   /dashboard/assets/x.js return 200 with HTML instead of 404. The browser
  //   then refuses the module ("Failed to load module script") and renders a
  //   BLANK PAGE on every deep link and refresh. Measured against the real
  //   production build served under the production rewrite contract.
  //
  // So: relative only for the dev preview, absolute for anything shipped.
  base:
    process.env.MOBILE_BUILD === '1' || process.env.NODE_ENV === 'production'
      ? '/'
      : './',
  define: {
    // Injected at build time; safe to expose (commit id, branch, timestamp).
    // Same object that produces build-info.json and the meta tags.
    __BUILD_COMMIT__: JSON.stringify(BUILD.commit),
    __BUILD_COMMIT_SHORT__: JSON.stringify(BUILD.shortCommit),
    __BUILD_BRANCH__: JSON.stringify(BUILD.branch),
    __BUILD_TIME__: JSON.stringify(BUILD.builtAt),
    __BUILD_SOURCE__: JSON.stringify(BUILD.source),
    __BUILD_DIRTY__: JSON.stringify(BUILD.worktreeDirty),
  },
  // Phase 224 — the build-platform plugin (`vlyPlugin` from
  // @vly-ai/integrations) is intentionally absent. Its transformIndexHtml hook
  // injected, into PRODUCTION index.html, window "error"/"unhandledrejection"
  // listeners that postMessage every runtime error (message, stack, filename,
  // line/col) to `window.parent` with target origin "*". That is a diagnostic
  // leak to any embedding frame, and the platform editor it served is gone.
  plugins: [react(), tailwindcss(), buildProvenancePlugin()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@convex-dev/auth-internal/client": path.resolve(__dirname, "./node_modules/@convex-dev/auth/dist/react/client.js"),
    },
    // Force a single copy of React across all packages.
    // Without this, duplicate React copies can trigger "Invalid hook call" errors.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client", "convex"],
  },
  build: {
    // Enable source maps for better debugging (disable in production if needed)
    sourcemap: false,
    // Optimize chunk splitting
    rollupOptions: {
      output: {
        // Manual chunk splitting for better caching and lazy loading
        manualChunks: {
          // Vendor chunks for large libraries
          'react-vendor': ['react', 'react-dom', 'react-router'],
          'convex-vendor': ['convex'],
          // Large UI library chunks
          'radix-ui': [
            '@radix-ui/react-accordion',
            '@radix-ui/react-alert-dialog',
            '@radix-ui/react-avatar',
            '@radix-ui/react-checkbox',
            '@radix-ui/react-collapsible',
            '@radix-ui/react-context-menu',
            '@radix-ui/react-dialog',
            '@radix-ui/react-dropdown-menu',
            '@radix-ui/react-hover-card',
            '@radix-ui/react-label',
            '@radix-ui/react-menubar',
            '@radix-ui/react-navigation-menu',
            '@radix-ui/react-popover',
            '@radix-ui/react-progress',
            '@radix-ui/react-radio-group',
            '@radix-ui/react-scroll-area',
            '@radix-ui/react-select',
            '@radix-ui/react-separator',
            '@radix-ui/react-slider',
            '@radix-ui/react-switch',
            '@radix-ui/react-tabs',
            '@radix-ui/react-toggle',
            '@radix-ui/react-toggle-group',
            '@radix-ui/react-tooltip',
          ],
          // Heavy optional libraries - separate chunks for better lazy loading
          'framer-motion': ['framer-motion'],
          'charts': ['recharts'],
          'forms': ['react-hook-form', '@hookform/resolvers', 'zod'],
        },
        // Optimize chunk size
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
      },
    },
    // Increase chunk size warning limit for better chunking
    chunkSizeWarningLimit: 1000,
    // Target modern browsers for better optimization
    target: 'esnext',
    // Minify options - using esbuild (faster than terser)
    minify: 'esbuild',
  },
  // Optimize dependencies
  optimizeDeps: {
    // Only scan the app entry HTML; avoids crawling unrelated *.html files
    // if a legacy snapshot accidentally contains leaked package folders.
    entries: ['index.html'],
    include: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      'react-router',
      '@convex-dev/auth/react',
      'framer-motion',
    ],
  },
  // Static preview of the built artifact (`npm run preview`).
  //
  // Mirrors the dev server's host policy: bind all interfaces and accept the
  // sandbox/proxied preview host, because a preview that answers only to
  // `localhost` cannot be opened by the person who asked for it. This serves
  // the REAL built bundle (including build-info.json), which is what makes a
  // browser-facing verification of a deployment possible.
  preview: {
    host: "0.0.0.0",
    port: 3000,
    allowedHosts: true,
  },
  // Performance hints
  server: {
    // Bind to all interfaces so container server-ready event fires.
    host: "0.0.0.0",
    port: 3000,
    // Allow sandboxed/proxied preview hosts to load the dev server.
    allowedHosts: true,
    // Disable HMR for iframe preview stability
    hmr: false,
  },
});
