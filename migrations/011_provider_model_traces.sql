CREATE TABLE provider_model_traces (
 call_id TEXT PRIMARY KEY REFERENCES usage_ledger(call_id),
 schema_id TEXT NOT NULL,
 prompt_version TEXT NOT NULL,
 request_hash TEXT NOT NULL,
 request_json TEXT CHECK(request_json IS NULL OR json_valid(request_json)),
 request_omitted INTEGER NOT NULL CHECK(request_omitted IN (0,1)),
 response_hash TEXT,
 response_json TEXT CHECK(response_json IS NULL OR json_valid(response_json)),
 response_omitted INTEGER NOT NULL DEFAULT 0 CHECK(response_omitted IN (0,1)),
 model_id TEXT,
 finish_reason TEXT
);
