CREATE TABLE scope_refinements (
 source_kind TEXT NOT NULL CHECK(source_kind IN ('saved_followup','clarification')),
 source_id TEXT NOT NULL,
 investigation_id TEXT NOT NULL REFERENCES investigations(id),
 run_id TEXT NOT NULL REFERENCES runs(id),
 base_result_version_id TEXT REFERENCES result_versions(id),
 input_hash TEXT NOT NULL,
 before_scope_json TEXT CHECK(before_scope_json IS NULL OR json_valid(before_scope_json)),
 after_scope_json TEXT NOT NULL CHECK(json_valid(after_scope_json)),
 before_scope_version INTEGER NOT NULL CHECK(before_scope_version>=0),
 scope_version INTEGER NOT NULL CHECK(scope_version>=1),
 applied_at TEXT NOT NULL,
 PRIMARY KEY(source_kind,source_id)
);
CREATE TABLE scope_model_receipts (
 preparation_key TEXT NOT NULL,
 schema_id TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 run_id TEXT NOT NULL REFERENCES runs(id),
 call_id TEXT REFERENCES usage_ledger(call_id),
 state TEXT NOT NULL CHECK(state IN ('pending','sent','received','unsent','unknown')),
 response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
 PRIMARY KEY(preparation_key,schema_id)
);
CREATE TABLE watch_scope_pauses (
 watch_id TEXT PRIMARY KEY REFERENCES watches(id),
 scope_version INTEGER NOT NULL,
 paused_at TEXT NOT NULL
);
