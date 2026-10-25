import { randomUUID } from 'node:crypto';
import type Database from 'better-sqlite3';
import { z } from 'zod';
import {
 BrowserSessionSchema, IdSchema, InvestigationSchema, InvocationContextSchema, NotificationSchema,
 WatchSchema, WatchCheckSchema, TimestampSchema, type Watch, type WatchCheck, type InvocationContext,
} from '../../shared/contracts.js';
import { WatchDecisionSchema } from '../../shared/ports.js';
import type { WatchLease, WatchFinish } from '../watch/ports.js';
import { BudgetBook } from './budget.js';
import { RunStore } from './runs.js';
import { hashValue, stableJson } from './snapshots.js';
import { factSignature,canAdvanceWatchScope } from './watch-state.js';
import { ApiFault } from './errors.js';
import { CreateWatchRequestSchema } from '../../shared/watch-http.js';
export const WATCH_LIMITS = Object.freeze({activeMs:120000,searches:3,reads:3,modelCalls:8,inputTokens:48000,outputTokens:8000,moneyMicros:1000000});
const PERIOD_LIMITS = {activeMs:86400000,searches:936,reads:936,modelCalls:2496,inputTokens:14976000,outputTokens:2496000,moneyMicros:5000000};
export const CreateWatchSchema=CreateWatchRequestSchema;
type WatchRow={id:string;session_id:string;investigation_id:string;status:string;epoch:number;period_id:string;next_check_at:string;expires_at:string;last_manual_at:string|null;payload_json:string};
type CheckRow={id:string;watch_id:string;period_id:string;budget_window_id:string|null;run_id:string|null;lease_epoch:number;lease_until:string|null;status:string;payload_json:string};
const missing=()=>new ApiFault(404,'NOT_FOUND','未找到该监测或记录。');
const invalid=(message:string)=>new ApiFault(409,'INVALID_STATE',message);
const identity=(scope:unknown)=>{const {referenceTime:_time,...rest}=scope as Record<string,unknown>;return stableJson(rest);};
export class WatchStore {
 readonly runs:RunStore; readonly book:BudgetBook;
 constructor(private readonly db:Database.Database,private readonly options:{serviceEndsAt:string}) {this.runs=new RunStore(db);this.book=new BudgetBook(db);TimestampSchema.parse(options.serviceEndsAt);}
 private session(owner:string,at:string) {
  const row=this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(owner) as {payload_json:string}|undefined;
  if(!row) throw missing();const session=BrowserSessionSchema.parse(JSON.parse(row.payload_json));
  if(session.revokedAt || Date.parse(at)>=Date.parse(session.expiresAt)||Date.parse(at)>=Date.parse(this.options.serviceEndsAt)) throw new ApiFault(401,'UNAUTHENTICATED','会话已过期或服务已结束。');
  return session;
 }
 private row(id:string,owner?:string):WatchRow {
  IdSchema.parse(id);const row=this.db.prepare('SELECT * FROM watches WHERE id=?'+(owner?' AND session_id=?':'')).get(...(owner?[id,owner]:[id])) as WatchRow|undefined;
  if(!row)throw missing();return row;
 }
 private watch(row:WatchRow):Watch {
  const watch=WatchSchema.parse(JSON.parse(row.payload_json));const pool=this.book.inspectPool(row.period_id);
  return {...watch,usedMicros:pool.used.moneyMicros,reservedMicros:pool.reserved.moneyMicros};
 }
 private save(watch:Watch) {WatchSchema.parse(watch);this.db.prepare('UPDATE watches SET status=?,next_check_at=?,expires_at=?,payload_json=? WHERE id=?').run(watch.status,watch.nextCheckAt,watch.expiresAt,JSON.stringify(watch),watch.id);}
 private saveCheck(check:WatchCheck) {WatchCheckSchema.parse(check);this.db.prepare('UPDATE watch_checks SET status=?,run_id=?,lease_epoch=?,lease_until=?,payload_json=? WHERE id=?').run(check.status,check.runId,check.leaseEpoch,check.leaseUntil,JSON.stringify(check),check.id);}
 private request(owner:string,kind:string,key:string,body:unknown) {
  z.string().min(8).max(128).parse(key);const hash=hashValue(body);
  const old=this.db.prepare('SELECT body_hash,response_id FROM watch_requests WHERE session_id=? AND kind=? AND key=?').get(owner,kind,key) as {body_hash:string;response_id:string}|undefined;
  if(old && old.body_hash!==hash)throw new ApiFault(409,'IDEMPOTENCY_CONFLICT','此提交标识已用于不同内容。');
  return {prior:old?.response_id??null,save:(id:string)=>this.db.prepare('INSERT INTO watch_requests VALUES (?,?,?,?,?)').run(owner,kind,key,hash,id)};
 }
 create(owner:string,key:string,raw:z.infer<typeof CreateWatchSchema>,at:string):Watch {
  TimestampSchema.parse(at);const input=CreateWatchSchema.parse(raw);const session=this.session(owner,at);
  return this.db.transaction(()=>{
   const request=this.request(owner,'create',key,input);if(request.prior)return this.watch(this.row(request.prior,owner));
   const row=this.db.prepare('SELECT payload_json FROM investigations WHERE id=? AND session_id=?').get(input.investigationId,owner) as {payload_json:string}|undefined;
   if(!row)throw missing();const inv=InvestigationSchema.parse(JSON.parse(row.payload_json));
   if(!inv.scope||inv.latestResultVersionId!==input.resultVersionId)throw new ApiFault(409,'STALE_VERSION','请先查看当前最新报告，再开启监测。');
   if(inv.activeRunId)throw new ApiFault(409,'ACTIVE_RUN','调查仍在进行。');
   const count=this.db.prepare("SELECT count(*) AS n FROM watches WHERE session_id=? AND status IN ('active','paused','budget_paused')").get(owner) as {n:number};
   if(count.n>=3)throw new ApiFault(429,'RATE_LIMITED','每个浏览器最多保留三项监测。');
   if(this.db.prepare("SELECT 1 FROM watches WHERE investigation_id=? AND status IN ('active','paused','budget_paused')").get(inv.id))throw invalid('本调查已有监测。');
   const id=randomUUID(),periodId=randomUUID(),expiresAt=new Date(Math.min(Date.parse(at)+86400000,Date.parse(this.options.serviceEndsAt),Date.parse(session.expiresAt))).toISOString();
   this.book.createPool({id:periodId,kind:'window',accessGroup:session.accessGroup,sessionId:owner,investigationId:inv.id,limits:PERIOD_LIMITS});
   const watch=WatchSchema.parse({id,sessionId:owner,investigationId:inv.id,scopeVersion:inv.scopeVersion,targetKind:input.targetKind,targetUrls:input.targetUrls,focus:input.focus,
    baselineVersionId:input.resultVersionId,frequencySeconds:3600,expiresAt,status:'active',nextCheckAt:new Date(Date.parse(at)+3600000).toISOString(),
    lastAttemptAt:null,lastSuccessAt:null,periodCostLimitMicros:5000000,usedMicros:0,reservedMicros:0});
   this.db.prepare('INSERT INTO watches(id,session_id,investigation_id,status,epoch,period_id,next_check_at,expires_at,payload_json) VALUES (?,?,?,?,?,?,?,?,?)')
    .run(id,owner,inv.id,watch.status,1,periodId,watch.nextCheckAt,expiresAt,JSON.stringify(watch));
   this.db.prepare('INSERT INTO watch_periods VALUES (?,?,?,?)').run(periodId,id,at,expiresAt);request.save(id);return watch;
  }).immediate();
 }
 get(id:string,owner:string):Watch|null {try{return this.watch(this.row(id,owner));}catch(e){if(e instanceof ApiFault&&e.code==='NOT_FOUND')return null;throw e;}}
 list(owner:string) {return (this.db.prepare("SELECT * FROM watches WHERE session_id=? AND status<>'deleted' ORDER BY rowid").all(owner) as WatchRow[]).map(row=>this.watch(row));}
 private invalidate(row:WatchRow,at:string,status:'cancelled'|'interrupted') {
  const checks=this.db.prepare("SELECT payload_json FROM watch_checks WHERE watch_id=? AND status IN ('queued','running')").all(row.id) as {payload_json:string}[];
  for(const item of checks) {
   const check=WatchCheckSchema.parse(JSON.parse(item.payload_json));
   if(check.runId) {const run=this.runs.get(check.runId,row.session_id);if(run?.status==='running'){this.meter(this.lease(check.id).context,at);this.runs.finishWatch(run.id,run.epoch,status==='interrupted'?'interrupted':'failed',status==='interrupted'?'server_restart':'cancelled',at);}}
   check.status=status;check.endedAt=at;check.reasonSummary=status==='interrupted'?'服务或租约中断，本轮不自动重放。':'监测状态或基线改变，本轮作废。';this.saveCheck(check);
  }
  this.db.prepare('UPDATE watches SET epoch=epoch+1 WHERE id=?').run(row.id);
 }
 change(id:string,owner:string,action:'pause'|'resume'|'renew',at:string):Watch {
  TimestampSchema.parse(at);z.enum(['pause','resume','renew']).parse(action);const session=this.session(owner,at);
  return this.db.transaction(()=>{
   const row=this.row(id,owner);const watch=this.watch(row);if(watch.status==='deleted')throw missing();
   if(action!=='pause'){
    const inv=InvestigationSchema.parse(JSON.parse((this.db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(watch.investigationId) as {payload_json:string}).payload_json));
    if(inv.scopeVersion!==watch.scopeVersion||inv.latestResultVersionId!==watch.baselineVersionId){
     const latest=inv.latestResultVersionId?this.runs.getResult(inv.latestResultVersionId,owner):null;
     if(action!=='renew'||!latest||!canAdvanceWatchScope(this.db,watch,latest,inv.scopeVersion))throw invalid('监测范围或基线已变，请从最新报告重新创建监测。');
     watch.scopeVersion=inv.scopeVersion;watch.baselineVersionId=latest.id;
    }
   }
   // An explicit user action supersedes an automatic scope-refinement pause.
   this.db.prepare('DELETE FROM watch_scope_pauses WHERE watch_id=?').run(id);
   if(action!=='renew'&&(watch.status==='expired'||Date.parse(at)>=Date.parse(watch.expiresAt)))throw invalid('监测已到期，需要显式续期。');
   if(action==='pause' && watch.status==='paused')return watch;
   if(action==='resume' && watch.status==='active' && Date.parse(watch.expiresAt)>Date.parse(at))return watch;
   if(action==='resume' && (watch.status==='budget_paused'||Date.parse(watch.expiresAt)<=Date.parse(at)))throw invalid('到期或周期额度不足，需要显式续期。');
   if(action==='renew') {
    if(this.db.prepare("SELECT 1 FROM watches WHERE investigation_id=? AND id<>? AND status IN ('active','paused','budget_paused')").get(watch.investigationId,id))throw invalid('该案件已有新的监测，请管理新监测。');
    const count=this.db.prepare("SELECT count(*) AS n FROM watches WHERE session_id=? AND id<>? AND status IN ('active','paused','budget_paused')").get(owner,id) as {n:number};
    if(count.n>=3)throw new ApiFault(429,'RATE_LIMITED','每个浏览器最多保留三项监测。');
   }
   this.invalidate(row,at,'cancelled');
   if(action==='renew') {
    const expiresAt=new Date(Math.min(Date.parse(at)+86400000,Date.parse(this.options.serviceEndsAt),Date.parse(session.expiresAt))).toISOString(),periodId=randomUUID();
    this.book.createPool({id:periodId,kind:'window',accessGroup:session.accessGroup,sessionId:owner,investigationId:watch.investigationId,limits:PERIOD_LIMITS});
    this.db.prepare('INSERT INTO watch_periods VALUES (?,?,?,?)').run(periodId,id,at,expiresAt);
    this.db.prepare('UPDATE watches SET period_id=?,last_manual_at=NULL WHERE id=?').run(periodId,id);
    watch.expiresAt=expiresAt;watch.usedMicros=0;watch.reservedMicros=0;
   }
   watch.status=action==='pause'?'paused':'active';if(action!=='pause')watch.nextCheckAt=new Date(Date.parse(at)+3600000).toISOString();
   this.save(watch);return this.watch(this.row(id,owner));
  }).immediate();
 }
 remove(id:string,owner:string,at:string) {this.session(owner,at);this.db.transaction(()=>{const row=this.row(id,owner);if(row.status==='deleted')return;this.db.prepare('DELETE FROM watch_scope_pauses WHERE watch_id=?').run(id);this.invalidate(row,at,'cancelled');const watch=this.watch(row);watch.status='deleted';this.save(watch);}).immediate();}
 private newCheck(row:WatchRow,trigger:'manual'|'scheduled',at:string):WatchCheck {
  const watch=this.watch(row),id=randomUUID();
  const check=WatchCheckSchema.parse({id,watchId:row.id,scheduledFor:at,trigger,status:'queued',runId:null,beforeVersionId:watch.baselineVersionId,afterVersionId:null,changeKey:null,
    reasonSummary:'检查已接受，等待后台领取。',startedAt:null,endedAt:null,leaseEpoch:row.epoch,leaseUntil:null});
  this.db.prepare('INSERT INTO watch_checks(id,watch_id,period_id,scheduled_for,trigger,status,lease_epoch,payload_json) VALUES (?,?,?,?,?,?,?,?)').run(id,row.id,row.period_id,at,trigger,'queued',row.epoch,JSON.stringify(check));
  return check;
 }
 requestManual(owner:string,id:string,key:string,at:string):WatchCheck {
  TimestampSchema.parse(at);this.session(owner,at);
  return this.db.transaction(()=>{
   const request=this.request(owner,'manual',key,{id});if(request.prior)return WatchCheckSchema.parse(JSON.parse((this.db.prepare('SELECT payload_json FROM watch_checks WHERE id=?').get(request.prior) as {payload_json:string}).payload_json));
   const row=this.row(id,owner);this.ensureActive(row,at);
   const watch=this.watch(row),last=Math.max(Date.parse(row.last_manual_at??'1970-01-01'),Date.parse(watch.lastAttemptAt??'1970-01-01'));
   if(Date.parse(at)-last<300000)throw new ApiFault(429,'RATE_LIMITED','立即检查至少间隔五分钟。',true);
   if(this.db.prepare("SELECT 1 FROM watch_checks WHERE watch_id=? AND status IN ('queued','running')").get(id))throw new ApiFault(409,'ACTIVE_RUN','已有检查排队或运行。');
   if(this.db.prepare("SELECT 1 FROM runs WHERE investigation_id=? AND status IN ('queued','running','waiting_for_user')").get(row.investigation_id))throw new ApiFault(409,'ACTIVE_RUN','此调查已有活动任务。');
   this.ensureFunds(row);
   const check=this.newCheck(row,'manual',at);this.db.prepare('UPDATE watches SET last_manual_at=? WHERE id=?').run(at,id);request.save(check.id);return check;
  }).immediate();
 }
 private ensureActive(row:WatchRow,at:string) {this.session(row.session_id,at);if(row.status!=='active'||Date.parse(at)>=Date.parse(row.expires_at))throw invalid('监测未启用或已到期。');}
 private ensureFunds(row:WatchRow) {
  for(const id of ['runtime:global','runtime:'+this.sessionGroup(row.session_id),row.period_id]) {
   const pool=this.book.inspectPool(id);if(!this.book.unrestricted&&(pool.state!=='active'||pool.limits.moneyMicros-pool.used.moneyMicros-pool.reserved.moneyMicros<=0))throw new ApiFault(409,'BUDGET_EXHAUSTED','监测额度不足，已暂停新的收费检查。');
  }
 }
 private sessionGroup(owner:string) {const row=this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(owner) as {payload_json:string};return BrowserSessionSchema.parse(JSON.parse(row.payload_json)).accessGroup;}
 private canClaim(row:WatchRow,at:string):boolean {
  try {this.ensureActive(row,at);this.ensureFunds(row);}catch(e){if(e instanceof ApiFault&&e.code==='BUDGET_EXHAUSTED'){const w=this.watch(row);w.status='budget_paused';this.save(w);}return false;}
  const inv=InvestigationSchema.parse(JSON.parse((this.db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(row.investigation_id) as {payload_json:string}).payload_json));
  if(inv.latestResultVersionId!==this.watch(row).baselineVersionId||inv.scopeVersion!==this.watch(row).scopeVersion)return false;
  if(this.db.prepare("SELECT 1 FROM runs WHERE investigation_id=? AND status IN ('queued','running','waiting_for_user')").get(row.investigation_id))return false;
  if(this.db.prepare("SELECT 1 FROM runs r JOIN investigations i ON i.id=r.investigation_id WHERE i.session_id=? AND r.status IN ('running','waiting_for_user')").get(row.session_id))return false;
  if((this.db.prepare("SELECT count(*) AS n FROM runs WHERE status='running'").get() as {n:number}).n>=2)return false;
  if(this.db.prepare("SELECT 1 FROM watch_checks WHERE status='running'").get())return false;
  return true;
 }
 private claim(row:WatchRow,check:WatchCheck,at:string):WatchLease {
  const group=this.sessionGroup(row.session_id),windowId=randomUUID();
  this.book.createPool({id:windowId,kind:'window',accessGroup:group,sessionId:row.session_id,investigationId:row.investigation_id,limits:WATCH_LIMITS});
  const run=this.runs.startWatch(row.session_id,row.investigation_id,windowId,at);
  check.status='running';check.runId=run.id;check.startedAt=at;check.leaseUntil=new Date(Date.parse(at)+180000).toISOString();check.reasonSummary='后台检查正在执行。';
  this.db.prepare('UPDATE watch_checks SET budget_window_id=? WHERE id=?').run(windowId,check.id);this.saveCheck(check);
  const watch=this.watch(row);watch.lastAttemptAt=at;watch.nextCheckAt=new Date(Date.parse(at)+3600000).toISOString();this.save(watch);
  return this.lease(check.id);
 }
 claimManual(owner:string,id:string,at:string):WatchLease|null {
  TimestampSchema.parse(at);return this.db.transaction(()=>{const row=this.row(id,owner);if(!this.canClaim(row,at))return null;
   const old=this.db.prepare("SELECT payload_json FROM watch_checks WHERE watch_id=? AND status='queued' AND trigger='manual' ORDER BY ordinal LIMIT 1").get(id) as {payload_json:string}|undefined;
   return old?this.claim(row,WatchCheckSchema.parse(JSON.parse(old.payload_json)),at):null;
  }).immediate();
 }
 claimDue(at:string):WatchLease|null {
  TimestampSchema.parse(at);return this.db.transaction(()=>{
   this.recover(at,false);
   const rows=this.db.prepare("SELECT w.* FROM watches w WHERE w.status='active' AND (w.next_check_at<=? OR EXISTS(SELECT 1 FROM watch_checks c WHERE c.watch_id=w.id AND c.status='queued')) ORDER BY w.next_check_at,w.rowid").all(at) as WatchRow[];
   for(const row of rows) {
    if(!this.canClaim(row,at))continue;
    const pending=this.db.prepare("SELECT payload_json FROM watch_checks WHERE watch_id=? AND status IN ('queued','running') ORDER BY ordinal LIMIT 1").get(row.id) as {payload_json:string}|undefined;
    if(pending) {const check=WatchCheckSchema.parse(JSON.parse(pending.payload_json));if(check.status==='queued')return this.claim(row,check,at);continue;}
    return this.claim(row,this.newCheck(row,'scheduled',at),at);
   }
   return null;
  }).immediate();
 }

