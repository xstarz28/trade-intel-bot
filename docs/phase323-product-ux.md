# Phase 323 — Product UX / Productization

Date: 2026-10-05. Branch: `arena/01a0d195-trade-intel-bot`. Base: phase 322 tip `314987b`.
Product-surface only: no provider logic, analysis algorithms, risk math, provenance rules,
Convex schema/workflow, or auth architecture touched. Roadmap locked: 324 pricing, 325 final pass.

## 1. User journey audit (traced, not assumed)

Route map: `/` Landing → `/auth` (Google + guest, preserved) → `/dashboard` (protected;
workspace switcher trader/investor; tabs Analysis/Protection; investor: Portfolio/
Intelligence/Analysis) → instrument select → Analyze → multi-step factual loading → result
(SignalCard → bias header → data quality → context panels → decision rationale) → history
(bottom on mobile, sidebar on desktop) → `/journal`, `/download`, `/build`, legal pages.

Findings & actions:

| # | Finding | Action |
|---|---|---|
| J1 | Header brand block was dead (no way back to the workspace home) | brand icon is now a real `Link` to `/dashboard` with hover/focus ring (dropdown stays outside the link — no nested interactive) |
| J2 | Primary action used a sparkle-adjacent Zap glyph | InstrumentInput Analyze button now uses `Play` — "run analysis" label kept (human, lowercase terminal voice) |
| J3 | Loading screen had a Zap glyph inside the spinner and no `∞`-free honest stats | glyph removed (restrained ring); empty-state instruments stat shows the REAL discovered catalog count (`discoveredInstruments.length`, `—` when discovery hasn't run) instead of `∞` |
| J4 | Loading progress used raw emerald/red palette | steel progress vocabulary: done = muted check + `text-foreground/70`, active = primary spinner, error = `X` icon + `text-destructive`; error boxes moved to `border-destructive/25 bg-destructive/5` tokens (2 sites) |
| J5 | No dead ends found in the analysis flow; hierarchy of the result already matches PRIMARY DECISION (SignalCard: chart/plan/levels) → bias+conviction header → evidence → methodology | no IA change (deliberate) |

## 2. Phase-322 follow-ups corrected (decorative only — semantics preserved)

- **violet/purple fully removed from app source (0 occurrences)**: fundamental completeness chip
  + market-context accent (AnalysisResult), order-book rows → neutral steel, defi/equity
  intelligence dots, crypto asset-class chip + RESTRICTED status (MarketOpportunities), macro dot
  (MarketOverviewPanel), protection notice chip (PositionProtectionDetail), Landing factor-weight
  accents, HistoricalTimeline `VOLATILITY_CHANGE`, and `SIMULATED` source-mode tag
  (data-source-mode.ts) → muted steel (a simulated source must NOT carry brand illumination).
- **Semantic colors preserved**: bullish/bearish emerald/red, warnings amber, LIVE/POLLING source
  modes — all untouched.
- **⛔ emoji → lucide `Ban`** (NO_TRADE badge + rejection panel); loading `✗` glyph → lucide `X`.
- **Blur restraint**: `backdrop-blur-xl` → `backdrop-blur-md` on Dashboard + Landing headers.

## 3. State handling (audited)

Empty (Terminal Ready + first-run guide + honest stats), loading (5 factual steps: detecting
instrument → fetching market data → fetching intelligence → calculating indicators → generating
bias), unavailable (failure-class-mapped factual messages, no env/provider names leaked — phase
189 rule intact), entitlement-locked (server-authoritative LockedSignalNotice), stale/partial
(data-quality panel, informational-not-directional). No "AI thinking" language anywhere.
Auth page already factual (Google/guest CTA + fixed failure copy) — audited, no change needed.

## 4. Mobile

No layout metrics changed (color/icon/class-level edits only). Existing mobile hierarchy intact:
input first, result below, history at bottom; `native-shell` safe-area rules untouched.
No horizontal overflow introduced (radius/color token changes only).

## 5. Pricing preparation (boundary inventory only — no pricing built)

Existing capability boundaries that Phase 324 can price against (all already
server-authoritative): `EntitlementBadge` (plan state + `upgradeComingSoon` honesty),
`LockedSignalNotice` (server-withheld signal never rendered as WAIT), guest `remaining` counter
with the UNKNOWN-not-zero rule (phase 188). No tiers, no limits, no upgrade marketing invented.

## 6. Validation

| Check | Result |
|---|---|
| `tsc -b` | 0 errors |
| `npm run build` **with** `VITE_CONVEX_URL` (CI-exact mode) | ✓ |
| phase323 suite (19 tests) + phase322 identity suite | 19/19 + 10/10 PASS |
| Full suite against the real dist | **493 files / 15,323 PASS \| 0 FAIL \| 9 skipped** |
| AI-style copy scan / emoji scan / violet scan / blur scan | all clean (pinned by tests) |

## 7. Remaining UX limitations (honest)

1. Desktop sidebar hides MarketOpportunities on mobile (`lg:block`) — acceptable density choice,
   revisit if 324/325 want mobile scanning.
2. Result section ordering is the pre-323 authored order (decision-first already); deeper
   regrouping (e.g., dedicated "Evidence" accordion) is possible without backend changes and is
   deliberately deferred — the current hierarchy tests pass and the IA change would be churn
   without a demonstrated dead end.
3. Localization: no copy keys changed in this phase, so all 10 locales stay untouched.
