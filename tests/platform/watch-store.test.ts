import { randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { WatchHost } from '../../src/server/platform/watch-host.js';
import { fork } from 'node:child_process';
import { mkdtempSync,rmSync,rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join,resolve } from 'node:path';
import { openDatabase } from '../../src/server/platform/database.js';
import { FoundationStore } from '../../src/server/platform/repository.js';
import { hashValue } from '../../src/server/platform/snapshots.js';
import { runtimeSeed, time, later } from '../helpers/runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import type { WatchLease, WatchFinish } from '../../src/server/watch/ports.js';
const seeds: ReturnType<typeof runtimeSeed>[] = [];
async function setup() {
  const s = runtimeSeed(); seeds.push(s);
  s.runs.setScope(s.run.id, s.run.epoch, s.payload.scope, time);
  s.runs.saveCheckpoint(s.run.id, s.run.epoch, { sources: s.payload.sources, evidence: s.payload.evidence, claims: s.payload.claims }, time);
  const version = s.runs.commitResult(s.run.id, s.run.epoch, s.payload, 'completed', time);
  const session = JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as { payload_json: string }).payload_json);
  session.expiresAt = later(200000);
  s.db.prepare('UPDATE sessions SET payload_json=? WHERE id=?').run(JSON.stringify(session), s.owner);
  const funds = { ...zeroAmounts(), activeMs: 10000000, searches: 1000, reads: 1000, modelCalls: 1000, inputTokens: 10000000, outputTokens: 10000000, moneyMicros: 100000000 };
  s.book.createPool({ id: 'runtime:global', kind: 'global', sessionId: null, investigationId: null, accessGroup: null, limits: funds });
  s.book.createPool({ id: 'runtime:trial', kind: 'access_group', sessionId: null, investigationId: null, accessGroup: 'trial', limits: funds });
  const { WatchStore } = await import('../../src/server/platform/watch-store.js');
  const store = new WatchStore(s.db, { serviceEndsAt: later(200000) });
  const input = { investigationId: s.investigationId, resultVersionId: version.id, targetKind: 'page' as const, targetUrls: ['https://example.invalid/notice'], focus: '报名截止日期' };
  const watch = store.create(s.owner, 'controlled-watch', input, time);
  return { ...s, version, store, watch, input };
}

