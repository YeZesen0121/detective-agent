-- T02a foundation only. T02b adds runs, budgets, working material and snapshots.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  token_hash TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE TABLE investigations (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  created_at TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE INDEX investigations_owner ON investigations(session_id, created_at, id);
CREATE TABLE idempotency_records (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  response_ref TEXT NOT NULL REFERENCES investigations(id),
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  PRIMARY KEY (session_id, operation, key)
);
