# Xstarz Analysis release notes — 2026-10-15

## Data fallback improvements

- Crypto tokenomics now tries Tokenomist, then PatternPlus unlock records, then CoinGecko's public supply metrics when those unlock feeds have no usable record.
- CoinGecko fallback provides circulating, total, and maximum supply only. It does **not** invent an unlock schedule; future unlock events remain explicitly unconfirmed when no verified calendar exists.
- When representative volume is unavailable, the structural summary can display a price-only session mean computed from actual OHLC prices, clearly distinguished from VWAP.
- When volume-based VPVR cannot be calculated, the summary uses an available TPO profile as a time-based alternative, clearly distinguished from volume profile.

## Verification

- CoinGecko fallback parser tests cover valid supply values, malformed/missing supply, stale source timestamps, and the absence of fabricated unlock events.
- Zero-volume VWAP fallback tests ensure the price-only mean is labeled as a non-volume-weighted alternative.
- Full repository suite before this release: 7,592 tests passed across 199 test files; production build passed.
- Browser smoke on the previous known-good production deployment covered forex, crypto, stocks, commodities, spot/perpetual/futures contracts, M1 through W1, chart, risk sizing, and recommendations with no console errors.
