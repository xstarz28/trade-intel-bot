/**
 * Phase 182 — desktop packaging readiness (Tauri, Windows first).
 *
 * THE GUARANTEE UNDER TEST
 * One product, one web UI, one backend, four surfaces. Web, Android, iOS and
 * Windows must all consume the SAME production build and the SAME protected
 * decision pipeline. The failure this guards against is silent divergence: a
 * desktop-only asset path, a desktop-only router, or a desktop-only copy of
 * the analysis engine would each break the guarantee without breaking a
 * single existing test.
 *
 * Everything here is deterministic: no Rust toolchain, no Windows, no network.
 * The actual compile happens on a Windows CI runner, because the sandbox has
 * neither Rust nor Windows and pretending otherwise would be dishonest.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  desktopPlatform,
  isAllowedExternalUrl,
  isDesktopShell,
} from "./desktop-shell";

const ROOT = process.cwd();
const TAURI = join(ROOT, "src-tauri");

interface TauriConfig {
  productName: string;
  version: string;
  identifier: string;
  build: { frontendDist: string; devUrl?: string; beforeBuildCommand?: string };
  app: {
    windows: Array<{ title: string; width: number; height: number }>;
    security: { capabilities?: string[] };
  };
  bundle: {
    active: boolean;
    targets: string[];
    icon: string[];
    publisher?: string;
    copyright?: string;
    shortDescription?: string;
    longDescription?: string;
    windows?: Record<string, unknown>;
  };
  plugins?: Record<string, unknown>;
}

function config(): TauriConfig {
  return JSON.parse(readFileSync(join(TAURI, "tauri.conf.json"), "utf8"));
}

describe("Phase 182 — one product, four surfaces", () => {
  /**
   * THE central architectural assertion. `frontendDist: "../dist"` is what
   * makes the desktop app the same product rather than a fork: it consumes
   * the identical Vite output that the browser and both mobile platforms use.
   */
  it("wraps the SAME production web build as every other surface", () => {
    const c = config();
    expect(c.build.frontendDist).toBe("../dist");
    // And it rebuilds that shared output rather than a desktop-only one.
    expect(c.build.beforeBuildCommand).toBe("npm run build");
  });

  it("has no desktop-specific UI or analysis engine", () => {
    // A desktop copy of the engine is the failure this forbids. The only
    // desktop-specific TypeScript permitted is the shell-detection module.
    const desktopDir = join(ROOT, "src/lib/desktop");
    const files = readdirSync(desktopDir).filter((f) => f.endsWith(".ts"));
    const nonTest = files.filter((f) => !f.includes(".test."));
    expect(nonTest).toEqual(["desktop-shell.ts"]);

    // The Rust shell must not reimplement product logic. It is a window.
    //
    // Comments are stripped first: the file's header legitimately explains
    // that "every recommendation still comes from the protected Convex
    // pipeline", and flagging that sentence would punish the documentation
    // for describing the very guarantee being tested.
    const rustCode = readFileSync(join(TAURI, "src/lib.rs"), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    for (const forbidden of ["recommendation", "indicator", "candle", "ohlcv"]) {
      expect(
        rustCode.toLowerCase().includes(forbidden.toLowerCase()),
        `desktop shell must not contain product logic (${forbidden})`,
      ).toBe(false);
    }
  });

  it("keeps provider acquisition server-side on the desktop surface", () => {
    const rust = readFileSync(join(TAURI, "src/lib.rs"), "utf8");
    for (const host of [
      "twelvedata",
      "alphavantage",
      "coinglass",
      "coingecko",
      "okx.com",
      "api.eia.gov",
    ]) {
      expect(rust.toLowerCase()).not.toContain(host);
    }
    // No HTTP client in the shell at all: it cannot reach a provider.
    const cargo = readFileSync(join(TAURI, "Cargo.toml"), "utf8");
    for (const crate of ["reqwest", "hyper", "ureq", "curl"]) {
      expect(cargo).not.toContain(`\n${crate} `);
    }
  });
});

