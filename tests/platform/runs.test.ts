import { randomUUID } from 'node:crypto';
import { fork } from 'node:child_process';
import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { afterEach, beforeEach, expect, it, onTestFinished } from 'vitest';
import { openDatabase } from '../../src/server/platform/database.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { RunStore } from '../../src/server/platform/runs.js';
import { RunSchema } from '../../src/shared/contracts.js';

const at = '2026-10-24T10:00:00.000Z';
const later = (seconds: number) => new Date(Date.parse(at) + seconds * 1000).toISOString();
let db: ReturnType<typeof openDatabase>;
let runs: RunStore;
let sessionId: string; let investigationId: string; let windowId: string;
beforeEach(() => {
  db = openDatabase(':memory:');
  sessionId = randomUUID(); investigationId = randomUUID(); windowId = randomUUID();
  db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(sessionId, 'a'.repeat(64), JSON.stringify({ id: sessionId, tokenHash: 'a'.repeat(64), accessGroup: 'trial', createdAt: at, expiresAt: later(3600), revokedAt: null }));
  db.prepare('INSERT INTO investigations VALUES (?,?,?,?)').run(investigationId, sessionId, at, JSON.stringify({ id: investigationId, sessionId, originalQuestion: 'controlled_fixture：核对公开信息', basicMode: 'truth', presentationMode: 'brief', scope: null, scopeVersion: 0, status: 'draft', attachmentIds: [], activeRunId: null, latestResultVersionId: null, createdAt: at, updatedAt: at }));
  new BudgetBook(db).createPool({ id: windowId, kind: 'window', accessGroup: 'trial', sessionId, investigationId, limits: { ...zeroAmounts(), activeMs: 420000 } });
  runs = new RunStore(db);
});
afterEach(() => db.close());
const enqueue = (key = 'start-key-0001') => runs.enqueue({ sessionId, investigationId, key, action: 'start', previousRunId: null, budgetWindowId: windowId, at });

