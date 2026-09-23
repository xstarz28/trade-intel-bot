#!/usr/bin/env bash
# Phase 236 — mutation suite for the Android packaging job's guard.
#
# The premise: the Android job's value is entirely in its failure behaviour and
# in the assertions it makes about its own output. Every mutant below is a way
# that value can be deleted by an edit that still looks reasonable.
#
#   M1  explicit `packages` removed (falls back to the action default)
#   M2  the exact regression: `tools platform-tools` (the removed package)
#   M3  `packages` set to empty (setup becomes a no-op that "succeeds")
#   M4  job-level continue-on-error (a dead job still reports success)
#   M5  `if: false` (the job is skipped, not failed)
#   M6  `set -euo pipefail` removed from the APK step
#   M7  Gradle failure swallowed with `|| true`
#   M8  "an APK was produced" assertion removed
#   M9  "the web assets are inside the APK" assertion weakened
#   M10 "the asset base is absolute" assertion weakened
#   M11 packaged-artifact secret scan step removed
#   M12 native-project sync step removed (stale assets could ship)
#   M13 `working-directory: android` removed from the APK step
#   M14 job timeout removed (a hung build runs for six hours)
#   M15 `--stacktrace` removed (undiagnosable failures, as in Phase 236)
#   M16 artifact upload step removed
#   M17 a credential is injected into the job
#   M18 JDK downgraded below the Android Gradle Plugin floor
#   M19 the whole Android SDK setup step removed
#   M20 the job is moved off a Linux runner
#   M21 step-level continue-on-error on the APK step
#
# ESCAPING (lessons kept from Phases 233–235)
#   * each perl program is written from a SINGLE-quoted bash argument and handed
#     to perl via `-e "$(cat …)"`, so bash expands nothing;
#   * `\Q…\E` does NOT protect the s/// delimiter — `#` is used where the pattern
#     contains `|`;
#   * `\Q…\E` does NOT stop variable or array interpolation, does NOT expand
#     `\n`, and does NOT process `\$`/`\@` — so `$APK` is written
#     `\E\x24\QAPK` and `@v4` is written `\E\x40\Qv4`, with newlines sitting
#     OUTSIDE the quoted spans. (Two of these were found by this suite reporting
#     INVALID/SKIP for its own patterns, which is why those verdicts exist.)
#
# SAFETY
# Restore is byte-exact via `cmp` against a `.p236bak` snapshot, under a `trap`.
# A mutation that changes zero bytes is reported INVALID, never "passed".
set -uo pipefail
cd "$(dirname "$0")/.."

WORKFLOW=".github/workflows/mobile.yml"

TARGETS=("$WORKFLOW")
for f in "${TARGETS[@]}"; do cp "$f" "$f.p236bak"; done

restore() {
  for f in "${TARGETS[@]}"; do
    cp "$f.p236bak" "$f"
    cmp -s "$f" "$f.p236bak" || { echo "FATAL: could not restore $f"; exit 2; }
  done
}
trap 'restore; for f in "${TARGETS[@]}"; do rm -f "$f.p236bak"; done' EXIT

# The guard that must catch every mutant.
export P236="src/lib/hosting/mobile-android-ci.phase236.test.ts"

PASSED=0; FAILED=0; N=0

# $1 label, $2 target file, $3 expectation (catch|survive), $4 perl program,
# rest: test paths
mutate() {
  local label="$1"; shift
  local target="$1"; shift
  local expect="$1"; shift
  local program="$1"; shift

  N=$((N+1))
  printf '%s' "$program" >"/tmp/p236_${N}.pl"
  perl -0pi -e "$(cat "/tmp/p236_${N}.pl")" "$target" \
    || {
      echo "SKIP     $label (perl failed — a mutant that never applied proves nothing)"
      FAILED=$((FAILED+1)); restore; return
    }

  local changed=0
  for f in "${TARGETS[@]}"; do cmp -s "$f" "$f.p236bak" || changed=1; done
  if [ "$changed" -eq 0 ]; then
    echo "INVALID  $label (no bytes changed — mutation is a no-op)"
    FAILED=$((FAILED+1)); restore; return
  fi

  if npx vitest run "$@" >"/tmp/p236_${N}.log" 2>&1; then
    if [ "$expect" = "survive" ]; then
      echo "CORRECT  $label (equivalent mutant — correctly not flagged)"
      PASSED=$((PASSED+1))
    else
      echo "SURVIVED $label   <-- GUARD GAP"
      FAILED=$((FAILED+1))
    fi
  else
    if [ "$expect" = "survive" ]; then
      echo "FALSE+   $label   <-- guard now flags a behaviourally inert change"
      FAILED=$((FAILED+1))
    else
      echo "CAUGHT   $label"
      PASSED=$((PASSED+1))
    fi
  fi
  restore
}

echo "=== Phase 236 mutation suite ==="

