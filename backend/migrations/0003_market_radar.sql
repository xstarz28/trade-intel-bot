CREATE TABLE market_radar_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  cursor INTEGER NOT NULL DEFAULT 0,
  lease_until INTEGER NOT NULL DEFAULT 0,
  last_scan_at INTEGER NOT NULL DEFAULT 0,
  metrics_json TEXT NOT NULL DEFAULT '{}',
  errors_json TEXT NOT NULL DEFAULT '[]'
);
INSERT OR IGNORE INTO market_radar_state (id) VALUES (1);

CREATE TABLE market_radar_sources (
  source_key TEXT PRIMARY KEY,
  instrument TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  asset_class TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX market_radar_sources_updated_idx ON market_radar_sources(updated_at DESC);

CREATE TABLE market_radar_opportunities (
  horizon TEXT NOT NULL,
  instrument TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (horizon, instrument)
);
CREATE INDEX market_radar_opportunities_updated_idx ON market_radar_opportunities(updated_at DESC);
