import { afterEach, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDatabase } from '../../src/server/platform/database.js';
import { buildApp, type FoundationOptions } from '../../src/server/app.js';
import type { FollowupDecision, InvestigationModule } from '../../src/shared/ports.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { samplePayload } from '../helpers/result.js';
import { listenLoopback } from '../helpers/loopback-http.js';

// All material and providers in this file are controlled_fixture.
const origin = 'http://127.0.0.1:5173';
const apps: ReturnType<typeof buildApp>[] = [];
const directories: string[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await app.close(); for (const path of directories.splice(0)) rmSync(path, { recursive: true, force: true }); });
const funds = { ...zeroAmounts(), activeMs: 10000000, searches: 200, reads: 200, modelCalls: 200, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 100000000 };
const explanation: FollowupDecision = { route: 'explain', answer: { text: '仅解释受控报告：报名截至十月三十日。', claimIds: [samplePayload().claims[0]!.id], evidenceIds: [samplePayload().evidence[0]!.id] }, researchPurpose: null, suggestedQuestion: null };
function setup(route: InvestigationModule['routeFollowup'] = async () => explanation, databasePath = ':memory:',clock?:()=>string) {
  const inputs: Parameters<InvestigationModule['runInvestigation']>[0][] = [];
  const module: InvestigationModule = {
    prepareInvestigation: async input => ({ canInvestigate: true, scope: input.previousScope ?? samplePayload().scope, clarification: null }),
    runInvestigation: async (input, services) => {
      inputs.push(input);
      const draft = { ...samplePayload(), investigationId: input.context.investigationId, runId: input.run.id, scope: input.scope, queryTime: services.clock.now(), delta: input.baseline ? { previousVersionId: input.baseline.id, changes: [], checkedAt: services.clock.now() } : null };
      await services.checkpoint.save(input.run.id, input.context.epoch, { sources: draft.sources, evidence: draft.evidence, claims: draft.claims });
      return { completion: 'completed', stopReason: 'answered', draft, clarification: null };
    }, routeFollowup: route, compareWatchResult: async () => { throw Error('unused'); },
  };
  const unavailable = async () => { throw Error('unexpected controlled_fixture provider call'); };
  const options: FoundationOptions = { databasePath, allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code', serviceEndsAt: new Date((clock?Date.parse(clock()):Date.now()) + (clock?3*86400000:3600000)).toISOString(), secureCookies: false,...(clock?{now:clock}:{}),
    investigationRuntime: { module, enableFollowups: true, enableWatches: false, providers: { search: unavailable, read: unavailable, model: unavailable }, funding: { global: funds, trial: funds, demo: funds }, pricing: { quote: () => ({ provider: 'controlled_fixture', purpose: 'followup', priceRevision: 'fixture-v1', estimated: { ...zeroAmounts(), moneyMicros: 1 }, timeoutMs: 1000, attemptNo: 1 }), actual: () => null } } };
  const app = buildApp(options); apps.push(app); return { app, inputs, options };
}
async function poll(app: ReturnType<typeof buildApp>, url: string, headers: Record<string, string>, done: (data: any) => boolean) {
  for (let i = 0; i < 150; i++) { const r = await app.inject({ url, headers }); const data = r.json().data; if (data && done(data)) return data; await new Promise(r => setTimeout(r, 2)); }
  throw Error('controlled_fixture lifecycle did not finish');
}
async function seed(app: ReturnType<typeof buildApp>,basicMode:'truth'|'latest'='truth') {
  const login = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin }, payload: { code: 'controlled-trial-code' } });
  const headers = { origin, cookie: String(login.headers['set-cookie']).split(';')[0]!, 'idempotency-key': 'controlled-draft' };
  const inv = (await app.inject({ method: 'POST', url: '/api/v1/investigations', headers, payload: { originalQuestion: 'controlled_fixture：核对截止日期', basicMode, presentationMode: 'evidence' } })).json().data;
  const start = (await app.inject({ method: 'POST', url: `/api/v1/investigations/${inv.id}/runs`, headers, payload: { action: 'start', previousRunId: null } })).json().data;
  const view = await poll(app, `/api/v1/runs/${start.runId}`, headers, d => d.run.status === 'completed');
  const result = (await app.inject({ url: `/api/v1/results/${view.run.createdResultVersionId}`, headers })).json().data.version;
  return { headers, inv, run: view.run, result };
}
it('queues a fixed-version explanation once, preserves it across reads and isolates owners', async () => {
  let calls = 0; const { app, inputs } = setup(async () => { calls++; return explanation; }); const a = await seed(app);
  const submit = (question = '请解释这个日期') => app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question } });
  const [one, two] = await Promise.all([submit(), submit()]); expect(one.statusCode).toBe(202); expect(two.json().data).toEqual(one.json().data);
  const id = one.json().data.followupTurnId;
  const done = await poll(app, `/api/v1/followups/${id}`, a.headers, d => d.status === 'completed');
  expect(done.turn.route).toBe('explain'); expect(done.turn.resultVersionId).toBe(a.result.id); expect(done.activeRunId).toBeNull(); expect(done.evidenceIds).toEqual(explanation.answer!.evidenceIds);
  expect(calls).toBe(1); expect(inputs).toHaveLength(1); expect((await submit('不同的问题')).statusCode).toBe(409);
  const other = await seed(app); expect((await app.inject({ url: `/api/v1/followups/${id}`, headers: other.headers })).statusCode).toBe(404);
  const invalidOrigin = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: { ...a.headers, origin: 'https://other.invalid' }, payload: { resultVersionId: a.result.id, question: '解释' } }); expect(invalidOrigin.statusCode).toBe(400);
});
it('does not allow the routing module to search or create a hidden research window', async () => {
  const { app, inputs } = setup(async (input, services, signal) => {
    await services.search({ query: 'controlled_fixture forbidden', purpose: 'route must not search', claimIds: [], site: null, freshness: null, limit: 1 }, input.context, signal); return explanation;
  }); const a = await seed(app);
  const r = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question: '解释' } });
  const done = await poll(app, `/api/v1/followups/${r.json().data.followupTurnId}`, a.headers, d => d.status === 'failed'); expect(done.error.code).toBe('INVALID_STATE'); expect(inputs).toHaveLength(1);
});
it('rechecks exhausted research money after routing and only adds budget on explicit followup continuation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'detective-followup-')); directories.push(directory); const path = join(directory, 'runtime.db');
  const { app, inputs } = setup(async () => ({ route: 'research_same_scope', answer: null, researchPurpose: '核对更新', suggestedQuestion: null }), path); const a = await seed(app);
  const db = openDatabase(path); try { const row = db.prepare('SELECT limits_json,used_json FROM budget_pools WHERE id=?').get(a.run.budgetWindowId) as { limits_json: string; used_json: string }; const used = JSON.parse(row.used_json); used.moneyMicros = JSON.parse(row.limits_json).moneyMicros; db.prepare('UPDATE budget_pools SET used_json=? WHERE id=?').run(JSON.stringify(used), a.run.budgetWindowId); } finally { db.close(); }
  const r = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question: '后来延期了吗？' } });
  const id = r.json().data.followupTurnId; const done = await poll(app, `/api/v1/followups/${id}`, a.headers, d => d.status === 'completed'); expect(done.turn.route).toBe('needs_budget_confirmation'); expect(inputs).toHaveLength(1);
  const continued = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/runs`, headers: { ...a.headers, 'idempotency-key': 'controlled-explicit-budget' }, payload: { action: 'add_budget', previousRunId: a.run.id, followupTurnId: id } }); expect(continued.statusCode).toBe(202);
  const next = await poll(app, `/api/v1/runs/${continued.json().data.runId}`, a.headers, d => d.run.status === 'completed'); expect(next.run.budgetWindowId).not.toBe(a.run.budgetWindowId); expect(inputs.at(-1)!.followupQuestion).toBe('后来延期了吗？');
});
it('fences late routing on shutdown and restart never replays it, while GET preserves the failed submission', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'detective-followup-')); directories.push(directory); const path = join(directory, 'runtime.db');
  let resolve!: (value: FollowupDecision) => void, entered = false, calls = 0; const pending = new Promise<FollowupDecision>(r => { resolve = r; });
  const { app, options, inputs } = setup(async () => { entered = true; calls++; return pending; }, path); const a = await seed(app);
  const post = { method: 'POST' as const, url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question: '解释旧证据' } };
  const r = await app.inject(post); const id = r.json().data.followupTurnId;
  for (let i = 0; !entered && i < 100; i++) await new Promise(r => setTimeout(r, 2)); expect(entered).toBe(true);
  await app.close(); apps.splice(apps.indexOf(app), 1); resolve({ route: 'research_same_scope', answer: null, researchPurpose: 'late', suggestedQuestion: null });
  await new Promise(r => setTimeout(r, 5)); const reopened = buildApp(options); apps.push(reopened);
  const state = (await reopened.inject({ url: `/api/v1/followups/${id}`, headers: a.headers })).json().data; expect(state.status).toBe('failed'); expect(state.error.code).toBe('SERVER_RESTART');
  expect((await reopened.inject(post)).json().data.followupTurnId).toBe(id); expect(calls).toBe(1); expect(inputs).toHaveLength(1);
});
it('dispatches same-scope research with its question, original remaining window and immutable baseline', async () => {
  const { app, inputs } = setup(async () => ({ route: 'research_same_scope', answer: null, researchPurpose: '核对延期公告', suggestedQuestion: null })); const a = await seed(app);
  const response = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question: '后来延期了吗？' } }); expect(response.statusCode).toBe(202);
  const done = await poll(app, `/api/v1/followups/${response.json().data.followupTurnId}`, a.headers, d => d.status === 'completed');
  expect(done.turn.route).toBe('research_same_scope'); expect(done.researchPurpose).toBe('核对延期公告');
  const next = await poll(app, `/api/v1/runs/${done.activeRunId}`, a.headers, d => d.run.status === 'completed');
  expect(next.run.trigger).toBe('followup'); expect(next.run.budgetWindowId).toBe(a.run.budgetWindowId); expect(next.run.previousRunId).toBe(a.run.id);
  expect(inputs.at(-1)!.followupQuestion).toBe('后来延期了吗？'); expect(inputs.at(-1)!.baseline!.id).toBe(a.result.id); expect(inputs.at(-1)!.checkpoint!.evidence).toHaveLength(1);
  expect(next.run.createdResultVersionId).not.toBe(a.result.id);
  const old = (await app.inject({ url: `/api/v1/results/${a.result.id}`, headers: a.headers })).json().data; expect(old.version).toEqual(a.result); expect(old.updateNotice.latestResultVersionId).toBe(next.run.createdResultVersionId);
  const stale = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: { ...a.headers, 'idempotency-key': 'controlled-stale' }, payload: { resultVersionId: a.result.id, question: '再查这个旧报告' } });
  const failed = await poll(app, `/api/v1/followups/${stale.json().data.followupTurnId}`, a.headers, d => d.status === 'failed'); expect(failed.error.code).toBe('STALE_VERSION'); expect(failed.latestResultVersionId).toBe(next.run.createdResultVersionId); expect(inputs).toHaveLength(2);
});
it('passes the authoritative saved followup into preparation without inventing a clarification answer',async()=>{
 const {app,options}=setup(async()=>({route:'research_same_scope',answer:null,researchPurpose:'controlled_fixture 核对新增线索',suggestedQuestion:null}));
 const preparations:unknown[]=[],prepare=options.investigationRuntime!.module.prepareInvestigation;
 options.investigationRuntime!.module.prepareInvestigation=async(input,services,signal)=>{preparations.push(input);return prepare(input,services,signal);};
 const first=await seed(app),question='controlled_fixture 主角是成年老师，好像弹钢琴';
 const response=await app.inject({method:'POST',url:`/api/v1/investigations/${first.inv.id}/followups`,headers:first.headers,payload:{resultVersionId:first.result.id,question}});
 const turnId=response.json().data.followupTurnId,decision=await poll(app,`/api/v1/followups/${turnId}`,first.headers,d=>d.status==='completed');
 await poll(app,`/api/v1/runs/${decision.turn.newRunId}`,first.headers,d=>d.run.status==='completed');
 expect(preparations.at(-1)).toMatchObject({clarificationAnswer:null,followup:{kind:'saved_followup',turnId,resultVersionId:first.result.id,question}});
 expect(preparations[0]).not.toHaveProperty('followup');
});
it.each(['truth','latest'] as const)('%s preserves the original time scope and immutable explanation while latest research uses its new query time',async basicMode=>{
 let timestamp=Date.now(),route:FollowupDecision={route:'explain',answer:{text:'controlled_fixture 解释固定版本',claimIds:[],evidenceIds:[]},researchPurpose:null,suggestedQuestion:null};
 const clock=()=>new Date(timestamp).toISOString(),{app,options,inputs}=setup(async()=>route,':memory:',clock);
 options.investigationRuntime!.module.prepareInvestigation=async input=>({canInvestigate:true,clarification:null,scope:input.previousScope??{...samplePayload().scope,basicMode:input.basicMode,referenceTime:clock(),timeScope:'controlled_fixture 同一届活动'}});
 const first=await seed(app,basicMode),before=structuredClone(first.result);timestamp+=86400000;
 const post=async(key:string)=>app.inject({method:'POST',url:`/api/v1/investigations/${first.inv.id}/followups`,headers:{...first.headers,'idempotency-key':key},payload:{resultVersionId:first.result.id,question:'controlled_fixture 后续公告如何？'}});
 const explanationPost=await post('controlled-time-explain');await poll(app,`/api/v1/followups/${explanationPost.json().data.followupTurnId}`,first.headers,d=>d.status==='completed');expect(inputs).toHaveLength(1);
 route={route:'research_same_scope',answer:null,researchPurpose:'controlled_fixture 同届后续生效公告',suggestedQuestion:null};
 const researchPost=await post('controlled-time-research'),decision=await poll(app,`/api/v1/followups/${researchPost.json().data.followupTurnId}`,first.headers,d=>d.status==='completed');
 expect(decision.turn.route).toBe('research_same_scope');expect(decision.turn.newRunId).toBeTruthy();
 const next=await poll(app,`/api/v1/runs/${decision.turn.newRunId}`,first.headers,d=>['completed','partial','failed'].includes(d.run.status));expect(next.run.status).toBe('completed');
 expect(inputs.at(-1)!.scope.referenceTime).toBe(basicMode==='latest'?clock():before.payload.scope.referenceTime);expect(inputs.at(-1)!.scope.timeScope).toBe(before.payload.scope.timeScope);expect(next.run.budgetWindowId).toBe(first.run.budgetWindowId);
 const old=(await app.inject({url:`/api/v1/results/${first.result.id}`,headers:first.headers})).json().data.version;expect(old).toEqual(before);expect(old.payload.scope.referenceTime).not.toBe(clock());
});
it('never launches research for a budget-confirmation or a new-case suggestion and rejects foreign citations', async () => {
  let decision: FollowupDecision = { route: 'needs_budget_confirmation', answer: null, researchPurpose: '补查缺口', suggestedQuestion: '请明确追加预算' };
  const { app, inputs } = setup(async () => decision); const a = await seed(app);
  async function turn(key: string) { const r = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: { ...a.headers, 'idempotency-key': key }, payload: { resultVersionId: a.result.id, question: key } }); expect(r.statusCode).toBe(202); return poll(app, `/api/v1/followups/${r.json().data.followupTurnId}`, a.headers, d => ['completed', 'failed'].includes(d.status)); }
  expect((await turn('controlled-budget')).turn.route).toBe('needs_budget_confirmation');
  decision = { route: 'suggest_new_case', answer: null, researchPurpose: null, suggestedQuestion: '另一个活动何时截止？' }; expect((await turn('controlled-new-case')).suggestedQuestion).toBe(decision.suggestedQuestion);
  decision = { ...explanation, answer: { ...explanation.answer!, evidenceIds: ['00000000-0000-4000-8000-000000000099'] } }; expect((await turn('controlled-invalid')).status).toBe('failed'); expect(inputs).toHaveLength(1);
});
it('retains the followup question after cancellation and resume, without resetting the window', async () => {
  const { app, options, inputs } = setup(async () => ({ route: 'research_same_scope', answer: null, researchPurpose: '核对延期', suggestedQuestion: null }));
  const original = options.investigationRuntime!.module.runInvestigation; let block = true, entered = false;
  options.investigationRuntime!.module.runInvestigation = async (input, services, signal) => {
    if (input.followupQuestion && block) { entered = true; await new Promise<void>(r => signal.addEventListener('abort', () => r(), { once: true })); signal.throwIfAborted(); }
    return original(input, services, signal);
  };
  const a = await seed(app); const post = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question: '是否延期？' } });
  const job = await poll(app, `/api/v1/followups/${post.json().data.followupTurnId}`, a.headers, d => d.status === 'completed');
  for (let i = 0; !entered && i < 150; i++) await new Promise(r => setTimeout(r, 2)); expect(entered).toBe(true);
  await app.inject({ method: 'POST', url: `/api/v1/runs/${job.activeRunId}/cancel`, headers: a.headers }); block = false;
  const resumed = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/runs`, headers: { ...a.headers, 'idempotency-key': 'controlled-followup-resume' }, payload: { action: 'resume', previousRunId: job.activeRunId } }); expect(resumed.statusCode).toBe(202);
  const done = await poll(app, `/api/v1/runs/${resumed.json().data.runId}`, a.headers, d => d.run.status === 'completed'); expect(done.run.budgetWindowId).toBe(a.run.budgetWindowId); expect(inputs.at(-1)!.followupQuestion).toBe('是否延期？'); expect(inputs.at(-1)!.baseline!.id).toBe(a.result.id);
});
it('uses the latest baseline for explicit continuation after a completed followup and accepts a later distinct question', async () => {
  let decision: FollowupDecision = { route: 'research_same_scope', answer: null, researchPurpose: '核对延期', suggestedQuestion: null };
  const { app, inputs } = setup(async () => decision); const a = await seed(app);
  const submit = (version: string, question: string, key: string) => app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: { ...a.headers, 'idempotency-key': key }, payload: { resultVersionId: version, question } });
  const post = await submit(a.result.id, '是否延期？', 'controlled-first-followup');
  const job = await poll(app, `/api/v1/followups/${post.json().data.followupTurnId}`, a.headers, d => d.status === 'completed');
  const second = await poll(app, `/api/v1/runs/${job.activeRunId}`, a.headers, d => d.run.status === 'completed');
  const general = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/runs`, headers: { ...a.headers, 'idempotency-key': 'controlled-general-grant' }, payload: { action: 'add_budget', previousRunId: second.run.id } }); expect(general.statusCode).toBe(202);
  const third = await poll(app, `/api/v1/runs/${general.json().data.runId}`, a.headers, d => d.run.status === 'completed'); expect(inputs.at(-1)!.baseline!.id).toBe(second.run.createdResultVersionId);
  decision = { route: 'needs_budget_confirmation', answer: null, researchPurpose: '核对资格', suggestedQuestion: '追加后继续' };
  const next = await submit(third.run.createdResultVersionId, '资格是否更新？', 'controlled-new-question');
  const newJob = await poll(app, `/api/v1/followups/${next.json().data.followupTurnId}`, a.headers, d => d.status === 'completed');
  const grant = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/runs`, headers: { ...a.headers, 'idempotency-key': 'controlled-new-grant' }, payload: { action: 'add_budget', previousRunId: third.run.id, followupTurnId: newJob.id } }); expect(grant.statusCode).toBe(202);
  await poll(app, `/api/v1/runs/${grant.json().data.runId}`, a.headers, d => d.run.status === 'completed'); expect(inputs.at(-1)!.followupQuestion).toBe('资格是否更新？'); expect(inputs.at(-1)!.baseline!.id).toBe(third.run.createdResultVersionId);
});
it('serves a controlled followup through real loopback HTTP and reconnect reads do not re-execute it', async () => {
  let calls = 0; const { app } = setup(async () => { calls++; return explanation; }); const a = await seed(app), base = await listenLoopback(app);
  const r = await fetch(`${base}/api/v1/investigations/${a.inv.id}/followups`, { method: 'POST', headers: { ...a.headers, 'Content-Type': 'application/json', Connection: 'close' }, body: JSON.stringify({ resultVersionId: a.result.id, question: '解释日期' }) }); expect(r.status).toBe(202); const id = (await r.json()).data.followupTurnId;
  await poll(app, `/api/v1/followups/${id}`, a.headers, d => d.status === 'completed');
  for (let i = 0; i < 2; i++) { const view = await fetch(`${base}/api/v1/followups/${id}`, { headers: { cookie: a.headers.cookie, Connection: 'close' } }); expect(view.status).toBe(200); expect((await view.json()).data.turn.route).toBe('explain'); } expect(calls).toBe(1);
});
it('recovers a lost POST response by original key and lists saved turns without additional routing', async () => {
  let calls = 0; const { app } = setup(async () => { calls++; return explanation; }); const a = await seed(app);
  const url = `/api/v1/investigations/${a.inv.id}/followups`;
  const r = await app.inject({ method: 'POST', url, headers: a.headers, payload: { resultVersionId: a.result.id, question: '解释报告' } });
  const id = r.json().data.followupTurnId; await poll(app, `/api/v1/followups/${id}`, a.headers, d => d.status === 'completed');
  const restored = await app.inject({ url: url + '/submission', headers: a.headers }); expect(restored.statusCode).toBe(200); expect(restored.json().data.submission.followupTurnId).toBe(id);
  const page = await app.inject({ url, headers: a.headers }); expect(page.statusCode).toBe(200); expect(page.json().data.items[0].id).toBe(id); expect(page.json().data.nextAfter).toBeNull();
  const absent = await app.inject({ url: url + '/submission', headers: { ...a.headers, 'idempotency-key': 'controlled-never-submitted' } }); expect(absent.json().data.submission).toBeNull(); expect(calls).toBe(1);
});
it('stops a routing module from replaying a failed paid request and keeps its unknown reservation', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'detective-followup-')); directories.push(directory); const path = join(directory, 'runtime.db');
  const { app, options } = setup(async (input, services, signal) => {
    const request = { purpose: 'followup' as const, promptVersion: 'controlled_fixture', schemaId: 'controlled_fixture', messages: [{ role: 'user' as const, content: '解释固定报告' }], maxOutputTokens: 100 };
    for (let i = 0; i < 2; i++) { try { await services.model(request, input.context, signal); } catch { /* hostile retry must be fenced by P */ } }
    return explanation;
  }, path);
  let sends = 0;
  options.investigationRuntime!.providers.model = async () => { sends++; throw Error('controlled_fixture unknown network outcome'); };
  options.investigationRuntime!.pricing.quote = () => ({ provider: 'controlled_fixture', purpose: 'followup', attemptNo: 1, priceRevision: 'fixture-v1', estimated: { ...zeroAmounts(), modelCalls: 1, inputTokens: 100, outputTokens: 100, moneyMicros: 10 }, timeoutMs: 1000 });
  const a = await seed(app), r = await app.inject({ method: 'POST', url: `/api/v1/investigations/${a.inv.id}/followups`, headers: a.headers, payload: { resultVersionId: a.result.id, question: '解释报告' } });
  const done = await poll(app, `/api/v1/followups/${r.json().data.followupTurnId}`, a.headers, d => ['completed', 'failed'].includes(d.status));
  expect(sends).toBe(1); expect(done.status).toBe('failed');
  const db = openDatabase(path); try { const calls = db.prepare('SELECT status,context_json FROM usage_ledger').all() as { status: string; context_json: string }[]; expect(calls).toHaveLength(1); expect(calls[0]!.status).toBe('unknown'); const ctx = JSON.parse(calls[0]!.context_json); expect(ctx.runId).toBeNull(); expect(ctx.interactionPoolId).toBeTruthy(); const pool = db.prepare('SELECT reserved_json FROM budget_pools WHERE id=?').get(ctx.interactionPoolId) as { reserved_json: string }; expect(JSON.parse(pool.reserved_json).moneyMicros).toBe(10); } finally { db.close(); }
});
