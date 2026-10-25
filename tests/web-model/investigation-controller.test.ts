import { describe, expect, it } from 'vitest';
import { createInvestigationController } from '../../src/web/controllers/investigation.js';
import { createTaskController } from '../../src/web/controllers/task.js';
import { ClientError } from '../../src/web/api/client.js';
import type { RuntimeApi } from '../../src/web/api/runtime.js';
import type { InvestigationView } from '../../src/web/api/foundation.js';
import { at, deferred, event, id, run, runView } from './fixtures.js';

export function caseView(n = 10, activeRun: InvestigationView['activeRun'] = null): InvestigationView {
  return { investigation: { id: id(n), originalQuestion: 'controlled_fixture 原问题', basicMode: 'truth', presentationMode: 'evidence', scope: null, scopeVersion: 0, status: activeRun ? 'running' : 'draft', attachmentIds: [], activeRunId: activeRun?.id ?? null, latestResultVersionId: null, createdAt: at, updatedAt: at }, activeRun, latestResultVersionId: null };
}
function setup(overrides: Partial<RuntimeApi> = {}, reader: (caseId: string, signal: AbortSignal) => Promise<InvestigationView> = async () => caseView()) {
  const posts: { action: string; key: string }[] = []; let reads = 0; let keys = 0;
  const runtime: RuntimeApi = {
    getRun: async (runId) => ({ ...runView(), run: { ...run(), id: runId } }),
    getEvents: async (_id, after) => ({ items: [], nextSeq: after, hasMore: false }),
    cancel: async () => ({ ...run(), status: 'cancelled' }),
    startRun: async (_id, input, key) => { posts.push({ action: input.action, key }); return { runId: id(1), status: 'queued', budgetWindowId: id(3), limits: runView().remainingBudget.limits }; },
    answerClarification: async () => { posts.push({ action: 'answer', key: '' }); return { runId: id(1), status: 'queued' }; },
    getResult: async () => { throw Error('controlled_fixture unexpected result read'); },
    copyResult: async () => ({ text: 'controlled_fixture' }), ...overrides,
  };
  const task = createTaskController(runtime, { set: () => 1, clear() {} });
  const controller = createInvestigationController({ foundation: { getInvestigation: async (caseId, signal) => { reads++; return reader(caseId, signal); } }, runtime, task, keyFactory: () => `controlled-key-${++keys}` });
  return { controller, runtime, task, posts, get reads() { return reads; }, get keys() { return keys; } };
}
describe('investigation actions (controlled_fixture)', () => {
  it('follows a server-created terminal followup run without POSTing start',async()=>{
    const h=setup({getRun:async runId=>({...runView(),run:{...run(),id:runId,status:'completed',trigger:'followup'}})});await h.controller.open(id(10));await h.controller.followRun(id(2));expect(h.posts).toEqual([]);expect(h.controller.getState().task?.data?.run).toMatchObject({id:id(2),status:'completed',trigger:'followup'});h.controller.dispose();
  });
  it('does not regress a resumed followup to its older stable turn run',async()=>{
    const h=setup({getRun:async runId=>({...runView(),run:{...run(),id:runId,status:'completed',trigger:'followup',previousRunId:runId===id(3)?id(2):null}})});await h.controller.open(id(10));await h.controller.followRun(id(3));await h.controller.followRun(id(2));expect(h.controller.getState().task?.data?.run.id).toBe(id(3));h.controller.dispose();
  });
  it('late ancestry GET failure cannot poison a newly opened case',async()=>{
    const pending=deferred<ReturnType<typeof runView>>();const h=setup({getRun:async runId=>runId===id(2)?pending.promise:{...runView(),run:{...run(),id:runId,status:'completed',previousRunId:id(2)}}},async caseId=>caseView(caseId===id(20)?20:10));
    await h.controller.open(id(10));await h.controller.followRun(id(3));const old=h.controller.followRun(id(4));await h.controller.open(id(20));pending.reject(Error('controlled_fixture old rejection'));await old;expect(h.controller.getState()).toMatchObject({investigationId:id(20),phase:'ready',error:null});h.controller.dispose();
  });
  it('keeps an unknown submission blocked across another failed explicit read, then reuses its key after a successful read', async () => {
    let failRead=false;
    const h=setup({getEvents:async()=>({items:[{...event(1),type:'run.queued'}],nextSeq:1,hasMore:false}),getRun:async()=>({...runView(),run:{...run(),status:'cancelled'}})},async()=>{
      if(failRead)throw new ClientError('NETWORK_ERROR','controlled_fixture read failed');const view=caseView();view.investigation.status='cancelled';return view;
    });
    await h.controller.open(id(10));const send=h.runtime.startRun;
    h.runtime.startRun=async(_caseId,input,key)=>{h.posts.push({action:input.action,key});throw new ClientError('NETWORK_ERROR','controlled_fixture unknown write');};
    failRead=true;await h.controller.start('resume',id(1));await h.controller.open(id(10));
    expect(h.controller.getState()).toMatchObject({phase:'error',recoveryIncomplete:true,submission:{outcome:'unknown'},task:{data:{run:{status:'cancelled'}}}});
    await h.controller.start('resume',id(1));expect(h.posts).toHaveLength(1);
    failRead=false;await h.controller.open(id(10));h.runtime.startRun=send;await h.controller.start('resume',id(1));
    expect(h.posts).toHaveLength(2);expect(h.posts[1]!.key).toBe(h.posts[0]!.key);h.controller.dispose();
  });
  it('coalesces a double start into one POST and follows the confirmed server run', async () => {
    const ack = deferred<Awaited<ReturnType<RuntimeApi['startRun']>>>(); const h = setup();
    h.runtime.startRun = async (_caseId, input, key) => { h.posts.push({ action: input.action, key }); return ack.promise; };
    await h.controller.open(id(10)); const a = h.controller.start('start', null); const b = h.controller.start('start', null);
    expect(h.posts).toEqual([{ action: 'start', key: 'controlled-key-1' }]);
    ack.resolve({ runId: id(1), status: 'queued', budgetWindowId: id(3), limits: runView().remainingBudget.limits }); await Promise.all([a, b]);
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', submission: { outcome: 'confirmed' }, task: { data: { run: { status: 'running' } } } });
    await h.controller.start('start', null); expect(h.posts).toHaveLength(1); h.controller.disconnect();
  });
  it('recovers an unknown POST only with reads and explicit retry preserves its key', async () => {
    let opens = 0; const h = setup({}, async () => ++opens === 1 ? caseView() : caseView(10, run()));
    const base = h.runtime.startRun; let sends = 0;
    h.runtime.startRun = async (...args) => { if (++sends === 1) { h.posts.push({ action: args[1].action, key: args[2] }); throw new ClientError('NETWORK_ERROR', '连接中断', null, null, true); } return base(...args); };
    await h.controller.open(id(10)); await h.controller.start('start', null);
    expect(h.posts).toHaveLength(1); expect(h.reads).toBe(2);
    expect(h.controller.getState()).toMatchObject({ submission: { outcome: 'unknown' }, task: { data: { run: { id: id(1) } } }, error: { code: 'NETWORK_ERROR' } });
    await h.controller.start('start', null);
    expect(h.posts.map((post) => post.key)).toEqual(['controlled-key-1', 'controlled-key-1']); h.controller.disconnect();
  });
  it('allocates a new key for a different explicit action', async () => {
    const h = setup(); await h.controller.open(id(10)); await h.controller.start('start', null);
    await h.controller.start('resume', id(1));
    expect(h.posts.map((post) => post.key)).toEqual(['controlled-key-1', 'controlled-key-2']); h.controller.disconnect();
  });
  it('late open(A) cannot replace open(B) or launch A polling', async () => {
    const old = deferred<InvestigationView>(); const h = setup({}, async (caseId) => caseId === id(10) ? old.promise : caseView(20));
    const a = h.controller.open(id(10)); await h.controller.open(id(20)); old.resolve(caseView(10, run())); await a;
    expect(h.controller.getState()).toMatchObject({ investigationId: id(20), investigation: { id: id(20) }, task: null }); h.controller.disconnect();
  });
  it('a draft GET started before start cannot regress the task after the POST confirms', async () => {
    const old = deferred<InvestigationView>(); let reads = 0; const h = setup({}, async () => ++reads === 1 ? caseView() : old.promise);
    await h.controller.open(id(10)); const reopening = h.controller.open(id(10)); await h.controller.start('start', null);
    old.resolve(caseView()); await reopening;
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', task: { data: { run: { status: 'running' } } } }); h.controller.disconnect();
  });
  it('disconnect fences a late POST without following or cancelling a server run', async () => {
    const ack = deferred<Awaited<ReturnType<RuntimeApi['startRun']>>>(); let reads = 0; let cancels = 0;
    const h = setup({ startRun: async () => ack.promise, getRun: async () => { reads++; return runView(); }, cancel: async () => { cancels++; return run(); } });
    await h.controller.open(id(10)); const pending = h.controller.start('start', null); h.controller.disconnect();
    ack.resolve({ runId: id(1), status: 'queued', budgetWindowId: id(3), limits: runView().remainingBudget.limits }); await pending;
    expect(h.controller.getState()).toMatchObject({ phase: 'idle', task: null }); expect(reads).toBe(0); expect(cancels).toBe(0);
  });
  it('only accepts clarification while waiting and coalesces identical answers', async () => {
    const question = { id: id(80), runId: id(1), prompt: 'controlled_fixture 哪一年？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null };
    const h = setup({ getRun: async () => ({ ...runView(), run: { ...run(), status: 'waiting_for_user' }, clarification: question }) }, async () => caseView(10, run()));
    await h.controller.open(id(10));
    const input = { answer: '2026', proceedWithUnknown: false };
    await Promise.all([h.controller.answer(id(80), input), h.controller.answer(id(80), input)]);
    await h.controller.answer(id(80), input);
    expect(h.posts.filter((post) => post.action === 'answer')).toHaveLength(1); h.controller.disconnect();
    const blocked = setup(); await blocked.controller.open(id(10)); await blocked.controller.answer(id(80), input);
    expect(blocked.posts).toHaveLength(0); expect(blocked.controller.getState().error?.code).toBe('INVALID_STATE'); blocked.controller.disconnect();
  });
  it('a late answer acknowledgement does not restart polling over a newer clarification', async () => {
    const ack = deferred<Awaited<ReturnType<RuntimeApi['answerClarification']>>>(); let question = id(80); let reads = 0;
    const h = setup({ answerClarification: async () => ack.promise, getRun: async () => { reads++; return { ...runView(), run: { ...run(), status: 'waiting_for_user' }, clarification: { id: question, runId: id(1), prompt: 'controlled_fixture 新问题', missingFields: [], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null } }; } }, async () => caseView(10, run()));
    await h.controller.open(id(10)); const pending = h.controller.answer(id(80), { answer: '2026', proceedWithUnknown: false });
    question = id(81); await h.task.follow(id(10), id(1)); const before = reads;
    ack.resolve({ runId: id(1), status: 'queued' }); await pending;
    expect(reads).toBe(before); expect(h.controller.getState().task?.data?.clarification?.id).toBe(id(81)); h.controller.disconnect();
  });
  it.each([[409, 'INVALID_STATE'], [429, 'RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE']] as const)('preserves safe %s failure without success or implicit retry', async (status, code) => {
    let posts = 0; const h = setup({ startRun: async () => { posts++; throw new ClientError(code, 'controlled_fixture 安全错误', 'controlled-request', status); } });
    await h.controller.open(id(10)); await h.controller.start('start', null);
    expect(h.controller.getState()).toMatchObject({ phase: 'error', investigation: { id: id(10) }, error: { code, status, requestId: 'controlled-request' }, submission: { outcome: 'failed' } }); expect(posts).toBe(1); h.controller.disconnect();
  });
  it('rejects invalid ids/body and mismatched investigation responses safely', async () => {
    const h = setup({}, async () => caseView(20));
    await h.controller.open('bad'); expect(h.reads).toBe(0); expect(h.controller.getState().error?.code).toBe('VALIDATION_ERROR');
    await h.controller.open(id(10)); expect(h.controller.getState().error?.code).toBe('PROTOCOL_ERROR');
    h.controller.disconnect();
  });
  it('ignores a stale rejected draft read after a newer action revision', async () => {
    const old = deferred<InvestigationView>(); let reads = 0;
    const h = setup({}, async () => ++reads === 1 ? caseView() : old.promise);
    await h.controller.open(id(10)); const reopening = h.controller.open(id(10)); await h.controller.start('start', null);
    old.reject(Error('controlled_fixture old network failure')); await reopening;
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', error: null }); h.controller.dispose();
  });
  it('disconnect publishes idle connection while retaining saved task material', async () => {
    const h = setup({}, async () => caseView(10, run())); await h.controller.open(id(10)); h.controller.disconnect();
    expect(h.controller.getState()).toMatchObject({ phase: 'idle', task: { connection: 'idle', data: { run: { id: id(1) } } } }); h.controller.dispose();
  });
  it('discovers the latest cancelled run on a later public event page', async () => {
    const cursors: number[] = [];
    const h = setup({ getEvents: async (_caseId, after) => { cursors.push(after); return after === 0 ? { items: [{ ...event(1), type: 'run.queued' }], nextSeq: 100, hasMore: true } : { items: [{ ...event(101, id(2)), type: 'run.queued' }], nextSeq: 101, hasMore: false }; },
      getRun: async (runId) => ({ ...runView(), run: { ...run(), id: runId, status: 'cancelled' } }),
    }, async () => { const view = caseView(); view.investigation.status = 'cancelled'; return view; });
    await h.controller.open(id(10));
    expect(cursors.slice(0, 2)).toEqual([0, 100]);
    expect(h.controller.getState()).toMatchObject({ recoveryIncomplete: false, task: { data: { run: { id: id(2), status: 'cancelled' } } } }); h.controller.dispose();
  });
  it('marks incomplete terminal recovery explicitly when lifecycle records cannot identify the run', async () => {
    const h = setup({}, async () => { const view = caseView(); view.investigation.status = 'cancelled'; return view; });
    await h.controller.open(id(10)); await h.controller.start('resume', id(1));
    expect(h.controller.getState()).toMatchObject({ phase: 'error', recoveryIncomplete: true, task: null, error: { code: 'INVALID_STATE' } });
    expect(h.posts).toHaveLength(0); h.controller.dispose();
  });
});