async function addBaseline(s:Awaited<ReturnType<typeof setup>>,key:string) {
 const repo=new FoundationStore(s.db),inv=repo.createDraft(s.owner,key,{originalQuestion:'controlled_fixture：另一案件',basicMode:'truth',presentationMode:'brief'},time,later(200000)),pool=randomUUID();
 s.book.createPool({id:pool,kind:'window',sessionId:s.owner,investigationId:inv.id,accessGroup:'trial',limits:s.book.inspectPool(s.windowId).limits});
 s.runs.enqueue({sessionId:s.owner,investigationId:inv.id,key,action:'start',previousRunId:null,budgetWindowId:pool,at:time});
 const run=s.runs.claimNext(time)!;const payload={...s.payload,investigationId:inv.id,runId:run.id};
 s.runs.setScope(run.id,run.epoch,payload.scope,time);s.runs.saveCheckpoint(run.id,run.epoch,{sources:payload.sources,evidence:payload.evidence,claims:payload.claims},time);
 const version=s.runs.commitResult(run.id,run.epoch,payload,'completed',time);
 return {...s.input,investigationId:inv.id,resultVersionId:version.id};
}
const tempDirs:string[]=[];
afterEach(() => { for (const s of seeds.splice(0)) s.db.close();for(const dir of tempDirs.splice(0)){for(const suffix of ['','-wal','-shm'])rmSync(join(dir,'watch.db')+suffix,{force:true});rmdirSync(dir);} });
function changed(s: Awaited<ReturnType<typeof setup>>, lease: WatchLease, statement: string): WatchFinish {
  const candidate = structuredClone(lease.before.payload);
  candidate.runId = lease.context.runId!; candidate.summary = statement;
  candidate.claims[0]!.statement = statement; candidate.evidence[0]!.excerpt = statement; candidate.delta = null;
  s.runs.saveCheckpoint(lease.context.runId!, lease.context.epoch, { sources: candidate.sources, evidence: candidate.evidence, claims: candidate.claims }, lease.check.startedAt!);
  return { kind: 'changed', candidate, reason: 'controlled_fixture：实质变化', decision: {
    kind: 'significant', reason: 'controlled_fixture：实质变化', factSignature: 'b'.repeat(64),
    changes: [{ kind: 'conclusion', description: statement, claimIds: [candidate.claims[0]!.id], evidenceIds: [candidate.evidence[0]!.id] }],
  } };
}
it('creates an idempotent owned watch without initial notification', async () => {
  const s = await setup();
  expect(s.store.create(s.owner, 'controlled-watch', s.input, later(1)).id).toBe(s.watch.id);
  expect(s.store.get(s.watch.id, randomUUID())).toBeNull();
  expect(s.store.notifications(s.owner).items).toHaveLength(0);
  expect(() => s.store.create(s.owner, 'different-key', s.input, time)).toThrow();
  expect(s.watch.expiresAt).toBe(later(86400));
});
it('claims once and atomically saves the new result baseline link and notification', async () => {
  const s = await setup(); const lease = s.store.claimDue(later(3600))!;
  expect(lease).not.toBeNull(); expect(s.store.claimDue(later(3600))).toBeNull();
  expect(s.store.heartbeat(lease, later(3630))).toBe(true);
  const result = changed(s, lease, '报名截至十一月一日');
  expect(s.store.finish(lease, result, later(3640))).toBe(true);
  const notice = s.store.notifications(s.owner).items[0]!;
  expect(notice.targetResultVersionId).not.toBe(s.version.id);
  expect(s.store.get(s.watch.id, s.owner)!.baselineVersionId).toBe(notice.targetResultVersionId);
  expect(s.book.inspectPool(lease.context.budgetWindowId!).used.activeMs).toBe(40000);
  expect(s.runs.getResult(s.version.id, s.owner)).toEqual(s.version);
  expect(s.db.prepare('SELECT count(*) AS n FROM version_links').get()).toEqual({ n: 1 });
  expect(s.store.finish(lease, result, later(3641))).toBe(false);
  expect(s.store.notifications(s.owner).items).toHaveLength(1);
});
it('keeps unknown and unchanged distinct without advancing an unknown baseline', async () => {
  const s = await setup(); const lease = s.store.claimDue(later(3600))!;
  s.store.finish(lease, { kind: 'unknown', candidate: null, decision: null, reason: '读取失败' }, later(3602));
  expect(s.store.get(s.watch.id, s.owner)).toMatchObject({ baselineVersionId: s.version.id, lastSuccessAt: null, lastAttemptAt: later(3600) });
  const next = s.store.claimDue(later(7200))!;
  s.store.finish(next, { kind: 'unchanged', candidate: null, decision: { kind: 'unchanged', changes: [], reason: '相同事实', factSignature: 'a'.repeat(64) }, reason: '相同事实' }, later(7202));
  expect(s.store.get(s.watch.id, s.owner)).toMatchObject({ baselineVersionId: s.version.id, lastSuccessAt: later(7202) });
  expect(s.store.notifications(s.owner).items).toHaveLength(0);
});

