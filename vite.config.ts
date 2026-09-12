import { vlyPlugin } from "@vly-ai/integrations";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import path from "path";
import { execSync } from "node:child_process";
import { defineConfig } from "vite";

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
 */
function gitInfo(): { commit: string; branch: string; time: string } {
  const read = (cmd: string): string => {
    try {
      return execSync(cmd, { stdio: ["ignore", "pipe", "ignore"] }).toString().trim();
    } catch {
      return "unknown";
    }
  };

  const epoch = process.env.SOURCE_DATE_EPOCH;
  const commitEpoch = epoch ?? read("git log -1 --format=%ct");
  const time = /^\d+$/.test(commitEpoch)
    ? new Date(Number(commitEpoch) * 1000).toISOString()
    : "unknown";

  return {
    commit: read("git rev-parse --short HEAD"),
    // In CI the checkout is often detached, where `--abbrev-ref HEAD` yields
    // "HEAD". GITHUB_REF_NAME carries the real branch in that case.
    branch: process.env.GITHUB_REF_NAME ?? read("git rev-parse --abbrev-ref HEAD"),
    time,
  };
}

const BUILD = gitInfo();

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
    __BUILD_COMMIT__: JSON.stringify(BUILD.commit),
    __BUILD_BRANCH__: JSON.stringify(BUILD.branch),
    __BUILD_TIME__: JSON.stringify(BUILD.time),
  },
  plugins: [vlyPlugin(), react(), tailwindcss()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    // Force a single copy of React across all packages.
    // Without this, duplicate React copies can trigger "Invalid hook call" errors.
    dedupe: ["react", "react/jsx-runtime", "react-dom", "react-dom/client"],
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
  // Performance hints
  server: {
    // Bind to all interfaces so WebContainer's server-ready event fires.
    host: true,
    port: 5173,
    // Allow sandboxed/proxied preview hosts (e.g. *.e2b.app) to load the
    // dev server. Vite blocks unknown Hosts by default.
    allowedHosts: true,
    // Freebuff requires HMR to remain disabled in the preview iframe.
    hmr: false,
  },
});