# ── the SDK package set: the actual 2026-09-15 regression ──────────────────
mutate "M1 explicit packages removed (action default returns)" "$WORKFLOW" catch '
s#\Q          packages: "platform-tools"\E\n##' "$P236"

mutate "M2 the exact regression: tools platform-tools" "$WORKFLOW" catch '
s|\Q          packages: "platform-tools"\E|          packages: "tools platform-tools"|' "$P236"

mutate "M3 packages emptied (setup becomes a no-op)" "$WORKFLOW" catch '
s|\Q          packages: "platform-tools"\E|          packages: ""|' "$P236"

mutate "M19 the Android SDK setup step removed entirely" "$WORKFLOW" catch '
s#\Q      - uses: android-actions/setup-android\E\x40\Qv3\E\n\Q        with:\E\n\Q          packages: "platform-tools"\E\n##' "$P236"

# ── the job must not be able to report success while doing nothing ─────────
mutate "M4 job-level continue-on-error" "$WORKFLOW" catch '
s#\Q    timeout-minutes: 45\E#    timeout-minutes: 45\n    continue-on-error: true#' "$P236"

mutate "M5 if: false on the job" "$WORKFLOW" catch '
s#\Q    timeout-minutes: 45\E#    timeout-minutes: 45\n    if: false#' "$P236"

mutate "M14 job timeout removed" "$WORKFLOW" catch '
s#\Q    timeout-minutes: 45\E\n##' "$P236"

mutate "M20 the job is moved off a Linux runner" "$WORKFLOW" catch '
s|\Q    runs-on: ubuntu-latest\E|    runs-on: windows-latest|' "$P236"

# ── the APK step must fail loudly ──────────────────────────────────────────
mutate "M6 set -euo pipefail removed from the APK step" "$WORKFLOW" catch '
s#\Q        run: |\E\n\Q          set -euo pipefail\E\n\Q          ./gradlew assembleDebug\E#        run: |\n          ./gradlew assembleDebug#' "$P236"

mutate "M7 Gradle failure swallowed with || true" "$WORKFLOW" catch '
s#\Q          ./gradlew assembleDebug --no-daemon --stacktrace\E#          ./gradlew assembleDebug --no-daemon --stacktrace || true#' "$P236"

mutate "M21 step-level continue-on-error on the APK step" "$WORKFLOW" catch '
s#\Q      - name: Assemble debug APK\E#      - name: Assemble debug APK\n        continue-on-error: true#' "$P236"

mutate "M15 --stacktrace removed" "$WORKFLOW" catch '
s|\Q --no-daemon --stacktrace\E| --no-daemon|' "$P236"

mutate "M13 working-directory removed from the APK step" "$WORKFLOW" catch '
s#\Q      - name: Assemble debug APK\E\n\Q        working-directory: android\E#\Q      - name: Assemble debug APK\E#' "$P236"

# ── the APK step must still prove what it produced ─────────────────────────
mutate "M8 'an APK was produced' assertion removed" "$WORKFLOW" catch '
s#\Q          test -n "\E\x24\QAPK" || { echo "::error::no APK produced"; exit 1; }\E\n##' "$P236"

mutate "M9 'web assets inside the APK' assertion weakened" "$WORKFLOW" catch '
s|\Q'"'"'assets/public/index.html'"'"'\E|'"'"'assets/public/'"'"'|' "$P236"

mutate "M10 'asset base is absolute' assertion weakened" "$WORKFLOW" catch '
s|\Q'"'"'src="/assets/'"'"'\E|'"'"'src="assets/'"'"'|' "$P236"

# ── supporting steps that must not disappear ───────────────────────────────
mutate "M11 packaged-artifact secret scan removed" "$WORKFLOW" catch '
s#\Q      - name: Verify packaged artifacts contain no secrets\E\n\Q        run: npm run mobile:verify\E\n##' "$P236"

mutate "M12 native-project sync step removed" "$WORKFLOW" catch '
s#\Q      - name: Build web assets and sync into the native project\E\n\Q        run: npm run mobile:sync:android\E\n##' "$P236"

mutate "M16 artifact upload step removed" "$WORKFLOW" catch '
s#\Q      - name: Upload APK\E\n\Q        uses: actions/upload-artifact\E\x40\Qv4\E\n##' "$P236"

# ── no credentials, and a toolchain the build supports ─────────────────────
mutate "M17 a credential is injected into the job" "$WORKFLOW" catch '
s#\Q      - uses: android-actions/setup-android\E\x40\Qv3\E#      - uses: android-actions/setup-android\x40v3\n        env:\n          ANDROID_KEY: \x24{{ secrets.ANDROID_KEY }}#' "$P236"

mutate "M18 JDK downgraded below the AGP floor" "$WORKFLOW" catch '
s|\Q          java-version: "21"\E|          java-version: "8"|' "$P236"

echo
echo "mutants CAUGHT: $PASSED; gaps: $FAILED"
[ "$FAILED" -eq 0 ]
