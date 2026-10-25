-- One explicit grant per persistent campaign database. Config omission cannot disable it.
CREATE TABLE paid_campaign (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 policy_json TEXT NOT NULL CHECK(json_valid(policy_json)),
 paused INTEGER NOT NULL DEFAULT 0 CHECK(paused IN (0,1))
);
CREATE TABLE paid_campaign_calls (
 call_id TEXT PRIMARY KEY REFERENCES usage_ledger(call_id)
);
