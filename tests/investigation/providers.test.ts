import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { normalizeYuanbaoResponse, searchYuanbao } from '../../src/server/providers/search/yuanbao.js';
import { modelDeepSeek, normalizeDeepSeekResponse } from '../../src/server/providers/model/deepseek.js';
import { readWithFetch, normalizeFetchResponse } from '../../src/server/providers/reader/deepseek-fetch.js';

const request: any = { query: '受控对象', purpose: 'verify claims', claimIds: [], site: null, freshness: null, limit: 3 };
const modelRequest: any = { purpose: 'evaluate', promptVersion: 'investigation.evaluate.v1', schemaId: 'investigation.evaluate.v1', messages: [{ role: 'user', content: '受控材料' }], maxOutputTokens: 100 };
const readRequest: any = { url: 'https://example.invalid/a', sourceId: '00000000-0000-4000-8000-000000000001' };

describe('provider adapters', () => {
  it('isolates invalid search entries while preserving valid entries', () => {
    const response = normalizeYuanbaoResponse({ Pages: [{ url: 'https://example.invalid/a', title: 'valid', passage: 'text' }, { url: 'javascript:bad', title: 'bad' }] }, request);
    expect(response.items).toHaveLength(1);
    expect(response.invalidItemCount).toBe(1);
  });
  it('uses injected search transport and rejects missing configuration', async () => {
    const transport = { send: async () => ({ Pages: [{ url: 'https://example.invalid/a', title: 'valid', passage: 'text' }] }) };
    await expect(searchYuanbao(request, transport)).resolves.toMatchObject({ items: [{ title: 'valid' }] });
    await expect(searchYuanbao(request)).rejects.toThrow('SEARCH_ADAPTER_NOT_CONFIGURED');
  });
  it('uses injected model and reader transports', async () => {
    await expect(modelDeepSeek(modelRequest, { send: async () => ({ id: 'req-1', model: 'deepseek-controlled', usage: { inputTokens: 1, outputTokens: 1, characters: 0, searches: 0, reads: 0 }, choices: [{ message: { content: '{"ok":true}' }, finish_reason: 'stop' }] }) })).resolves.toMatchObject({ value: { ok: true }, providerRequestId: 'req-1', modelId: 'deepseek-controlled' });
    await expect(readWithFetch(readRequest, { send: async () => ({ text: '正文', readStatus: 'full', finalUrl: readRequest.url }) })).resolves.toMatchObject({ text: '正文', readStatus: 'full' });
  });
  it('normalizes invalid model JSON and reader failures explicitly', () => {
    expect(() => normalizeDeepSeekResponse({ choices: [{ message: { content: 'no json' } }] }, modelRequest)).toThrow('INVALID_MODEL_JSON');
    expect(normalizeFetchResponse({ failureCode: 'timeout', readStatus: 'inaccessible' }, readRequest).failureCode).toBe('timeout');
  });
  it('maps DeepSeek probe usage fields and fetch content fields', () => {
    const model = normalizeDeepSeekResponse({ id: 'req-2', usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 }, choices: [{ message: { content: '{"ok":true}' } }] }, modelRequest);
    expect(model.usage).toMatchObject({ inputTokens: 12, outputTokens: 4, characters: 0, searches: 0, reads: 0 });
    const read = normalizeFetchResponse({ title: '正文标题', content: '受控正文' }, readRequest);
    expect(read.text).toBe('受控正文');
    expect(read.readStatus).toBe('full');
    expect(read.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('marks over-limit fetch content partial and hashes the captured prefix', () => {
    const exact = '字'.repeat(24000);
    const long = `${exact}超出捕获上限`;
    const exactRead = normalizeFetchResponse({ content: exact }, readRequest);
    const longRead = normalizeFetchResponse({ content: long }, readRequest);
    expect(exactRead.text).toHaveLength(24000);
    expect(exactRead.readStatus).toBe('full');
    expect(longRead.text).toHaveLength(24000);
    expect(longRead.readStatus).toBe('partial');
    expect(longRead.failureCode).toBe('content_truncated');
    expect(longRead.contentHash).toBe(exactRead.contentHash);
  });
  it('hashes the exact normalized text returned for full and truncated captures', () => {
    const full = normalizeFetchResponse({ content: ' \ncontrolled_fixture body \t' }, readRequest);
    expect(full.text).toBe('controlled_fixture body');
    expect(full.contentHash).toBe(createHash('sha256').update('controlled_fixture body').digest('hex'));
    const partial = normalizeFetchResponse({ content: ' ' + 'a'.repeat(24000) }, readRequest);
    expect(partial.text).toBe('a'.repeat(23999));
    expect(partial.readStatus).toBe('partial');
    expect(partial.failureCode).toBe('content_truncated');
    expect(partial.contentHash).toBe(createHash('sha256').update('a'.repeat(23999)).digest('hex'));
  });
  it('preserves nested Yuanbao request ids and rejects provider errors', () => {
    expect(normalizeYuanbaoResponse({ Response: { Pages: [], RequestId: 'controlled-request' } }, request).providerRequestId).toBe('controlled-request');
    expect(() => normalizeYuanbaoResponse({ Response: { Error: { Code: 'AuthFailure', Message: 'denied' }, RequestId: 'controlled-request' } }, request)).toThrow('AuthFailure');
  });
});
