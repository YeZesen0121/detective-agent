CREATE TABLE watches (
 id TEXT PRIMARY KEY, session_id TEXT NOT NULL REFERENCES sessions(id),
 investigation_id TEXT NOT NULL REFERENCES investigations(id),
 status TEXT NOT NULL CHECK(status IN ('active','paused','budget_paused','expired','deleted')),
 epoch INTEGER NOT NULL, period_id TEXT NOT NULL REFERENCES budget_pools(id),
 next_check_at TEXT NOT NULL, expires_at TEXT NOT NULL, last_manual_at TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json))
);
CREATE UNIQUE INDEX one_watch_per_case ON watches(investigation_id) WHERE status IN ('active','paused','budget_paused');
CREATE TABLE watch_periods (
 id TEXT PRIMARY KEY REFERENCES budget_pools(id), watch_id TEXT NOT NULL REFERENCES watches(id),
 created_at TEXT NOT NULL, expires_at TEXT NOT NULL
);
CREATE TABLE watch_checks (
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 watch_id TEXT NOT NULL REFERENCES watches(id),
 period_id TEXT NOT NULL REFERENCES watch_periods(id),
 budget_window_id TEXT REFERENCES budget_pools(id),
 run_id TEXT UNIQUE REFERENCES runs(id), scheduled_for TEXT NOT NULL,
 trigger TEXT NOT NULL CHECK(trigger IN ('scheduled','manual')),
 status TEXT NOT NULL CHECK(status IN ('queued','running','unchanged','changed','unknown','failed','interrupted','cancelled')),
 lease_epoch INTEGER NOT NULL, lease_until TEXT,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 UNIQUE(watch_id,scheduled_for,trigger)
);
CREATE UNIQUE INDEX one_watch_check ON watch_checks(watch_id) WHERE status IN ('queued','running');
CREATE UNIQUE INDEX one_running_watch ON watch_checks((1)) WHERE status='running';
CREATE TABLE version_links (
 from_version_id TEXT NOT NULL REFERENCES result_versions(id),
 to_version_id TEXT NOT NULL UNIQUE REFERENCES result_versions(id), reason TEXT NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(from_version_id,to_version_id)
);
INSERT INTO version_links SELECT previous_version_id,id,'既有结果版本关联。',created_at FROM result_versions WHERE previous_version_id IS NOT NULL;
CREATE TABLE notifications (
 ordinal INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT NOT NULL UNIQUE,
 session_id TEXT NOT NULL REFERENCES sessions(id), watch_id TEXT NOT NULL REFERENCES watches(id),
 watch_check_id TEXT NOT NULL REFERENCES watch_checks(id),
 change_key TEXT NOT NULL, target_version_id TEXT NOT NULL REFERENCES result_versions(id),
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 UNIQUE(watch_id,change_key)
);
CREATE TABLE watch_requests (
 session_id TEXT NOT NULL REFERENCES sessions(id), kind TEXT NOT NULL,
 key TEXT NOT NULL, body_hash TEXT NOT NULL, response_id TEXT NOT NULL,
 PRIMARY KEY(session_id,kind,key)
);
