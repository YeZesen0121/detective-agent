import type Database from 'better-sqlite3';
import { ClarificationSchema,RunSchema,type Investigation,type Run,type Scope } from '../../shared/contracts.js';
import { FollowupDecisionSchema,type PreparationInput } from '../../shared/ports.js';
import { ApiFault } from './errors.js';
import { hashValue,stableJson } from './snapshots.js';
export type ScopeInputSource={kind:'saved_followup'|'clarification';id:string;question:string;baseVersionId:string|null;proceedWithUnknown:boolean};
const invalid=()=>new ApiFault(409,'INVALID_STATE','线索更新与已保存的用户输入或范围不一致。');
const applied=(db:Database.Database,kind:string,id:string)=>!!db.prepare('SELECT 1 FROM scope_refinements WHERE source_kind=? AND source_id=?').get(kind,id);

export function pendingScopeInputs(db:Database.Database,run:Run,inv:Investigation):ScopeInputSource[]{
 const result:ScopeInputSource[]=[];
 const linked=db.prepare('SELECT f.followup_id,f.result_version_id,f.question,j.result_version_id AS original_version_id,j.session_id,j.investigation_id,j.question AS saved_question,j.status,j.decision_json FROM followup_run_inputs f JOIN followup_jobs j ON j.id=f.followup_id WHERE f.run_id=?').get(run.id) as {followup_id:string;result_version_id:string;original_version_id:string;question:string;session_id:string;investigation_id:string;saved_question:string;status:string;decision_json:string|null}|undefined;
 if(linked){
  if(linked.session_id!==inv.sessionId||linked.investigation_id!==inv.id||linked.question!==linked.saved_question||linked.status!=='completed'||!linked.decision_json)throw invalid();
  if(linked.result_version_id!==inv.latestResultVersionId)throw new ApiFault(409,'STALE_VERSION','补查基线已有更新，请从最新报告继续。');
  const decision=FollowupDecisionSchema.parse(JSON.parse(linked.decision_json));
  if(!['research_same_scope','needs_budget_confirmation'].includes(decision.route))throw invalid();
  if(!applied(db,'saved_followup',linked.followup_id))result.push({kind:'saved_followup',id:linked.followup_id,question:linked.question,baseVersionId:linked.original_version_id,proceedWithUnknown:false});
 }
 let cursor=run;const seen=new Set<string>();
 for(let depth=0;depth<64;depth++){
  if(seen.has(cursor.id))throw invalid();seen.add(cursor.id);
  const row=db.prepare('SELECT payload_json,proceeded_unknown FROM clarifications WHERE run_id=? ORDER BY rowid DESC LIMIT 1').get(cursor.id) as {payload_json:string;proceeded_unknown:number|null}|undefined;
  if(row){const q=ClarificationSchema.parse(JSON.parse(row.payload_json));if(q.answeredAt&&!applied(db,'clarification',q.id))result.push({kind:'clarification',id:q.id,question:q.answer??'',baseVersionId:null,proceedWithUnknown:!!row.proceeded_unknown});break;}
  if(cursor.trigger!=='resume'||!cursor.previousRunId)break;
  const prior=db.prepare('SELECT payload_json FROM runs WHERE id=?').get(cursor.previousRunId) as {payload_json:string}|undefined;if(!prior)throw invalid();cursor=RunSchema.parse(JSON.parse(prior.payload_json));if(cursor.investigationId!==inv.id)throw invalid();
  if(depth===63)throw invalid();
 }
 return result;
}
export function followupPreparation(source:ScopeInputSource|undefined):PreparationInput['followup']{
 return source?{kind:'saved_followup',turnId:source.id,resultVersionId:source.baseVersionId!,question:source.question}:undefined;
}
export function validateClueRefinement(before:Scope,after:Scope,sources:ScopeInputSource[]){
 const identity=(scope:Scope)=>{const{knownClues:_known,uncertainClues:_uncertain,...rest}=scope;return rest;};
 if(!sources.some(source=>source.question.trim())||stableJson(identity(before))!==stableJson(identity(after)))throw invalid();
 const retained=new Set([...after.knownClues,...after.uncertainClues]);
 if([...before.knownClues,...before.uncertainClues].some(clue=>!retained.has(clue)))throw invalid();
 if(after.knownClues.some(clue=>after.uncertainClues.includes(clue)))throw invalid();
}
export function recordScopeInputs(db:Database.Database,sources:ScopeInputSource[],run:Run,before:Scope|null,after:Scope,beforeVersion:number,scopeVersion:number,at:string){
 for(const source of sources)db.prepare('INSERT INTO scope_refinements(source_kind,source_id,investigation_id,run_id,base_result_version_id,input_hash,before_scope_json,after_scope_json,before_scope_version,scope_version,applied_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(source.kind,source.id,run.investigationId,run.id,source.baseVersionId,hashValue({question:source.question,proceedWithUnknown:source.proceedWithUnknown}),before?JSON.stringify(before):null,JSON.stringify(after),beforeVersion,scopeVersion,at);
}
