import type Database from 'better-sqlite3';
import {IdSchema,InvestigationSchema} from '../../shared/contracts.js';
import {DeleteInvestigationResponseSchema,type DeleteInvestigationResponse} from '../../shared/investigations-http.js';
import {ApiFault} from './errors.js';

/** User-authorized content erasure only. Payment facts and all budget amounts survive. */
export function deleteInvestigation(db:Database.Database,owner:string,id:string):DeleteInvestigationResponse{
 IdSchema.parse(owner);IdSchema.parse(id);
 return db.transaction(()=>{
  const row=db.prepare('SELECT payload_json FROM investigations WHERE id=? AND session_id=?').get(id,owner) as {payload_json:string}|undefined;
  if(!row)throw new ApiFault(404,'NOT_FOUND','未找到该调查；已删除的案卷不能再次读取。');
  const investigation=InvestigationSchema.parse(JSON.parse(row.payload_json));
  const runs='SELECT id FROM runs WHERE investigation_id=?',versions='SELECT id FROM result_versions WHERE investigation_id=?';
  const jobs='SELECT id FROM experience_jobs WHERE investigation_id=?',watches='SELECT id FROM watches WHERE investigation_id=?';
  const companions='SELECT id FROM companion_sessions WHERE investigation_id=?',attachments='SELECT id FROM attachments WHERE investigation_id=?';
  const active=investigation.activeRunId||[
   "SELECT 1 FROM runs WHERE investigation_id=? AND status IN ('queued','running','waiting_for_user')",
   "SELECT 1 FROM followup_jobs WHERE investigation_id=? AND status IN ('queued','running')",
   "SELECT 1 FROM experience_jobs WHERE investigation_id=? AND status IN ('queued','running')",
   "SELECT 1 FROM watches WHERE investigation_id=? AND status='active'",
   `SELECT 1 FROM watch_checks WHERE watch_id IN (${watches}) AND status IN ('queued','running')`,
   `SELECT 1 FROM usage_ledger WHERE status IN ('sent','reserved') AND (json_extract(context_json,'$.investigationId')=? OR json_extract(context_json,'$.runId') IN (${runs}))`,
  ].some(sql=>!!db.prepare(sql).get(...(sql.includes("$.runId")?[id,id]:[id])));
  if(active)throw new ApiFault(409,'INVALID_STATE','本案仍有活动任务、监测或在途请求，请先停止并等待结束后删除。');
  // Corrupt cross-case links must fail closed rather than erase another case's relationship.
  if(db.prepare('SELECT 1 FROM version_links l JOIN result_versions a ON a.id=l.from_version_id JOIN result_versions b ON b.id=l.to_version_id WHERE (a.investigation_id=? AND b.investigation_id<>?) OR (b.investigation_id=? AND a.investigation_id<>?)').get(id,id,id,id))throw new ApiFault(409,'INVALID_STATE','案卷关联不一致，未删除任何内容。');
  const trigger=db.prepare("SELECT sql FROM sqlite_master WHERE type='trigger' AND name='immutable_result_delete' AND tbl_name='result_versions'").get() as {sql:string}|undefined;
  if(!trigger?.sql)throw new ApiFault(409,'INVALID_STATE','报告删除保护无法核对，未删除任何内容。');
  const assetCount=(db.prepare('SELECT count(*) n FROM private_assets WHERE investigation_id=?').get(id) as {n:number}).n;
  const erase=(sql:string,...values:string[])=>db.prepare(sql).run(...(values.length?values:[id]));
  erase(`DELETE FROM provider_model_traces WHERE call_id IN (SELECT call_id FROM usage_ledger WHERE json_extract(context_json,'$.investigationId')=? OR json_extract(context_json,'$.runId') IN (${runs}))`,id,id);
  erase(`DELETE FROM scope_model_receipts WHERE run_id IN (${runs})`);
  erase('DELETE FROM scope_refinements WHERE investigation_id=?');
  for(const table of ['experience_admissions','experience_activity','experience_submissions','experience_tts_attempts'])erase(`DELETE FROM ${table} WHERE job_id IN (${jobs})`);
  erase(`DELETE FROM companion_turns WHERE companion_session_id IN (${companions})`);
  erase(`DELETE FROM audio_chunks WHERE job_id IN (${jobs})`);
  erase(`DELETE FROM audio_jobs WHERE id IN (${jobs})`);
  erase('DELETE FROM experience_jobs WHERE investigation_id=?');
  erase('DELETE FROM companion_sessions WHERE investigation_id=?');
  erase('DELETE FROM experience_scopes WHERE investigation_id=?');
  erase(`DELETE FROM followup_run_inputs WHERE run_id IN (${runs})`);
  erase('DELETE FROM followup_jobs WHERE investigation_id=?');
  erase(`DELETE FROM notifications WHERE watch_id IN (${watches})`);
  erase(`DELETE FROM watch_requests WHERE session_id=? AND (response_id IN (${watches}) OR response_id IN (SELECT id FROM watch_checks WHERE watch_id IN (${watches})))`,owner,id,id);
  erase(`DELETE FROM watch_checks WHERE watch_id IN (${watches})`);
  erase(`DELETE FROM watch_scope_pauses WHERE watch_id IN (${watches})`);
  erase(`DELETE FROM watch_periods WHERE watch_id IN (${watches})`);
  erase('DELETE FROM watches WHERE investigation_id=?');
  erase(`DELETE FROM version_links WHERE from_version_id IN (${versions}) OR to_version_id IN (${versions})`,id,id);
  erase(`DELETE FROM result_attachment_refs WHERE result_version_id IN (${versions})`);
  erase(`DELETE FROM attachment_submissions WHERE attachment_id IN (${attachments})`);
  erase('DELETE FROM attachments WHERE investigation_id=?');
  // No filesystem deletion here. Existing UUID-only orphan GC reclaims private files.
  erase('DELETE FROM private_assets WHERE investigation_id=?');
  // Only this explicitly authorized transaction may remove immutable reports. SQLite
  // rolls DDL back as well as content if anything fails; the UPDATE guard stays active.
  db.exec('DROP TRIGGER immutable_result_delete');
  erase('DELETE FROM result_versions WHERE investigation_id=?');
  db.exec(trigger.sql);
  for(const table of ['clarifications','run_checkpoints','run_activity_meter','task_admissions','run_submissions','host_submissions'])erase(`DELETE FROM ${table} WHERE run_id IN (${runs})`);
  erase('DELETE FROM progress_events WHERE investigation_id=?');
  erase('DELETE FROM runs WHERE investigation_id=?');
  erase('DELETE FROM idempotency_records WHERE response_ref=?');
  erase('DELETE FROM investigations WHERE id=?');
  return DeleteInvestigationResponseSchema.parse({investigationId:id,deleted:true,billingAuditRetained:true,mediaCleanup:assetCount?'managed_by_existing_gc':'not_needed'});
 }).immediate();
}