describe("Phase 182 — Windows packaging metadata", () => {
  it("declares the product identity users will see", () => {
    const c = config();
    expect(c.productName).toBe("Xstarz Analysis");
    expect(c.app.windows[0].title).toBe("Xstarz Analysis");
    expect(c.identifier).toBe("app.xstarz.analysis.desktop");
  });

  it("uses a publisher distinct from the product name", () => {
    // Microsoft Store rejects a publisher equal to the product name.
    const c = config();
    expect(c.bundle.publisher).toBeTruthy();
    expect(c.bundle.publisher).not.toBe(c.productName);
  });

  it("carries version, copyright and description metadata for the installer", () => {
    const c = config();
    expect(c.version).toMatch(/^\d+\.\d+\.\d+$/);
    expect(c.bundle.copyright).toBeTruthy();
    expect(c.bundle.shortDescription).toBeTruthy();
    expect(c.bundle.longDescription).toBeTruthy();
  });

  it("describes itself as decision support, never as an automated broker", () => {
    const c = config();
    const text = `${c.bundle.shortDescription} ${c.bundle.longDescription}`.toLowerCase();
    expect(text).toContain("decision");
    // Standing product invariant: never claim execution or guaranteed profit.
    // Note the phrasing must be checked in context — the description says the
    // app "never executes trades", so searching for the bare phrase
    // "executes trades" would flag the disclaimer itself.
    for (const forbidden of ["auto-trade", "automatic trading", "guaranteed"]) {
      expect(text).not.toContain(forbidden);
    }
    expect(text).toMatch(/never (places orders|executes trades)/);
    expect(text).toContain("never places orders");
  });

  it("produces both installer formats with a multi-size Windows icon", () => {
    const c = config();
    expect(c.bundle.active).toBe(true);
    expect(c.bundle.targets).toEqual(expect.arrayContaining(["msi", "nsis"]));
    expect(c.bundle.icon.some((i) => i.endsWith(".ico"))).toBe(true);
    expect(existsSync(join(TAURI, "icons/icon.ico"))).toBe(true);
    // A single-size .ico renders badly in the taskbar and Add/Remove Programs.
    const ico = readFileSync(join(TAURI, "icons/icon.ico"));
    expect(ico.readUInt16LE(0)).toBe(0); // reserved
    expect(ico.readUInt16LE(2)).toBe(1); // type: icon
    expect(ico.readUInt16LE(4)).toBeGreaterThanOrEqual(4); // image count
  });
});