it('runs the persistent M scheduler from the server thirty-second timer without a browser',async()=>{
 const s=await setup();let now=later(3600),result:WatchFinish|null=null;
 const host=new WatchHost(s.store,async lease=>{result=changed(s,lease,'报名截至十一月一日');return {candidate:result.candidate,readFailures:[]};},async()=>result!.decision!,()=>now);
 vi.useFakeTimers({toFake:['setInterval','clearInterval']});
 try {
  host.start();expect(s.store.checks(s.watch.id,s.owner).items).toHaveLength(0);
  await vi.advanceTimersByTimeAsync(30000);
  expect(s.store.checks(s.watch.id,s.owner).items[0]!.status).toBe('changed');
  expect(s.store.notifications(s.owner).items).toHaveLength(1);
  await host.stop();now=later(7200);await vi.advanceTimersByTimeAsync(60000);
  expect(s.store.checks(s.watch.id,s.owner).items).toHaveLength(1);
 }finally{await host.stop();vi.useRealTimers();}
});
it('fences pause deletion and late cleanup', async () => {
  const s = await setup(); const lease = s.store.claimDue(later(3600))!;
  const result = changed(s, lease, '报名截至十一月一日');
  s.store.change(s.watch.id, s.owner, 'pause', later(3602));
  expect(s.book.inspectPool(lease.context.budgetWindowId!).used.activeMs).toBe(2000);
  expect(s.store.finish(lease, result, later(3603))).toBe(false);
  expect(s.store.heartbeat(lease, later(3603))).toBe(false);
  s.store.fail(lease, 'WATCH_CHECK_FAILED', later(3604));
  expect(s.store.checks(s.watch.id, s.owner).items[0]!.status).toBe('cancelled');
  s.store.change(s.watch.id, s.owner, 'resume', later(3605));
  s.store.remove(s.watch.id, s.owner, later(3606));
  expect(s.store.claimDue(later(7200))).toBeNull();
});
it('rolls back result baseline and notification when evidence mismatches the checkpoint', async () => {
  const s = await setup(); const lease = s.store.claimDue(later(3600))!;
  const result = changed(s, lease, '报名截至十一月一日'); result.candidate!.evidence[0]!.excerpt = '未经保存的证据';
  expect(() => s.store.finish(lease, result, later(3602))).toThrow();
  expect(s.store.get(s.watch.id, s.owner)!.baselineVersionId).toBe(s.version.id);
  expect(s.store.notifications(s.owner).items).toHaveLength(0);
  expect(s.runs.get(lease.context.runId!, s.owner)!.status).toBe('running');
});
it('preserves old unknown reservations across explicit renewal without resetting global costs', async () => {
  const s = await setup(); const lease = s.store.claimDue(later(3600))!;
  const pools = s.store.poolIds(lease.context); const callId = randomUUID();
  s.book.reserve(lease.context, pools, { callId, provider: 'controlled', operation: 'search', purpose: '核查日期', attemptNo: 1, estimated: { ...zeroAmounts(), searches: 1, moneyMicros: 10 } });
  s.book.markSent(callId); s.book.markUnknown(callId);
  expect(s.store.get(s.watch.id, s.owner)!.reservedMicros).toBe(10);
  s.store.change(s.watch.id, s.owner, 'renew', later(3602));
  s.book.settle(callId, { ...zeroAmounts(), searches: 1, moneyMicros: 7 });
  expect(s.store.get(s.watch.id, s.owner)!.usedMicros).toBe(0);
  expect(s.book.inspectPool('runtime:trial').used.moneyMicros).toBe(7);
  expect(s.store.finish(lease, { kind: 'unknown', candidate: null, decision: null, reason: '迟到' }, later(3603))).toBe(false);
});
it('notifies A-to-B-to-A while preserving every prior saved report', async () => {
  const s = await setup(); const first = s.store.claimDue(later(3600))!;
  s.store.finish(first, changed(s, first, '报名截至十一月一日'), later(3602));
  const second = s.store.claimDue(later(7200))!;
  s.store.finish(second, changed(s, second, s.payload.claims[0]!.statement), later(7202));
  const notices = s.store.notifications(s.owner).items;
  expect(notices).toHaveLength(2); expect(notices[0]!.changeKey).not.toBe(notices[1]!.changeKey);
  expect(s.runs.getResult(s.version.id, s.owner)).toEqual(s.version);
  const third=s.store.claimDue(later(10800))!;
  expect(s.store.finish(third,changed(s,third,'报名截至十一月一日'),later(10802))).toBe(true);
  expect(s.store.notifications(s.owner).items).toHaveLength(3);
});