 private checkRow(id:string):CheckRow {IdSchema.parse(id);const row=this.db.prepare('SELECT * FROM watch_checks WHERE id=?').get(id) as CheckRow|undefined;if(!row)throw missing();return row;}
 private lease(checkId:string):WatchLease {
  const row=this.checkRow(checkId),watchRow=this.row(row.watch_id),check=WatchCheckSchema.parse(JSON.parse(row.payload_json));
  if(!row.run_id||!row.budget_window_id||!check.startedAt)throw invalid('检查尚未领取。');
  const run=this.runs.get(row.run_id,watchRow.session_id)!;
  const owner=this.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(watchRow.session_id) as {payload_json:string};
  const session=BrowserSessionSchema.parse(JSON.parse(owner.payload_json));
  const period=this.db.prepare('SELECT expires_at FROM watch_periods WHERE id=?').get(row.period_id) as {expires_at:string};
  const context:InvocationContext={sessionId:session.id,accessGroup:session.accessGroup,investigationId:watchRow.investigation_id,runId:run.id,budgetWindowId:row.budget_window_id,interactionPoolId:null,
   watchCheckId:check.id,epoch:run.epoch,watchLeaseEpoch:check.leaseEpoch,deadlineAt:new Date(Math.min(this.book.unrestricted?Infinity:Date.parse(check.startedAt)+120000,Date.parse(period.expires_at),Date.parse(session.expiresAt),Date.parse(this.options.serviceEndsAt))).toISOString()};
  const before=this.runs.getResult(check.beforeVersionId,session.id);if(!before)throw missing();
  return {watch:this.watch(watchRow),check,context,before};
 }
 contextForRun(id:string):InvocationContext {
  const row=this.db.prepare('SELECT id FROM watch_checks WHERE run_id=?').get(id) as {id:string}|undefined;
  if(!row)throw missing();return this.lease(row.id).context;
 }
 authorizedLease(ctx:InvocationContext,at:string):WatchLease {this.fence(ctx,at);return this.lease(ctx.watchCheckId!);}
 poolIds(ctx:InvocationContext):string[] {
  const row=this.checkRow(ctx.watchCheckId!);
  if(row.run_id!==ctx.runId||row.budget_window_id!==ctx.budgetWindowId)throw invalid('检查预算窗口不匹配。');
  return ['runtime:global','runtime:'+ctx.accessGroup,ctx.budgetWindowId!,row.period_id];
 }
 private fence(ctx:InvocationContext,at:string,checkTime=true) {
  InvocationContextSchema.parse(ctx);TimestampSchema.parse(at);
  const c=this.checkRow(ctx.watchCheckId!),w=this.row(c.watch_id),watch=this.watch(w);
  this.session(ctx.sessionId,at);
  const run=this.runs.get(ctx.runId!,ctx.sessionId);
  const invRow=this.db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(w.investigation_id) as {payload_json:string};
  const inv=InvestigationSchema.parse(JSON.parse(invRow.payload_json));
  const check=WatchCheckSchema.parse(JSON.parse(c.payload_json));
  if(c.status!=='running'||w.status!=='active'||c.period_id!==w.period_id||w.epoch!==ctx.watchLeaseEpoch||c.lease_epoch!==ctx.watchLeaseEpoch
    ||c.run_id!==ctx.runId||c.budget_window_id!==ctx.budgetWindowId||ctx.investigationId!==w.investigation_id||ctx.sessionId!==w.session_id||ctx.accessGroup!==this.sessionGroup(w.session_id)
    ||!run||run.status!=='running'||run.epoch!==ctx.epoch||run.trigger!=='watch'||inv.activeRunId!==run.id||inv.scopeVersion!==watch.scopeVersion||run.scopeVersion!==watch.scopeVersion
    ||watch.baselineVersionId!==check.beforeVersionId||inv.latestResultVersionId!==check.beforeVersionId||ctx.deadlineAt!==this.lease(c.id).context.deadlineAt)throw invalid('检查提交权或基线已失效。');
  if(checkTime&&(Date.parse(at)>=Date.parse(ctx.deadlineAt)||Date.parse(at)>=Date.parse(w.expires_at)||!c.lease_until||Date.parse(at)>=Date.parse(c.lease_until)))throw invalid('检查期限或租约已到期。');
  return {row:w,watch,check,run};
 }
 assertContext(ctx:InvocationContext,at:string):void {this.fence(ctx,at);}
 meter(ctx:InvocationContext,at:string) {
  const run=this.runs.get(ctx.runId!,ctx.sessionId);if(!run)throw missing();
  const interval=run.activeIntervals.at(-1),open=run.status==='running'&&interval?.endedAt===null?Date.parse(at)-Date.parse(interval.startedAt):0;
  if(open<0)throw invalid('检查时钟不能倒退。');
  this.db.transaction(()=>{
   const total=run.activeMs+open;
   const prior=this.db.prepare('SELECT metered_ms FROM run_activity_meter WHERE run_id=?').get(run.id) as {metered_ms:number}|undefined;
   if(total<(prior?.metered_ms??0))throw invalid('检查计量不能倒退。');
   this.book.chargeActivity(ctx,this.poolIds(ctx),total-(prior?.metered_ms??0));
   this.db.prepare('INSERT INTO run_activity_meter VALUES (?,?) ON CONFLICT(run_id) DO UPDATE SET metered_ms=excluded.metered_ms').run(run.id,total);
  }).immediate();
 }
 heartbeat(lease:WatchLease,at:string):boolean {
  return this.db.transaction(()=>{try {
   const current=this.fence(lease.context,at);this.meter(lease.context,at);
   current.check.leaseUntil=new Date(Date.parse(at)+180000).toISOString();this.saveCheck(current.check);return true;
  }catch(error){if(error instanceof ApiFault)return false;throw error;}}).immediate();
 }
 finish(lease:WatchLease,result:WatchFinish,at:string):boolean {
  return this.db.transaction(()=>{
   let current:ReturnType<WatchStore['fence']>;
   try {current=this.fence(lease.context,at);}catch(error){if(error instanceof ApiFault)return false;throw error;}
   const {watch,check,run}=current;
   if(lease.before.id!==check.beforeVersionId||lease.watch.id!==watch.id||lease.check.id!==check.id)throw invalid('检查参数归属不一致。');
   z.enum(['changed','unchanged','unknown']).parse(result.kind);z.string().trim().min(1).max(4000).parse(result.reason);
   const decision=result.decision?WatchDecisionSchema.parse(result.decision):null;
   this.meter(lease.context,at);
   if(result.kind==='changed') {
    if(!result.candidate||decision?.kind!=='significant')throw invalid('缺少合法变化判断。');
    const candidate=result.candidate;
    const before=this.runs.getResult(check.beforeVersionId,watch.sessionId)!;
    if(candidate.investigationId!==watch.investigationId||candidate.runId!==run.id||identity(candidate.scope)!==identity(before.payload.scope)||!['answered','no_useful_direction'].includes(candidate.stopReason))throw invalid('候选范围或完成状态不一致。');
    const claims=new Set(candidate.claims.map(c=>c.id)),evidence=new Set(candidate.evidence.map(e=>e.id));
    if(decision.changes.some(change=>change.evidenceIds.length===0||change.claimIds.some(id=>!claims.has(id))||change.evidenceIds.some(id=>!evidence.has(id))))throw invalid('变化引用不合法。');
    const beforeSig=factSignature(before.payload),afterSig=factSignature(candidate);
    const changeKey=hashValue({baselineVersionId:before.id,before:beforeSig,after:afterSig,focus:watch.focus.normalize('NFKC').trim()});
    if(this.db.prepare('SELECT 1 FROM notifications WHERE watch_id=? AND change_key=?').get(watch.id,changeKey))throw invalid('该变化已通知，不能重复提交。');
    const payload={...candidate,delta:{previousVersionId:before.id,changes:decision.changes,checkedAt:at}};
    const version=this.runs.commitResult(run.id,run.epoch,payload,'completed',at);
    const notification=NotificationSchema.parse({id:randomUUID(),sessionId:watch.sessionId,watchId:watch.id,watchCheckId:check.id,changeKey,targetResultVersionId:version.id,previousVersionId:before.id,reason:result.reason,createdAt:at,readAt:null});
    this.db.prepare('INSERT INTO notifications(id,session_id,watch_id,watch_check_id,change_key,target_version_id,payload_json) VALUES (?,?,?,?,?,?,?)').run(notification.id,notification.sessionId,watch.id,check.id,changeKey,version.id,JSON.stringify(notification));
    check.status='changed';check.afterVersionId=version.id;check.changeKey=changeKey;watch.baselineVersionId=version.id;watch.lastSuccessAt=at;
   } else {
    if(result.kind==='unchanged'&&(decision?.kind!=='unchanged'||decision.changes.length!==0))throw invalid('无变化判断不一致。');
    if(result.kind==='unknown'&&(result.candidate!==null||(decision&&decision.kind!=='unknown')))throw invalid('未知结果不能带已确认的候选。');
    this.runs.finishWatch(run.id,run.epoch,result.kind==='unchanged'?'completed':'failed',result.kind==='unchanged'?'answered':'provider_error',at);
    check.status=result.kind;if(result.kind==='unchanged')watch.lastSuccessAt=at;
   }
   check.endedAt=at;check.reasonSummary=result.reason;this.saveCheck(check);this.save(watch);return true;
  }).immediate();
 }
 fail(lease:WatchLease,safeCode:string,at:string):void {
  this.db.transaction(()=>{
   let current:ReturnType<WatchStore['fence']>;try{current=this.fence(lease.context,at,false);}catch(error){if(error instanceof ApiFault)return;throw error;}
   this.meter(lease.context,at);
   const code=['WATCH_STOPPED','WATCH_LEASE_LOST','WATCH_DEADLINE','WATCH_CHECK_FAILED'].includes(safeCode)?safeCode:'WATCH_CHECK_FAILED';
   this.runs.finishWatch(current.run.id,current.run.epoch,code==='WATCH_STOPPED'?'interrupted':'failed',code==='WATCH_DEADLINE'?'time_limit':code==='WATCH_STOPPED'?'server_restart':'provider_error',at);
   current.check.status=code==='WATCH_STOPPED'?'interrupted':'failed';current.check.reasonSummary=code;current.check.endedAt=at;this.saveCheck(current.check);
  }).immediate();
 }
 recover(at:string,force=true) {
  TimestampSchema.parse(at);return this.db.transaction(()=>{
   let count=0;
   const watches=this.db.prepare("SELECT * FROM watches WHERE status<>'deleted'").all() as WatchRow[];
   for(const row of watches) {
    const checks=this.db.prepare("SELECT * FROM watch_checks WHERE watch_id=? AND status IN ('queued','running')").all(row.id) as CheckRow[];
    const expired=Date.parse(at)>=Date.parse(row.expires_at);
    const stale=checks.some(check=>force||check.status==='running'&&(!check.lease_until||Date.parse(at)>=Date.parse(check.lease_until)||Date.parse(at)>=Date.parse(this.lease(check.id).context.deadlineAt)));
    if(stale||expired) {
     for(const c of checks)if(c.run_id){const ctx=this.lease(c.id).context;this.meter(ctx,at);}
     this.invalidate(row,at,'interrupted');count+=checks.length;
     const watch=this.watch(this.row(row.id));if(expired)watch.status='expired';else watch.nextCheckAt=new Date(Math.max(Date.parse(watch.nextCheckAt),Date.parse(at)+3600000)).toISOString();this.save(watch);
    }
   }
   return count;
  }).immediate();
 }
 checks(id:string,owner:string,after=0) {
  this.row(id,owner);z.number().int().nonnegative().parse(after);
  const rows=this.db.prepare('SELECT ordinal,payload_json FROM watch_checks WHERE watch_id=? AND ordinal>? ORDER BY ordinal LIMIT 101').all(id,after) as {ordinal:number;payload_json:string}[];
  return {items:rows.slice(0,100).map(row=>WatchCheckSchema.parse(JSON.parse(row.payload_json))),nextCursor:rows[Math.min(rows.length,100)-1]?.ordinal??after,hasMore:rows.length>100};
 }
 notifications(owner:string,after=0) {
  IdSchema.parse(owner);z.number().int().nonnegative().parse(after);
  const rows=this.db.prepare('SELECT ordinal,payload_json FROM notifications WHERE session_id=? AND ordinal>? ORDER BY ordinal LIMIT 101').all(owner,after) as {ordinal:number;payload_json:string}[];
  const unread=this.db.prepare("SELECT count(*) AS n FROM notifications WHERE session_id=? AND json_extract(payload_json,'$.readAt') IS NULL").get(owner) as {n:number};
  return {items:rows.slice(0,100).map(row=>NotificationSchema.parse(JSON.parse(row.payload_json))),nextCursor:rows[Math.min(rows.length,100)-1]?.ordinal??after,hasMore:rows.length>100,unreadCount:unread.n};
 }
 markRead(id:string,owner:string,at:string) {
  const row=this.db.prepare('SELECT payload_json FROM notifications WHERE id=? AND session_id=?').get(id,owner) as {payload_json:string}|undefined;
  if(!row)throw missing();const notification=NotificationSchema.parse(JSON.parse(row.payload_json));
  notification.readAt??=TimestampSchema.parse(at);this.db.prepare('UPDATE notifications SET payload_json=? WHERE id=?').run(JSON.stringify(notification),id);return notification;
 }
}
