CREATE TABLE result_versions (
  id TEXT PRIMARY KEY,
  investigation_id TEXT NOT NULL REFERENCES investigations(id),
  run_id TEXT NOT NULL UNIQUE REFERENCES runs(id),
  previous_version_id TEXT REFERENCES result_versions(id),
  created_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE INDEX results_owner ON result_versions(investigation_id, created_at, id);
CREATE TRIGGER immutable_result_update BEFORE UPDATE ON result_versions BEGIN SELECT RAISE(ABORT, 'Result versions are immutable'); END;
CREATE TRIGGER immutable_result_delete BEFORE DELETE ON result_versions BEGIN SELECT RAISE(ABORT, 'Result versions are immutable'); END;
CREATE TABLE clarifications (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES runs(id),
  proceeded_unknown INTEGER,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE INDEX clarification_run ON clarifications(run_id);
CREATE TABLE run_activity_meter (
  run_id TEXT PRIMARY KEY REFERENCES runs(id),
  metered_ms INTEGER NOT NULL DEFAULT 0 CHECK(metered_ms>=0)
);
CREATE TABLE host_submissions (
  session_id TEXT NOT NULL REFERENCES sessions(id),
  operation TEXT NOT NULL,
  key TEXT NOT NULL,
  body_hash TEXT NOT NULL,
  run_id TEXT NOT NULL REFERENCES runs(id),
  PRIMARY KEY(session_id,operation,key)
);
