-- Core Trade Intel domain schema extracted from src/convex/schema.ts.
-- Legacy market-radar scheduler/source/candidate tables are intentionally excluded:
-- the global scanner was removed and must not be reintroduced during migration.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT,
  image TEXT,
  email TEXT COLLATE NOCASE UNIQUE,
  email_verified_at INTEGER,
  is_anonymous INTEGER NOT NULL DEFAULT 0 CHECK (is_anonymous IN (0, 1)),
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('admin', 'user', 'member')),
  google_subject TEXT UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE auth_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL
);
CREATE INDEX auth_sessions_user_expiry ON auth_sessions(user_id, expires_at);
CREATE INDEX auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE oauth_flows (
  state_hash TEXT PRIMARY KEY,
  nonce TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX oauth_flows_expiry ON oauth_flows(expires_at);

CREATE TABLE analyses (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  bias TEXT NOT NULL,
  confidence REAL NOT NULL,
  recommendation TEXT,
  conviction TEXT,
  no_trade_reasons TEXT CHECK (no_trade_reasons IS NULL OR json_valid(no_trade_reasons)),
  risk_reward REAL,
  trading_style TEXT,
  technical_summary TEXT NOT NULL,
  fundamental_summary TEXT NOT NULL,
  breakdown TEXT NOT NULL CHECK (json_valid(breakdown)),
  key_levels TEXT NOT NULL CHECK (json_valid(key_levels)),
  risk_note TEXT NOT NULL,
  data_completeness TEXT NOT NULL,
  data_flags TEXT NOT NULL CHECK (json_valid(data_flags)),
  price REAL,
  data_source TEXT,
  sentiment_summary TEXT,
  sentiment_score REAL,
  macro_summary TEXT,
  derivatives_summary TEXT,
  calendar_summary TEXT,
  timestamp INTEGER NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX analyses_user_timestamp ON analyses(user_id, timestamp DESC);

CREATE TABLE fundamental_observations (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  instrument TEXT NOT NULL,
  fiscal_period_end TEXT,
  reported_date TEXT NOT NULL,
  eps REAL,
  revenue REAL,
  first_observed_at INTEGER NOT NULL,
  last_retrieved_at INTEGER NOT NULL,
  UNIQUE(provider, instrument, reported_date)
);
CREATE INDEX fundamentals_instrument_reported ON fundamental_observations(instrument, reported_date);

CREATE TABLE sec_edgar_observations (
  id TEXT PRIMARY KEY,
  ticker TEXT NOT NULL,
  cik TEXT NOT NULL,
  accession_number TEXT NOT NULL,
  form TEXT NOT NULL,
  filing_date TEXT NOT NULL,
  acceptance_date_time TEXT,
  fiscal_period_start TEXT NOT NULL,
  fiscal_period_end TEXT NOT NULL,
  fiscal_year INTEGER,
  fiscal_period TEXT,
  eps REAL,
  revenue REAL,
  eps_tag TEXT,
  revenue_tag TEXT,
  source_url TEXT NOT NULL,
  first_observed_at INTEGER NOT NULL,
  last_retrieved_at INTEGER NOT NULL,
  UNIQUE(ticker, accession_number)
);
CREATE INDEX sec_edgar_ticker_filing_date ON sec_edgar_observations(ticker, filing_date);

CREATE TABLE journal (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  instrument TEXT NOT NULL,
  instrument_type TEXT NOT NULL,
  timeframe TEXT NOT NULL,
  style TEXT NOT NULL,
  analysis_snapshot TEXT NOT NULL CHECK (json_valid(analysis_snapshot)),
  status TEXT NOT NULL,
  entry REAL,
  stop_loss REAL,
  take_profit REAL,
  risk_reward REAL,
  position_size REAL,
  notional_value REAL,
  exit_price REAL,
  pnl REAL,
  pnl_percent REAL,
  outcome TEXT,
  closed_at INTEGER,
  entry_reason TEXT,
  thesis_at_entry TEXT,
  confirmation_observed TEXT,
  invalidation_observed TEXT,
  what_went_right TEXT,
  what_went_wrong TEXT,
  lessons TEXT,
  notes TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX journal_user_created ON journal(user_id, created_at DESC);
CREATE INDEX journal_user_instrument ON journal(user_id, instrument);
CREATE INDEX journal_user_status ON journal(user_id, status);

CREATE TABLE monitored_positions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL,
  entry_price REAL NOT NULL,
  stop_loss REAL,
  take_profit REAL,
  leverage REAL,
  horizon TEXT NOT NULL,
  opened_at INTEGER NOT NULL,
  peak_price REAL,
  peak_profit REAL,
  current_severity TEXT NOT NULL,
  lifecycle_state TEXT NOT NULL,
  monitoring_lifecycle TEXT NOT NULL,
  last_update_at INTEGER NOT NULL,
  last_alert_at INTEGER NOT NULL,
  consecutive_same_severity INTEGER NOT NULL,
  UNIQUE(user_id, position_id)
);
CREATE INDEX monitored_positions_user_lifecycle ON monitored_positions(user_id, monitoring_lifecycle);
CREATE INDEX monitored_positions_user_instrument ON monitored_positions(user_id, instrument);

CREATE TABLE alert_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL,
  position_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  severity TEXT NOT NULL,
  notification_priority TEXT NOT NULL,
  reason TEXT NOT NULL,
  action TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  acknowledged INTEGER NOT NULL DEFAULT 0 CHECK (acknowledged IN (0, 1)),
  UNIQUE(user_id, alert_id)
);
CREATE INDEX alert_history_user_timestamp ON alert_history(user_id, timestamp DESC);
CREATE INDEX alert_history_user_position_timestamp ON alert_history(user_id, position_id, timestamp DESC);

CREATE TABLE stream_cursors (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  instrument TEXT NOT NULL,
  last_event_id TEXT NOT NULL,
  last_timestamp INTEGER NOT NULL,
  last_sequence INTEGER,
  UNIQUE(user_id, provider, instrument)
);

CREATE TABLE historical_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  thesis_state TEXT NOT NULL,
  evidence_quality TEXT NOT NULL,
  market_regime TEXT NOT NULL,
  h1_trend TEXT NOT NULL,
  m15_trend TEXT NOT NULL,
  m5_trend TEXT NOT NULL,
  mtf_alignment TEXT NOT NULL,
  momentum TEXT NOT NULL,
  volatility TEXT NOT NULL,
  structure TEXT NOT NULL,
  supporting_count INTEGER NOT NULL,
  conflicting_count INTEGER NOT NULL,
  invalidation_condition TEXT NOT NULL,
  watch_next TEXT NOT NULL,
  data_availability TEXT NOT NULL
);
CREATE INDEX historical_snapshots_user_position_ts ON historical_snapshots(user_id, position_id, timestamp DESC);

