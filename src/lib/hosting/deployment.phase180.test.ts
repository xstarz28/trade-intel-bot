/**
 * Phase 180 — Hosting & deployment readiness.
 *
 * These tests lock the contract between the built artifact and the host that
 * serves it. The bug that motivated them was invisible to every existing gate:
 * the test suite passed, typecheck passed, the build passed, and `vercel.json`
 * contained a correct-looking rewrite — yet every deep link and every browser
 * refresh rendered a blank page in production.
 *
 * The cause was the interaction of two individually reasonable choices:
 *   1. a relative asset base (`./assets/...`), and
 *   2. an SPA catch-all rewrite that answers unknown paths with index.html.
 *
 * Loading /dashboard made the browser resolve `./assets/index-*.js` against
 * /dashboard/, producing /dashboard/assets/index-*.js. The catch-all rewrite
 * answered that request with 200 + HTML instead of 404, so the browser
 * received HTML where a JavaScript module was expected, refused to execute
 * it, and rendered nothing. The rewrite actively MASKED the missing asset.
 *
 * Everything here is deterministic: no network, no deployed environment.
 */

import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { safeInAppPath } from "@/lib/mobile/native-shell";
import { resolveSafeRedirect } from "@/lib/routing/safe-redirect";

const ROOT = process.cwd();
const DIST = join(ROOT, "dist");

/** dist/ only exists after a build; skip rather than fail on a clean checkout. */
const built = existsSync(join(DIST, "index.html"));
const describeBuilt = built ? describe : describe.skip;

function distIndex(): string {
  return readFileSync(join(DIST, "index.html"), "utf8");
}

/**
 * Minimal model of the production rewrite contract expressed by both
 * `vercel.json` and `public/_redirects`: serve a real file when one exists,
 * otherwise fall through to index.html with status 200 so the client router
 * can handle the path.
 */
function serveUnderSpaRewrite(pathname: string): {
  status: number;
  body: "asset" | "index.html";
} {
  const rel = pathname.replace(/^\/+/, "");
  const onDisk = rel.length > 0 && existsSync(join(DIST, rel));
  if (onDisk) return { status: 200, body: "asset" };
  return { status: 200, body: "index.html" };
}

describe("Phase 180 — SPA rewrite contract", () => {
  it("declares a catch-all rewrite in vercel.json", () => {
    const cfg = JSON.parse(readFileSync(join(ROOT, "vercel.json"), "utf8"));
    const rewrites: Array<{ source: string; destination: string }> =
      cfg.rewrites ?? [];
    expect(rewrites.length).toBeGreaterThan(0);
    const catchAll = rewrites.find((r) => r.destination === "/index.html");
    expect(catchAll).toBeDefined();
    expect(catchAll!.source).toBe("/(.*)");
  });

  it("declares an equivalent fallback for non-Vercel hosts", () => {
    const redirects = readFileSync(join(ROOT, "public", "_redirects"), "utf8");
    // Status must be 200 (rewrite), not 301/302 — a redirect would change the
    // URL and lose the client route the user actually asked for.
    expect(redirects).toMatch(/^\s*\/\*\s+\/index\.html\s+200\s*$/m);
  });

  it.each(["/", "/auth", "/dashboard", "/journal", "/unknown-route"])(
    "serves index.html for deep link %s",
    (route) => {
      const res = serveUnderSpaRewrite(route);
      expect(res.status).toBe(200);
      expect(res.body).toBe("index.html");
    },
  );
});

