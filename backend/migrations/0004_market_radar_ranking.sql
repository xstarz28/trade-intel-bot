ALTER TABLE market_radar_opportunities ADD COLUMN asset_class TEXT NOT NULL DEFAULT 'unknown';
ALTER TABLE market_radar_opportunities ADD COLUMN score REAL NOT NULL DEFAULT 0;
CREATE INDEX market_radar_opportunities_rank_idx ON market_radar_opportunities(horizon, score DESC, updated_at DESC);
