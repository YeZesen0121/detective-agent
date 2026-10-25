import { afterEach, expect, it } from 'vitest';
import { listenLoopback } from '../helpers/loopback-http.js';
import type { InvestigationModule, InvestigationServices } from '../../src/shared/ports.js';
import { buildApp, type FoundationOptions } from '../../src/server/app.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { samplePayload } from '../helpers/result.js';
const origin = 'http://127.0.0.1:5173';
const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); });
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; }
const funding = { ...zeroAmounts(), activeMs: 10000000, searches: 200, reads: 200, modelCalls: 200, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 100000000 };
function moduleFor(work?: InvestigationModule['runInvestigation']): InvestigationModule {
  return {
    prepareInvestigation: async input => ({ scope: { ...samplePayload().scope, basicMode: input.basicMode }, clarification: null, canInvestigate: true }),
    runInvestigation: work ?? (async (input, services) => {
      const draft = { ...samplePayload(), investigationId: input.context.investigationId, runId: input.run.id, scope: input.scope, queryTime: services.clock.now() };
      await services.checkpoint.save(input.run.id, input.context.epoch, { sources: draft.sources, evidence: draft.evidence, claims: draft.claims });
      return { completion: 'completed', stopReason: 'answered', draft, clarification: null };
    }),
    routeFollowup: async () => { throw Error('not used'); },
    compareWatchResult: async () => { throw Error('not used'); },
  };
}
function setup(module = moduleFor(), now = () => new Date().toISOString()) {
  const unavailable = async () => { throw Error('unexpected paid call'); };
  const options: FoundationOptions = {
    databasePath: ':memory:', allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code',
    serviceEndsAt: new Date(Date.now() + 3600000).toISOString(), secureCookies: false, now,
    investigationRuntime: {
      module, providers: { search: unavailable, read: unavailable, model: unavailable },
      funding: { global: funding, trial: funding, demo: funding },
      pricing: { quote: () => ({ provider: 'controlled_fixture', purpose: 'controlled test', priceRevision: 'fixture-v1', estimated: { ...zeroAmounts(), moneyMicros: 1 }, timeoutMs: 1000, attemptNo: 1 }),
        actual: () => null },
    },
  };
  const app = buildApp(options); apps.push(app); return app;
}
async function client(app: ReturnType<typeof buildApp>) {
  const login = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin }, payload: { code: 'controlled-trial-code' } });
  const cookie = String(login.headers['set-cookie']).split(';')[0]!;
  const headers = { cookie, origin, 'idempotency-key': 'controlled-draft' };
  const draft = await app.inject({ method: 'POST', url: '/api/v1/investigations', headers, payload: { originalQuestion: 'controlled_fixture：核对日期', basicMode: 'truth', presentationMode: 'evidence' } });
  return { headers, id: draft.json().data.id as string };
}
it('stops scope preparation at the actual model budget instead of asking the user to fill a budget deficit',async()=>{
 let sends=0;const module=moduleFor();module.prepareInvestigation=async(input,services,signal)=>{
  await services.model({purpose:'scope',promptVersion:'controlled_fixture',schemaId:'investigation.scope.grounded.v1',maxOutputTokens:100,messages:[{role:'user',content:'controlled_fixture scope'}]},input.context,signal);
  return{canInvestigate:false,scope:null,clarification:{id:'00000000-0000-4000-8000-000000000011',runId:input.context.runId!,prompt:'controlled_fixture 当前没有范围复核额度',missingFields:['inputScope'],options:[],canProceedWithUnknown:false,answer:null,answeredAt:null}};
 };
 const unavailable=async()=>{throw Error('controlled_fixture forbidden');},funds={...funding,modelCalls:1};
 const app=buildApp({databasePath:':memory:',allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:new Date(Date.now()+3600000).toISOString(),secureCookies:false,investigationRuntime:{module,providers:{search:unavailable,read:unavailable,model:async()=>{sends++;return{value:{controlled_fixture:true},modelId:'controlled_fixture',finishReason:'stop',providerRequestId:null,usage:{inputTokens:10,outputTokens:10,searches:0,reads:0,characters:0}};}},funding:{global:funds,trial:funds,demo:funds},pricing:{quote:()=>({provider:'controlled_fixture',purpose:'scope',priceRevision:'fixture-v1',attemptNo:1,timeoutMs:1000,estimated:{...zeroAmounts(),modelCalls:1,inputTokens:2000,outputTokens:100,moneyMicros:100}}),actual:()=>({...zeroAmounts(),modelCalls:1,inputTokens:10,outputTokens:10,moneyMicros:1})}}});apps.push(app);
 const c=await client(app),started=await app.inject({method:'POST',url:`/api/v1/investigations/${c.id}/runs`,headers:c.headers,payload:{action:'start',previousRunId:null}});let view:any;
 for(let i=0;i<100;i++){view=(await app.inject({url:`/api/v1/runs/${started.json().data.runId}`,headers:c.headers})).json().data;if(['waiting_for_user','failed','partial','completed'].includes(view.run.status))break;await new Promise<void>(resolve=>setImmediate(resolve));}
 expect(view.run).toMatchObject({status:'failed',stopReason:'model_limit',createdResultVersionId:null});expect(view.clarification).toBeNull();expect(view.remainingBudget.used.modelCalls).toBe(1);expect(sends).toBe(1);
});
async function until(app: ReturnType<typeof buildApp>, url: string, headers: Record<string, string>, status: string) {
  for (let i = 0; i < 100; i++) {
    const r = await app.inject({ url, headers });
    if (r.json().data?.run?.status === status) return r.json().data;
    await new Promise<void>(resolve => setTimeout(resolve, 2));
  }
  throw Error('run did not reach ' + status);
}
it('serves the full controlled HTTP lifecycle with idempotency, evidence, copy and owner isolation', async () => {
  const app = setup(); const a = await client(app);
  const start = () => app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'controlled-run' }, payload: { action: 'start', previousRunId: null } });
  const [one, two] = await Promise.all([start(), start()]);
  expect(one.statusCode).toBe(202); expect(two.statusCode).toBe(202);
  expect(two.json().data.runId).toBe(one.json().data.runId);
  const runId = one.json().data.runId;
  const done = await until(app, '/api/v1/runs/' + runId, a.headers, 'completed');
  const result = await app.inject({ url: '/api/v1/results/' + done.run.createdResultVersionId, headers: a.headers });
  expect(result.statusCode).toBe(200);
  expect(result.json().data.version.payload.summary).toContain('十月三十日');
  const copied = await app.inject({ url: '/api/v1/results/' + done.run.createdResultVersionId + '/copy', headers: a.headers });
  expect(copied.json().data.text).toContain('https://example.invalid/notice');
  const b = await client(app);
  expect((await app.inject({ url: '/api/v1/runs/' + runId, headers: b.headers })).statusCode).toBe(404);
  expect((await app.inject({ url: '/api/v1/results/' + done.run.createdResultVersionId, headers: b.headers })).statusCode).toBe(404);
  const events = await app.inject({ url: '/api/v1/investigations/' + a.id + '/events?afterSeq=0', headers: a.headers });
  expect(events.json().data.items.at(-1).type).toBe('run.finalized');
  expect((await start()).json().data.runId).toBe(runId);
  const changed = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'controlled-run' }, payload: { action: 'add_budget', previousRunId: runId } });
  expect(changed.statusCode).toBe(409);
});
it('fences a cancelled worker from publishing a late response and resumes its original budget', async () => {
  const pending = deferred<Awaited<ReturnType<InvestigationModule['runInvestigation']>>>();
  let entered = false;
  const app = setup(moduleFor(async () => { entered = true; return pending.promise; }));
  const a = await client(app);
  const start = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  expect(start.statusCode).toBe(202); const runId = start.json().data.runId;
  for (let i = 0; !entered && i < 100; i++) await new Promise<void>(r => setTimeout(r, 2));
  expect(entered).toBe(true);
  const cancelled = await app.inject({ method: 'POST', url: '/api/v1/runs/' + runId + '/cancel', headers: a.headers });
  expect(cancelled.statusCode).toBe(202);
  pending.resolve({ completion: 'failed', stopReason: 'provider_error', draft: null, clarification: null });
  const state = await until(app, '/api/v1/runs/' + runId, a.headers, 'cancelled');
  expect(state.run.createdResultVersionId).toBeNull();
  const resumed = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'controlled-resume' }, payload: { action: 'resume', previousRunId: runId } });
  expect(resumed.statusCode).toBe(202);
  expect(resumed.json().data.budgetWindowId).toBe(start.json().data.budgetWindowId);
});
it('persists clarification answers and excludes user waiting from window active time', async () => {
  let tick = Date.now(); const clock = () => new Date(tick).toISOString();
  const module = moduleFor(); const original = module.prepareInvestigation;
  module.prepareInvestigation = async input => input.clarificationAnswer ? original(input, {} as InvestigationServices, new AbortController().signal) : {
    canInvestigate: false, scope: null, clarification: { id: '10000000-0000-4000-8000-000000000001', runId: input.context.runId!, prompt: '哪一届？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null },
  };
  const app = setup(module, clock); const a = await client(app);
  const response = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  expect(response.statusCode).toBe(202);
  const runId = response.json().data.runId;
  const waiting = await until(app, '/api/v1/runs/' + runId, a.headers, 'waiting_for_user');
  tick += 100000;
  const answer = await app.inject({ method: 'POST', url: '/api/v1/runs/' + runId + '/clarifications/' + waiting.clarification.id, headers: a.headers, payload: { answer: '2026', proceedWithUnknown: false } });
  expect(answer.statusCode).toBe(202);
  const done = await until(app, '/api/v1/runs/' + runId, a.headers, 'completed');
  expect(done.remainingBudget.used.activeMs).toBe(0);
  const replay = await app.inject({ method: 'POST', url: '/api/v1/runs/' + runId + '/clarifications/' + waiting.clarification.id, headers: a.headers, payload: { answer: '2026', proceedWithUnknown: false } });
  expect(replay.statusCode).toBe(202);
  expect(replay.json().data.status).toBe('completed');
});
it('fails closed when no investigation implementation is configured', async () => {
  const app = buildApp({ databasePath: ':memory:', allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code', serviceEndsAt: new Date(Date.now() + 3600000).toISOString(), secureCookies: false });
  apps.push(app); const a = await client(app);
  const r = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  expect(r.statusCode).toBe(503); expect(r.json().error.code).toBe('PROVIDER_UNAVAILABLE');
});

it('charges elapsed work to the original window once and preserves it after resume', async () => {
  let tick = Date.now();
  const module = moduleFor();
  const base = module.runInvestigation;
  module.runInvestigation = async (input, services, signal) => {
    tick += 5000;
    await services.budget.snapshot(input.context);
    await services.budget.snapshot(input.context);
    return base(input, services, signal);
  };
  const app = setup(module, () => new Date(tick).toISOString()); const a = await client(app);
  const start = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  const state = await until(app, '/api/v1/runs/' + start.json().data.runId, a.headers, 'completed');
  expect(state.remainingBudget.used.activeMs).toBe(5000);
  expect(state.remainingBudget.remaining.activeMs).toBe(415000);
  const again = await app.inject({ url: '/api/v1/runs/' + state.run.id, headers: a.headers });
  expect(again.json().data.remainingBudget.used.activeMs).toBe(5000);
});
it('returns captured partial evidence on a provider exception instead of throwing material away', async () => {
  const app = setup(moduleFor(async (input, services) => {
    const draft = { ...samplePayload(), investigationId: input.context.investigationId, runId: input.run.id };
    await services.checkpoint.save(input.run.id, input.context.epoch, { sources: draft.sources, evidence: draft.evidence, claims: draft.claims });
    throw Error('controlled upstream failure');
  }));
  const a = await client(app);
  const start = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  const state = await until(app, '/api/v1/runs/' + start.json().data.runId, a.headers, 'partial');
  const r = await app.inject({ url: '/api/v1/results/' + state.run.createdResultVersionId, headers: a.headers });
  expect(r.json().data.version.payload.sources).toHaveLength(1);
  expect(r.json().data.version.payload.claims[0].status).toBe('insufficient');
});
it('keeps an old report unchanged when explicit new budget creates a new version', async () => {
  const module = moduleFor(); const base = module.runInvestigation;
  module.runInvestigation = async (input, services, signal) => {
    const result = await base(input, services, signal);
    if (input.baseline && result.draft) {
      result.draft.summary = 'controlled_fixture：第二个独立保存版本';
      result.draft.delta = { previousVersionId: input.baseline.id, changes: [], checkedAt: services.clock.now() };
    }
    return result;
  };
  const app = setup(module); const a = await client(app);
  const one = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  const first = await until(app, '/api/v1/runs/' + one.json().data.runId, a.headers, 'completed');
  const old = await app.inject({ url: '/api/v1/results/' + first.run.createdResultVersionId, headers: a.headers });
  const two = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'explicit-new-budget' }, payload: { action: 'add_budget', previousRunId: first.run.id } });
  expect(two.statusCode).toBe(202); expect(two.json().data.budgetWindowId).not.toBe(one.json().data.budgetWindowId);
  const second = await until(app, '/api/v1/runs/' + two.json().data.runId, a.headers, 'completed');
  const kept = await app.inject({ url: '/api/v1/results/' + first.run.createdResultVersionId, headers: a.headers });
  expect(kept.json().data.version).toEqual(old.json().data.version);
  expect(kept.json().data.updateNotice.latestResultVersionId).toBe(second.run.createdResultVersionId);
});