describe("Phase 182 — desktop artifact security", () => {
  it("commits no signing material or certificate", () => {
    const c = config();
    const win = c.bundle.windows ?? {};
    expect(win.certificateThumbprint ?? null).toBeNull();
    expect(win.signCommand ?? null).toBeNull();

    // And nothing certificate-shaped is committed anywhere under src-tauri.
    const walk = (dir: string, acc: string[] = []): string[] => {
      for (const e of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, e.name);
        if (e.isDirectory()) {
          if (e.name === "target" || e.name === "gen") continue;
          walk(full, acc);
        } else acc.push(full);
      }
      return acc;
    };
    for (const file of walk(TAURI)) {
      expect(file).not.toMatch(/\.(pfx|p12|pem|key|cer|crt)$/i);
    }
  });

  it("grants no filesystem, shell, process or raw-http capability", () => {
    const capsDir = join(TAURI, "capabilities");
    const caps = readdirSync(capsDir).filter((f) => f.endsWith(".json"));
    expect(caps.length).toBeGreaterThan(0);

    for (const file of caps) {
      const cap = JSON.parse(readFileSync(join(capsDir, file), "utf8"));
      const perms: string[] = cap.permissions ?? [];
      for (const p of perms) {
        const id = typeof p === "string" ? p : (p as { identifier: string }).identifier;
        // Web content must not be handed the operating system.
        expect(id).not.toMatch(/^(shell|fs|process|http):/);
      }
    }
  });

  it("does not configure a self-updater", () => {
    // Auto-update is documented as a decision, not silently implemented.
    // An unsigned self-updater would be an unacceptable attack surface.
    expect(config().plugins?.updater).toBeUndefined();
  });

  it("never points the packaged app at a dev server", () => {
    const c = config();
    /*
      Phase 183 — proven by Windows CI, not by reasoning.

      `tauri::generate_context!()` bakes the ENTIRE config into the compiled
      binary. With `devUrl` in the release config, the shipped .exe contained
      the literal string "localhost:5173" — the binary scanner caught it. A
      release build does not USE devUrl, but shipping a dev-server URL inside
      the executable is exactly the class of dev dependency this project
      forbids in every other artifact.

      It now lives in `tauri.dev.conf.json`, merged only by
      `npm run desktop:dev`.
    */
    expect(c.build.devUrl).toBeUndefined();
    expect((c.build as { beforeDevCommand?: string }).beforeDevCommand).toBeUndefined();
  });

  it("keeps the dev server URL in a dev-only overlay config", () => {
    const dev = JSON.parse(
      readFileSync(join(TAURI, "tauri.dev.conf.json"), "utf8"),
    ) as { build: { devUrl: string; beforeDevCommand: string } };
    expect(dev.build.devUrl).toMatch(/^http:\/\/localhost:\d+$/);
    expect(dev.build.beforeDevCommand).toBe("npm run dev");

    // And the dev overlay must be wired up, or `desktop:dev` silently loses
    // its dev server.
    const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
    expect(pkg.scripts["desktop:dev"]).toContain("tauri.dev.conf.json");
  });
});

describe("Phase 182 — desktop routing preserves BrowserRouter", () => {
  it("keeps BrowserRouter for every surface", () => {
    const main = readFileSync(join(ROOT, "src/main.tsx"), "utf8");
    expect(main).toContain("<BrowserRouter>");

    // MemoryRouter/HashRouter would break deep links and ?returnTo. Comments
    // are stripped first because main.tsx documents WHY MemoryRouter was
    // rejected — that explanation is valuable and must not fail the check.
    const code = main
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\{\/\*[\s\S]*?\*\/\}/g, "")
      .replace(/^\s*\/\/.*$/gm, "");
    expect(code).not.toContain("MemoryRouter");
    expect(code).not.toContain("HashRouter");
  });

  it("registers the public website routes", () => {
    const main = readFileSync(join(ROOT, "src/main.tsx"), "utf8");
    for (const route of ["/download", "/privacy", "/terms"]) {
      expect(main).toContain(`path="${route}"`);
    }
    // And the existing app routes are untouched.
    for (const route of ["/auth", "/dashboard", "/journal"]) {
      expect(main).toContain(`path="${route}"`);
    }
  });

  /**
   * Tauri serves the bundled frontend through its asset protocol, which falls
   * back to index.html for unknown paths — the same contract as the SPA
   * rewrite on the web. That means the Phase 180 relative-base defect would
   * reproduce EXACTLY here: /dashboard would request
   * /dashboard/assets/index-*.js, receive index.html, and render blank.
   */
  it("would reproduce the Phase 180 blank-page bug without an absolute base", () => {
    const vite = readFileSync(join(ROOT, "vite.config.ts"), "utf8");
    expect(vite).toContain("NODE_ENV");
    // `tauri build` runs `npm run build`, which sets NODE_ENV=production and
    // therefore selects the absolute base.
    expect(config().build.beforeBuildCommand).toBe("npm run build");

    const dist = join(ROOT, "dist/index.html");
    if (existsSync(dist)) {
      const html = readFileSync(dist, "utf8");
      const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
      for (const ref of refs.filter((r) => r.includes("assets/"))) {
        expect(ref.startsWith("/"), `relative asset ref breaks desktop: ${ref}`).toBe(true);
      }
    }
  });
});

