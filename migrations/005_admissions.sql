CREATE TABLE task_admissions (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id),
  run_id TEXT NOT NULL REFERENCES runs(id),
  kind TEXT NOT NULL CHECK(kind IN ('start','answer')),
  operation_key TEXT NOT NULL,
  admitted_at TEXT NOT NULL,
  UNIQUE(session_id, kind, operation_key)
);
CREATE INDEX admission_rate ON task_admissions(session_id, admitted_at);
INSERT INTO task_admissions(session_id,run_id,kind,operation_key,admitted_at)
  SELECT s.session_id,s.run_id,'start',s.key,json_extract(r.payload_json,'$.queuedAt')
  FROM host_submissions s JOIN runs r ON r.id=s.run_id;
INSERT INTO task_admissions(session_id,run_id,kind,operation_key,admitted_at)
  SELECT i.session_id,c.run_id,'answer',c.id,json_extract(c.payload_json,'$.answeredAt')
  FROM clarifications c JOIN runs r ON r.id=c.run_id JOIN investigations i ON i.id=r.investigation_id
  WHERE json_extract(c.payload_json,'$.answeredAt') IS NOT NULL;
