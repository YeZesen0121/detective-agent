import { afterEach, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { budgetScenario } from '../helpers/budget-scenario.js';
import { BudgetBook, zeroAmounts } from '../../src/server/platform/budget.js';
import { PaidGateway } from '../../src/server/platform/gateway.js';
import { openDatabase } from '../../src/server/platform/database.js';
import { PaidCampaign, PaidCampaignPolicySchema, type PaidCampaignPolicy } from '../../src/server/platform/paid-campaign.js';
import { fork } from 'node:child_process';
import { resolve } from 'node:path';
import { paidCampaignFromEnvironment } from '../../src/server/platform/campaign-configuration.js';
import { buildApp } from '../../src/server/app.js';
import type { InvestigationModule } from '../../src/shared/ports.js';
import { BudgetSnapshotSchema } from '../../src/shared/contracts.js';
import { budgetStop } from '../../src/server/investigation/planner.js';
const cleanup: Array<() => void> = [], directories: string[] = [];
afterEach(() => { vi.useRealTimers(); for (const close of cleanup.splice(0)) close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const policy = (): PaidCampaignPolicy => ({ id: 'controlled_fixture-campaign', moneyMicros: 20, requestLimit: 3, operationLimits: { search: 1, read: 1, model: 1, tts: 1 }, expiresAt: new Date(Date.now() + 3600000).toISOString() });
function setup(path = ':memory:', grant = policy()) {
  const s = budgetScenario(path); cleanup.push(() => s.db.close());
  const book = new BudgetBook(s.db, grant), campaign = new PaidCampaign(s.db);
  const gateway = new PaidGateway({ book, poolIds: () => s.poolIds, assertCurrent: () => {}, concurrency: { search: 1, read: 1, model: 1, tts: 1 } });
  return { ...s, book, campaign, gateway, grant };
}
it('exposes the persisted campaign operation cap to investigation planning without changing the task grant', () => {
  const s=setup(),before=s.book.inspectPool(s.poolIds.at(-1)!);
  expect(s.book.snapshot(s.context,s.poolIds).remaining).toMatchObject({searches:1,reads:1,modelCalls:1,moneyMicros:20});
  const call={...s.reservation(2),operation:'model'};s.book.reserve(s.context,s.poolIds,call);
  const snapshot=new BudgetBook(s.db).snapshot(s.context,s.poolIds);
  expect(BudgetSnapshotSchema.safeParse(snapshot).success).toBe(true);
  expect(snapshot).toMatchObject({canModel:false,canSearch:true,remaining:{modelCalls:0,searches:1,moneyMicros:18}});
  expect(budgetStop(snapshot,'model')).toBe('model_limit');
  s.book.release(call.callId);expect(s.book.snapshot(s.context,s.poolIds).remaining.modelCalls).toBe(1);
  expect(s.book.inspectPool(s.poolIds.at(-1)!)).toEqual(before);
  const sent={...s.reservation(2),operation:'model'};s.book.reserve(s.context,s.poolIds,sent);s.book.markSent(sent.callId);s.book.markUnknown(sent.callId);
  expect(new BudgetBook(s.db).snapshot(s.context,s.poolIds).remaining.modelCalls).toBe(0);
  expect(s.campaign.inspect()).toMatchObject({requestCount:1,unknownCount:1,heldMicros:2});
});
it('shows a shared total request cap consumed by TTS as unavailable to research before another send', () => {
  const s=setup(':memory:',{...policy(),requestLimit:1}),call={...s.reservation(1),operation:'tts'};
  s.book.reserve(s.context,s.poolIds,call);s.book.markSent(call.callId);s.book.settle(call.callId,{...zeroAmounts(),moneyMicros:1});
  const snapshot=s.book.snapshot(s.context,s.poolIds);
  expect(snapshot).toMatchObject({canModel:false,canSearch:false,canRead:false,remaining:{modelCalls:0,searches:0,reads:0}});
  expect(snapshot.blockedBy).toContain('paid_campaign:request_limit');
  expect(BudgetSnapshotSchema.safeParse(snapshot).success).toBe(true);
});
it('reports an expired or accounting-paused campaign in the snapshot while keeping its usage intact', () => {
  const now=Date.now(),s=setup(':memory:',{...policy(),expiresAt:new Date(now+1000).toISOString()});
  vi.useFakeTimers({toFake:['Date']});vi.setSystemTime(now+2000);
  expect(s.book.snapshot(s.context,s.poolIds)).toMatchObject({canModel:false,remaining:{moneyMicros:0},blockedBy:expect.arrayContaining(['paid_campaign:expired'])});
  vi.useRealTimers();
  const paused=setup(),call=paused.reservation(2);paused.book.reserve(paused.context,paused.poolIds,call);paused.book.markSent(call.callId);paused.book.settle(call.callId,{...zeroAmounts(),moneyMicros:3});
  const snapshot=paused.book.snapshot(paused.context,paused.poolIds);
  expect(snapshot).toMatchObject({canModel:false,canRead:false,canSearch:false,remaining:{moneyMicros:0},blockedBy:expect.arrayContaining(['paid_campaign:accounting_paused'])});
  expect(paused.campaign.inspect()).toMatchObject({settledMicros:3,requestCount:1,paused:true});
});
it('counts failed and TTS requests together before send, with independent operation and money caps', async () => {
  const s = setup(); let sends = 0;
  const invoke = (operation: 'search' | 'read' | 'tts', moneyMicros: number, fail = false) => s.gateway.invoke(s.context, { provider: 'controlled_fixture', operation, purpose: 'campaign bound', priceRevision: 'fixture-v1', attemptNo: 1, timeoutMs: 1000, estimated: { ...zeroAmounts(), moneyMicros } }, async () => { sends++; if (fail) throw Error('controlled_fixture unknown'); return { value: 'controlled_fixture', actual: { ...zeroAmounts(), moneyMicros } }; }, new AbortController().signal);
  await expect(invoke('search', 7, true)).rejects.toThrow();
  await expect(invoke('search', 1)).rejects.toThrow(); expect(sends).toBe(1);
  await invoke('tts', 6); await expect(invoke('read', 8)).rejects.toThrow(); expect(sends).toBe(2);
  await invoke('read', 7); expect(s.campaign.inspect()).toMatchObject({ requestCount: 3, unknownCount: 1, heldMicros: 7, settledMicros: 13, allocatedMicros: 20, operations: { search: 1, read: 1, model: 0, tts: 1 } });
  expect(s.db.prepare('SELECT count(*) n FROM usage_ledger').get()).toEqual({ n: 3 });
});
it('persists the campaign across connections, cannot reset a grant, and only releases provably unsent requests', () => {
  const directory = mkdtempSync(join(tmpdir(), 'detective-campaign-')); directories.push(directory);
  const path = join(directory, 'runtime.db'), s = setup(path);
  const one = s.reservation(8); s.book.reserve(s.context, s.poolIds, one);
  const second = openDatabase(path); cleanup.unshift(() => second.close());
  // Omission of the config cannot bypass an already persisted campaign.
  const otherBook = new BudgetBook(second);
  expect(() => otherBook.reserve(s.context, s.poolIds, s.reservation(1))).toThrow();
  s.book.release(one.callId); const sent = s.reservation(8); otherBook.reserve(s.context, s.poolIds, sent); otherBook.markSent(sent.callId); otherBook.recoverInFlight();
  expect(() => new BudgetBook(second, { ...s.grant, requestLimit: 4 })).toThrow();
  expect(new PaidCampaign(second).inspect()).toMatchObject({ requestCount: 1, unknownCount: 1, heldMicros: 8 }); expect(() => s.book.release(sent.callId)).toThrow();
});
it('permanently pauses the campaign on a price overrun', () => {
  const s = setup(); const call = s.reservation(8); s.book.reserve(s.context, s.poolIds, call); s.book.markSent(call.callId);
  s.book.settle(call.callId, { ...zeroAmounts(), moneyMicros: 9 }); expect(s.campaign.inspect()!.paused).toBe(true);
  expect(() => s.book.reserve(s.context, s.poolIds, { ...s.reservation(1), operation: 'read' })).toThrow();
  expect(s.campaign.inspect()!.allocatedMicros).toBe(9);
});
it('blocks a reserved request that expires before send, but still settles an earlier sent request', () => {
  const now = Date.now(), s = setup(':memory:', { ...policy(), expiresAt: new Date(now + 1000).toISOString() });
  const sent = s.reservation(5); s.book.reserve(s.context, s.poolIds, sent); s.book.markSent(sent.callId);
  const unsent = { ...s.reservation(4), operation: 'read' }; s.book.reserve(s.context, s.poolIds, unsent);
  vi.useFakeTimers({ toFake: ['Date'] }); vi.setSystemTime(now + 2000);
  expect(() => s.book.markSent(unsent.callId)).toThrow(); s.book.release(unsent.callId);
  s.book.settle(sent.callId, { ...zeroAmounts(), searches: 1, moneyMicros: 3 });
  expect(s.campaign.inspect()).toMatchObject({ requestCount: 1, sentCount: 1, heldMicros: 0, settledMicros: 3, paused: false });
  expect(() => s.book.reserve(s.context, s.poolIds, { ...s.reservation(1), operation: 'read' })).toThrow();
});
it('rejects an expired campaign and enforces total request count even when money remains', () => {
  const s = setup(':memory:', { ...policy(), requestLimit: 1, expiresAt: new Date(Date.now() - 1000).toISOString() });
  expect(() => s.book.reserve(s.context, s.poolIds, s.reservation(1))).toThrow();
  const other = setup(':memory:', { ...policy(), requestLimit: 1 }); const first = other.reservation(1); other.book.reserve(other.context, other.poolIds, first); other.book.markSent(first.callId); other.book.settle(first.callId, { ...zeroAmounts(), moneyMicros: 1 });
  expect(() => other.book.reserve(other.context, other.poolIds, { ...other.reservation(1), operation: 'tts' })).toThrow(); expect(other.campaign.inspect()!.remainingMicros).toBe(19);
});
it('keeps the user authorization fixed instead of accepting arbitrary environment quota overrides', () => {
  expect(paidCampaignFromEnvironment({})).toBeUndefined(); expect(paidCampaignFromEnvironment({ LIVE_CAMPAIGN_ENABLED: '0' })).toBeUndefined();
  expect(() => paidCampaignFromEnvironment({ LIVE_CAMPAIGN_ENABLED: 'yes' })).toThrow();
  const configured = paidCampaignFromEnvironment({ LIVE_CAMPAIGN_ENABLED: '1', LIVE_CAMPAIGN_MONEY: '999999999', LIVE_CAMPAIGN_REQUESTS: '9999' })!;
  expect(configured).toMatchObject({ moneyMicros: 100000000, requestLimit: 2000, operationLimits: { search: 2000, read: 2000, model: 2000, tts: 2000 } });
  expect(PaidCampaignPolicySchema.parse(configured)).toEqual(configured);
  expect(() => PaidCampaignPolicySchema.parse({...configured,moneyMicros:100000001})).toThrow();
  expect(() => PaidCampaignPolicySchema.parse({...configured,requestLimit:2001})).toThrow();
  expect(() => PaidCampaignPolicySchema.parse({...configured,operationLimits:{...configured.operationLimits,model:2001}})).toThrow();
});
it('allows only one of two actual processes to claim the final campaign request', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'detective-campaign-')); directories.push(directory); const path = join(directory, 'runtime.db'), s = setup(path, { ...policy(), requestLimit: 1 });
  const workers = [0, 1].map(() => {
    const child = fork(resolve('tests/helpers/reserve-worker.ts'), [path], { execArgv: ['--import', 'tsx'], silent: true });
    let ready!: () => void, failReady!: (error: Error) => void, done!: (value: boolean) => void, failResult!: (error: Error) => void, completed = false, stderr = '';
    const started = new Promise<void>((r, reject) => { ready = r; failReady = reject; });
    const result = new Promise<boolean>((r, reject) => { done = r; failResult = reject; }); void result.catch(() => {}); void started.catch(() => {});
    const fail = (error: Error) => { failReady(error); failResult(error); };
    child.stderr?.on('data', chunk => { stderr = (stderr + String(chunk)).slice(-2000); }); child.stdout?.resume(); child.on('error', fail);
    child.on('message', (message: { ready?: boolean; reserved?: boolean }) => { if (message.ready) ready(); else { completed = true; done(message.reserved === true); } });
    const exited = new Promise<void>(r => child.on('close', (code, signal) => { if (!completed) fail(Error(`controlled_fixture worker exited ${code ?? signal}: ${stderr}`)); r(); }));
    return { child, started, result, exited };
  });
  try {
    await Promise.all(workers.map(w => w.started)); for (const worker of workers) worker.child.send({ context: s.context, poolIds: s.poolIds, reservation: s.reservation(7) });
    const result = await Promise.all(workers.map(w => w.result)); await Promise.all(workers.map(w => w.exited)); expect(result.filter(Boolean)).toHaveLength(1);
    expect(s.campaign.inspect()).toMatchObject({ requestCount: 1, heldMicros: 7 });
  } finally { for (const w of workers) if (w.child.exitCode === null) w.child.kill(); await Promise.all(workers.map(w => w.exited)); }
}, 15000);
it('enforces the campaign below HTTP and the task host across separate cases', async () => {
  const origin = 'http://127.0.0.1:5173'; let sends = 0;
  const unavailable = async () => { throw Error('controlled_fixture unexpected'); };
  const funds = { ...zeroAmounts(), activeMs: 10000000, searches: 100, reads: 100, modelCalls: 100, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 100000000 };
  const module: InvestigationModule = {
    prepareInvestigation: async input => ({ canInvestigate: true, scope: { objectText: input.originalQuestion, goal: 'controlled_fixture', basicMode: input.basicMode, knownClues: [], uncertainClues: [], claimsToCheck: [], timeScope: null, region: null, referenceTime: new Date().toISOString(), userConfirmed: true }, clarification: null }),
    runInvestigation: async (input, services, signal) => { await services.search({ query: 'controlled_fixture', purpose: '核对', claimIds: [], site: null, freshness: null, limit: 1 }, input.context, signal); return { completion: 'failed', stopReason: 'no_useful_direction', draft: null, clarification: null }; }, routeFollowup: unavailable, compareWatchResult: unavailable,
  };
  const app = buildApp({ databasePath: ':memory:', allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code', serviceEndsAt: new Date(Date.now() + 3600000).toISOString(), secureCookies: false, paidCampaign: { ...policy(), requestLimit: 1 },
    investigationRuntime: { module, enableWatches: false, funding: { global: funds, trial: funds, demo: funds }, providers: { search: async () => { sends++; return { items: [], providerRequestId: 'controlled_fixture', usage: null, invalidItemCount: 0, warnings: [] }; }, read: unavailable, model: unavailable },
      pricing: { quote: () => ({ provider: 'controlled_fixture', purpose: '核对', attemptNo: 1, timeoutMs: 1000, priceRevision: 'fixture-v1', estimated: { ...zeroAmounts(), searches: 1, moneyMicros: 1 } }), actual: () => ({ ...zeroAmounts(), searches: 1, moneyMicros: 1 }) } } });
  try {
    const login = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin }, payload: { code: 'controlled-trial-code' } }); const headers = { origin, cookie: String(login.headers['set-cookie']).split(';')[0]! };
    for (let n = 0; n < 2; n++) {
      const key = `controlled-case-${n}`, inv = (await app.inject({ method: 'POST', url: '/api/v1/investigations', headers: { ...headers, 'idempotency-key': key }, payload: { originalQuestion: key, basicMode: 'truth', presentationMode: 'brief' } })).json().data;
      const start = await app.inject({ method: 'POST', url: `/api/v1/investigations/${inv.id}/runs`, headers: { ...headers, 'idempotency-key': key }, payload: { action: 'start', previousRunId: null } });
      if(n===1){expect(start.statusCode).toBe(409);expect(start.json().error.code).toBe('BUDGET_EXHAUSTED');continue;}
      expect(start.statusCode).toBe(202);
      let done: any;
      for (let i = 0; i < 100; i++) { done = (await app.inject({ url: '/api/v1/runs/' + start.json().data.runId, headers })).json().data.run; if (done.status === 'failed') break; await new Promise(r => setTimeout(r, 2)); }
      expect(done.status).toBe('failed');
    }
    expect(sends).toBe(1);
  } finally { await app.close(); }
});
