# Desktop Distribution — Windows

Phase 182. Windows is the fourth distribution surface for Xstarz Analysis.

**Status: code-ready, CI-verified. NOT production-ready, NOT Store-ready.**
Section 8 lists exactly what is missing.

---

## 1. Architecture

One product, one web UI, one backend, four surfaces:

| Surface | Wrapper | Runtime | Distribution |
| --- | --- | --- | --- |
| Web | Vite + React | Browser | Official website |
| Android | Capacitor | Android WebView | APK / Play Store |
| iOS | Capacitor | WKWebView | App Store |
| **Windows** | **Tauri 2** | **WebView2** | **Microsoft Store + direct download** |

All four load the **same `dist/`**. `tauri.conf.json` sets
`frontendDist: "../dist"` and `beforeBuildCommand: "npm run build"`, so the
desktop app cannot drift from the web app — a test asserts both.

**There is no desktop-specific UI and no desktop-specific analysis engine.**
Every recommendation still comes from the protected Convex pipeline over the
network. The Rust crate is a window: no HTTP client (`reqwest`, `hyper`,
`ureq`, `curl` are all absent), no provider hostnames, no product logic.

### Why Tauri rather than Electron

Tauri uses the OS WebView (WebView2 on Windows) instead of bundling Chromium,
giving a ~3 MB binary against Electron's ~96 MB. It also defaults to a
capability-permission model, so the shell grants the web layer nothing unless
explicitly allowed — which suits a product whose central security property is
that provider credentials never reach the client.

---

## 2. Windows support

| Item | Value |
| --- | --- |
| Windows versions | 10 (1803+) and 11 |
| Architecture | x64 (built in CI) |
| ARM64 | Supported by Tauri via `aarch64-pc-windows-msvc`; **not built or tested here** |
| Runtime dependency | WebView2 — preinstalled on Windows 11 and patched Windows 10 |
| WebView2 install mode | `downloadBootstrapper` (0 MB added; fetches the runtime only if absent) |

> Microsoft Store policy requires the **`offlineInstaller`** WebView2 mode,
> which adds ~127 MB. The current configuration targets direct download.
> Switching to Store distribution requires a separate Store config — see §5.

ARM64 is deliberately not claimed. Adding `--target aarch64-pc-windows-msvc`
is a one-line change, but an untested architecture must not be advertised.

---

## 3. Installer

`npx tauri build` produces two formats:

| Format | File | Notes |
| --- | --- | --- |
| WiX MSI | `.msi` | Windows-only build; enterprise-friendly |
| NSIS | `-setup.exe` | Cross-compilable |

Metadata carried into Add/Remove Programs:

- Product name — `Xstarz Analysis`
- Publisher — `Xstarz` (**must differ from the product name**; the Store
  rejects a publisher equal to it)
- Version — semver, validated
- Copyright, short and long description
- Multi-size `icon.ico` (16→256 px) so the taskbar, Explorer and Add/Remove
  Programs all render correctly

Uninstall is handled by the installer format itself: both MSI and NSIS
register a standard uninstall entry.

---

## 4. Security posture

The desktop artifact is held to the same standard as the mobile ones by the
same scanner (`npm run mobile:verify`).

| Check | Status |
| --- | --- |
| Provider API keys | Absent — no HTTP client exists in the shell |
| OTP / Convex server secrets | Absent |
| Signing certificates | Absent; `certificateThumbprint` must not be committed |
| localhost / dev server | Absent from the bundle (`devUrl` is used only by `tauri dev`) |
| Sandbox or editor endpoints | Absent |
| Filesystem / shell / process / raw-http capability | **Not granted** |

`VITE_CONVEX_URL` **may** appear: it is intentionally public frontend
configuration, identical on all four surfaces.

### External navigation

A desktop wrapper adds a boundary a browser tab does not have: a link can
leave the webview and become an OS-level "open this URL" request. That is a
route to an open redirect, so `is_allowed_external_url` (Rust, enforcing) and
`isAllowedExternalUrl` (TypeScript, mirrored for the UI and tests) both apply:

1. `https` only — `javascript:`, `data:`, `file:` and `http:` are refused.
2. Host must match an allowlist entry exactly, or be a true subdomain.
   Substring matching is not used, because `xstarz.app.evil.com` contains
   `xstarz.app`.
