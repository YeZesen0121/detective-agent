CREATE TABLE runs (
  ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  status TEXT NOT NULL CHECK (status IN ('queued','running','waiting_for_user','completed','partial','failed','cancelled','interrupted')),
  epoch INTEGER NOT NULL CHECK (epoch >= 0),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE UNIQUE INDEX one_active_run ON runs(investigation_id) WHERE status IN ('queued','running','waiting_for_user');
CREATE INDEX run_queue ON runs(status, ordinal);
CREATE TABLE run_submissions (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  PRIMARY KEY (session_id,key)
);
CREATE TABLE run_checkpoints (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json))
);
CREATE TABLE progress_events (
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  seq INTEGER NOT NULL CHECK (seq > 0),
  visibility TEXT NOT NULL CHECK (visibility IN ('public','internal')),
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
  PRIMARY KEY (investigation_id,seq)
);
