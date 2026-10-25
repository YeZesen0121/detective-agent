CREATE TABLE budget_pools (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('global','access_group','window','interaction')),
  access_group TEXT CHECK (access_group IN ('trial','demo')),
  session_id TEXT,
  investigation_id TEXT,
  limits_json TEXT NOT NULL CHECK (json_valid(limits_json)),
  used_json TEXT NOT NULL CHECK (json_valid(used_json)),
  reserved_json TEXT NOT NULL CHECK (json_valid(reserved_json)),
  state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('active','paused')),
  revision INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE usage_ledger (
  call_id TEXT PRIMARY KEY,
  context_json TEXT NOT NULL CHECK (json_valid(context_json)),
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  purpose TEXT NOT NULL,
  price_revision TEXT,
  attempt_no INTEGER NOT NULL CHECK (attempt_no >= 1),
  status TEXT NOT NULL CHECK (status IN ('reserved','sent','settled','failed','unknown','released')),
  estimated_json TEXT NOT NULL CHECK (json_valid(estimated_json)),
  actual_json TEXT CHECK (actual_json IS NULL OR json_valid(actual_json)),
  provider_request_id TEXT,
  error_code TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT,
  settled_at TEXT
);
CREATE TABLE call_pool_reservations (
  call_id TEXT NOT NULL REFERENCES usage_ledger(call_id),
  pool_id TEXT NOT NULL REFERENCES budget_pools(id),
  PRIMARY KEY (call_id,pool_id)
);
CREATE TABLE usage_reconciliations (
  id INTEGER PRIMARY KEY,
  call_id TEXT NOT NULL REFERENCES usage_ledger(call_id),
  previous_status TEXT NOT NULL,
  actual_json TEXT NOT NULL CHECK (json_valid(actual_json)),
  provider_request_id TEXT,
  created_at TEXT NOT NULL
);