it('continues a server-owned task after the client aborts its completed start connection', async () => {
  const ready = deferred<void>(); const finish = deferred<void>(); let aborted = false;
  const app = setup(moduleFor(async (input, services, signal) => {
    signal.addEventListener('abort', () => { aborted = true; }, { once: true });
    ready.resolve(); await finish.promise;
    return moduleFor().runInvestigation(input, services, signal);
  }));
  const a = await client(app);
  const address = await listenLoopback(app);
  const network = new AbortController();
  const response = await fetch(address + '/api/v1/investigations/' + a.id + '/runs', { method: 'POST', headers: { ...a.headers, 'content-type': 'application/json' }, body: JSON.stringify({ action: 'start', previousRunId: null }), signal: network.signal });
  const body = await response.json() as { data: { runId: string } };
  expect(response.status).toBe(202);
  await ready.promise; network.abort();
  const running = await app.inject({ url: '/api/v1/runs/' + body.data.runId, headers: a.headers });
  expect(running.json().data.run.status).toBe('running'); expect(aborted).toBe(false);
  finish.resolve(); await until(app, '/api/v1/runs/' + body.data.runId, a.headers, 'completed');
});
it('limits active investigations to two while queued clients wait without provider execution', async () => {
  let entered = 0;
  const app = setup(moduleFor(async (_input, _services, signal) => {
    entered++;
    await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true }));
    return { completion: 'failed', stopReason: 'cancelled', draft: null, clarification: null };
  }));
  const clients = await Promise.all([client(app), client(app), client(app)]);
  const starts = [];
  for (const a of clients) starts.push(await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } }));
  await until(app, '/api/v1/runs/' + starts[0]!.json().data.runId, clients[0]!.headers, 'running');
  await until(app, '/api/v1/runs/' + starts[1]!.json().data.runId, clients[1]!.headers, 'running');
  const queued = await app.inject({ url: '/api/v1/runs/' + starts[2]!.json().data.runId, headers: clients[2]!.headers });
  expect(queued.json().data.run.status).toBe('queued');
  expect(queued.json().data.remainingBudget.used.activeMs).toBe(0);
  expect(entered).toBe(2);
  await app.inject({ method: 'POST', url: '/api/v1/runs/' + starts[0]!.json().data.runId + '/cancel', headers: clients[0]!.headers });
  await until(app, '/api/v1/runs/' + starts[2]!.json().data.runId, clients[2]!.headers, 'running');
});