it('replays one enqueue key but rejects a different submission while a run is active', () => {
  const first = enqueue(); expect(enqueue().id).toBe(first.id);
  expect(() => enqueue('different-key')).toThrowError(expect.objectContaining({ code: 'ACTIVE_RUN' }));
  expect(RunSchema.parse(first).status).toBe('queued');
  expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 1 });
});
it('rejects changed content for an existing key even after the first run was cancelled', () => {
  const first = enqueue(); runs.cancel(first.id, sessionId, later(2));
  expect(() => runs.enqueue({ sessionId, investigationId, key: 'start-key-0001', action: 'resume', previousRunId: first.id, budgetWindowId: windowId, at: later(3) })).toThrowError(expect.objectContaining({ code: 'IDEMPOTENCY_CONFLICT' }));
  expect(enqueue().status).toBe('cancelled');
});
it('checks owner and budget window before queueing and never grants a budget implicitly', () => {
  expect(() => runs.enqueue({ sessionId: randomUUID(), investigationId, key: 'other-owner', action: 'start', previousRunId: null, budgetWindowId: windowId, at })).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
  expect(() => runs.enqueue({ sessionId, investigationId, key: 'missing-pool', action: 'start', previousRunId: null, budgetWindowId: randomUUID(), at })).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 0 });
});
it('claims a queued run once and excludes queue and user waiting from active time', () => {
  const queued = enqueue(); const running = runs.claimNext(later(10))!;
  expect(running.id).toBe(queued.id); expect(runs.claimNext(later(11))).toBeNull();
  const waiting = runs.waitForUser(running.id, running.epoch, later(15));
  expect(waiting.activeMs).toBe(5000);
  expect(() => runs.assertCurrent({ sessionId, investigationId, runId: running.id, budgetWindowId: windowId, epoch: running.epoch, accessGroup: 'trial', interactionPoolId: null, watchCheckId: null, watchLeaseEpoch: null, deadlineAt: later(400) })).toThrow();
  const continued = runs.continueAfterUser(running.id, sessionId, later(50));
  expect(continued.epoch).toBeGreaterThan(running.epoch);
  const cancelled = runs.cancel(running.id, sessionId, later(53));
  expect(cancelled.activeMs).toBe(8000);
  expect(cancelled.activeIntervals).toEqual([{ startedAt: later(10), endedAt: later(15) }, { startedAt: later(50), endedAt: later(53) }]);
});
it('does not let a different case waiting for user input block the session execution slot',()=>{
 const first=enqueue();const running=runs.claimNext(at)!;runs.waitForUser(first.id,running.epoch,later(1));
 const secondId=randomUUID(),secondWindow=randomUUID(),row=db.prepare('SELECT payload_json FROM investigations WHERE id=?').get(investigationId) as {payload_json:string};
 const second={...JSON.parse(row.payload_json),id:secondId,status:'draft',activeRunId:null,createdAt:later(2),updatedAt:later(2)};
 db.prepare('INSERT INTO investigations VALUES (?,?,?,?)').run(secondId,sessionId,later(2),JSON.stringify(second));
 new BudgetBook(db).createPool({id:secondWindow,kind:'window',accessGroup:'trial',sessionId,investigationId:secondId,limits:{...zeroAmounts(),activeMs:420000}});
 const queued=runs.enqueue({sessionId,investigationId:secondId,key:'controlled-other-case',action:'start',previousRunId:null,budgetWindowId:secondWindow,at:later(2)});
 expect(runs.claimNext(later(3))?.id).toBe(queued.id);expect(runs.get(first.id,sessionId)?.status).toBe('waiting_for_user');
});
it('preserves a never-started queued user request across restart without resetting its window',()=>{
 const queued=enqueue();expect(runs.interruptOnStartup(later(2))).toBe(0);expect(runs.get(queued.id,sessionId)).toEqual(queued);
 const started=runs.claimNext(later(3))!;expect(started.id).toBe(queued.id);expect(started.budgetWindowId).toBe(windowId);expect(runs.claimNext(later(4))).toBeNull();
});
it('does not auto-restart queued work that had already begun before clarification',()=>{
 const queued=enqueue(),running=runs.claimNext(at)!;
 const paused={...running,status:'queued',stage:null};
 db.prepare("UPDATE runs SET status='queued',payload_json=? WHERE id=?").run(JSON.stringify(paused),queued.id);
 expect(runs.interruptOnStartup(later(2))).toBe(1);expect(runs.get(queued.id,sessionId)?.status).toBe('interrupted');
});
it('fences cancelled workers from checkpoints and events and keeps cancellation idempotent', () => {
  enqueue(); const run = runs.claimNext(at)!;
  runs.saveCheckpoint(run.id, run.epoch, { sources: [] }, later(1));
  const cancelled = runs.cancel(run.id, sessionId, later(2));
  expect(cancelled.epoch).toBe(run.epoch + 1);
  expect(runs.cancel(run.id, sessionId, later(10))).toEqual(cancelled);
  expect(() => runs.saveCheckpoint(run.id, run.epoch, { claims: [] }, later(3))).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  expect(() => runs.appendEvent(run.id, run.epoch, { type: 'query.started', message: '迟到消息', queryId: null, sourceIds: [], visibility: 'public' }, later(3))).toThrow();
  expect(runs.get(run.id, randomUUID())).toBeNull();
});
it('persists interrupted state and resumes into a new run using the original window', () => {
  enqueue(); const run = runs.claimNext(later(2))!;
  runs.saveCheckpoint(run.id, run.epoch, { sources: [], claims: [] }, later(3));
  expect(runs.interruptOnStartup(later(8))).toBe(1);
  runs = new RunStore(db);
  expect(runs.get(run.id, sessionId)).toMatchObject({ status: 'interrupted', activeMs: 6000, stopReason: 'server_restart' });
  const resumed = runs.enqueue({ sessionId, investigationId, key: 'resume-key', action: 'resume', previousRunId: run.id, budgetWindowId: windowId, at: later(9) });
  expect(resumed.id).not.toBe(run.id); expect(resumed.budgetWindowId).toBe(windowId);
  expect(runs.getCheckpoint(resumed.id, sessionId)).toEqual({ sources: [], evidence: [], claims: [], candidates: [], queries: [] });
  expect(runs.interruptOnStartup(later(10))).toBe(0);
  expect(runs.get(resumed.id,sessionId)?.status).toBe('queued');
  expect(runs.interruptOnStartup(later(11))).toBe(0);
});
it('retains waiting tasks on startup and excludes internal events from public pagination', () => {
  enqueue(); const run = runs.claimNext(at)!;
  runs.appendEvent(run.id, run.epoch, { type: 'evidence.updated', message: '内部诊断', queryId: null, sourceIds: [], visibility: 'internal' }, later(1));
  runs.waitForUser(run.id, run.epoch, later(2));
  expect(runs.interruptOnStartup(later(20))).toBe(0);
  const first = runs.listEvents(investigationId, sessionId, 0, 1);
  expect(first.items).toHaveLength(1); expect(first.hasMore).toBe(true);
  const rest = runs.listEvents(investigationId, sessionId, first.nextSeq, 100);
  expect(rest.items.map(e => e.type)).toEqual(['run.started', 'clarification.requested']);
  expect(rest.items.every(e => e.visibility === 'public')).toBe(true);
  expect(() => runs.listEvents(investigationId, randomUUID(), 0, 10)).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
});
it('rejects backward clocks without mutating a running task', () => {
  enqueue(); const run = runs.claimNext(later(5))!;
  expect(() => runs.cancel(run.id, sessionId, later(4))).toThrow();
  expect(runs.get(run.id, sessionId)?.status).toBe('running');
});
it('rejects a resume timestamp before its predecessor stopped without creating a run', () => {
  enqueue(); const first = runs.claimNext(at)!; runs.cancel(first.id, sessionId, later(10));
  expect(() => runs.enqueue({ sessionId, investigationId, key: 'backward-resume', action: 'resume', previousRunId: first.id, budgetWindowId: windowId, at: later(9) })).toThrowError(expect.objectContaining({ code: 'INVALID_STATE' }));
  expect(db.prepare('SELECT count(*) AS n FROM runs').get()).toEqual({ n: 1 });
});

