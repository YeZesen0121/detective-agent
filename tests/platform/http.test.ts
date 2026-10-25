import { mkdtempSync, rmSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { buildApp, type FoundationOptions } from '../../src/server/app.js';
import { ApiErrorSchema, InvestigationPublicSchema, apiSuccessSchema } from '../../src/shared/contracts.js';

const origin = 'http://127.0.0.1:5173';
const options: FoundationOptions = {
  databasePath: ':memory:', allowedOrigin: origin,
  trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code',
  serviceEndsAt: '2026-10-26T08:00:00.000Z', secureCookies: false,
  now: () => '2026-10-24T08:00:00.000Z',
};
const draft = { originalQuestion: '报名何时截止？', basicMode: 'latest', presentationMode: 'evidence' };
let app: ReturnType<typeof buildApp>;
beforeEach(() => { app = buildApp(options); });
afterEach(async () => { await app.close(); });

async function login(target = app, code = options.trialCode) {
  const response = await target.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin }, payload: { code } });
  expect(response.statusCode).toBe(200);
  const header = response.headers['set-cookie'];
  return String(Array.isArray(header) ? header[0] : header).split(';')[0]!;
}
async function create(cookie: string, key = 'create-test-001', target = app, input = draft) {
  return target.inject({ method: 'POST', url: '/api/v1/investigations', headers: { cookie, origin, 'idempotency-key': key }, payload: input });
}