it('allows only one of two independent Node processes to claim the same SQLite watch',async()=>{
 const s=await setup(),dir=mkdtempSync(join(tmpdir(),'detective-watch-'));tempDirs.push(dir);const path=join(dir,'watch.db');
 await s.db.backup(path);
 // The single host initializes/migrates storage before workers compete for claims.
 const initialized=openDatabase(path);initialized.close();
 const run=()=>new Promise<string|null>((resolveResult,reject)=>{
  const child=fork(resolve('tests/helpers/watch-claim-worker.ts'),[path,later(3600),later(200000)],{execArgv:['--import','tsx'],stdio:['ignore','ignore','pipe','ipc']});
  let message:{checkId?:string|null;error?:string}|undefined;
  let diagnostic='';child.stderr?.on('data',data=>{diagnostic+=String(data);});
  child.on('message',value=>{message=value as typeof message;});
  child.on('error',reject);child.on('exit',code=>{if(code!==0||!message||message.error)reject(Error(message?.error??diagnostic));else resolveResult(message.checkId??null);});
 });
 const completed=await Promise.allSettled([run(),run()]);
 const failure=completed.find(result=>result.status==='rejected');if(failure?.status==='rejected')throw failure.reason;
 const results=completed.map(result=>result.status==='fulfilled'?result.value:null);
 expect(results.filter(Boolean)).toHaveLength(1);
 const db=openDatabase(path);try{expect(db.prepare("SELECT count(*) AS n FROM watch_checks WHERE status='running'").get()).toEqual({n:1});}finally{db.close();}
},20000);

it('rejects generic cancellation and resume of watch runs instead of losing the period budget',async()=>{
 const s=await setup(),lease=s.store.claimDue(later(3600))!;
 expect(()=>s.runs.cancel(lease.context.runId!,s.owner,later(3601))).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
 s.store.recover(later(3602),true);
 expect(()=>s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,key:'illegal-watch-resume',action:'resume',previousRunId:lease.context.runId!,budgetWindowId:lease.context.budgetWindowId!,at:later(3603)})).toThrowError(expect.objectContaining({code:'INVALID_STATE'}));
});
it('accepts an evidence-backed significant decision even when the dedupe projection has identical facts',async()=>{
 const s=await setup(),lease=s.store.claimDue(later(3600))!,result=changed(s,lease,s.payload.claims[0]!.statement);
 const candidate=result.candidate!,extra={...candidate.evidence[0]!,id:randomUUID(),excerpt:'controlled_fixture：新增的补充证据'};
 candidate.evidence.push(extra);candidate.claims[0]!.links.push({evidenceId:extra.id,relation:'supports',rationale:'新增支持'});
 result.decision!.changes[0]!.evidenceIds.push(extra.id);
 s.runs.saveCheckpoint(lease.context.runId!,lease.context.epoch,{sources:candidate.sources,evidence:candidate.evidence,claims:candidate.claims},later(3601));
 expect(s.store.finish(lease,result,later(3602))).toBe(true);
 expect(s.store.notifications(s.owner).items).toHaveLength(1);
});
it('returns a domain conflict when an expired watch has been replaced for the same case',async()=>{
 const s=await setup();s.store.recover(later(86401));
 s.store.create(s.owner,'replacement-watch',s.input,later(86401));
 expect(()=>s.store.change(s.watch.id,s.owner,'renew',later(86402))).toThrowError(expect.objectContaining({code:'INVALID_STATE',status:409}));
 expect(s.store.get(s.watch.id,s.owner)!.status).toBe('expired');
});
it('rechecks the three-watch limit when renewing expired watches',async()=>{
 const s=await setup(),old=[s.watch];
 for(let i=0;i<2;i++)old.push(s.store.create(s.owner,'old-watch-'+i,await addBaseline(s,'old-baseline-'+i),time));
 s.store.recover(later(86401));
 s.store.create(s.owner,'new-watch',await addBaseline(s,'new-baseline'),later(86401));
 s.store.change(old[0]!.id,s.owner,'renew',later(86402));
 s.store.change(old[1]!.id,s.owner,'renew',later(86402));
 expect(()=>s.store.change(old[2]!.id,s.owner,'renew',later(86402))).toThrowError(expect.objectContaining({code:'RATE_LIMITED',status:429}));
 expect(s.store.list(s.owner).filter(w=>w.status==='active')).toHaveLength(3);
});