it('checks the live persisted run context rather than just accepting a matching epoch', () => {
  enqueue(); const run = runs.claimNext(at)!;
  const context = { sessionId, investigationId, runId: run.id, budgetWindowId: windowId, epoch: run.epoch, accessGroup: 'trial' as const, interactionPoolId: null, watchCheckId: null, watchLeaseEpoch: null, deadlineAt: later(400) };
  expect(() => runs.assertCurrent(context)).not.toThrow();
  for (const wrong of [{ budgetWindowId: randomUUID() }, { investigationId: randomUUID() }, { accessGroup: 'demo' as const }, { epoch: 99 }, { sessionId: randomUUID() }, { watchCheckId: randomUUID() }]) {
    expect(() => runs.assertCurrent({ ...context, ...wrong })).toThrow();
  }
  runs.cancel(run.id, sessionId, later(1));
  expect(() => runs.assertCurrent(context)).toThrow();
});

it('keeps each run checkpoint separate and prevents recovery from an obsolete predecessor', () => {
  enqueue(); const first = runs.claimNext(at)!;
  const query = { id: randomUUID(), runId: first.id, query: 'controlled_fixture', purpose: '核对', claimIds: [], site: null, freshness: null, limit: 5, scopeVersion: 0, batchNo: 1, attemptCount: 1 };
  runs.saveCheckpoint(first.id, first.epoch, { queries: [query] }, later(1));
  runs.cancel(first.id, sessionId, later(2));
  const next = runs.enqueue({ sessionId, investigationId, key: 'resume-new', action: 'resume', previousRunId: first.id, budgetWindowId: windowId, at: later(3) });
  const running = runs.claimNext(later(4))!;
  const extra = { ...query, id: randomUUID(), runId: next.id, query: 'controlled_fixture 新缺口', batchNo: 2, attemptCount: 2 };
  expect(() => runs.saveCheckpoint(next.id, running.epoch, { queries: [] }, later(5))).toThrow();
  runs.saveCheckpoint(next.id, running.epoch, { queries: [query, extra] }, later(5));
  expect(runs.getCheckpoint(first.id, sessionId)?.queries).toEqual([{ ...query, budgetWindowId: windowId }]);
  expect(runs.getCheckpoint(next.id, sessionId)?.queries).toEqual([{ ...query, budgetWindowId: windowId }, { ...extra, budgetWindowId: windowId }]);
  runs.cancel(next.id, sessionId, later(6));
  expect(() => runs.enqueue({ sessionId, investigationId, key: 'obsolete-resume', action: 'resume', previousRunId: first.id, budgetWindowId: windowId, at: later(7) })).toThrow();
});