describe('foundation HTTP boundary', () => {
  it('reports database readiness and states foundation capabilities', async () => {
    const response = await app.inject({ url: '/health/ready' });
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toMatchObject({ phase: 'foundation', capabilities: ['sessions', 'drafts', 'attachments'] });
  });
  it('requires authentication before reading drafts', async () => {
    const response = await app.inject({ url: '/api/v1/investigations/00000000-0000-4000-8000-000000000001' });
    expect(response.statusCode).toBe(401);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe('UNAUTHENTICATED');
  });
  it('rejects unknown access codes with no cookie', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin }, payload: { code: 'invalid-code' } });
    expect(response.statusCode).toBe(401);
    expect(response.headers['set-cookie']).toBeUndefined();
  });
  it('sets a private cookie and returns no token or owner identifiers', async () => {
    const response = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin }, payload: { code: options.trialCode } });
    expect(response.statusCode).toBe(200);
    expect(response.headers['set-cookie']).toContain('HttpOnly');
    expect(response.headers['set-cookie']).toContain('SameSite=Lax');
    expect(response.json().data).toMatchObject({ accessGroup: 'trial' });
    expect(response.json().data).not.toHaveProperty('tokenHash');
    expect(response.json().data).not.toHaveProperty('sessionId');
  });
  it.each([undefined, 'https://other.invalid'])('rejects writes with missing or wrong Origin: %s', async (sentOrigin) => {
    const cookie = await login();
    const headers = { cookie, 'idempotency-key': 'create-origin-001', ...(sentOrigin ? { origin: sentOrigin } : {}) };
    const response = await app.inject({ method: 'POST', url: '/api/v1/investigations', headers, payload: draft });
    expect(response.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(response.json()).error.code).toBe('VALIDATION_ERROR');
  });
  it('does not accept body owner injection', async () => {
    const cookie = await login();
    const response = await app.inject({ method: 'POST', url: '/api/v1/investigations', headers: { cookie, origin, 'idempotency-key': 'create-injection' }, payload: { ...draft, sessionId: 'other-owner' } });
    expect(response.statusCode).toBe(400);
  });
  it('requires an idempotency key for creation', async () => {
    const cookie = await login();
    const response = await app.inject({ method: 'POST', url: '/api/v1/investigations', headers: { cookie, origin }, payload: draft });
    expect(response.statusCode).toBe(400);
  });
  it('returns the same draft on concurrent retries and rejects changed bodies', async () => {
    const cookie = await login();
    const [first, repeated] = await Promise.all([create(cookie), create(cookie)]);
    expect(first.statusCode).toBe(201); expect(repeated.statusCode).toBe(201);
    const parsed = apiSuccessSchema(InvestigationPublicSchema).parse(first.json());
    expect(repeated.json().data.id).toBe(parsed.data.id);
    expect(parsed.data).not.toHaveProperty('sessionId');
    const conflict = await create(cookie, 'create-test-001', app, { ...draft, originalQuestion: '另一个问题' });
    expect(conflict.statusCode).toBe(409);
    expect(ApiErrorSchema.parse(conflict.json()).error.code).toBe('IDEMPOTENCY_CONFLICT');
  });
  it('isolates histories for browsers sharing a trial code', async () => {
    const one = await login(); const two = await login();
    expect(one).not.toBe(two);
    const created = await create(one); expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    const owner = await app.inject({ url: `/api/v1/investigations/${id}`, headers: { cookie: one } });
    expect(owner.statusCode).toBe(200);
    expect(owner.json().data.investigation.originalQuestion).toBe('报名何时截止？');
    const foreign = await app.inject({ url: `/api/v1/investigations/${id}`, headers: { cookie: two } });
    expect(foreign.statusCode).toBe(404);
    expect(ApiErrorSchema.parse(foreign.json()).error.code).toBe('NOT_FOUND');
    // The same key in another browser is independent.
    expect((await create(two)).json().data.id).not.toBe(id);
  });
  it('does not accept expired browser sessions', async () => {
    let at = '2026-10-24T08:00:00.000Z';
    const target = buildApp({ ...options, now: () => at });
    try {
      const cookie = await login(target); at = '2026-10-26T08:00:01.000Z';
      const response = await target.inject({ url: '/api/v1/session', headers: { cookie } });
      expect(response.statusCode).toBe(401);
    } finally { await target.close(); }
  });
  it('keeps the same browser history accessible until the configured service end', async () => {
    let at = '2026-10-24T08:00:00.000Z';
    const target = buildApp({ ...options, now: () => at });
    try {
      const cookie = await login(target);
      const created = await create(cookie, 'retained-history', target);
      expect(created.statusCode).toBe(201);
      at = '2026-10-25T10:00:00.000Z';
      const response = await target.inject({ url: `/api/v1/investigations/${created.json().data.id}`, headers: { cookie } });
      expect(response.statusCode).toBe(200);
    } finally { await target.close(); }
  });
  it('returns a safe error envelope for malformed JSON and unknown routes', async () => {
    const malformed = await app.inject({ method: 'POST', url: '/api/v1/sessions', headers: { origin, 'content-type': 'application/json' }, payload: '{' });
    expect(malformed.statusCode).toBe(400);
    expect(ApiErrorSchema.parse(malformed.json()).error.code).toBe('VALIDATION_ERROR');
    const missing = await app.inject({ url: '/api/v1/nonexistent' });
    expect(ApiErrorSchema.parse(missing.json()).error.code).toBe('NOT_FOUND');
  });
});

it('persists sessions, drafts and idempotency across process reopen', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'detective-g0-'));
  const path = join(directory, 'test.db');
  const config = { ...options, databasePath: path };
  let target = buildApp(config);
  try {
    const cookie = await login(target);
    const created = await create(cookie, 'persist-retry-01', target);
    expect(created.statusCode).toBe(201);
    const id = created.json().data.id as string;
    await target.close(); target = buildApp(config);
    const fetched = await target.inject({ url: `/api/v1/investigations/${id}`, headers: { cookie } });
    expect(fetched.statusCode).toBe(200);
    expect(fetched.json().data.investigation.id).toBe(id);
    const repeated = await create(cookie, 'persist-retry-01', target);
    expect(repeated.statusCode).toBe(201); expect(repeated.json().data.id).toBe(id);
  } finally {
    await target.close();
    for (const suffix of ['', '-wal', '-shm']) rmSync(path + suffix, { force: true });
    rmdirSync(directory);
  }
});
