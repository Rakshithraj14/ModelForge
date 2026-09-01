CREATE TABLE IF NOT EXISTS models (
  model_id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  version TEXT NOT NULL,
  endpoint TEXT,
  schema_json TEXT,
  baseline_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS telemetry (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL REFERENCES models(model_id),
  model_version TEXT,
  prediction_id TEXT,
  ts TEXT NOT NULL,
  features_json TEXT NOT NULL,
  prediction INTEGER NOT NULL,
  probability REAL NOT NULL,
  latency_ms REAL,
  data_quality_score REAL,
  actual INTEGER
);

CREATE INDEX IF NOT EXISTS idx_telemetry_model_ts ON telemetry(model_id, ts);
CREATE UNIQUE INDEX IF NOT EXISTS idx_telemetry_prediction_id ON telemetry(prediction_id);

CREATE TABLE IF NOT EXISTS drift_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL REFERENCES models(model_id),
  ts TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  scores_json TEXT NOT NULL,
  max_severity TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_drift_reports_model_ts ON drift_reports(model_id, ts);

CREATE TABLE IF NOT EXISTS performance_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  model_id TEXT NOT NULL REFERENCES models(model_id),
  ts TEXT NOT NULL,
  sample_size INTEGER NOT NULL,
  accuracy REAL NOT NULL,
  precision REAL NOT NULL,
  recall REAL NOT NULL,
  f1 REAL NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_performance_reports_model_ts ON performance_reports(model_id, ts);