describe("Phase 182 — external navigation cannot become an open redirect", () => {
  it.each([
    "javascript:alert(1)",
    "data:text/html,<script>alert(1)</script>",
    "file:///etc/passwd",
    "http://example.com",
    "",
    "   ",
    "not a url",
  ])("rejects %s", (url) => {
    expect(isAllowedExternalUrl(url)).toBe(false);
  });

  it("rejects look-alike hosts and embedded credentials", () => {
    // Substring matching would accept the first of these for "xstarz.app".
    expect(isAllowedExternalUrl("https://xstarz.app.evil.com")).toBe(false);
    expect(isAllowedExternalUrl("https://user:pass@example.com")).toBe(false);
  });

  it("defaults to an empty allowlist, so nothing opens externally", () => {
    // Nothing in the product needs to open an external site today. An empty
    // allowlist cannot be abused; adding a host must be deliberate.
    expect(isAllowedExternalUrl("https://example.com")).toBe(false);
  });

  it("keeps the TypeScript mirror in lockstep with the Rust enforcement", () => {
    // Rust is the real boundary — web content cannot bypass it. If the two
    // allowlists drift, the UI would offer links the shell then refuses.
    const rust = readFileSync(join(TAURI, "src/lib.rs"), "utf8");
    const ts = readFileSync(join(ROOT, "src/lib/desktop/desktop-shell.ts"), "utf8");
    const rustHosts = rust.match(/ALLOWED_EXTERNAL_HOSTS[^=]*=\s*&\[([^\]]*)\]/)?.[1] ?? "";
    const tsHosts = ts.match(/ALLOWED_EXTERNAL_HOSTS[^=]*=\s*\[([^\]]*)\]/)?.[1] ?? "";
    const norm = (s: string) =>
      s.split(",").map((x) => x.trim().replace(/['"]/g, "")).filter(Boolean).sort();
    expect(norm(tsHosts)).toEqual(norm(rustHosts));
  });
});

describe("Phase 182 — desktop shell detection", () => {
  it("reports web when no Tauri globals are present", () => {
    // jsdom/node: no __TAURI_INTERNALS__, so this must not claim desktop.
    expect(isDesktopShell()).toBe(false);
    expect(desktopPlatform()).toBe("unknown");
  });

  it("detects by feature, not user agent", () => {
    // WebView2's user agent is essentially Edge's, so sniffing it would both
    // miss the desktop app and misclassify Edge users as desktop.
    const src = readFileSync(join(ROOT, "src/lib/desktop/desktop-shell.ts"), "utf8");
    const detection = src.slice(src.indexOf("export function isDesktopShell"));
    const body = detection.slice(0, detection.indexOf("\n}"));
    expect(body).not.toMatch(/userAgent/);
    expect(body).toContain("__TAURI");
  });
});

describe("Phase 182 — no invented official domain or download URL", () => {
  it("ships no hardcoded download link", () => {
    const page = readFileSync(join(ROOT, "src/pages/Download.tsx"), "utf8");
    // A fabricated URL would 404 for real users. Channels are explicitly
    // unavailable until a signed artifact and a real domain exist.
    expect(page).not.toMatch(/https?:\/\/(?!localhost)[a-z0-9-]+\.[a-z]{2,}/i);
    expect(page).toContain("href: null");
  });

  it("invents no official domain anywhere in the desktop configuration", () => {
    const conf = readFileSync(join(TAURI, "tauri.conf.json"), "utf8");
    expect(conf).not.toMatch(/xstarz\.(app|com|io|net)/i);
  });

  it("uses translated strings rather than hardcoded UI text", () => {
    for (const page of ["Download", "Privacy", "Terms"]) {
      const src = readFileSync(join(ROOT, `src/pages/${page}.tsx`), "utf8");
      expect(src).toContain("useI18n");
      expect(src).toContain("tx(");
    }
  });
});
