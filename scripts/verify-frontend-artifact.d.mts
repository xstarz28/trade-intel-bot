/**
 * Types for `verify-frontend-artifact.mjs`.
 *
 * The checker is plain JavaScript because CI and the deploy workflow must be
 * able to run it with `node` alone, before any build tooling is involved — the
 * whole point is to judge an artifact that already exists. That makes the
 * module untyped at the call site unless it is declared, and an untyped import
 * into a `strict` project is how a checker silently drifts away from the tests
 * that pin its contract.
 *
 * The declarations mirror the exports exactly. The behaviour is pinned by
 * `src/lib/deployment/frontend-artifact.phase299.test.ts`, which fails if the
 * two ever disagree about what the artifact must contain.
 */

/** Retired build-platform surfaces: the hosted site, its toolbar, its env vars. */
export const RETIRED_PLATFORM_MARKERS: string[];

/** Retired email-OTP sign-in surface (Phase 270). */
export const RETIRED_OTP_MARKERS: string[];

export type OklchToken = { l: number; c: number; h: number };

/** The brand primary the current source defines (Xstarz blue, hue 255). */
export const BRAND_PRIMARY_OKLCH: OklchToken;
export const BRAND_PRIMARY_OKLCH_DARK: OklchToken;

/** The retired teal-green primary the legacy scaffold shipped (hue 170). */
export const RETIRED_PRIMARY_OKLCH: OklchToken;
export const RETIRED_XSTARZ_BLUE_PRIMARY_OKLCH: OklchToken;

/** `--primary` declarations parsed from a CSS asset, minified or not. */
export function primaryTokens(css: string): OklchToken[];

/** Numeric comparison, so `oklch(0.52 0.18 255)` and `oklch(52% .18 255)` agree. */
export function colorMatches(token: OklchToken, want: OklchToken): boolean;

/** Current auth surface copy (i18n strings, shipped in the bundle). */
export const CURRENT_AUTH_MARKERS: string[];

/** A meta tag's `content`, whatever the attribute order or quote style. */
export function metaContent(html: string, name: string): string | null;

export type TextAsset = { name: string; text: string };

export type FrontendArtifactInput = {
  indexHtml: string | null;
  buildInfoText: string | null;
  textAssets: TextAsset[];
  cssText: string;
  /** What the artifact must agree with; absent means "report, do not require". */
  expected?: { commit?: string | null; branch?: string | null; requireClean?: boolean };
};

export type FrontendArtifactCheck = { name: string; ok: boolean; detail: string };

export type FrontendArtifactResult = { ok: boolean; checks: FrontendArtifactCheck[] };

/**
 * Judge a built artifact. Pure: it reads the given strings and never the
 * filesystem, so the same evaluation can be run against a recorded build.
 */
export function evaluateFrontendArtifact(input: FrontendArtifactInput): FrontendArtifactResult;

/** One line per check, for a CI log or a deploy guard's output. */
export function formatReport(result: FrontendArtifactResult): string;
