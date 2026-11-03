# ESLint baseline

The repository-wide lint baseline is tracked in [eslint-baseline-2026-11-02.json](./eslint-baseline-2026-11-02.json).

## Baseline

- Source run: main CI run [#41399012659](https://github.com/xstarz28/trade-intel-bot/actions/runs/41399012659).
- **1,400 errors and 28 warnings across 217 files** (1,428 total diagnostics).
- Dominant rules: `@typescript-eslint/no-unused-vars` (769) and `@typescript-eslint/no-explicit-any` (602).
- React Hooks compiler diagnostics are grouped by their specific rule in the JSON report.

## Remediation policy

1. Reduce the baseline monotonically; do not add blanket disables, downgrade rules, or exclude broad source trees.
2. Prioritize production-critical market data, forecast, fundamentals, execution, and authentication modules.
3. Add blocking strict lint coverage for critical modules that are already clean.
4. CI enforces a per-file/per-rule baseline ratchet: new or increased violations fail, while existing debt can be reduced incrementally.
5. Keep full zero-debt acceptance open until the repository reaches zero errors and zero warnings; then remove the baseline ratchet and retain strict full lint.
6. Re-run and refresh the machine-readable report after each baseline milestone.

The JSON report is a dated snapshot, not a waiver or an acceptance of outstanding violations. PRs #241 and #242 reduced confirmed violations without changing lint rules; continue tightening the baseline after every verified cleanup milestone.
