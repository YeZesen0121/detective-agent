-- Usage policy is separate from historical grants and accounting. Never reset usage.
CREATE TABLE usage_policy (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  unrestricted INTEGER NOT NULL CHECK (unrestricted IN (0, 1)),
  updated_at TEXT NOT NULL
);
