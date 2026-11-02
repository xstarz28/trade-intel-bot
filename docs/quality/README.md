# ESLint baseline

The repository-wide lint baseline is tracked in [eslint-baseline-2026-11-02.json](./eslint-baseline-2026-11-02.json).

## Baseline

- Source run: main CI run [#4454](https://github.com/xstarz28/trade-intel-bot/actions/runs/41391878537)
- 1,459 errors and 28 warnings across 231 files (latest main CI run #41395127276). The initial measured baseline was 1,503 errors / 28 warnings.
- Dominant rules: `@typescript-eslint/no-unused-vars` (828) and `@typescript-eslint/no-explicit-any` (602).
- React Hooks compiler diagnostics are separately grouped by rule in the JSON report.

## Remediation policy

1. Reduce the baseline monotonically; do not add blanket disables, downgrade rules, or exclude broad source trees.
2. Prioritize production-critical market data, forecast, fundamentals, execution, and authentication modules.
3. Add blocking strict lint coverage for critical modules that are already clean.
4. CI enforces a per-file/per-rule baseline ratchet now: new or increased violations fail, while existing debt can be reduced incrementally.
5. Keep full zero-debt acceptance open until the repository reaches zero errors and zero warnings; then remove the baseline ratchet and retain strict full lint.
6. Re-run and refresh the machine-readable report after each baseline milestone.

The JSON report is a dated snapshot, not a waiver or an acceptance of outstanding violations. The baseline was reduced by 44 errors without changing lint rules; continue tightening it after every verified cleanup milestone.
