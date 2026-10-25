import { afterEach, describe, expect, it } from 'vitest';
import { createInvestigationController } from '../../src/web/controllers/investigation.js';
import { createResultController } from '../../src/web/controllers/result.js';
import { createTaskController } from '../../src/web/controllers/task.js';
import type { InvestigationModule } from '../../src/shared/ports.js';
import { moduleFor, untilRun, pump } from './runtime-http-fixture.js';
import { localHarness, manualScheduler, waitState } from './interaction-http-fixture.js';
import { deferred, id } from './fixtures.js';

const servers: Awaited<ReturnType<typeof localHarness>>[] = []; const cleanup: (() => void)[] = [];
afterEach(async () => { for (const release of cleanup.splice(0)) release(); for (const h of servers.splice(0)) await h.close(); });
async function setup(module?: InvestigationModule) { const h = await localHarness(module); servers.push(h); return h; }
function controllerFor(browser: ReturnType<Awaited<ReturnType<typeof localHarness>>['browser']>) {
  const clock = manualScheduler(); const task = createTaskController(browser.runtime, clock.scheduler);
  const controller = createInvestigationController({ foundation: browser.foundation, runtime: browser.runtime, task }); cleanup.push(() => controller.dispose()); return { controller, clock };
}

describe('actual loopback W client/controller HTTP (controlled_fixture)', () => {
  it('coalesces real duplicate starts while an acknowledgement is delayed', async () => {
    const h = await setup(); const arrived = deferred<void>(); const release = deferred<void>(); cleanup.push(() => release.resolve());
    const browser = h.browser(async (path, init, send) => { const response = await send(); if (init.method === 'POST' && path.endsWith('/runs')) { arrived.resolve(); await release.promise; } return response; });
    await browser.enter(); const draft = await browser.draft(); const { controller } = controllerFor(browser); await controller.open(draft.id);
    const first = controller.start('start', null); const duplicate = controller.start('start', null); await arrived.promise;
    expect(h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/runs'))).toHaveLength(1);
    release.resolve(); await Promise.all([first, duplicate]);
    expect(controller.getState().submission?.outcome).toBe('confirmed');
    const runId = controller.getState().task!.data!.run.id;
    expect((await untilRun(browser.runtime, runId, 'completed', browser.signal)).run.createdResultVersionId).not.toBeNull();
  });
  it('lost start response recovers a fast completed run read-only; explicit retry reuses the real original key', async () => {
    let executions = 0; const module = moduleFor(); const work = module.runInvestigation;
    module.runInvestigation = async (...args) => { executions++; return work(...args); };
    const h = await setup(module); let lose = true;
    const browser = h.browser(async (path, init, send) => {
      const response = await send();
      if (lose && init.method === 'POST' && path.endsWith('/runs')) {
        lose = false; const ack = await response.json() as { data: { runId: string } };
        await untilRun(browser.runtime, ack.data.runId, 'completed', browser.signal);
        throw TypeError('controlled_fixture lost acknowledgement');
      }
      return response;
    });
    await browser.enter(); const draft = await browser.draft(); const { controller } = controllerFor(browser); await controller.open(draft.id);
    await controller.start('start', null);
    expect(controller.getState()).toMatchObject({ submission: { outcome: 'unknown' }, task: { data: { run: { status: 'completed' } } } });
    expect(h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/runs'))).toHaveLength(1);
    await controller.start('start', null);
    const posts = h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/runs'));
    expect(posts).toHaveLength(2); expect(posts[0]!.key).toBe(posts[1]!.key); expect(executions).toBe(1);
  });
  it('cancel POST followed by failed GET recovers only by reads, and enforces session/Origin boundaries', async () => {
    const entered = deferred<void>(); const pending = deferred<Awaited<ReturnType<InvestigationModule['runInvestigation']>>>();
    cleanup.push(() => pending.resolve({ completion: 'failed', stopReason: 'provider_error', draft: null, clarification: null }));
    const h = await setup(moduleFor(async () => { entered.resolve(); return pending.promise; })); let failRead = false;
    const browser = h.browser(async (path, init, send) => {
      if (failRead && init.method !== 'POST' && path.startsWith('/api/v1/runs/')) { failRead = false; throw TypeError('controlled_fixture read disconnected'); }
      const response = await send(); if (path.endsWith('/cancel')) failRead = true; return response;
    });
    await browser.enter(); const draft = await browser.draft(); const { controller, clock } = controllerFor(browser); await controller.open(draft.id);
    await controller.start('start', null); await entered.promise; const runId = controller.getState().task!.data!.run.id;
    await controller.cancel(); expect(controller.getState().task?.error?.code).toBe('NETWORK_ERROR');
    const recovered = waitState(controller, (state) => state.task?.data?.run.status === 'cancelled'); clock.tick(); await recovered;
    expect(h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/cancel'))).toHaveLength(1);
    const stranger = h.browser(); await stranger.enter(); await expect(stranger.runtime.getRun(runId, stranger.signal)).rejects.toMatchObject({ code: 'NOT_FOUND', status: 404 });
    browser.setOrigin('https://other.invalid');
    await expect(browser.runtime.startRun(draft.id, { action: 'resume', previousRunId: runId }, 'controlled-origin-key', browser.signal)).rejects.toMatchObject({ code: 'VALIDATION_ERROR', status: 400 });
    controller.disconnect(); expect(h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/cancel'))).toHaveLength(1);
  });
  it('submits a saved clarification once despite duplicate UI actions', async () => {
    const module = moduleFor(); const prepare = module.prepareInvestigation;
    module.prepareInvestigation = async (input, services, signal) => input.clarificationAnswer ? prepare(input, services, signal) : { canInvestigate: false, scope: null, clarification: { id: id(980), runId: input.context.runId!, prompt: 'controlled_fixture 年份？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null } };
    const h = await setup(module); const browser = h.browser(); await browser.enter(); const draft = await browser.draft(); const { controller } = controllerFor(browser);
    await controller.open(draft.id); await controller.start('start', null); const runId = controller.getState().task!.data!.run.id;
    await untilRun(browser.runtime, runId, 'waiting_for_user', browser.signal); await controller.open(draft.id);
    const input = { answer: '2026', proceedWithUnknown: false };
    await Promise.all([controller.answer(id(980), input), controller.answer(id(980), input)]); await controller.answer(id(980), input);
    expect(h.requests.filter((request) => request.method === 'POST' && request.path.includes('/clarifications/'))).toHaveLength(1);
    await untilRun(browser.runtime, runId, 'completed', browser.signal);
  });
  it('keeps old content/copy, then explicitly switches versions while fencing a delayed selection', async () => {
    const h = await setup(); let delayedId = ''; let delayed = false;
    const arrived = deferred<void>(); const release = deferred<void>(); cleanup.push(() => release.resolve());
    const browser = h.browser(async (path, _init, send) => { const response = await send(); if (!delayed && path === `/api/v1/results/${delayedId}`) { delayed = true; arrived.resolve(); await release.promise; } return response; });
    await browser.enter(); const draft = await browser.draft(); const one = await browser.runtime.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-start-key', browser.signal);
    const first = await untilRun(browser.runtime, one.runId, 'completed', browser.signal); const oldId = first.run.createdResultVersionId!;
    let changes = 0; const result = createResultController({ runtime: browser.runtime, onVersionChange() { changes++; } }); cleanup.push(() => result.dispose());
    await result.select(oldId); const oldHash = result.getState().data!.result.payloadHash;
    const two = await browser.runtime.startRun(draft.id, { action: 'add_budget', previousRunId: one.runId }, 'controlled-new-budget', browser.signal);
    const next = await untilRun(browser.runtime, two.runId, 'completed', browser.signal); delayedId = next.run.createdResultVersionId!;
    await result.refreshNotice(); expect(result.getState().data).toMatchObject({ selectedVersionId: oldId, result: { payloadHash: oldHash } }); expect(changes).toBe(0);
    expect((await result.copy())?.text).toContain('受控材料中的报名截止日期为十月三十日。');
    const stale = result.openLatest(); await arrived.promise; await result.select(oldId); release.resolve(); await stale;
    expect(result.getState().data?.selectedVersionId).toBe(oldId); await result.openLatest();
    expect(result.getState().data?.selectedVersionId).toBe(delayedId); expect(changes).toBe(1);
    const stranger = h.browser(); await stranger.enter(); await expect(stranger.runtime.getResult(oldId, stranger.signal)).rejects.toMatchObject({ status: 404 });
  });
  it('disconnect after POST dispatch ignores the late response and never follows or cancels it', async () => {
    const h = await setup(); const arrived = deferred<void>(); const release = deferred<void>(); cleanup.push(() => release.resolve());
    const browser = h.browser(async (path, init, send) => { const response = await send(); if (init.method === 'POST' && path.endsWith('/runs')) { arrived.resolve(); await release.promise; } return response; });
    await browser.enter(); const draft = await browser.draft(); const { controller } = controllerFor(browser); await controller.open(draft.id);
    const starting = controller.start('start', null); await arrived.promise; const before = h.requests.length;
    controller.disconnect(); release.resolve(); await starting;
    expect(h.requests).toHaveLength(before); expect(controller.getState()).toMatchObject({ phase: 'idle', task: null });
    expect(h.requests.some((request) => request.path.endsWith('/cancel'))).toBe(false);
  });
  it('uses public lifecycle events to recover and resume the latest cancelled run instead of the older report run', async () => {
    const entered = deferred<void>(); const pending = deferred<Awaited<ReturnType<InvestigationModule['runInvestigation']>>>(); let calls = 0;
    const failed = { completion: 'failed' as const, stopReason: 'provider_error' as const, draft: null, clarification: null };
    cleanup.push(() => pending.resolve(failed)); const base = moduleFor();
    const h = await setup(moduleFor(async (...args) => { if (++calls === 2) { entered.resolve(); return pending.promise; } return base.runInvestigation(...args); }));
    const browser = h.browser(); await browser.enter(); const draft = await browser.draft(); const { controller } = controllerFor(browser);
    await controller.open(draft.id); await controller.start('start', null); const r1 = controller.getState().task!.data!.run.id;
    await untilRun(browser.runtime, r1, 'completed', browser.signal);
    await controller.start('add_budget', r1); await entered.promise; const r2 = controller.getState().task!.data!.run;
    await controller.cancel(); pending.resolve(failed); await pump();
    const postCount = h.requests.filter((request) => request.method === 'POST').length;
    const fresh = controllerFor(browser).controller; await fresh.open(draft.id);
    expect(fresh.getState()).toMatchObject({ phase: 'ready', recoveryIncomplete: false, investigation: { status: 'cancelled' }, task: { data: { run: { id: r2.id, status: 'cancelled' } } } });
    expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(postCount);
    controller.disconnect(); await controller.open(draft.id);
    expect(controller.getState()).toMatchObject({ phase: 'ready', recoveryIncomplete: false, task: { data: { run: { id: r2.id, status: 'cancelled' } } } });
    await fresh.start('resume', r2.id); const resumedId = fresh.getState().task!.data!.run.id;
    expect(resumedId).not.toBe(r2.id);
    const resumed = await untilRun(browser.runtime, resumedId, 'completed', browser.signal);
    expect(resumed.run.budgetWindowId).toBe(r2.budgetWindowId);
  });
});
