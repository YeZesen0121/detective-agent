CREATE TABLE followup_jobs (
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL REFERENCES sessions(id),
 investigation_id TEXT NOT NULL REFERENCES investigations(id),
 result_version_id TEXT NOT NULL REFERENCES result_versions(id),
 research_run_id TEXT NOT NULL REFERENCES runs(id),
 pool_id TEXT NOT NULL REFERENCES budget_pools(id),
 submission_key TEXT NOT NULL, body_hash TEXT NOT NULL, question TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('queued','running','completed','failed')),
 epoch INTEGER NOT NULL DEFAULT 0, started_at TEXT, deadline_at TEXT, ended_at TEXT,
 metered_ms INTEGER NOT NULL DEFAULT 0 CHECK(metered_ms>=0),
 decision_json TEXT CHECK(decision_json IS NULL OR json_valid(decision_json)),
 new_run_id TEXT REFERENCES runs(id), error_code TEXT, latest_version_id TEXT REFERENCES result_versions(id),
 created_at TEXT NOT NULL,
 UNIQUE(session_id,submission_key)
);
CREATE UNIQUE INDEX one_active_followup ON followup_jobs(investigation_id) WHERE status IN ('queued','running');
CREATE INDEX followup_queue ON followup_jobs(status,ordinal);
CREATE TABLE followup_run_inputs (
 run_id TEXT PRIMARY KEY REFERENCES runs(id),
 followup_id TEXT NOT NULL REFERENCES followup_jobs(id),
 result_version_id TEXT NOT NULL REFERENCES result_versions(id),
 question TEXT NOT NULL
);
