import { afterEach, describe, expect, it } from 'vitest';
import type { InvestigationModule } from '../../src/shared/ports.js';
import { createRuntimeApi } from '../../src/web/api/runtime.js';
import { createTaskController, type TaskScheduler } from '../../src/web/controllers/task.js';
import { createResultState, projectResult, reduceResult } from '../../src/web/model/result.js';
import { deferred, id, at } from './fixtures.js';
import { harness, moduleFor, pump, untilRun } from './runtime-http-fixture.js';

const apps: ReturnType<typeof harness>[] = [];
const dispose: (() => void)[] = [];
afterEach(async () => {
  for (const cleanup of dispose.splice(0)) cleanup();
  for (const item of apps.splice(0)) { await item.app.close(); expect(item.paidCalls).toBe(0); }
});
function setup(module?: InvestigationModule | null) { const item = harness(module); apps.push(item); return item; }
function manual() {
  const callbacks = new Set<() => void>(); const delays: number[] = [];
  const scheduler: TaskScheduler = { set(callback, delay) { callbacks.add(callback); delays.push(delay); return callback; }, clear(handle) { callbacks.delete(handle as () => void); } };
  return { scheduler, delays, tick() { const next = callbacks.values().next().value; if (next) { callbacks.delete(next); next(); } } };
}

