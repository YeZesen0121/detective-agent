import { afterEach, describe, expect, it } from 'vitest';
import { z } from 'zod';
import { request } from '../../src/web/api/client.js';
import { createFoundationApi } from '../../src/web/api/foundation.js';
import { buildApp } from '../../src/server/app.js';

const fixtureType = 'controlled_fixture';
const meta = { requestId: fixtureType, contractVersion: '0.1.0' };
const dataSchema = z.strictObject({ value: z.string() });
const transportFor = (body: unknown, status = 200): typeof fetch => async () =>
  new Response(JSON.stringify(body), { status });

describe('validated same-origin HTTP client (controlled_fixture)', () => {
  it('unwraps validated data and forces same-origin credentials without exposing headers', async () => {
    let captured: RequestInit | undefined;
    const transport: typeof fetch = async (_path, options) => {
      captured = options;
      return new Response(JSON.stringify({ data: { value: 'ok' }, meta }), { headers: { 'set-cookie': 'secret' } });
    };
    expect(await request('/api/v1/session', { credentials: 'include' }, dataSchema, transport)).toEqual({ value: 'ok' });
    expect(captured).toMatchObject({ credentials: 'same-origin', mode: 'same-origin', redirect: 'error' });
  });
  it.each(['https://other.invalid/api/v1/session', '//other.invalid/api/v1/session', '/api/v1/../../secret'])('rejects unsafe path %s before transport', async (path) => {
    let calls = 0;
    await expect(request(path, {}, dataSchema, async () => { calls++; throw Error(); })).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(calls).toBe(0);
  });
  it('discards malformed JSON and transport error text that can contain cookie values', async () => {
    await expect(request('/api/v1/session', {}, dataSchema, async () => new Response('cookie=secret'))).rejects.toMatchObject({ code: 'INVALID_RESPONSE', requestId: null });
    try { await request('/api/v1/session', {}, dataSchema, async () => { throw Error('cookie=secret'); }); }
    catch (error) { expect(JSON.stringify(error)).not.toContain('secret'); expect(error).toMatchObject({ code: 'NETWORK_ERROR' }); }
  });
  it.each([
    { data: { value: 'ok' }, meta: { ...meta, contractVersion: '9.0.0' } },
    { data: { value: 1 }, meta },
    { error: { code: 'UNAUTHENTICATED', message: '安全消息', retryable: false }, meta: { ...meta, contractVersion: '9.0.0' } },
  ])('rejects a schema or contract mismatch', async (body) => {
    await expect(request('/api/v1/session', {}, dataSchema, transportFor(body, 'error' in body ? 401 : 200))).rejects.toMatchObject({ code: 'INVALID_RESPONSE' });
  });
  it.each([[401, 'UNAUTHENTICATED', false], [429, 'RATE_LIMITED', true]] as const)('retains safe HTTP %s code/message/requestId', async (status, code, retryable) => {
    await expect(request('/api/v1/session', {}, dataSchema, transportFor({ error: { code, message: '安全消息', retryable }, meta }, status))).rejects.toMatchObject({ code, message: '安全消息', requestId: fixtureType, status, retryable });
  });
  it('rejects a non-envelope HTTP error without retaining its body', async () => {
    const result = request('/api/v1/session', {}, dataSchema, async () => new Response('cookie=secret', { status: 502 }));
    await expect(result).rejects.toMatchObject({ code: 'INVALID_RESPONSE', status: 502 });
  });
  it('reports abort as local cancellation and does not retry a POST', async () => {
    let calls = 0;
    const signal = AbortSignal.abort();
    await expect(request('/api/v1/sessions', { method: 'POST', signal }, dataSchema, async () => {
      calls++; throw new DOMException('aborted', 'AbortError');
    })).rejects.toMatchObject({ code: 'ABORTED', retryable: false });
    expect(calls).toBe(1);
  });
  it('classifies a response body transport failure as retryable network loss without retrying POST', async () => {
    let calls = 0;
    const transport: typeof fetch = async () => {
      calls++;
      return new Response(new ReadableStream({ start(controller) {
        controller.error(new TypeError('controlled_fixture cookie=secret'));
      } }), { status: 200 });
    };
    const error = await request('/api/v1/sessions', { method: 'POST' }, dataSchema, transport).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: 'NETWORK_ERROR', status: 200, retryable: true });
    expect(JSON.stringify(error)).not.toContain('secret');
    expect(calls).toBe(1);
  });
});

const apps: ReturnType<typeof buildApp>[] = [];
afterEach(async () => { await Promise.all(apps.splice(0).map((app) => app.close())); });
describe('foundation consumer against real G0 routes (controlled_fixture)', () => {
  it('creates/reads a session and draft, preserves modes, and explicit retry uses the same key', async () => {
    const origin = 'http://127.0.0.1:5173';
    const app = buildApp({ databasePath: ':memory:', allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code', serviceEndsAt: '2026-10-26T08:00:00.000Z', secureCookies: false, now: () => '2026-10-24T08:00:00.000Z' });
    apps.push(app);
    // Test-only cookie jar emulates browser handling; production client never reads it.
    let cookie = '';
    let postCount = 0;
    const transport: typeof fetch = async (path, options) => {
      const headers = Object.fromEntries(new Headers(options?.headers).entries());
      if (options?.method === 'POST') postCount++;
      const response = await app.inject({ method: options?.method === 'POST' ? 'POST' : 'GET', url: String(path), headers: { ...headers, origin, ...(cookie ? { cookie } : {}) }, ...(typeof options?.body === 'string' ? { payload: options.body } : {}) });
      if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0]!;
      return new Response(response.body, { status: response.statusCode });
    };
    const api = createFoundationApi(transport);
    const signal = new AbortController().signal;
    expect(await api.createSession('controlled-trial-code', signal)).toMatchObject({ accessGroup: 'trial' });
    expect(await api.getSession(signal)).toMatchObject({ accessGroup: 'trial' });
    const input = { originalQuestion: '受控测试：何时截止？', basicMode: 'latest', presentationMode: 'companion' } as const;
    const draft = await api.createInvestigation(input, 'controlled-create-key', signal);
    const retry = await api.createInvestigation(input, 'controlled-create-key', signal);
    expect(retry.id).toBe(draft.id);
    expect(draft).toMatchObject({ ...input, status: 'draft' });
    expect(await api.getInvestigation(draft.id, signal)).toMatchObject({ investigation: { id: draft.id }, activeRun: null });
    expect(postCount).toBe(3);
    await expect(api.createInvestigation(input, 'x', signal)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.getInvestigation('../session', signal)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    await expect(api.createSession('', signal)).rejects.toMatchObject({ code: 'VALIDATION_ERROR' });
    expect(postCount).toBe(3);
  });
});
