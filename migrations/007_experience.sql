CREATE TABLE private_assets (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
 investigation_id TEXT NOT NULL REFERENCES investigations(id),
 kind TEXT NOT NULL CHECK(kind IN ('attachment','audio')), mime TEXT NOT NULL,
 byte_size INTEGER NOT NULL CHECK(byte_size>0), sha256 TEXT NOT NULL, storage_key TEXT NOT NULL UNIQUE,
 created_at TEXT NOT NULL, expires_at TEXT, deleted_at TEXT, purged_at TEXT
);
CREATE INDEX private_assets_owner ON private_assets(session_id,kind,deleted_at);
CREATE TABLE attachments (
 id TEXT PRIMARY KEY REFERENCES private_assets(id), investigation_id TEXT NOT NULL REFERENCES investigations(id),
 session_id TEXT NOT NULL REFERENCES sessions(id), sort_order INTEGER NOT NULL CHECK(sort_order BETWEEN 0 AND 2),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), questions_json TEXT NOT NULL DEFAULT '[]' CHECK(json_valid(questions_json)), deleted_at TEXT
);
CREATE UNIQUE INDEX live_attachment_order ON attachments(investigation_id,sort_order) WHERE deleted_at IS NULL;
CREATE TABLE attachment_submissions (
 session_id TEXT NOT NULL REFERENCES sessions(id), key TEXT NOT NULL, body_hash TEXT NOT NULL,
 attachment_id TEXT NOT NULL REFERENCES attachments(id), PRIMARY KEY(session_id,key)
);
CREATE TABLE result_attachment_refs (
 result_version_id TEXT NOT NULL REFERENCES result_versions(id), attachment_id TEXT NOT NULL REFERENCES attachments(id),
 PRIMARY KEY(result_version_id,attachment_id)
);
CREATE TRIGGER retain_linked_attachment BEFORE UPDATE OF deleted_at ON attachments
 WHEN NEW.deleted_at IS NOT NULL AND EXISTS(SELECT 1 FROM result_attachment_refs WHERE attachment_id=OLD.id)
 BEGIN SELECT RAISE(ABORT,'Result attachment must be retained'); END;
CREATE TABLE experience_scopes (
 investigation_id TEXT PRIMARY KEY REFERENCES investigations(id), session_id TEXT NOT NULL REFERENCES sessions(id),
 pool_id TEXT NOT NULL UNIQUE REFERENCES budget_pools(id), epoch INTEGER NOT NULL DEFAULT 0,
 characters_used INTEGER NOT NULL DEFAULT 0 CHECK(characters_used>=0),
 characters_reserved INTEGER NOT NULL DEFAULT 0 CHECK(characters_reserved>=0), paused INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE companion_sessions (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id), investigation_id TEXT NOT NULL REFERENCES investigations(id),
 result_version_id TEXT NOT NULL REFERENCES result_versions(id), persona_id TEXT NOT NULL, persona_version TEXT NOT NULL,
 voice_id TEXT, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 UNIQUE(session_id,result_version_id,persona_id,persona_version)
);
CREATE TABLE experience_jobs (
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL REFERENCES sessions(id), investigation_id TEXT NOT NULL REFERENCES investigations(id),
 companion_session_id TEXT NOT NULL REFERENCES companion_sessions(id), result_version_id TEXT NOT NULL REFERENCES result_versions(id),
 kind TEXT NOT NULL CHECK(kind IN ('companion','turn','audio')), epoch INTEGER NOT NULL DEFAULT 0,
 status TEXT NOT NULL CHECK(status IN ('queued','running','completed','partial','failed','cancelled')),
 request_json TEXT NOT NULL CHECK(json_valid(request_json)), output_json TEXT CHECK(output_json IS NULL OR json_valid(output_json)),
 error_code TEXT, started_at TEXT, deadline_at TEXT, ended_at TEXT, metered_ms INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
);
CREATE INDEX experience_queue ON experience_jobs(status,ordinal);
CREATE TABLE experience_admissions (
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL REFERENCES sessions(id),
 job_id TEXT NOT NULL REFERENCES experience_jobs(id), admitted_at TEXT NOT NULL
);
CREATE INDEX experience_rate ON experience_admissions(session_id,admitted_at);
CREATE TABLE experience_activity (
 job_id TEXT NOT NULL REFERENCES experience_jobs(id), epoch INTEGER NOT NULL, started_at TEXT NOT NULL,
 ended_at TEXT, metered_ms INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(job_id,epoch)
);
CREATE UNIQUE INDEX one_experience_active ON experience_jobs(investigation_id) WHERE status='running';
CREATE TABLE experience_submissions (
 session_id TEXT NOT NULL REFERENCES sessions(id), operation TEXT NOT NULL, key TEXT NOT NULL,
 body_hash TEXT NOT NULL, job_id TEXT NOT NULL REFERENCES experience_jobs(id), PRIMARY KEY(session_id,operation,key)
);
CREATE TABLE companion_turns (
 id TEXT PRIMARY KEY REFERENCES experience_jobs(id), companion_session_id TEXT NOT NULL REFERENCES companion_sessions(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE audio_jobs (
 id TEXT PRIMARY KEY REFERENCES experience_jobs(id), cache_key TEXT NOT NULL UNIQUE,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE TABLE audio_chunks (
 job_id TEXT NOT NULL REFERENCES audio_jobs(id), chunk_index INTEGER NOT NULL CHECK(chunk_index>=0 AND chunk_index<100),
 asset_id TEXT NOT NULL REFERENCES private_assets(id), text_hash TEXT NOT NULL,
 PRIMARY KEY(job_id,chunk_index)
);
CREATE TABLE experience_tts_attempts (
 id TEXT PRIMARY KEY, job_id TEXT NOT NULL REFERENCES experience_jobs(id), pool_id TEXT NOT NULL REFERENCES budget_pools(id),
 epoch INTEGER NOT NULL, chunk_index INTEGER, request_hash TEXT, call_id TEXT REFERENCES usage_ledger(call_id),
 characters INTEGER NOT NULL CHECK(characters>0), status TEXT NOT NULL CHECK(status IN ('reserved','sent','unknown','settled','released')),
 created_at TEXT NOT NULL
);
