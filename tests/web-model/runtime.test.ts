import { describe, expect, it } from 'vitest';
import { createTaskHttpPort } from '../../src/web/api/task-http.js';
import { createRuntimeApi } from '../../src/web/api/runtime.js';
import { createResultState, reduceResult } from '../../src/web/model/result.js';
import { updatedVersionFixture } from '../../src/shared/fixtures/index.js';
import { event, id, run, runView, at } from './fixtures.js';

const meta = { requestId: 'controlled_fixture', contractVersion: '0.1.0' };
const signal = () => new AbortController().signal;
function scripted(...responses: unknown[]) {
  const calls: { path: string; init: RequestInit }[] = [];
  const transport: typeof fetch = async (path, init) => {
    calls.push({ path: String(path), init: init ?? {} });
    if (!responses.length) throw Error('unexpected controlled_fixture request');
    const response = responses.shift();
    if (response instanceof Error) throw response;
    if (response instanceof Response) return response;
    return new Response(JSON.stringify({ data: response, meta }));
  };
  return { transport, calls };
}
const started = () => ({ runId: id(1), status: 'queued', budgetWindowId: id(2), limits: runView().remainingBudget.limits });

describe('published runtime HTTP consumers (controlled_fixture)', () => {
  it('maps GET run and event cursor to same-origin paths and returns public events only', async () => {
    const s = scripted(runView(), { items: [event(2), { ...event(3), visibility: 'internal' }], nextSeq: 3, hasMore: false });
    const port = createTaskHttpPort(s.transport);
    const abort = signal();
    expect(await port.getRun(id(1), abort)).toMatchObject({ run: { id: id(1) }, partialMaterialSummary: 'controlled_fixture：已保存部分来源' });
    expect(await port.getEvents(id(10), 1, abort)).toMatchObject({ items: [event(2)], nextSeq: 3 });
    expect(s.calls.map((call) => call.path)).toEqual([`/api/v1/runs/${id(1)}`, `/api/v1/investigations/${id(10)}/events?afterSeq=1`]);
    expect(s.calls.every((call) => call.init.credentials === 'same-origin' && call.init.signal === abort)).toBe(true);
  });
  it('cancel maps the short acknowledgement to one POST followed by a complete GET', async () => {
    const stopped = { ...runView(), run: { ...run(), status: 'cancelled' as const, cancelRequestedAt: at } };
    const s = scripted({ runId: id(1), status: 'cancelled', cancelRequestedAt: at }, stopped);
    const port = createTaskHttpPort(s.transport);
    expect(await port.cancel(id(1), 'controlled-cancel-key', signal())).toEqual(stopped.run);
    expect(s.calls.map((call) => [call.path, call.init.method ?? 'GET'])).toEqual([[`/api/v1/runs/${id(1)}/cancel`, 'POST'], [`/api/v1/runs/${id(1)}`, 'GET']]);
    expect(s.calls[0]!.init.body).toBeUndefined();
    expect(new Headers(s.calls[0]!.init.headers).get('Idempotency-Key')).toBe('controlled-cancel-key');
  });
  it('a failed post-cancel GET retains safe network failure and never repeats the POST', async () => {
    const s = scripted({ runId: id(1), status: 'running', cancelRequestedAt: at }, Error('cookie=secret'));
    await expect(createTaskHttpPort(s.transport).cancel(id(1), 'controlled-cancel-key', signal())).rejects.toMatchObject({ code: 'NETWORK_ERROR', retryable: true });
    expect(s.calls.map((call) => call.init.method ?? 'GET')).toEqual(['POST', 'GET']);
  });
  it('abort between cancel acknowledgement and GET prevents the follow-up read', async () => {
    const abort = new AbortController(); const paths: string[] = [];
    const port = createTaskHttpPort(async (path) => {
      paths.push(String(path)); abort.abort();
      return new Response(JSON.stringify({ data: { runId: id(1), status: 'cancelled', cancelRequestedAt: at }, meta }));
    });
    await expect(port.cancel(id(1), 'controlled-cancel-key', abort.signal)).rejects.toMatchObject({ code: 'ABORTED' });
    expect(paths).toEqual([`/api/v1/runs/${id(1)}/cancel`]);
  });
  it.each([
    ['run', runView(2)],
    ['events', { items: [{ ...event(1), investigationId: id(999) }], nextSeq: 1, hasMore: false }],
    ['events', { items: [event(2)], nextSeq: 1, hasMore: false }],
    ['events', { items: [], nextSeq: 0, hasMore: true }],
    ['cancel', { runId: id(2), status: 'cancelled', cancelRequestedAt: at }],
  ] as const)('rejects mismatched or non-advancing %s data', async (kind, response) => {
    const s = scripted(response); const port = createTaskHttpPort(s.transport);
    const result = kind === 'run' ? port.getRun(id(1), signal()) : kind === 'events' ? port.getEvents(id(10), 0, signal()) : port.cancel(id(1), 'controlled-cancel-key', signal());
    await expect(result).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    expect(s.calls).toHaveLength(1);
  });
  it('rejects invalid ids, unsafe cursors, input and keys before transport', async () => {
    const s = scripted(); const api = createRuntimeApi(s.transport);
    await expect(api.getRun('../session', signal())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    for (const cursor of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1]) await expect(api.getEvents(id(10), cursor, signal())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.cancel(id(1), 'x', signal())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.startRun(id(10), { action: 'start', previousRunId: null }, 'x', signal())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.answerClarification(id(1), id(9), { answer: '', proceedWithUnknown: false }, signal())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.getResult('../session', signal())).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(s.calls).toEqual([]);
  });
  it.each(['start', 'resume', 'add_budget'] as const)('starts explicit %s using the caller key and published body', async (action) => {
    const s = scripted(started(), started()); const api = createRuntimeApi(s.transport);
    const input = { action, previousRunId: action === 'start' ? null : id(99) };
    const first = await api.startRun(id(10), input, 'controlled-fixed-key', signal());
    const retried = await api.startRun(id(10), input, 'controlled-fixed-key', signal());
    expect(first).toEqual(started()); expect(retried.runId).toBe(first.runId);
    expect(s.calls).toHaveLength(2);
    for (const call of s.calls) {
      expect(call.path).toBe(`/api/v1/investigations/${id(10)}/runs`);
      expect(call.init.method).toBe('POST');
      expect(new Headers(call.init.headers).get('Idempotency-Key')).toBe('controlled-fixed-key');
      expect(JSON.parse(String(call.init.body))).toEqual(input);
    }
  });
  it('answers a saved clarification without silently creating another run or adding budget', async () => {
    const s = scripted({ runId: id(1), status: 'queued' }); const api = createRuntimeApi(s.transport);
    expect(await api.answerClarification(id(1), id(9), { answer: null, proceedWithUnknown: true }, signal())).toEqual({ runId: id(1), status: 'queued' });
    expect(s.calls[0]!.path).toBe(`/api/v1/runs/${id(1)}/clarifications/${id(9)}`);
    expect(JSON.parse(String(s.calls[0]!.init.body))).toEqual({ answer: null, proceedWithUnknown: true });
    expect(s.calls).toHaveLength(1);
  });
  it('uses published notice fields without replacing the old selected version', async () => {
    const { before, after } = updatedVersionFixture;
    const notice = { latestResultVersionId: after.id, createdAt: after.createdAt };
    const s = scripted({ version: before, updateNotice: notice }, { text: 'controlled_fixture 结论、限定、未知、查询时间与来源' });
    const api = createRuntimeApi(s.transport); const old = createResultState(before);
    const response = await api.getResult(before.id, signal());
    const state = reduceResult(old, { type: 'notice', notice: response.updateNotice });
    expect(state.selectedVersionId).toBe(before.id); expect(state.result.summary).toBe('受控材料中的报名截止日期为十月三十日。');
    expect(state.updateNotice).toEqual(notice);
    expect(await api.copyResult(before.id, signal())).toEqual({ text: 'controlled_fixture 结论、限定、未知、查询时间与来源' });
    expect(s.calls.map((call) => call.path)).toEqual([`/api/v1/results/${before.id}`, `/api/v1/results/${before.id}/copy`]);
  });
  it('rejects a result or clarification acknowledgement from another id', async () => {
    const s = scripted({ version: updatedVersionFixture.after, updateNotice: null }, { runId: id(999), status: 'queued' });
    const api = createRuntimeApi(s.transport);
    await expect(api.getResult(updatedVersionFixture.before.id, signal())).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
    await expect(api.answerClarification(id(1), id(9), { answer: 'controlled_fixture', proceedWithUnknown: false }, signal())).rejects.toMatchObject({ code: 'PROTOCOL_ERROR' });
  });
  it.each([[401, 'UNAUTHENTICATED'], [404, 'NOT_FOUND'], [429, 'RATE_LIMITED'], [503, 'PROVIDER_UNAVAILABLE']] as const)('preserves HTTP %s failures and never auto-retries a write', async (status, code) => {
    const s = scripted(new Response(JSON.stringify({ error: { code, message: 'controlled_fixture 安全错误', retryable: status >= 429 }, meta }), { status }));
    await expect(createRuntimeApi(s.transport).startRun(id(10), { action: 'start', previousRunId: null }, 'controlled-fixed-key', signal())).rejects.toMatchObject({ code, status, requestId: 'controlled_fixture' });
    expect(s.calls).toHaveLength(1);
  });
});