it('applies the same queue limit when a waiting task is answered', async () => {
  const hold=deferred<void>(),waitingCases=new Set<string>();
  const module = moduleFor(async (_input,_services,signal)=>{
    await Promise.race([hold.promise,new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});})]);
    return {completion:'failed',stopReason:'cancelled',draft:null,clarification:null};
  });
  const prepare=module.prepareInvestigation;
  module.prepareInvestigation = async (input,services,signal) => waitingCases.has(input.context.investigationId!)?({
    scope: null, canInvestigate: false,
    clarification: { id: '10000000-0000-4000-8000-000000000001', runId: input.context.runId!, prompt: '哪一届？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null },
  }):prepare(input,services,signal);
  const app = setup(module); const a = await client(app);waitingCases.add(a.id);
  const first = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + a.id + '/runs', headers: a.headers, payload: { action: 'start', previousRunId: null } });
  const state = await until(app, '/api/v1/runs/' + first.json().data.runId, a.headers, 'waiting_for_user');
  for(let i=0;i<2;i++){
    const worker=await client(app),started=await app.inject({method:'POST',url:'/api/v1/investigations/'+worker.id+'/runs',headers:worker.headers,payload:{action:'start',previousRunId:null}});
    expect(started.statusCode).toBe(202);await until(app,'/api/v1/runs/'+started.json().data.runId,worker.headers,'running');
  }
  for (let i = 0; i < 2; i++) {
    const draft = await app.inject({ method: 'POST', url: '/api/v1/investigations', headers: { ...a.headers, 'idempotency-key': 'queued-draft-' + i }, payload: { originalQuestion: 'controlled_fixture：排队 ' + i, basicMode: 'truth', presentationMode: 'brief' } });
    const queued = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + draft.json().data.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'queued-run-' + i }, payload: { action: 'start', previousRunId: null } });
    expect(queued.statusCode).toBe(202);
    await until(app,'/api/v1/runs/'+queued.json().data.runId,a.headers,'queued');
  }
  const answer = await app.inject({ method: 'POST', url: '/api/v1/runs/' + state.run.id + '/clarifications/' + state.clarification.id, headers: a.headers, payload: { answer: '2026', proceedWithUnknown: false } });
  expect(answer.statusCode).toBe(429);
  const waiting = await app.inject({ url: '/api/v1/runs/' + state.run.id, headers: a.headers });
  expect(waiting.json().data.run.status).toBe('waiting_for_user');
  expect(waiting.json().data.clarification.answeredAt).toBeNull();
  hold.resolve();
});