it('does not permit a worker to fabricate platform lifecycle events', () => {
  enqueue(); const run = runs.claimNext(at)!;
  expect(() => runs.appendEvent(run.id, run.epoch, { type: 'run.finalized', message: '假完成', queryId: null, sourceIds: [], visibility: 'public' }, later(1))).toThrow();
  expect(runs.listEvents(investigationId, sessionId).items.map(e => e.type)).toEqual(['run.queued', 'run.started']);
});

async function withDisk(action: (path: string) => Promise<void>) {
  const directory = mkdtempSync(join(tmpdir(), 'detective-runs-')); const path = join(directory, 'state.db');
  try {
    await db.backup(path);
    // A backup of :memory: starts in DELETE mode. Prepare the platform database before
    // racing queue operations; otherwise both workers race the unrelated WAL transition.
    const prepared=openDatabase(path);
    try { expect(prepared.pragma('journal_mode',{simple:true})).toBe('wal'); } finally { prepared.close(); }
    await action(path);
  }
  finally { for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true }); rmdirSync(directory); }
}
type WorkerInput={at:string;enqueue?:Parameters<RunStore['enqueue']>[0]};
type WorkerResult={id?:string|null;error?:string};
async function raceWorkers(path:string,inputs:WorkerInput[],entry=resolve('tests/helpers/run-worker.ts')) {
  const workers = [0, 1].map(() => {
    const child = fork(entry, [path], { execArgv: entry.endsWith('.ts')?['--import', 'tsx']:[], silent: true });
    const started=performance.now();let phase='startup',stderr='',failure:Error|null=null;
    let ready!:()=>void,rejectReady!:(error:Error)=>void,pending:{resolve(value:WorkerResult):void;reject(error:Error):void}|null=null;
    const readyPromise=new Promise<void>((resolve,reject)=>{ready=resolve;rejectReady=reject;});
    void readyPromise.catch(()=>{});
    const fail=(error:Error)=>{failure??=error;rejectReady(failure);pending?.reject(failure);pending=null;};
    child.stderr?.on('data',(chunk:Buffer)=>{stderr=(stderr+chunk.toString()).slice(-4096);});
    child.stdout?.resume();
    child.once('error',error=>fail(new Error('worker '+phase+': '+error.message)));
    const exit=new Promise<void>(resolve=>child.once('close',(code,signal)=>{
      if(phase!=='closing')fail(new Error(`worker ${phase} exit ${code??signal}: ${stderr.trim()}`));resolve();
    }));
    child.on('message',(message:{ready?:boolean}&WorkerResult)=>{
      if(message.ready){phase='idle';ready();}
      else if(pending){const waiting=pending;pending=null;phase='idle';waiting.resolve(message);}
    });
    const request=(input:WorkerInput)=>new Promise<WorkerResult>((resolve,reject)=>{
      if(failure||!child.connected){reject(failure??new Error('worker request: IPC disconnected'));return;}
      phase='request';pending={resolve,reject};child.send(input,error=>{if(error)fail(new Error('worker request: '+error.message));});
    });
    return {child,readyPromise,request,exit,shutdown:()=>{phase='closing';if(child.connected)child.send({stop:true});},timing:()=>performance.now()-started};
  });
  const cleanup=async()=>{for(const w of workers)if(w.child.exitCode===null&&w.child.signalCode===null)w.child.kill();await Promise.all(workers.map(w=>w.exit));};
  onTestFinished(cleanup);
  try {
    await Promise.all(workers.map(w=>w.readyPromise));
    const values:WorkerResult[][]=[];
    for(const input of inputs)values.push(await Promise.all(workers.map(w=>w.request(input))));
    workers.forEach(w=>w.shutdown());await Promise.all(workers.map(w=>w.exit));
    if(process.env.P_TEST_DIAGNOSTICS)console.error('controlled_fixture run worker lifetime ms',workers.map(w=>w.timing()));
    return values;
  } finally {
    await cleanup();
  }
}
it('reports a controlled child startup exit instead of leaving the ready promise pending',async()=>{
 await expect(raceWorkers(':memory:',[{at}],resolve('tests/helpers/exit-worker.mjs'))).rejects.toThrow(/startup.*17.*controlled_fixture/);
});
it('reports a controlled child exit after ready instead of waiting forever for a result',async()=>{
 await expect(raceWorkers('after-ready',[{at}],resolve('tests/helpers/exit-worker.mjs'))).rejects.toThrow(/worker (request|idle)/);
});
it('allows two independent processes to replay a submission but claim its queue entry only once', async () => {
  await withDisk(async path => {
    const input = { sessionId, investigationId, key: 'race-enqueue', action: 'start' as const, previousRunId: null, budgetWindowId: windowId, at };
    const [queued,claimed]=await raceWorkers(path,[{at,enqueue:input},{at:later(1)}]);
    expect(queued).toBeDefined();expect(claimed).toBeDefined();
    expect(queued![0]?.error).toBeUndefined(); expect(queued![1]?.error).toBeUndefined();
    expect(queued![0]?.id).toBeTruthy(); expect(queued![1]?.id).toBe(queued![0]?.id);
    expect(claimed!.filter(result => result.id === queued![0]?.id)).toHaveLength(1);
    expect(claimed!.filter(result => result.id === null)).toHaveLength(1);
  });
}, 15000);

it('reopens a real database with checkpoints, event cursors and active time preserved', async () => {
  enqueue(); const run = runs.claimNext(later(2))!;
  runs.saveCheckpoint(run.id, run.epoch, { queries: [{ id: randomUUID(), runId: run.id, query: 'controlled_fixture', purpose: '保留材料', claimIds: [], site: null, freshness: null, limit: 3, scopeVersion: 0, batchNo: 1, attemptCount: 1 }] }, later(3));
  await withDisk(async path => {
    let connection = openDatabase(path); let restored = new RunStore(connection);
    try {
      restored.interruptOnStartup(later(8)); connection.close();
      connection = openDatabase(path); restored = new RunStore(connection);
      expect(restored.get(run.id, sessionId)).toMatchObject({ status: 'interrupted', activeMs: 6000, epoch: 2 });
      expect(restored.getCheckpoint(run.id, sessionId)?.queries[0]?.purpose).toBe('保留材料');
      expect(restored.listEvents(investigationId, sessionId, 2).items.map(e => e.type)).toEqual(['run.stopped']);
      expect(() => restored.getCheckpoint(run.id, randomUUID())).toThrowError(expect.objectContaining({ code: 'NOT_FOUND' }));
    } finally { connection.close(); }
  });
});