CREATE TABLE alert_rules (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  rule_id TEXT NOT NULL,
  name TEXT NOT NULL,
  enabled INTEGER NOT NULL CHECK (enabled IN (0, 1)),
  scope TEXT NOT NULL,
  instrument TEXT,
  position_id TEXT,
  condition TEXT NOT NULL,
  severity TEXT NOT NULL,
  cooldown_ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(user_id, rule_id)
);
CREATE INDEX alert_rules_user ON alert_rules(user_id);

CREATE TABLE rule_alert_history (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  alert_id TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  position_id TEXT,
  instrument TEXT,
  condition TEXT NOT NULL,
  severity TEXT NOT NULL,
  description TEXT NOT NULL,
  previous_state TEXT,
  current_state TEXT,
  timestamp INTEGER NOT NULL,
  UNIQUE(user_id, alert_id)
);
CREATE INDEX rule_alert_history_user_timestamp ON rule_alert_history(user_id, timestamp DESC);
CREATE INDEX rule_alert_history_user_rule_timestamp ON rule_alert_history(user_id, rule_id, timestamp DESC);

CREATE TABLE notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL,
  alert_identity TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  rule_name TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  instrument TEXT,
  position_id TEXT,
  side TEXT,
  severity TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  category TEXT NOT NULL,
  impact TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0 CHECK (read IN (0, 1)),
  dismissed INTEGER NOT NULL DEFAULT 0 CHECK (dismissed IN (0, 1)),
  source TEXT NOT NULL,
  condition TEXT NOT NULL,
  UNIQUE(user_id, notification_id)
);
CREATE INDEX notifications_user_timestamp ON notifications(user_id, timestamp DESC);
CREATE INDEX notifications_user_read_timestamp ON notifications(user_id, read, timestamp DESC);

CREATE TABLE notification_preferences (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
  minimum_severity TEXT NOT NULL DEFAULT 'INFO',
  enabled_categories TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(enabled_categories)),
  enabled_scopes TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(enabled_scopes)),
  muted_rule_ids TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(muted_rule_ids)),
  enabled_instruments TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(enabled_instruments)),
  muted_instruments TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(muted_instruments)),
  show_read_notifications INTEGER NOT NULL DEFAULT 1 CHECK (show_read_notifications IN (0, 1)),
  show_dismissed_notifications INTEGER NOT NULL DEFAULT 0 CHECK (show_dismissed_notifications IN (0, 1)),
  updated_at INTEGER NOT NULL
);

CREATE TABLE historical_events (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  position_id TEXT NOT NULL,
  instrument TEXT NOT NULL,
  side TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  event_type TEXT NOT NULL,
  description TEXT NOT NULL,
  previous_state TEXT NOT NULL,
  current_state TEXT NOT NULL,
  category TEXT NOT NULL,
  strength TEXT NOT NULL
);
CREATE INDEX historical_events_user_position_ts ON historical_events(user_id, position_id, timestamp DESC);

CREATE TABLE runtime_health_snapshots (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  timestamp INTEGER NOT NULL,
  overall_status TEXT NOT NULL,
  components TEXT NOT NULL CHECK (json_valid(components)),
  intelligence_cycle_status TEXT NOT NULL,
  alert_pipeline_status TEXT NOT NULL,
  persistence_status TEXT NOT NULL,
  provider_availability TEXT NOT NULL CHECK (json_valid(provider_availability)),
  stale_components TEXT NOT NULL CHECK (json_valid(stale_components)),
  unavailable_components TEXT NOT NULL CHECK (json_valid(unavailable_components))
);
CREATE INDEX runtime_health_user_timestamp ON runtime_health_snapshots(user_id, timestamp DESC);