it('counts clarification continuations in the five-per-minute start limit', async () => {
  const module = moduleFor();
  module.prepareInvestigation = async input => ({ scope: null, canInvestigate: false,
    clarification: { id: input.context.runId!, runId: input.context.runId!, prompt: '哪一届？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null } });
  const app = setup(module); const a = await client(app);
  let last: Awaited<ReturnType<typeof until>> | null = null;
  for (let i = 0; i < 5; i++) {
    const draft = i === 0 ? { id: a.id } : (await app.inject({ method: 'POST', url: '/api/v1/investigations', headers: { ...a.headers, 'idempotency-key': 'rate-draft-' + i }, payload: { originalQuestion: 'controlled_fixture：限频 ' + i, basicMode: 'truth', presentationMode: 'brief' } })).json().data;
    const started = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + draft.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'rate-start-' + i }, payload: { action: 'start', previousRunId: null } });
    expect(started.statusCode).toBe(202);
    last = await until(app, '/api/v1/runs/' + started.json().data.runId, a.headers, 'waiting_for_user');
    if (i < 4) await app.inject({ method: 'POST', url: '/api/v1/runs/' + last.run.id + '/cancel', headers: a.headers });
  }
  const answered = await app.inject({ method: 'POST', url: '/api/v1/runs/' + last!.run.id + '/clarifications/' + last!.clarification.id, headers: a.headers, payload: { answer: '2026', proceedWithUnknown: false } });
  expect(answered.statusCode).toBe(429); expect(answered.json().error.code).toBe('RATE_LIMITED');
  const unchanged = await app.inject({ url: '/api/v1/runs/' + last!.run.id, headers: a.headers });
  expect(unchanged.json().data.clarification.answeredAt).toBeNull();
});

