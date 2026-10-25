import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import { BrowserSessionSchema, CompanionSessionSchema, CompanionTurnSchema, type CompanionSession, type InvocationContext, type BudgetAmounts } from '../../shared/contracts.js';
import { CompanionDraftSchema, CompanionReplySchema, type CompanionDraft, type CompanionReply, type PersonaSchema } from '../../shared/ports.js';
import { CompanionPatchSchema } from '../../shared/experience-http.js';
import { BudgetBook } from './budget.js';
import { ApiFault, BudgetLimitFault } from './errors.js';
import { hashValue, readSnapshot } from './snapshots.js';
export const INTERACTION_LIMITS:BudgetAmounts=Object.freeze({activeMs:1200000,searches:0,reads:0,modelCalls:30,inputTokens:200000,outputTokens:30000,moneyMicros:5000000});
export const DEFAULT_PERSONA:z.infer<typeof PersonaSchema>=Object.freeze({id:'default',version:'detective-v1',name:'侦探',traits:['重证据','保留未知'],style:'简短说明材料、限定和缺口，人物口气不改变事实。'});
export type ExperienceKind='companion'|'turn'|'audio';
export type ExperienceStatus='queued'|'running'|'completed'|'partial'|'failed'|'cancelled';
export type ExperienceJob={id:string;sessionId:string;investigationId:string;companionId:string;resultVersionId:string;kind:ExperienceKind;epoch:number;status:ExperienceStatus;request:Record<string,unknown>;output:unknown;errorCode:string|null;startedAt:string|null;deadlineAt:string|null;meteredMs:number;createdAt:string};
type JobRow={id:string;session_id:string;investigation_id:string;companion_session_id:string;result_version_id:string;kind:ExperienceKind;epoch:number;status:ExperienceStatus;request_json:string;output_json:string|null;error_code:string|null;started_at:string|null;deadline_at:string|null;metered_ms:number;created_at:string};
const missing=()=>new ApiFault(404,'NOT_FOUND','未找到该伴读或任务。');
const invalid=(message='该操作不适用于当前状态。')=>new ApiFault(409,'INVALID_STATE',message);
const pools=(ctx:InvocationContext)=>['runtime:global','runtime:'+ctx.accessGroup,ctx.interactionPoolId!];
export class ExperienceStore {
 readonly book:BudgetBook;
 constructor(readonly db:Database.Database,readonly serviceEndsAt:string){this.book=new BudgetBook(db);}
 private rowJob(row:JobRow):ExperienceJob{return{id:row.id,sessionId:row.session_id,investigationId:row.investigation_id,companionId:row.companion_session_id,resultVersionId:row.result_version_id,kind:row.kind,epoch:row.epoch,status:row.status,request:JSON.parse(row.request_json),output:row.output_json?JSON.parse(row.output_json):null,errorCode:row.error_code,startedAt:row.started_at,deadlineAt:row.deadline_at,meteredMs:row.metered_ms,createdAt:row.created_at};}
 job(id:string,owner?:string){const row=(owner?this.db.prepare('SELECT * FROM experience_jobs WHERE id=? AND session_id=?').get(id,owner):this.db.prepare('SELECT * FROM experience_jobs WHERE id=?').get(id)) as JobRow|undefined;return row?this.rowJob(row):null;}
 session(owner:string,at:string,requireLive=true){const row=this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(owner) as {payload_json:string}|undefined;if(!row)throw missing();const session=BrowserSessionSchema.parse(JSON.parse(row.payload_json));if(requireLive&&(session.revokedAt||Date.parse(at)>=Date.parse(session.expiresAt)||Date.parse(at)>=Date.parse(this.serviceEndsAt)))throw new ApiFault(401,'UNAUTHENTICATED','会话或服务已结束。');return session;}
 budget(owner:string,investigationId:string,at:string){
  const session=this.session(owner,at);if(!this.db.prepare('SELECT 1 FROM investigations WHERE id=? AND session_id=?').get(investigationId,owner))throw missing();
  const scope=this.db.prepare('SELECT pool_id,epoch,characters_used,characters_reserved FROM experience_scopes WHERE investigation_id=? AND session_id=?').get(investigationId,owner) as {pool_id:string;epoch:number;characters_used:number;characters_reserved:number}|undefined;
  if(!scope)return{snapshot:null,ttsCharacters:null};
  const context:InvocationContext={sessionId:owner,accessGroup:session.accessGroup,investigationId,runId:null,budgetWindowId:null,interactionPoolId:scope.pool_id,epoch:scope.epoch,watchCheckId:null,watchLeaseEpoch:null,deadlineAt:this.serviceEndsAt};
  return{snapshot:this.book.snapshot(context,pools(context)),ttsCharacters:{limit:this.book.unrestricted?null:20000,used:scope.characters_used,reserved:scope.characters_reserved,remaining:this.book.unrestricted?null:Math.max(0,20000-scope.characters_used-scope.characters_reserved)}};
 }
 scope(owner:string,inv:string,at:string){
  const session=this.session(owner,at);let row=this.db.prepare('SELECT pool_id FROM experience_scopes WHERE investigation_id=? AND session_id=?').get(inv,owner) as {pool_id:string}|undefined;
  if(!row){const poolId=randomUUID();this.book.createPool({id:poolId,kind:'interaction',sessionId:owner,investigationId:inv,accessGroup:session.accessGroup,limits:INTERACTION_LIMITS});this.db.prepare('INSERT INTO experience_scopes(investigation_id,session_id,pool_id) VALUES (?,?,?)').run(inv,owner,poolId);row={pool_id:poolId};}return row.pool_id;
 }
 private admit(owner:string,at:string){
  const total=this.db.prepare("SELECT (SELECT count(*) FROM experience_jobs WHERE status='queued')+(SELECT count(*) FROM runs WHERE status='queued') n").get() as {n:number};
  const own=this.db.prepare("SELECT (SELECT count(*) FROM experience_jobs WHERE session_id=? AND status='queued')+(SELECT count(*) FROM runs r JOIN investigations i ON i.id=r.investigation_id WHERE i.session_id=? AND r.status='queued') n").get(owner,owner) as {n:number};
  const recent=this.db.prepare('SELECT count(*) n FROM experience_admissions WHERE session_id=? AND admitted_at>?').get(owner,new Date(Date.parse(at)-60000).toISOString()) as {n:number};
  if(total.n>=20)throw new ApiFault(429,'QUEUE_FULL','后台队列已满。',true);if(own.n>=2||recent.n>=10)throw new ApiFault(429,'RATE_LIMITED','交互过于频繁，请稍后再试。',true);
 }
 prior(owner:string,operation:string,key:string,body:unknown){z.string().min(8).max(128).parse(key);const row=this.db.prepare('SELECT job_id,body_hash FROM experience_submissions WHERE session_id=? AND operation=? AND key=?').get(owner,operation,key) as {job_id:string;body_hash:string}|undefined;if(row&&row.body_hash!==hashValue(body))throw new ApiFault(409,'IDEMPOTENCY_CONFLICT','该提交标识已用于不同操作。');return row?this.job(row.job_id,owner):null;}
 remember(owner:string,operation:string,key:string,body:unknown,id:string){this.db.prepare('INSERT INTO experience_submissions VALUES (?,?,?,?,?)').run(owner,operation,key,hashValue(body),id);}
 enqueue(owner:string,companion:CompanionSession,kind:ExperienceKind,request:Record<string,unknown>,at:string){
  this.admit(owner,at);this.scope(owner,companion.investigationId,at);const id=randomUUID();
  this.db.prepare("INSERT INTO experience_jobs(id,session_id,investigation_id,companion_session_id,result_version_id,kind,status,request_json,created_at) VALUES (?,?,?,?,?,?,'queued',?,?)").run(id,owner,companion.investigationId,companion.id,companion.resultVersionId,kind,JSON.stringify(request),at);this.db.prepare('INSERT INTO experience_admissions(session_id,job_id,admitted_at) VALUES (?,?,?)').run(owner,id,at);return this.job(id)!;
 }
 requeue(id:string,owner:string,at:string){this.session(owner,at);const job=this.job(id,owner);if(!job||!['failed','partial','cancelled'].includes(job.status))throw invalid();this.admit(owner,at);this.db.prepare("UPDATE experience_jobs SET status='queued',error_code=NULL,output_json=NULL WHERE id=?").run(id);this.db.prepare('INSERT INTO experience_admissions(session_id,job_id,admitted_at) VALUES (?,?,?)').run(owner,id,at);return this.job(id)!;}
 createCompanion(owner:string,versionId:string,key:string,at:string){return this.db.transaction(()=>{
  const version=readSnapshot(this.db,versionId,owner);if(!version)throw missing();const body={versionId,personaVersion:DEFAULT_PERSONA.version};
  const prior=this.prior(owner,'companion',key,body);if(prior)return this.companion(prior.companionId,owner).session;
  const row=this.db.prepare('SELECT id,payload_json FROM companion_sessions WHERE session_id=? AND result_version_id=? AND persona_id=? AND persona_version=?').get(owner,versionId,DEFAULT_PERSONA.id,DEFAULT_PERSONA.version) as {id:string;payload_json:string}|undefined;
  let companion:CompanionSession;
  if(row){companion=CompanionSessionSchema.parse(JSON.parse(row.payload_json));if(companion.status!=='failed'&&!(companion.status==='ended'&&companion.segments.length===0)){
   const existing=this.db.prepare("SELECT id FROM experience_jobs WHERE companion_session_id=? AND kind='companion' ORDER BY ordinal DESC LIMIT 1").get(companion.id) as {id:string};this.remember(owner,'companion',key,body,existing.id);return companion;
  }companion={...companion,status:'generating',segments:[],cursor:0,deliveredClaimIds:[]};this.saveCompanion(companion);
  }else{companion=CompanionSessionSchema.parse({id:randomUUID(),investigationId:version.investigationId,resultVersionId:versionId,personaVersion:DEFAULT_PERSONA.version,status:'generating',segments:[],cursor:0,deliveredClaimIds:[],createdAt:at});
   this.db.prepare('INSERT INTO companion_sessions(id,session_id,investigation_id,result_version_id,persona_id,persona_version,payload_json) VALUES (?,?,?,?,?,?,?)').run(companion.id,owner,version.investigationId,versionId,DEFAULT_PERSONA.id,DEFAULT_PERSONA.version,JSON.stringify(companion));}
  const job=this.enqueue(owner,companion,'companion',{personaId:DEFAULT_PERSONA.id},at);this.remember(owner,'companion',key,body,job.id);return companion;
 }).immediate();}
 companion(id:string,owner:string){const row=this.db.prepare('SELECT payload_json,voice_id FROM companion_sessions WHERE id=? AND session_id=?').get(id,owner) as {payload_json:string;voice_id:string|null}|undefined;if(!row)throw missing();const session=CompanionSessionSchema.parse(JSON.parse(row.payload_json));const next=this.db.prepare("SELECT r.payload_json FROM result_versions r JOIN investigations i ON i.id=r.investigation_id WHERE i.id=? AND r.id=json_extract(i.payload_json,'$.latestResultVersionId')").get(session.investigationId) as {payload_json:string}|undefined;
  const latest=next?JSON.parse(next.payload_json) as {id:string;createdAt:string}:null;return{session,voiceId:row.voice_id,updateNotice:latest&&latest.id!==session.resultVersionId?{latestResultVersionId:latest.id,createdAt:latest.createdAt}:null};}
 private saveCompanion(session:CompanionSession){this.db.prepare('UPDATE companion_sessions SET payload_json=? WHERE id=?').run(JSON.stringify(CompanionSessionSchema.parse(session)),session.id);}
 patchCompanion(id:string,owner:string,input:z.infer<typeof CompanionPatchSchema>,at:string){return this.db.transaction(()=>{
  const patch=CompanionPatchSchema.parse(input),{session}=this.companion(id,owner);
  if(patch.cursor!==undefined&&patch.cursor>session.segments.length)throw new ApiFault(400,'VALIDATION_ERROR','伴读位置超出段落范围。');
  if(patch.ended===false&&(!['ready','ended'].includes(session.status)||session.segments.length<3))throw invalid();
  if(patch.ended===true){const jobs=this.db.prepare("SELECT id FROM experience_jobs WHERE companion_session_id=? AND status IN ('queued','running')").all(id) as {id:string}[];for(const job of jobs)this.cancel(job.id,owner,at);}
  const cursor=patch.cursor??session.cursor,updated={...session,cursor,status:patch.ended===true?'ended' as const:patch.ended===false?'ready' as const:session.status,deliveredClaimIds:[...new Set([...session.deliveredClaimIds,...session.segments.slice(0,cursor).flatMap(s=>s.claimIds)])]};this.saveCompanion(updated);return updated;
 }).immediate();}
 createTurn(owner:string,id:string,key:string,question:string,at:string){return this.db.transaction(()=>{const body={id,question},prior=this.prior(owner,'turn',key,body);if(prior)return prior;
  const {session}=this.companion(id,owner);if(session.status!=='ready'||session.segments.length<3)throw invalid();const job=this.enqueue(owner,session,'turn',{question:z.string().trim().min(1).max(2000).parse(question)},at);this.remember(owner,'turn',key,body,job.id);return job;
 }).immediate();}
 claim(at:string){return this.db.transaction(()=>{
  const row=this.db.prepare("SELECT j.* FROM experience_jobs j WHERE j.status='queued' AND NOT EXISTS(SELECT 1 FROM experience_jobs active WHERE active.investigation_id=j.investigation_id AND active.status='running') AND NOT EXISTS(SELECT 1 FROM followup_jobs f WHERE f.investigation_id=j.investigation_id AND f.status='running') ORDER BY j.ordinal LIMIT 1").get() as JobRow|undefined;if(!row)return null;
  this.db.prepare('UPDATE experience_scopes SET epoch=epoch+1 WHERE investigation_id=?').run(row.investigation_id);const scope=this.db.prepare('SELECT epoch,pool_id FROM experience_scopes WHERE investigation_id=?').get(row.investigation_id) as {epoch:number;pool_id:string};
  const session=this.session(row.session_id,at,false),initialDeadline=this.book.unrestricted?Date.parse(this.serviceEndsAt):Math.min(Date.parse(this.serviceEndsAt),Date.parse(at)+120000);
  const ctx:InvocationContext={sessionId:row.session_id,accessGroup:session.accessGroup,investigationId:row.investigation_id,runId:null,budgetWindowId:null,interactionPoolId:scope.pool_id,epoch:scope.epoch,watchCheckId:null,watchLeaseEpoch:null,deadlineAt:new Date(initialDeadline).toISOString()};
  const deadline=this.book.unrestricted?this.serviceEndsAt:new Date(Math.min(initialDeadline,Date.parse(at)+this.book.snapshot(ctx,pools(ctx)).remaining.activeMs)).toISOString();
  this.db.prepare("UPDATE experience_jobs SET status='running',epoch=?,started_at=?,deadline_at=?,ended_at=NULL,metered_ms=0,error_code=NULL WHERE id=? AND status='queued'").run(scope.epoch,at,deadline,row.id);
  this.db.prepare('INSERT INTO experience_activity(job_id,epoch,started_at) VALUES (?,?,?)').run(row.id,scope.epoch,at);return this.job(row.id)!;
 }).immediate();}
 context(id:string,at:string,requireLive=true):InvocationContext{const job=this.job(id);if(!job)throw missing();const session=this.session(job.sessionId,at,requireLive),scope=this.db.prepare('SELECT pool_id FROM experience_scopes WHERE investigation_id=?').get(job.investigationId) as {pool_id:string};
  return{sessionId:job.sessionId,accessGroup:session.accessGroup,investigationId:job.investigationId,runId:null,budgetWindowId:null,interactionPoolId:scope.pool_id,watchCheckId:null,epoch:job.epoch,watchLeaseEpoch:null,deadlineAt:job.deadlineAt??new Date(Math.min(Date.parse(this.serviceEndsAt),Date.parse(job.startedAt??at)+120000)).toISOString()};}
 assertContext(ctx:InvocationContext,at:string){
  const row=this.db.prepare("SELECT j.* FROM experience_jobs j JOIN experience_scopes s ON s.investigation_id=j.investigation_id WHERE s.pool_id=? AND s.epoch=? AND j.epoch=? AND j.status='running'").get(ctx.interactionPoolId,ctx.epoch,ctx.epoch) as JobRow|undefined;
  if(!row||ctx.runId!==null||ctx.budgetWindowId!==null||ctx.watchCheckId!==null||ctx.watchLeaseEpoch!==null||row.session_id!==ctx.sessionId||row.investigation_id!==ctx.investigationId||ctx.deadlineAt!==row.deadline_at)throw invalid('旧交互任务不能继续提交。');
  const session=this.session(ctx.sessionId,at);if(session.accessGroup!==ctx.accessGroup)throw invalid();
  this.meter(row.id,at);const scope=this.db.prepare('SELECT paused FROM experience_scopes WHERE pool_id=?').get(ctx.interactionPoolId) as {paused:number};
  const snapshot=this.book.snapshot(ctx,pools(ctx));if(!this.book.unrestricted&&(scope.paused||snapshot.blockedBy.includes('accounting_paused')))throw new BudgetLimitFault(null);
  if(!this.book.unrestricted&&(Date.parse(at)>=Date.parse(ctx.deadlineAt)||snapshot.remaining.activeMs===0))throw new BudgetLimitFault('activeMs');return this.rowJob(row);
 }
 meter(id:string,at:string){const job=this.job(id);if(!job||job.status!=='running'||!job.startedAt)return;
  const total=Math.max(0,Math.min(Date.parse(at),Date.parse(job.deadlineAt??this.serviceEndsAt))-Date.parse(job.startedAt));if(total<job.meteredMs)throw invalid('交互活动时间不能倒退。');
  this.db.transaction(()=>{const ctx=this.context(id,at,false);this.book.chargeActivity(ctx,pools(ctx),total-job.meteredMs);this.db.prepare('UPDATE experience_jobs SET metered_ms=? WHERE id=?').run(total,id);this.db.prepare('UPDATE experience_activity SET metered_ms=? WHERE job_id=? AND epoch=?').run(total,id,job.epoch);}).immediate();
 }
 assertJob(id:string,epoch:number){const job=this.job(id);if(!job||job.status!=='running'||job.epoch!==epoch)throw invalid('任务提交权已失效。');return job;}
 finish(id:string,epoch:number,status:'completed'|'partial'|'failed'|'cancelled',output:unknown,error:string|null,at:string){
  const job=this.assertJob(id,epoch);if(status==='completed'||status==='partial')this.assertContext(this.context(id,at),at);else this.meter(id,at);this.db.prepare('UPDATE experience_jobs SET status=?,output_json=?,error_code=?,ended_at=? WHERE id=? AND epoch=?').run(status,output===null?null:JSON.stringify(output),error,at,id,epoch);this.db.prepare('UPDATE experience_activity SET ended_at=? WHERE job_id=? AND epoch=?').run(at,id,epoch);return job;
 }
 private refs(versionId:string,owner:string,claims:string[],evidence:string[]){const version=readSnapshot(this.db,versionId,owner);if(!version||claims.some(id=>!version.payload.claims.some(c=>c.id===id))||evidence.some(id=>!version.payload.evidence.some(e=>e.id===id)))throw invalid('伴读引用不属于固定报告版本。');}
 finishCompanion(id:string,epoch:number,raw:CompanionDraft,at:string){this.db.transaction(()=>{
  const job=this.assertJob(id,epoch),draft=CompanionDraftSchema.parse(raw),{session}=this.companion(job.companionId,job.sessionId);
  if(job.kind!=='companion'||draft.resultVersionId!==job.resultVersionId||draft.personaVersion!==session.personaVersion||draft.segments.length<3||draft.segments.length>5||new Set(draft.segments.map(s=>s.id)).size!==draft.segments.length)throw invalid();
  for(const segment of draft.segments)this.refs(job.resultVersionId,job.sessionId,segment.claimIds,segment.evidenceIds);
  this.finish(id,epoch,'completed',draft,null,at);this.saveCompanion({...session,status:'ready',segments:draft.segments,cursor:0,deliveredClaimIds:[]});
 }).immediate();}
 finishTurn(id:string,epoch:number,raw:CompanionReply,at:string){this.db.transaction(()=>{
  const job=this.assertJob(id,epoch),reply=CompanionReplySchema.parse(raw),{session}=this.companion(job.companionId,job.sessionId);if(job.kind!=='turn'||reply.resumeCursor>session.segments.length)throw invalid();this.refs(job.resultVersionId,job.sessionId,reply.claimIds,reply.evidenceIds);
  const turn=CompanionTurnSchema.parse({id,companionSessionId:session.id,question:job.request.question,answer:reply.text,claimIds:reply.claimIds,evidenceIds:reply.evidenceIds,resumeCursor:reply.resumeCursor,followupTurnId:null,createdAt:at});
  this.db.prepare('INSERT INTO companion_turns VALUES (?,?,?)').run(id,session.id,JSON.stringify(turn));this.finish(id,epoch,'completed',reply,null,at);if(reply.kind==='finish')this.patchCompanion(session.id,job.sessionId,{ended:true},at);
 }).immediate();}
 fail(id:string,epoch:number,code:string,at:string){this.db.transaction(()=>{const job=this.assertJob(id,epoch);this.finish(id,epoch,'failed',null,code,at);if(job.kind==='companion'){const {session}=this.companion(job.companionId,job.sessionId);this.saveCompanion({...session,status:'failed'});}}).immediate();}
 cancel(id:string,owner:string,at:string){return this.db.transaction(()=>{const job=this.job(id,owner);if(!job)throw missing();if(!['queued','running'].includes(job.status))return job;
  if(job.status==='running'){this.meter(id,at);this.db.prepare('UPDATE experience_activity SET ended_at=? WHERE job_id=? AND epoch=?').run(at,id,job.epoch);this.db.prepare('UPDATE experience_scopes SET epoch=epoch+1 WHERE investigation_id=?').run(job.investigationId);}
  this.db.prepare("UPDATE experience_jobs SET status='cancelled',epoch=epoch+1,error_code='CANCELLED',ended_at=? WHERE id=?").run(at,id);if(job.kind==='companion'){const {session}=this.companion(job.companionId,owner);this.saveCompanion({...session,status:'failed'});}return this.job(id)!;
 }).immediate();}
 assertSpeechReconciled(id:string,index?:number){
  const pending=this.db.prepare("SELECT 1 FROM experience_tts_attempts a LEFT JOIN usage_ledger u ON u.call_id=a.call_id WHERE a.job_id=? AND (? IS NULL OR a.chunk_index=? OR a.chunk_index IS NULL) AND (a.status IN ('reserved','sent','unknown') OR (a.call_id IS NOT NULL AND COALESCE(u.status,'unknown') IN ('reserved','sent','unknown'))) LIMIT 1").get(id,index??null,index??null);
  if(pending)throw new ApiFault(409,'INVALID_STATE','该段语音仍有在途或费用未知的请求，需先对账；已保存的音频仍可读取。');
 }
 reserveCharacters(id:string,epoch:number,count:number,metadata?:{index:number;requestHash:string;at:string}){return this.db.transaction(()=>{const job=this.assertJob(id,epoch);z.number().int().min(1).max(150).parse(count);if(metadata)this.assertSpeechReconciled(id,metadata.index);const row=this.db.prepare('SELECT * FROM experience_scopes WHERE investigation_id=?').get(job.investigationId) as {pool_id:string;characters_used:number;characters_reserved:number;paused:number};if(!this.book.unrestricted&&(row.paused||row.characters_used+row.characters_reserved+count>20000))throw new BudgetLimitFault(null);const token=randomUUID();this.db.prepare("INSERT INTO experience_tts_attempts(id,job_id,pool_id,epoch,chunk_index,request_hash,characters,status,created_at) VALUES (?,?,?,?,?,?,?,'reserved',?)").run(token,id,row.pool_id,epoch,metadata?.index??null,metadata?.requestHash??null,count,metadata?.at??new Date().toISOString());this.db.prepare('UPDATE experience_scopes SET characters_reserved=characters_reserved+? WHERE pool_id=?').run(count,row.pool_id);return token;}).immediate();}
 markCharactersSent(token:string,callId:string|null=null){const changed=this.db.prepare("UPDATE experience_tts_attempts SET status='sent',call_id=? WHERE id=? AND status='reserved'").run(callId,token);if(changed.changes!==1)throw invalid();}
 settleCharacters(token:string,actual:number|null){this.db.transaction(()=>{const row=this.db.prepare('SELECT * FROM experience_tts_attempts WHERE id=?').get(token) as {status:string;characters:number;pool_id:string}|undefined;if(!row||['settled','released'].includes(row.status))return;
  if(actual===null){if(row.status==='reserved'){this.db.prepare('UPDATE experience_scopes SET characters_reserved=characters_reserved-? WHERE pool_id=?').run(row.characters,row.pool_id);this.db.prepare("UPDATE experience_tts_attempts SET status='released' WHERE id=?").run(token);}else this.db.prepare("UPDATE experience_tts_attempts SET status='unknown' WHERE id=?").run(token);return;}
  z.number().int().nonnegative().parse(actual);actual=Math.max(actual,row.characters);this.db.prepare('UPDATE experience_scopes SET characters_reserved=characters_reserved-?,characters_used=characters_used+?,paused=CASE WHEN ?>? THEN 1 ELSE paused END WHERE pool_id=?').run(row.characters,actual,actual,row.characters,row.pool_id);
  if(actual>row.characters)this.db.prepare("UPDATE budget_pools SET state='paused',revision=revision+1 WHERE id=?").run(row.pool_id);
  this.db.prepare("UPDATE experience_tts_attempts SET status='settled' WHERE id=?").run(token);
 }).immediate();}
 recover(at:string){return this.db.transaction(()=>{
  const rows=this.db.prepare("SELECT id FROM experience_jobs WHERE status IN ('queued','running')").all() as {id:string}[];
  for(const row of rows){const job=this.job(row.id)!;if(job.status==='running'){this.meter(job.id,at);this.db.prepare('UPDATE experience_activity SET ended_at=? WHERE job_id=? AND epoch=?').run(at,job.id,job.epoch);}this.db.prepare("UPDATE experience_jobs SET status='failed',epoch=epoch+1,error_code='SERVER_RESTART',ended_at=? WHERE id=?").run(at,job.id);if(job.kind==='companion'){const {session}=this.companion(job.companionId,job.sessionId);this.saveCompanion({...session,status:'failed'});}}
  this.db.prepare('UPDATE experience_scopes SET epoch=epoch+1').run();const calls=this.db.prepare("SELECT id FROM experience_tts_attempts WHERE status IN ('reserved','sent')").all() as {id:string}[];for(const call of calls)this.settleCharacters(call.id,null);return rows.length;
 }).immediate();}
}
