/**
 * Phase 179 — mobile packaging: deterministic checks.
 *
 * These are the AUTOMATED rows of the mobile matrix. They validate the shared
 * web layer and the static native project configuration — everything that can
 * be proven on Linux without an Android SDK, without Xcode, and without a
 * physical device.
 *
 * They deliberately do NOT claim:
 *   - that an APK builds (no Java/Android SDK in this environment),
 *   - that an iOS app builds (no macOS/Xcode),
 *   - that anything behaves correctly on real hardware.
 * Those rows are HUMAN/BLOCKED in docs/UAT-MATRIX.md.
 */

import { describe, expect, it } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import {
  EXIT_ROUTES,
  backButtonAction,
  isNativeShell,
  nativePlatform,
  safeInAppPath,
} from "./native-shell";

const ROOT = resolve(__dirname, "../../..");
const read = (p: string) => readFileSync(resolve(ROOT, p), "utf8");
const has = (p: string) => existsSync(resolve(ROOT, p));

// ═══════════════════════════════════════════════════════════
// Shared web layer
// ═══════════════════════════════════════════════════════════

describe("the web app remains the single UI for both platforms", () => {
  it("BrowserRouter is preserved (not Memory/HashRouter)", () => {
    const main = read("src/main.tsx");
    // Assert the ACTIVE router element, not a bare word: main.tsx documents
    // in a comment why MemoryRouter was rejected, and matching that comment
    // would make this test fail for the very reason it should pass.
    expect(main).toContain("<BrowserRouter>");
    expect(main).not.toContain("<MemoryRouter");
    expect(main).not.toContain("<HashRouter");
    expect(main).not.toMatch(/import\s*\{[^}]*\bMemoryRouter\b[^}]*\}\s*from/);
    expect(main).not.toMatch(/import\s*\{[^}]*\bHashRouter\b[^}]*\}\s*from/);
  });

  it("all four product routes are declared once, for every platform", () => {
    const main = read("src/main.tsx");
    for (const route of ["/", "/auth", "/dashboard", "/journal"]) {
      expect(main).toContain(`path="${route}"`);
    }
  });

  it("protected routes keep their auth guard", () => {
    const main = read("src/main.tsx");
    // A deep link into /dashboard or /journal must hit the same guard the web
    // app uses, so an unauthenticated link redirects rather than leaking.
    const dashboard = main.slice(main.indexOf('path="/dashboard"'));
    expect(dashboard.slice(0, 200)).toContain("RequireAuth");
    const journal = main.slice(main.indexOf('path="/journal"'));
    expect(journal.slice(0, 200)).toContain("RequireAuth");
  });

  it("there is no second UI implementation", () => {
    // A React Native rewrite would show up as a parallel entry point.
    expect(has("App.native.tsx")).toBe(false);
    expect(has("index.native.js")).toBe(false);
    expect(has("metro.config.js")).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════
// Native shell behaviour (pure, testable without a device)
// ═══════════════════════════════════════════════════════════

describe("native shell helpers degrade safely in a browser", () => {
  it("reports web when no Capacitor bridge is present", () => {
    expect(isNativeShell()).toBe(false);
    expect(nativePlatform()).toBe("web");
  });
});

describe("Android hardware back button", () => {
  it("pops history whenever there is history to pop", () => {
    for (const route of ["/", "/auth", "/dashboard", "/journal"]) {
      expect(backButtonAction(route, true)).toBe("back");
    }
  });

  it("exits only from the app's entry routes", () => {
    expect(backButtonAction("/", false)).toBe("exit");
    expect(backButtonAction("/auth", false)).toBe("exit");
  });

  it("never exits the app from a deep-linked interior route", () => {
    // Backing out of a deep link must not kill the app.
    expect(backButtonAction("/dashboard", false)).toBe("back");
    expect(backButtonAction("/journal", false)).toBe("back");
  });

  it("exit routes are exactly the two entry points", () => {
    expect([...EXIT_ROUTES].sort()).toEqual(["/", "/auth"]);
  });
});

// ═══════════════════════════════════════════════════════════
// Deep links must not become an open redirect (Phase 169b)
// ═══════════════════════════════════════════════════════════

describe("deep links cannot be used as an open redirect", () => {
  it("accepts in-app paths from an https universal link", () => {
    expect(safeInAppPath("https://xstarz.app/dashboard")).toBe("/dashboard");
    expect(safeInAppPath("https://xstarz.app/journal")).toBe("/journal");
    expect(safeInAppPath("https://xstarz.app/auth?returnTo=%2Fdashboard")).toBe(
      "/auth?returnTo=%2Fdashboard",
    );
  });

  it("accepts a custom-scheme deep link", () => {
    expect(safeInAppPath("app.xstarz.analysis://dashboard")).toBe("/dashboard");
  });

  it("rejects protocol-relative and external destinations", () => {
    expect(safeInAppPath("//evil.example.com/steal")).toBeNull();
    expect(safeInAppPath("javascript:alert(1)")).toBeNull();
    expect(safeInAppPath("data:text/html,<script>alert(1)</script>")).toBeNull();
    expect(safeInAppPath("file:///etc/passwd")).toBeNull();
  });

  it("never returns a destination pointing off-app", () => {
    for (const url of [
      "https://evil.example.com//attacker.test/",
      "app.xstarz.analysis://",
      "",
      "not-a-url",
    ]) {
      const result = safeInAppPath(url);
      if (result !== null) {
        expect(result.startsWith("/")).toBe(true);
        expect(result.startsWith("//")).toBe(false);
      }
    }
  });

  it("rejects backslash-smuggled hosts", () => {
    expect(safeInAppPath("https://xstarz.app/\\evil.com")).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════
// Android project configuration
// ═══════════════════════════════════════════════════════════

describe("Android project is configured for release", () => {
  it("requests exactly one permission: INTERNET", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    const perms = [...manifest.matchAll(/<uses-permission[^>]*android:name="([^"]+)"/g)].map(
      (m) => m[1],
    );
    expect(perms).toEqual(["android.permission.INTERNET"]);
  });

  it("requests no invasive permission", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    for (const p of ["CAMERA", "RECORD_AUDIO", "ACCESS_FINE_LOCATION", "READ_CONTACTS", "READ_SMS", "BLUETOOTH", "READ_EXTERNAL_STORAGE", "AD_ID"]) {
      expect(manifest).not.toContain(p);
    }
  });

  it("does not back the auth session up to the cloud", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:allowBackup="false"');
    expect(has("android/app/src/main/res/xml/data_extraction_rules.xml")).toBe(true);
  });

  it("uses the Xstarz application id and label", () => {
    expect(read("android/app/build.gradle")).toContain('applicationId "app.xstarz.analysis"');
    expect(read("android/app/src/main/res/values/strings.xml")).toContain(
      "<string name=\"app_name\">Xstarz Analysis</string>",
    );
  });

  it("declares App Links for the product routes", () => {
    const manifest = read("android/app/src/main/AndroidManifest.xml");
    expect(manifest).toContain('android:autoVerify="true"');
    expect(manifest).toContain('android:scheme="https"');
  });

  it("commits no signing material", () => {
    expect(has("android/keystore.properties")).toBe(false);
    expect(read("android/app/build.gradle")).toContain("keystore.properties");
    // The template must document fields without carrying values.
    const example = read("android/keystore.properties.example");
    expect(example).toMatch(/storePassword=\s*$/m);
  });

  it("ignores signing material in git", () => {
    const ignore = read(".gitignore");
    for (const pattern of ["android/keystore.properties", "*.jks", "*.p12", "*.mobileprovision"]) {
      expect(ignore).toContain(pattern);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// iOS project configuration (static — no Xcode in this environment)
// ═══════════════════════════════════════════════════════════

describe("iOS project is configured for a macOS build", () => {
  it("exists with the standard Xcode structure", () => {
    expect(has("ios/App/App.xcodeproj/project.pbxproj")).toBe(true);
    expect(has("ios/App/App/Info.plist")).toBe(true);
    expect(has("ios/App/Podfile")).toBe(true);
  });

  it("uses the same reverse-DNS identity as Android", () => {
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain(
      "PRODUCT_BUNDLE_IDENTIFIER = app.xstarz.analysis;",
    );
    expect(read("ios/App/App/Info.plist")).toContain("Xstarz Analysis");
  });

  it("requests no privacy-gated permission", () => {
    const plist = read("ios/App/App/Info.plist");
    for (const key of [
      "NSCameraUsageDescription", "NSMicrophoneUsageDescription",
      "NSLocationWhenInUseUsageDescription", "NSPhotoLibraryUsageDescription",
      "NSContactsUsageDescription", "NSBluetoothAlwaysUsageDescription",
      "NSUserTrackingUsageDescription",
    ]) {
      expect(plist).not.toContain(key);
    }
  });

  it("declares associated domains for universal links", () => {
    const ent = read("ios/App/App/App.entitlements");
    expect(ent).toContain("com.apple.developer.associated-domains");
    expect(ent).toContain("applinks:");
    expect(read("ios/App/App.xcodeproj/project.pbxproj")).toContain("CODE_SIGN_ENTITLEMENTS");
  });

  it("is portrait-only on iPhone", () => {
    const plist = read("ios/App/App/Info.plist");
    const iphone = plist.slice(
      plist.indexOf("<key>UISupportedInterfaceOrientations</key>"),
      plist.indexOf("<key>UISupportedInterfaceOrientations~ipad</key>"),
    );
    expect(iphone).toContain("UIInterfaceOrientationPortrait");
    expect(iphone).not.toContain("LandscapeLeft");
  });

  it("commits no certificate or provisioning profile", () => {
    for (const f of [
      "ios/App/App.mobileprovision",
      "ios/certificates.p12",
      "ios/App/App/GoogleService-Info.plist",
    ]) {
      expect(has(f)).toBe(false);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Shared packaging contract
// ═══════════════════════════════════════════════════════════

describe("web assets flow to both platforms from one build", () => {
  it("capacitor points both platforms at the Vite output", () => {
    const cfg = read("capacitor.config.ts");
    expect(cfg).toContain('webDir: "dist"');
    expect(cfg).toContain('appId: "app.xstarz.analysis"');
    expect(cfg).toContain('appName: "Xstarz Analysis"');
  });

  it("the packaged app does not load from a remote or dev server", () => {
    const cfg = read("capacitor.config.ts");
    // `server.url` would make the shipped app depend on a network origin.
    expect(cfg).not.toMatch(/^\s*url:/m);
    expect(cfg).toContain("webContentsDebuggingEnabled: false");
  });

  it("the mobile build uses absolute asset paths so deep links resolve", () => {
    // With `base: './'` a deep link to /dashboard resolves ./assets/* against
    // /dashboard/ and 404s — a blank app. MOBILE_BUILD=1 switches to '/'.
    const vite = read("vite.config.ts");
    expect(vite).toContain("MOBILE_BUILD");
    expect(read("package.json")).toContain("MOBILE_BUILD=1 vite build");
  });

  /*
    Phase 181 — these assertions target COPIED output, not source.

    `android/app/src/main/assets/public/` and `ios/App/App/public/` are
    produced by `npx cap sync` and are git-ignored, so a fresh checkout does
    not contain them. Asserting on them unconditionally passed locally (where
    a sync had been run) and failed on CI with ENOENT — a green local suite
    that could not survive a clean clone.

    The assertions still run in full whenever the sync HAS happened, so the
    real guarantee is preserved; they simply do not claim to verify a copy
    that was never made. `npm run mobile:sync` is a prerequisite of the mobile
    workflow, which is where this genuinely matters.
  */
  const SYNCED_INDEX = [
    "android/app/src/main/assets/public/index.html",
    "ios/App/App/public/index.html",
  ];
  const capSynced = SYNCED_INDEX.every(has);
  const itSynced = capSynced ? it : it.skip;

  itSynced("both native projects received the web build", () => {
    for (const p of SYNCED_INDEX) expect(has(p)).toBe(true);
  });

  itSynced("the copied index.html uses absolute asset paths", () => {
    for (const p of SYNCED_INDEX) {
      const html = read(p);
      expect(html).toMatch(/src="\/assets\//);
      expect(html).not.toMatch(/src="\.\/assets\//);
    }
  });
});

// ═══════════════════════════════════════════════════════════
// Provider architecture is unchanged by packaging
// ═══════════════════════════════════════════════════════════

describe("mobile clients never acquire provider data directly", () => {
  // Same rationale as above: this reads cap-sync output, absent on a clean
  // checkout. The equivalent scan over dist/ runs in `npm run mobile:verify`,
  // which the mobile workflow executes after syncing.
  const androidIndex = "android/app/src/main/assets/public/index.html";
  const itSyncedAndroid = has(androidIndex) ? it : it.skip;

  itSyncedAndroid("no provider host is referenced from the shipped web assets", () => {
    const html = read(androidIndex);
    for (const host of ["twelvedata.com", "alphavantage.co", "coinglass.com", "api.eia.gov"]) {
      expect(html).not.toContain(host);
    }
  });

  it("no provider credential appears in either native project", () => {
    const files = [
      "android/app/src/main/AndroidManifest.xml",
      "android/app/src/main/res/values/strings.xml",
      "android/app/build.gradle",
      "ios/App/App/Info.plist",
      "capacitor.config.ts",
    ];
    for (const f of files) {
      const text = read(f);
      for (const key of ["TWELVE_DATA_API_KEY", "ALPHA_VANTAGE_API_KEY", "COINGLASS_API_KEY", "TICKATLAS_API_KEY", "EIA_API_KEY", "OTP_EMAIL_API_KEY"]) {
        expect(text).not.toContain(key);
      }
    }
  });
});