it('rejects a clarification continuation when the global queue already contains twenty jobs', async () => {
  const hold=deferred<void>(),waitingCases=new Set<string>();
  const module = moduleFor(async (_input,_services,signal)=>{
    await Promise.race([hold.promise,new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});})]);
    return {completion:'failed',stopReason:'cancelled',draft:null,clarification:null};
  });
  const prepare=module.prepareInvestigation;
  module.prepareInvestigation = async (input,services,signal) => waitingCases.has(input.context.investigationId!)?({ scope: null, canInvestigate: false,
    clarification: { id: input.context.runId!, runId: input.context.runId!, prompt: '哪一届？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null } }):prepare(input,services,signal);
  const app = setup(module);
  const targetClient=await client(app);waitingCases.add(targetClient.id);
  const first=await app.inject({method:'POST',url:'/api/v1/investigations/'+targetClient.id+'/runs',headers:targetClient.headers,payload:{action:'start',previousRunId:null}});
  const waiting=await until(app,'/api/v1/runs/'+first.json().data.runId,targetClient.headers,'waiting_for_user');
  const target={headers:targetClient.headers,runId:waiting.run.id,questionId:waiting.clarification.id};
  for(let i=0;i<2;i++){
    const worker=await client(app),started=await app.inject({method:'POST',url:'/api/v1/investigations/'+worker.id+'/runs',headers:worker.headers,payload:{action:'start',previousRunId:null}});
    expect(started.statusCode).toBe(202);await until(app,'/api/v1/runs/'+started.json().data.runId,worker.headers,'running');
  }
  for (let n = 0; n < 10; n++) {
    const a = n===0?targetClient:await client(app);
    for (let i = 0; i < 2; i++) {
      const draft = await app.inject({ method: 'POST', url: '/api/v1/investigations', headers: { ...a.headers, 'idempotency-key': 'global-draft-' + i }, payload: { originalQuestion: 'controlled_fixture：排队', basicMode: 'truth', presentationMode: 'brief' } });
      const queued = await app.inject({ method: 'POST', url: '/api/v1/investigations/' + draft.json().data.id + '/runs', headers: { ...a.headers, 'idempotency-key': 'global-run-' + i }, payload: { action: 'start', previousRunId: null } });
      expect(queued.statusCode).toBe(202);
      await until(app,'/api/v1/runs/'+queued.json().data.runId,a.headers,'queued');
    }
  }
  const answer = await app.inject({ method: 'POST', url: '/api/v1/runs/' + target!.runId + '/clarifications/' + target!.questionId, headers: target!.headers, payload: { answer: '2026', proceedWithUnknown: false } });
  expect(answer.statusCode).toBe(429); expect(answer.json().error.code).toBe('QUEUE_FULL');
  const stillWaiting = await app.inject({ url: '/api/v1/runs/' + target!.runId, headers: target!.headers });
  expect(stillWaiting.json().data.clarification.answeredAt).toBeNull();
  hold.resolve();
});