describeBuilt("Phase 180 — absolute asset base (blank-page regression)", () => {
  /**
   * THE regression test for the production defect.
   *
   * A relative src is what turned a working build into a blank page on every
   * deep link. This asserts the built HTML references assets from the site
   * root so resolution is independent of the route depth.
   */
  it("references assets absolutely, never relative to the current route", () => {
    const html = distIndex();
    const refs = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map((m) => m[1]);
    const assetRefs = refs.filter((r) => r.includes("assets/"));

    expect(assetRefs.length).toBeGreaterThan(0);
    for (const ref of assetRefs) {
      expect(ref.startsWith("/"), `asset ref must be root-absolute: ${ref}`).toBe(
        true,
      );
      expect(ref.startsWith("./"), `relative asset ref found: ${ref}`).toBe(
        false,
      );
    }
  });

  it("resolves its entry script identically from every route depth", () => {
    const html = distIndex();
    const entry = html.match(/src="([^"]*assets\/[^"]+\.js)"/)?.[1];
    expect(entry).toBeDefined();

    // Resolution from a nested route must land on the same file, which is
    // precisely what the relative base broke.
    for (const base of [
      "https://x.test/",
      "https://x.test/dashboard",
      "https://x.test/journal/entry/42",
    ]) {
      expect(new URL(entry!, base).pathname).toBe(entry);
    }
  });

  it("does not let the rewrite mask a missing asset under a nested route", () => {
    const html = distIndex();
    const entry = html.match(/src="([^"]*assets\/[^"]+\.js)"/)?.[1] ?? "";

    // The real file is present at the root path...
    expect(serveUnderSpaRewrite(entry).body).toBe("asset");

    // ...whereas the path the OLD relative base produced does not exist and is
    // silently answered with HTML. Asserting this documents why the rewrite
    // could not be blamed and the base had to change.
    const nested = `/dashboard${entry}`;
    expect(serveUnderSpaRewrite(nested).body).toBe("index.html");
  });

  it("emits hashed asset filenames so deploys are safely cacheable", () => {
    const files = readdirSync(join(DIST, "assets"));
    const js = files.filter((f) => f.endsWith(".js"));
    expect(js.length).toBeGreaterThan(0);
    for (const f of js) {
      expect(f, `unhashed asset would be served stale: ${f}`).toMatch(
        /-[A-Za-z0-9_-]{8,}\.js$/,
      );
    }
  });
});