3. Embedded credentials (`user:pass@host`) are refused.

**The allowlist is empty.** Nothing in the product needs to open an external
site today, and an empty allowlist cannot be abused. A test fails if the Rust
and TypeScript lists ever drift apart.

---

## 5. Distribution paths

### A. Microsoft Store — NOT READY

Tauri emits MSI and EXE, not MSIX. Two routes exist:

| Route | Requirement | Status |
| --- | --- | --- |
| MSIX submission | Repackage the build with `MakeAppx`; identity reserved in Partner Center | Not done — no developer account |
| MSI/EXE submission | Installer signed with a cert chaining to a Microsoft-trusted root; silent install; publisher-hosted HTTPS URL | Not done — no certificate |

Blocking items:

1. **Partner Center account** — the package identity (`Name`, `Publisher`)
   must match the reservation character-for-character. It cannot be guessed.
2. **Code-signing certificate** — self-signed is not accepted for MSI/EXE.
3. **WebView2 mode** — Store policy requires `offlineInstaller`.
4. **Store metadata** — listing, screenshots, age rating, privacy URL. The
   privacy URL needs the official domain (§7).

Nothing is submitted in this phase.

### B. Direct download from the official website — NOT READY

Intended flow:

```
official website → /download → signed installer → install Xstarz Analysis
```

`/download` exists and renders both channels as explicitly **unavailable**.
No download URL is hardcoded, because inventing one would ship a button that
404s. A test asserts no external URL appears in that page.

Blocking items: a code-signing certificate (without one, SmartScreen warns on
every download) and a hosting location for the installer.

---

## 6. Auto-update — documented, deliberately NOT implemented

| Path | Mechanism | Status |
| --- | --- | --- |
| Microsoft Store (MSIX) | Store-managed | Available only via MSIX submission |
| Microsoft Store (MSI/EXE) | **None** — the Store does not update these | App or installer must handle it |
| Direct download | Tauri updater plugin, signed manifest | **Not configured** |

Tauri's updater requires a signing keypair; the public key ships in the app
and the private key signs each release. **An unsigned or unverified updater is
a remote-code-execution channel**, so it is not enabled until signing exists.
The artifact scanner fails the build if an updater endpoint appears.

Versioning is semver in `tauri.conf.json`; `allowDowngrades` is `false`.
Rollback means publishing a higher version containing the previous code —
there is no in-place downgrade.

---

## 7. Official domain — external dependency

The project has **no custom domain**. None is invented anywhere in the code.

When one exists it will serve, with no routing change required:

| Path | Purpose |
| --- | --- |
| `/` | Landing page |
| `/download` | Windows installer and Store links |
| `/auth` | Sign-in |
| `/privacy` | Privacy statement (required for Store submission) |
| `/terms` | Terms of use |

All five are ordinary `BrowserRouter` routes under the existing SPA rewrite
(`vercel.json` and `public/_redirects`). The current Vercel/static hosting is
the deployment base; attaching a domain is a DNS and hosting action, not a
code change.

---

## 8. What is genuinely verified

| Item | Status | Evidence |
| --- | --- | --- |
| Configuration valid | ✅ | Tauri CLI 2.11.4 parses it |
| Shared web build | ✅ | `frontendDist: "../dist"`, asserted by test |
| Absolute asset base | ✅ | Verified in `dist/index.html`; CI re-checks |
| BrowserRouter preserved | ✅ | No MemoryRouter/HashRouter |
| Routes serve correctly | ✅ | `/`, `/auth`, `/dashboard`, `/journal`, `/download`, `/privacy`, `/terms` |
| No secrets in artifacts | ✅ | Scanner + 8 planted mutants caught |
| External-link safety | ✅ | Rust and TS, mutation-tested |
| **Windows compile** | **CI only** | No Rust toolchain and no Windows in the sandbox |
| **Installer runs on Windows** | ❌ **BLOCKED** | No Windows machine |
| **Install / uninstall / update** | ❌ **BLOCKED** | Same |
| **Signed installer** | ❌ **BLOCKED** | No certificate |
| **Store package** | ❌ **BLOCKED** | No Partner Center account |
| **ARM64** | ❌ Not attempted | Documented, not claimed |

A successful Windows CI build means **the application packages**. It does not
mean it installs, runs, or updates correctly on a real machine.