it('shares the two-run database limit with foreground work',async()=>{
 const s=await setup(),repo=new FoundationStore(s.db);const busy:Array<{id:string;owner:string}>=[];
 for(let i=0;i<2;i++){
  const owner=repo.createSession(hashValue(randomUUID()),'trial',time,later(200000));
  const inv=repo.createDraft(owner.id,'controlled-busy-'+i,{originalQuestion:'controlled_fixture：前台',basicMode:'truth',presentationMode:'brief'},time,later(200000));
  const pool=randomUUID();s.book.createPool({id:pool,kind:'window',sessionId:owner.id,investigationId:inv.id,accessGroup:'trial',limits:s.book.inspectPool(s.windowId).limits});
  s.runs.enqueue({sessionId:owner.id,investigationId:inv.id,key:'controlled-busy-'+i,action:'start',previousRunId:null,budgetWindowId:pool,at:time});
  busy.push({id:s.runs.claimNext(time)!.id,owner:owner.id});
 }
 expect(s.store.claimDue(later(3600))).toBeNull();
 s.runs.cancel(busy[0]!.id,busy[0]!.owner,later(3600));
 expect(s.store.claimDue(later(3600))).not.toBeNull();
});
it('pauses after the five-yuan period cap even though another check would have a fresh window',async()=>{
 const s=await setup();
 for(let i=1;i<=5;i++){
  const lease=s.store.claimDue(later(3600*i))!,id=randomUUID(),pools=s.store.poolIds(lease.context);
  expect(()=>s.book.reserve(lease.context,pools.slice(0,3),{callId:randomUUID(),provider:'controlled',operation:'search',purpose:'核查',attemptNo:1,estimated:{...zeroAmounts(),searches:1,moneyMicros:1}})).toThrow();
  s.book.reserve(lease.context,pools,{callId:id,provider:'controlled',operation:'search',purpose:'核查',attemptNo:1,estimated:{...zeroAmounts(),searches:1,moneyMicros:1000000}});
  s.book.markSent(id);s.book.settle(id,{...zeroAmounts(),searches:1,moneyMicros:1000000});
  s.store.finish(lease,{kind:'unchanged',candidate:null,decision:{kind:'unchanged',changes:[],reason:'没有变化',factSignature:'a'.repeat(64)},reason:'没有变化'},later(3600*i+1));
 }
 expect(s.store.get(s.watch.id,s.owner)!.usedMicros).toBe(5000000);
 expect(s.store.claimDue(later(21600))).toBeNull();
 expect(s.store.get(s.watch.id,s.owner)!.status).toBe('budget_paused');
});
it('fences expired leases and restarts without replaying their paid calls',async()=>{
 const s=await setup(),lease=s.store.claimDue(later(3600))!;
 expect(s.store.heartbeat(lease,later(3721))).toBe(false);
 expect(s.store.finish(lease,{kind:'unknown',candidate:null,decision:null,reason:'迟到'},later(3721))).toBe(false);
 expect(s.store.recover(later(3721))).toBe(1);
 expect(s.store.checks(s.watch.id,s.owner).items[0]!.status).toBe('interrupted');
 expect(s.store.claimDue(later(3722))).toBeNull();
 expect(s.store.notifications(s.owner).items).toHaveLength(0);
});
it('synchronizes an ordinary follow-up baseline and invalidates an accepted queued check',async()=>{
 const s=await setup();const queued=s.store.requestManual(s.owner,s.watch.id,'manual-before-user',later(1));
 const nextWindow=randomUUID();s.book.createPool({id:nextWindow,kind:'window',sessionId:s.owner,investigationId:s.investigationId,accessGroup:'trial',limits:s.book.inspectPool(s.windowId).limits});
 const queuedRun=s.runs.enqueue({sessionId:s.owner,investigationId:s.investigationId,key:'ordinary-followup',action:'add_budget',previousRunId:s.run.id,budgetWindowId:nextWindow,at:later(2)});
 const run=s.runs.claimNext(later(2))!;expect(run.id).toBe(queuedRun.id);
 const payload={...s.payload,runId:run.id,delta:{previousVersionId:s.version.id,changes:[],checkedAt:later(3)}};
 s.runs.saveCheckpoint(run.id,run.epoch,{sources:payload.sources,evidence:payload.evidence,claims:payload.claims},later(2));
 const next=s.runs.commitResult(run.id,run.epoch,payload,'completed',later(3));
 expect(s.store.get(s.watch.id,s.owner)!.baselineVersionId).toBe(next.id);
 expect(s.store.checks(s.watch.id,s.owner).items.find(c=>c.id===queued.id)!.status).toBe('cancelled');
 expect(s.store.notifications(s.owner).items).toHaveLength(0);
});
