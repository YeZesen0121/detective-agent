import type Database from 'better-sqlite3';
import type { ResultPayload, ResultVersion,Watch,Scope } from '../../shared/contracts.js';
import { WatchCheckSchema, WatchSchema,ScopeSchema,ResultVersionSchema } from '../../shared/contracts.js';
import { createHash } from 'node:crypto';
function canonical(value: unknown): string {
 if (Array.isArray(value)) return '[' + value.map(canonical).sort().join(',') + ']';
 if (value !== null && typeof value === 'object') return '{' + Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+canonical(v)).join(',') + '}';
 return JSON.stringify(value);
}
export function factSignature(payload: ResultPayload): string {
 return createHash('sha256').update(canonical({
  claims: payload.claims.map(c=>({ statement:c.statement,status:c.status,conditions:c.conditions,gaps:c.gaps })),
  unknowns:payload.unknowns, conditions:payload.conditions,
  conflicts:payload.conflicts.map(c=>c.description),
  candidates:payload.candidates.map(c=>({name:c.name,matched:c.matchedClues,conflicting:c.conflictingClues,missing:c.missingClues})),
 })).digest('hex');
}
/** Scope increments may follow only recorded user clue refinements, never a new target. */
export function canAdvanceWatchScope(db:Database.Database,watch:Watch,version:ResultVersion,target:number):boolean{
 if(watch.investigationId!==version.investigationId||watch.scopeVersion>target)return false;
 if(watch.scopeVersion===target)return true;
 const row=db.prepare('SELECT payload_json FROM result_versions WHERE id=? AND investigation_id=?').get(watch.baselineVersionId,version.investigationId) as {payload_json:string}|undefined;if(!row)return false;
 let scope=ResultVersionSchema.parse(JSON.parse(row.payload_json)).payload.scope,current=watch.scopeVersion;
 const view=(value:Scope)=>{const{referenceTime:_time,...rest}=value;return canonical(rest);};
 const fixed=(value:Scope)=>{const{referenceTime:_time,knownClues:_known,uncertainClues:_uncertain,...rest}=value;return canonical(rest);};
 for(let depth=0;current<target&&depth<128;depth++){
  const steps=db.prepare('SELECT before_scope_json,after_scope_json FROM scope_refinements WHERE investigation_id=? AND before_scope_version=? AND scope_version=?').all(version.investigationId,current,current+1) as {before_scope_json:string|null;after_scope_json:string}[];
  const matches=steps.flatMap(step=>{if(!step.before_scope_json)return[];const before=ScopeSchema.parse(JSON.parse(step.before_scope_json)),after=ScopeSchema.parse(JSON.parse(step.after_scope_json));return view(before)===view(scope)&&fixed(before)===fixed(after)?[after]:[];});
  if(!matches.length||new Set(matches.map(view)).size!==1)return false;scope=matches[0]!;current++;
 }
 return current===target&&view(scope)===view(version.payload.scope);
}
function cancelWatchChecks(db:Database.Database,id:string,at:string,message:string){
 const active=db.prepare("SELECT payload_json FROM watch_checks WHERE watch_id=? AND status IN ('queued','running')").all(id) as {payload_json:string}[];
 for(const item of active){const check=WatchCheckSchema.parse(JSON.parse(item.payload_json));check.status='cancelled';check.endedAt=at;check.reasonSummary=message;db.prepare("UPDATE watch_checks SET status='cancelled',payload_json=? WHERE id=?").run(JSON.stringify(check),check.id);}
}
/** A cancelled foreground refinement must not leave an unclaimable watch labelled active. */
export function pauseWatchesForScopeRefinement(db:Database.Database,id:string,version:number,at:string){
 const rows=db.prepare("SELECT payload_json FROM watches WHERE investigation_id=? AND status='active'").all(id) as {payload_json:string}[];
 for(const row of rows){const watch=WatchSchema.parse(JSON.parse(row.payload_json));if(watch.scopeVersion===version)continue;
  db.prepare('INSERT OR IGNORE INTO watch_scope_pauses(watch_id,scope_version,paused_at) VALUES (?,?,?)').run(watch.id,watch.scopeVersion,at);
  cancelWatchChecks(db,watch.id,at,'同案线索已更新，旧检查作废，等待新报告。');watch.status='paused';db.prepare("UPDATE watches SET status='paused',epoch=epoch+1,payload_json=? WHERE id=?").run(JSON.stringify(watch),watch.id);
 }
}
/** Called only inside the same transaction as a foreground result commit. */
export function advanceWatchBaselines(db: Database.Database, version: ResultVersion, scopeVersion: number, at: string) {
 const rows = db.prepare("SELECT payload_json FROM watches WHERE investigation_id=? AND status IN ('active','paused','budget_paused')").all(version.investigationId) as {payload_json:string}[];
 for (const row of rows) {
  const watch=WatchSchema.parse(JSON.parse(row.payload_json)),allowed=canAdvanceWatchScope(db,watch,version,scopeVersion);
  cancelWatchChecks(db,watch.id,at,'前台结果已更新，旧检查作废。');
  const automatic=db.prepare('SELECT 1 FROM watch_scope_pauses WHERE watch_id=?').get(watch.id);
  if(allowed){watch.scopeVersion=scopeVersion;watch.baselineVersionId=version.id;if(automatic&&watch.status==='paused')watch.status=Date.parse(at)<Date.parse(watch.expiresAt)?'active':'expired';}else watch.status='paused';
  db.prepare('DELETE FROM watch_scope_pauses WHERE watch_id=?').run(watch.id);
  db.prepare('UPDATE watches SET status=?,epoch=epoch+1,payload_json=? WHERE id=?').run(watch.status,JSON.stringify(watch),watch.id);
 }
}
