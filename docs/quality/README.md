# ESLint baseline

The repository-wide lint baseline is tracked in [eslint-baseline-2026-11-02.json](./eslint-baseline-2026-11-02.json).

## Baseline

- Source run: main CI run [#4454](https://github.com/xstarz28/trade-intel-bot/actions/runs/41391878537)
- 1,503 errors and 28 warnings across 231 files.
- Dominant rules: `@typescript-eslint/no-unused-vars` (828) and `@typescript-eslint/no-explicit-any` (602).
- React Hooks compiler diagnostics are separately grouped by rule in the JSON report.

## Remediation policy

1. Reduce the baseline monotonically; do not add blanket disables, downgrade rules, or exclude broad source trees.
2. Prioritize production-critical market data, forecast, fundamentals, execution, and authentication modules.
3. Add blocking strict lint coverage for critical modules that are already clean.
4. Keep full repository lint advisory until it reaches zero errors and zero warnings, then make it blocking.
5. Re-run and refresh the machine-readable report after each baseline milestone.

The JSON report is a dated snapshot, not a waiver or an acceptance of outstanding violations.
