/**
 * Phase 169 — Production routing, hosting and brand integrity.
 *
 * These are static assertions over the shipped source. They exist because the
 * defects they cover are invisible in unit tests and in the dev preview, and
 * only show up once a real user opens a real URL:
 *
 *  - MemoryRouter renders perfectly in development while making every deep
 *    link, reload and back-button press fail in production.
 *  - A SPA on BrowserRouter 404s on refresh unless the host rewrites to
 *    index.html.
 *  - Development-platform branding leaks are easy to reintroduce.
 */

import { describe, expect, it } from "vitest";
import { existsSync, readFileSync } from "node:fs";

const read = (p: string) => readFileSync(p, "utf8");

describe("router supports real URLs", () => {
  const main = read("src/main.tsx");

  it("uses BrowserRouter, not MemoryRouter", () => {
    // MemoryRouter never updates the address bar: /dashboard cannot be
    // bookmarked, reload loses the page, and ?returnTo is meaningless.
    expect(main).toContain("<BrowserRouter>");
    // Only the explanatory comment may mention MemoryRouter, never an import
    // or an element.
    expect(main).not.toMatch(/import\s*\{[^}]*MemoryRouter/);
    expect(main).not.toContain("<MemoryRouter");
  });

  it("still registers every production route", () => {
    for (const route of ["/", "/auth", "/dashboard", "/journal", "*"]) {
      expect(main, `missing route ${route}`).toContain(`path="${route}"`);
    }
  });

  it("keeps authenticated routes behind RequireAuth", () => {
    // Extract each protected route element and confirm the guard wraps it.
    for (const route of ["/dashboard", "/journal"]) {
      const idx = main.indexOf(`path="${route}"`);
      expect(idx, `route ${route} not found`).toBeGreaterThan(-1);
      const block = main.slice(idx, idx + 400);
      expect(block, `${route} is not guarded`).toContain("RequireAuth");
    }
  });
});

describe("SPA hosting rewrite is configured", () => {
  it("ships a host rewrite so deep links survive a refresh", () => {
    // Without this, BrowserRouter deep links return the host's 404.
    const hasRedirects = existsSync("public/_redirects");
    const hasVercel = existsSync("vercel.json");
    expect(hasRedirects || hasVercel).toBe(true);

    if (hasRedirects) {
      expect(read("public/_redirects")).toMatch(/\/\*\s+\/index\.html\s+200/);
    }
    if (hasVercel) {
      const cfg = JSON.parse(read("vercel.json"));
      expect(JSON.stringify(cfg)).toContain("/index.html");
    }
  });
});

describe("no development-platform branding on product surfaces", () => {
  const surfaces = [
    "src/pages/Auth.tsx",
    "src/pages/Landing.tsx",
    "src/pages/Dashboard.tsx",
    "src/pages/NotFound.tsx",
    "index.html",
    "public/manifest.webmanifest",
  ];

  for (const file of surfaces) {
    it(`${file} carries no third-party or internal brand`, () => {
      if (!existsSync(file)) return;
      const src = read(file);
      for (const brand of ["freebuff", "Freebuff", "Gilfan", "gilfan"]) {
        expect(src, `${file} mentions ${brand}`).not.toContain(brand);
      }
    });
  }

  it("the app manifest identifies the product correctly", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    expect(manifest.name).toBe("Xstarz Analysis");
    // The description was a placeholder repeat of the name.
    expect(manifest.description).not.toBe("Xstarz Analysis");
    expect(manifest.description.length).toBeGreaterThan(20);
  });

  it("every manifest icon actually exists", () => {
    const manifest = JSON.parse(read("public/manifest.webmanifest"));
    for (const icon of manifest.icons ?? []) {
      const path = `public${icon.src}`;
      expect(existsSync(path), `manifest references missing ${icon.src}`).toBe(true);
    }
  });
});

describe("editor tooling never ships to users", () => {
  const main = read("src/main.tsx");

  it("does not mount the build-platform toolbar at all (Phase 224 removed it)", () => {
    // Phase 169 gated the toolbar behind import.meta.env.DEV. Phase 224
    // deleted it together with the platform plugin, so the stronger
    // invariant is simply: no reference remains.
    expect(main).not.toContain("VlyToolbar");
    expect(main).not.toContain("vly-toolbar");
  });
});

describe("locale persistence survives the rename", () => {
  const i18n = read("src/lib/i18n/index.ts");

  it("stores new values under the product-branded key", () => {
    expect(i18n).toContain('const STORAGE_KEY = "xstarz:locale"');
  });

  it("still reads the legacy key so saved languages are not lost", () => {
    // Renaming the key outright would silently reset every existing user's
    // language back to the browser default.
    expect(i18n).toContain("LEGACY_STORAGE_KEY");
    expect(i18n).toContain('"freebuff:locale"');
  });
});

describe("auth surface does not leak raw errors", () => {
  const auth = read("src/pages/Auth.tsx");

  it("never serialises an error object into user-visible state", () => {
    // JSON.stringify(error) can carry request context and config hints.
    expect(auth).not.toMatch(/setError\([^)]*JSON\.stringify/);
    expect(auth).not.toContain("JSON.stringify(error");
  });

  it("does not render a raw provider message as the guest failure", () => {
    expect(auth).not.toMatch(/setError\(`Failed to sign in as guest/);
  });

  it("uses the hardened redirect resolver", () => {
    expect(auth).toContain("resolveSafeRedirect");
    // The old naive inline guard must be gone.
    expect(auth).not.toContain('!returnTo.startsWith("//")');
  });
});

describe("product safety language", () => {
  it("states that the product does not execute trades", () => {
    // Phase 189 moved this sentence into the i18n catalogue so all nine
    // locales carry it. The guarantee is unchanged: the auth surface must
    // still render it, and it must reach the user in every language.
    const auth = read("src/pages/Auth.tsx");
    expect(auth).toContain("t.auth.disclaimer");
    const en = read("src/lib/i18n/en.ts");
    const authBlock = en.slice(en.indexOf("\n  auth: {"), en.indexOf("\n  },", en.indexOf("\n  auth: {")));
    expect(authBlock.toLowerCase()).toContain("never places trades");
    for (const locale of ["id", "es", "fr", "pt", "de", "ja", "ko", "zh"]) {
      const src = read(`src/lib/i18n/${locale}.ts`);
      const block = src.slice(src.indexOf("\n  auth: {"), src.indexOf("\n  },", src.indexOf("\n  auth: {")));
      expect(block, `${locale} lost the no-execution disclaimer`).toContain("disclaimer:");
    }
  });

  it("makes no profit guarantee anywhere on the auth surface", () => {
    const auth = read("src/pages/Auth.tsx").toLowerCase();
    for (const claim of ["guaranteed profit", "guaranteed return", "risk-free"]) {
      expect(auth).not.toContain(claim);
    }
  });
});