describeBuilt("Phase 180 — backend URL configuration", () => {
  /**
   * VITE_CONVEX_URL is inlined at BUILD time. An artifact built without it can
   * never work, no matter how the host is configured afterwards, and the
   * failure is invisible: ConvexReactClient throws while the entry module is
   * still evaluating, React never mounts, and the user sees a blank page.
   *
   * So the artifact must always be in one of two honest states — configured,
   * or explicitly telling an operator it is not. Never silently blank.
   */
  it("either inlines a backend URL or ships a visible misconfiguration notice", () => {
    const bundles = readdirSync(join(DIST, "assets"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(DIST, "assets", f), "utf8"));
    const all = bundles.join("\n");

    const configured = /https:\/\/[a-z0-9-]+\.convex\.cloud/.test(all);
    const guarded = all.includes("Xstarz Analysis is not configured");

    expect(
      configured || guarded,
      "build must not fail silently when VITE_CONVEX_URL is absent",
    ).toBe(true);
  });

  it("never hardcodes a localhost backend in the built artifact", () => {
    const bundles = readdirSync(join(DIST, "assets"))
      .filter((f) => f.endsWith(".js"))
      .map((f) => readFileSync(join(DIST, "assets", f), "utf8"))
      .join("\n");
    // A localhost Convex URL would point production at a machine that does
    // not exist for the user.
    expect(bundles).not.toMatch(/https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/?[^"'`]*convex/i);
  });
});

describe("Phase 180 — deep-link association files", () => {
  const wellKnown = join(ROOT, "public", ".well-known");

  it("publishes a structurally valid assetlinks.json for Android", () => {
    const raw = readFileSync(join(wellKnown, "assetlinks.json"), "utf8");
    const parsed = JSON.parse(raw);
    expect(Array.isArray(parsed)).toBe(true);

    const statement = parsed[0];
    expect(statement.relation).toContain(
      "delegate_permission/common.handle_all_urls",
    );
    expect(statement.target.namespace).toBe("android_app");
    expect(statement.target.package_name).toBe("app.xstarz.analysis");
    expect(Array.isArray(statement.target.sha256_cert_fingerprints)).toBe(true);
  });

  it("publishes a structurally valid apple-app-site-association", () => {
    const raw = readFileSync(join(wellKnown, "apple-app-site-association"), "utf8");
    const parsed = JSON.parse(raw);
    const details = parsed.applinks.details;
    expect(Array.isArray(details)).toBe(true);
    expect(details[0].appID).toContain("app.xstarz.analysis");
    // Each protected route is claimed as an exact path AND a subtree wildcard
    // ("/auth" + "/auth/*") rather than a suffix glob ("/auth*"), so the app
    // cannot accidentally claim an unrelated sibling path like "/authorize".
    const paths: string[] = details[0].paths;
    expect(paths).toContain("/");
    for (const route of ["/auth", "/dashboard", "/journal"]) {
      expect(paths).toContain(route);
      expect(paths).toContain(`${route}/*`);
      expect(
        paths.includes(`${route}*`),
        `suffix glob ${route}* would over-claim sibling routes`,
      ).toBe(false);
    }
  });

  /**
   * Truth-in-reporting guard. Both files ship with placeholders because the
   * release certificate fingerprint and the Apple Team ID do not exist yet.
   * If a future change fills them in, this test fails on purpose — forcing
   * the docs and the UAT matrix to stop saying "NOT verified" at the same
   * moment the values become real, instead of drifting out of sync.
   */
  it("still contains placeholders, so links must be reported NOT verified", () => {
    const android = readFileSync(join(wellKnown, "assetlinks.json"), "utf8");
    const apple = readFileSync(join(wellKnown, "apple-app-site-association"), "utf8");
    expect(android).toContain("REPLACE_WITH_RELEASE_CERT_SHA256");
    expect(apple).toContain("REPLACE_WITH_APPLE_TEAM_ID");
  });

  it("copies both association files into the build output", () => {
    if (!built) return;
    expect(existsSync(join(DIST, ".well-known", "assetlinks.json"))).toBe(true);
    expect(
      existsSync(join(DIST, ".well-known", "apple-app-site-association")),
    ).toBe(true);
  });
});

describe("Phase 180 — deep-link target safety", () => {
  /**
   * A Universal/App Link hands an attacker-influenced URL straight to the app.
   * Phase 169b's redirect hardening must therefore also hold on the mobile
   * entry path, otherwise deep links become an open-redirect bypass.
   */
  const hostile = [
    "https://xstarz.app//evil.com",
    "https://xstarz.app/\\evil.com",
    "https://xstarz.app/https://evil.com",
    "app.xstarz.analysis://evil.com/dashboard",
  ];

  it.each(hostile)("never yields an off-origin destination for %s", (url) => {
    const path = safeInAppPath(url);
    if (path !== null) {
      expect(path.startsWith("/")).toBe(true);
      expect(path.startsWith("//")).toBe(false);
      expect(path).not.toMatch(/^\/\\/);
      expect(path).not.toMatch(/^https?:/i);
    }
  });

  it.each(["javascript:alert(1)", "data:text/html,<script>", "file:///etc/passwd"])(
    "rejects dangerous scheme %s",
    (url) => {
      expect(safeInAppPath(url)).toBeNull();
    },
  );

  it("rejects a malformed custom-scheme URL without throwing", () => {
    expect(() => safeInAppPath("app.xstarz.analysis://")).not.toThrow();
    expect(() => safeInAppPath("not a url at all")).not.toThrow();
    expect(safeInAppPath("not a url at all")).toBeNull();
  });

  it("keeps the Phase 169b redirect guard intact for hosted routes", () => {
    expect(resolveSafeRedirect("//evil.com")).toBe("/dashboard");
    expect(resolveSafeRedirect("https://evil.com/x")).toBe("/dashboard");
    expect(resolveSafeRedirect("/journal")).toBe("/journal");
  });
});