describe('W client against published P runtime routes (controlled_fixture)', () => {
  it('runs one idempotent job, drains real 100-event pages, reads evidence and copies the selected version', async () => {
    const module = moduleFor(); const base = module.runInvestigation; let executions = 0;
    module.runInvestigation = async (input, services, signal) => {
      executions++;
      for (let n = 0; n < 105; n++) await services.events.append(input.run.id, input.context.epoch, { type: 'query.completed', message: `controlled_fixture 公共事件 ${n}`, queryId: null, sourceIds: [], visibility: 'public' });
      await services.events.append(input.run.id, input.context.epoch, { type: 'query.completed', message: 'controlled_fixture 内部过程', queryId: null, sourceIds: [], visibility: 'internal' });
      return base(input, services, signal);
    };
    const h = setup(module); const browser = h.browser(); await browser.enter(); const draft = await browser.draft();
    const start = () => browser.api.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-same-run-key', browser.signal);
    const [one, two] = await Promise.all([start(), start()]);
    expect(one.runId).toBe(two.runId);
    const done = await untilRun(browser.api, one.runId, 'completed', browser.signal);
    expect(executions).toBe(1); expect(done.partialMaterialSummary).toBe('已保存1个来源、1条证据。');
    const firstPage = await browser.api.getEvents(draft.id, 0, browser.signal);
    expect(firstPage.items).toHaveLength(100); expect(firstPage.hasMore).toBe(true);
    const next = await browser.api.getEvents(draft.id, firstPage.nextSeq, browser.signal);
    expect(next.hasMore).toBe(false); expect(next.items.length).toBeGreaterThan(0);
    const clock = manual(); const controller = createTaskController(browser.api, clock.scheduler); dispose.push(() => controller.disconnect());
    await controller.follow(draft.id, one.runId);
    expect(controller.getState().events.length).toBe(firstPage.items.length + next.items.length);
    expect(controller.getState().events.every((event) => event.visibility === 'public')).toBe(true);
    expect(controller.getState().events.some((event) => event.message.includes('内部过程'))).toBe(false);
    const result = await browser.api.getResult(done.run.createdResultVersionId!, browser.signal);
    expect(projectResult(result.version).summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(result.updateNotice).toBeNull();
    const copied = await browser.api.copyResult(result.version.id, browser.signal);
    expect(copied.text).toContain('仅用于契约测试'); expect(copied.text).toContain(at); expect(copied.text).toContain('https://example.invalid/notice');
    expect(await browser.foundation.getInvestigation(draft.id, browser.signal)).toMatchObject({ latestResultVersionId: result.version.id });
    const stranger = h.browser(); await stranger.enter();
    for (const forbidden of [() => stranger.api.getRun(one.runId, stranger.signal), () => stranger.api.getEvents(draft.id, 0, stranger.signal), () => stranger.api.getResult(result.version.id, stranger.signal), () => stranger.api.copyResult(result.version.id, stranger.signal)]) await expect(forbidden()).rejects.toMatchObject({ status: 404, code: 'NOT_FOUND' });
  });
  it('cancels via the short POST plus GET, fences late material and resumes using the original budget window', async () => {
    const entered = deferred<void>(); const pending = deferred<Awaited<ReturnType<InvestigationModule['runInvestigation']>>>();
    const failed = { completion: 'failed' as const, stopReason: 'provider_error' as const, draft: null, clarification: null };
    dispose.push(() => pending.resolve(failed));
    let calls = 0; const base = moduleFor();
    const module = moduleFor(async (input, services, signal) => { if (++calls === 1) { entered.resolve(); return pending.promise; } return base.runInvestigation(input, services, signal); });
    const h = setup(module); const browser = h.browser(); await browser.enter(); const draft = await browser.draft();
    const started = await browser.api.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-start-key', browser.signal);
    await entered.promise;
    expect(await browser.foundation.getInvestigation(draft.id, browser.signal)).toMatchObject({ activeRun: { id: started.runId, status: 'running' } });
    const controller = createTaskController(browser.api, manual().scheduler); dispose.push(() => controller.disconnect());
    await controller.follow(draft.id, started.runId); const before = h.requests.length;
    await controller.cancel();
    expect(h.requests.slice(before).map((request) => [request.method, request.path])).toEqual([['POST', `/api/v1/runs/${started.runId}/cancel`], ['GET', `/api/v1/runs/${started.runId}`]]);
    expect(controller.getState()).toMatchObject({ cancelPending: false, data: { run: { status: 'cancelled' } } });
    pending.resolve(failed); await pump();
    expect((await browser.api.getRun(started.runId, browser.signal)).run.createdResultVersionId).toBeNull();
    const resumed = await browser.api.startRun(draft.id, { action: 'resume', previousRunId: started.runId }, 'controlled-resume-key', browser.signal);
    expect(resumed.budgetWindowId).toBe(started.budgetWindowId);
    await untilRun(browser.api, resumed.runId, 'completed', browser.signal);
    expect(controller.getState().data?.run.id).toBe(started.runId);
    await controller.follow(draft.id, resumed.runId);
    expect(controller.getState().events.every((event) => event.runId === resumed.runId)).toBe(true);
  });
  it('persists the same clarification answer without extra runs and surfaces conflicting replay as 409', async () => {
    const module = moduleFor(); const prepare = module.prepareInvestigation;
    module.prepareInvestigation = async (input, services, signal) => input.clarificationAnswer ? prepare(input, services, signal) : {
      canInvestigate: false, scope: null, clarification: { id: id(901), runId: input.context.runId!, prompt: 'controlled_fixture 哪一届？', missingFields: ['year'], options: [], canProceedWithUnknown: true, answer: null, answeredAt: null },
    };
    const h = setup(module); const browser = h.browser(); await browser.enter(); const draft = await browser.draft();
    const started = await browser.api.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-start-key', browser.signal);
    const waiting = await untilRun(browser.api, started.runId, 'waiting_for_user', browser.signal);
    expect(waiting.clarification?.id).toBe(id(901));
    const answer = { answer: '2026', proceedWithUnknown: false };
    const reply = await browser.api.answerClarification(started.runId, id(901), answer, browser.signal);
    expect(reply.runId).toBe(started.runId);
    const done = await untilRun(browser.api, started.runId, 'completed', browser.signal);
    expect(done.remainingBudget.used.activeMs).toBe(0);
    expect(await browser.api.answerClarification(started.runId, id(901), answer, browser.signal)).toMatchObject({ runId: started.runId, status: 'completed' });
    await expect(browser.api.answerClarification(started.runId, id(901), { answer: '2025', proceedWithUnknown: false }, browser.signal)).rejects.toMatchObject({ status: 409, code: 'IDEMPOTENCY_CONFLICT' });
    expect(h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/runs'))).toHaveLength(1);
  });
  it('reads actual old/new result notices and preserves old content until explicit open', async () => {
    const h = setup(); const browser = h.browser(); await browser.enter(); const draft = await browser.draft();
    const first = await browser.api.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-first-run', browser.signal);
    const initialRun = await untilRun(browser.api, first.runId, 'completed', browser.signal);
    const old = await browser.api.getResult(initialRun.run.createdResultVersionId!, browser.signal);
    const state = createResultState(old.version);
    const second = await browser.api.startRun(draft.id, { action: 'add_budget', previousRunId: first.runId }, 'controlled-second-run', browser.signal);
    expect(second.budgetWindowId).not.toBe(first.budgetWindowId);
    const updatedRun = await untilRun(browser.api, second.runId, 'completed', browser.signal);
    const reloadedOld = await browser.api.getResult(old.version.id, browser.signal);
    const latest = await browser.api.getResult(updatedRun.run.createdResultVersionId!, browser.signal);
    expect(reloadedOld.version).toEqual(old.version);
    expect(reloadedOld.updateNotice).toEqual({ latestResultVersionId: latest.version.id, createdAt: latest.version.createdAt });
    const noticeOnly = reduceResult(state, { type: 'notice', notice: reloadedOld.updateNotice });
    expect(noticeOnly.result.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(reduceResult(noticeOnly, { type: 'open', version: latest.version }).result.summary).toBe('controlled_fixture：新版本，旧版保持原文。');
    expect(latest.version.previousVersionId).toBe(old.version.id);
    expect((await browser.api.copyResult(old.version.id, browser.signal)).text).toContain('受控材料中的报名截止日期为十月三十日。');
  });
  it('reconnects a GET-only controller and disconnect never cancels the actual server run', async () => {
    const entered = deferred<void>(); const pending = deferred<Awaited<ReturnType<InvestigationModule['runInvestigation']>>>();
    const failed = { completion: 'failed' as const, stopReason: 'provider_error' as const, draft: null, clarification: null };
    dispose.push(() => pending.resolve(failed));
    const h = setup(moduleFor(async () => { entered.resolve(); return pending.promise; }));
    const browser = h.browser(); await browser.enter(); const draft = await browser.draft();
    const started = await browser.api.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-start-key', browser.signal); await entered.promise;
    let fail = true;
    const api = createRuntimeApi(async (path, init) => { if (fail && String(path).endsWith(`/runs/${started.runId}`)) { fail = false; throw TypeError('controlled_fixture disconnect'); } return browser.transport(path, init); });
    const clock = manual(); const controller = createTaskController(api, clock.scheduler); dispose.push(() => controller.disconnect());
    const writes = h.requests.filter((request) => request.method === 'POST').length;
    await controller.follow(draft.id, started.runId);
    expect(controller.getState()).toMatchObject({ connection: 'reconnecting', error: { code: 'NETWORK_ERROR' } });
    expect(clock.delays).toEqual([1000]); clock.tick(); await pump();
    expect(controller.getState()).toMatchObject({ connection: 'connected', data: { run: { status: 'running' } } });
    controller.disconnect();
    expect((await browser.api.getRun(started.runId, browser.signal)).run.status).toBe('running');
    expect(h.requests.filter((request) => request.method === 'POST')).toHaveLength(writes);
    pending.resolve(failed);
  });
  it('preserves the real 503 when no runtime is injected instead of substituting fixtures', async () => {
    const h = setup(null); const browser = h.browser(); await browser.enter(); const draft = await browser.draft();
    await expect(browser.api.startRun(draft.id, { action: 'start', previousRunId: null }, 'controlled-start-key', browser.signal)).rejects.toMatchObject({ status: 503, code: 'PROVIDER_UNAVAILABLE', retryable: false });
    expect(h.requests.filter((request) => request.method === 'POST' && request.path.endsWith('/runs'))).toHaveLength(1);
  });
});
