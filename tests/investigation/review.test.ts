import { describe, expect, it } from 'vitest';
import { InvestigationOutcomeSchema, type InvestigationServices } from '../../src/shared/ports.js';
import { investigationModule } from '../../src/server/investigation/index.js';

const ids = { investigation: '00000000-0000-4000-8000-000000000101', run: '00000000-0000-4000-8000-000000000102', budget: '00000000-0000-4000-8000-000000000103' };
const at = '2026-10-24T08:00:00.000Z';
const context: any = { sessionId: '00000000-0000-4000-8000-000000000100', accessGroup: 'trial', investigationId: ids.investigation, runId: ids.run, budgetWindowId: ids.budget, interactionPoolId: null, watchCheckId: null, epoch: 1, watchLeaseEpoch: null, deadlineAt: '2026-10-24T10:00:00.000Z' };
const run: any = { id: ids.run, investigationId: ids.investigation, trigger: 'initial', previousRunId: null, budgetWindowId: ids.budget, scopeVersion: 1, status: 'running', stage: 'searching', epoch: 1, queuedAt: at, startedAt: at, endedAt: null, activeIntervals: [], activeMs: 0, stopReason: null, cancelRequestedAt: null, checkpointRef: null, createdResultVersionId: null };
const scope: any = { objectText: '受控活动', goal: '核对截止日期', basicMode: 'truth', knownClues: [], uncertainClues: [], claimsToCheck: ['截止日期'], timeScope: null, region: null, referenceTime: at, userConfirmed: true };
const sourceId = '00000000-0000-4000-8000-000000000104';
const services = (value: unknown, items = [{ url: 'https://example.invalid/a', title: '公告', snippet: '截止十月三十日', publisher: null, publishedAt: null, providerScore: null }]): InvestigationServices => ({
  search: async () => ({ items, providerRequestId: null, invalidItemCount: 0, warnings: [], usage: null }),
  read: async () => ({ sourceId, finalUrl: 'https://example.invalid/a', title: '公告', text: '报名截止十月三十日。', readStatus: 'full', fetchedAt: at, contentHash: 'a'.repeat(64), failureCode: null, usage: null }),
  model: async () => ({ value: value as any, usage: null, providerRequestId: null, modelId: 'controlled', finishReason: 'stop' }),
  budget: { snapshot: async () => ({ limits: { activeMs: 100, searches: 4, reads: 4, modelCalls: 4, inputTokens: 24000, outputTokens: 1000, moneyMicros: 100 }, used: { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 }, reserved: { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 }, remaining: { activeMs: 100, searches: 4, reads: 4, modelCalls: 4, inputTokens: 24000, outputTokens: 1000, moneyMicros: 100 }, canSearch: true, canRead: true, canModel: true, blockedBy: [] }) },
  checkpoint: { save: async () => {} }, events: { append: async () => {} }, clock: { now: () => at },
});

describe('review regressions', () => {
  it('returns a contract-valid failed outcome when search is empty', async () => {
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint: null, baseline: null, intent: 'initial', followupQuestion: null }, services({}, []), new AbortController().signal);
    expect(result.draft).toBeNull();
    expect(InvestigationOutcomeSchema.safeParse(result).success).toBe(true);
  });
  it('uses model evidence judgement to produce a supported claim', async () => {
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint: null, baseline: null, intent: 'initial', followupQuestion: null }, services({ summary: '已核对', claims: [{ statement: '截止十月三十日', status: 'supported', evidenceIndexes: [0], conditions: [], gaps: [], reasonSummary: '公告直接说明' }], answerBlocks: [{ text: '截止十月三十日', claimIndexes: [0], evidenceIndexes: [0] }] }), new AbortController().signal);
    expect(result.draft?.claims).toHaveLength(1);
    expect(result.draft?.answerBlocks).toHaveLength(1);
    expect(InvestigationOutcomeSchema.safeParse(result).success).toBe(true);
  });
  it('rejects an out-of-range evidence index instead of returning an ungrounded fact block', async () => {
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint: null, baseline: null, intent: 'initial', followupQuestion: null }, services({ claims: [{ statement: '无依据断言', status: 'supported', evidenceIndexes: [999], conditions: [], gaps: [], reasonSummary: '无' }], answerBlocks: [{ text: '无依据断言', claimIndexes: [0], evidenceIndexes: [999] }] }), new AbortController().signal);
    expect(result.completion).toBe('partial');
    expect(result.draft?.claims).toHaveLength(1);expect(result.draft?.claims[0]?.status).toBe('insufficient');expect(result.draft?.claims[0]?.links).toEqual([]);
    expect(result.draft?.answerBlocks.every(block=>block.text.startsWith('证据不足：'))).toBe(true);
    expect(result.draft?.unknowns.join(' ')).toContain('引用非法');
  });
  it('rejects a supported claim and fact block when both omit evidence references', async () => {
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint: null, baseline: null, intent: 'initial', followupQuestion: null }, services({ claims: [{ statement: '无证据的确定断言', status: 'supported', evidenceIndexes: [], conditions: [], gaps: [], reasonSummary: '无' }], answerBlocks: [{ text: '无证据的确定断言', claimIndexes: [], evidenceIndexes: [] }] }), new AbortController().signal);
    expect(result.completion).toBe('partial');
    expect(result.draft?.claims).toHaveLength(1);expect(result.draft?.claims[0]?.status).toBe('insufficient');expect(result.draft?.claims[0]?.links).toEqual([]);
    expect(result.draft?.answerBlocks.every(block=>block.text.startsWith('证据不足：'))).toBe(true);
    expect(result.draft?.unknowns.join(' ')).toContain('引用非法');
  });
  it('keeps collected material as partial when evaluate fails', async () => {
    const failing = services({}, undefined as any); failing.model = async () => { throw new Error('MODEL_DOWN'); };
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint: null, baseline: null, intent: 'initial', followupQuestion: null }, failing, new AbortController().signal);
    expect(result.completion).toBe('partial');
    expect(result.stopReason).toBe('provider_error');
    expect(result.draft?.sources.length).toBeGreaterThan(0);
    expect(result.draft?.evidence.length).toBeGreaterThan(0);
  });
  it('keeps checkpoint material and reports search exhaustion accurately', async () => {
    const checkpoint: any = { sources: [{ id: sourceId, url: 'https://example.invalid/a', canonicalUrl: 'https://example.invalid/a', title: '公告', publisher: null, publishedAt: null, eventAt: null, fetchedAt: at, readStatus: 'full', originGroup: null, originReason: null, queryIds: [], snippet: null, contentHash: 'a'.repeat(64), diagnostic: null }], evidence: [{ id: '00000000-0000-4000-8000-000000000106', origin: { kind: 'source', id: sourceId }, representation: 'verbatim', excerpt: '已保存正文', locator: { kind: 'paragraph', value: '1' }, capturedAt: at, contentHash: 'b'.repeat(64), limitations: [] }], claims: [], candidates: [], queries: [] };
    const limited = services({ claims: [], answerBlocks: [] }); limited.budget.snapshot = async () => ({ limits: { activeMs: 100, searches: 0, reads: 4, modelCalls: 4, inputTokens: 24000, outputTokens: 1000, moneyMicros: 100 }, used: { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 }, reserved: { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 }, remaining: { activeMs: 100, searches: 0, reads: 4, modelCalls: 4, inputTokens: 24000, outputTokens: 1000, moneyMicros: 100 }, canSearch: false, canRead: true, canModel: true, blockedBy: ['searches'] });
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint, baseline: null, intent: 'initial', followupQuestion: null }, limited, new AbortController().signal);
    expect(result.draft?.sources).toHaveLength(1);
    expect(result.stopReason).toBe('search_limit');
  });
  it('does not call model when the effective budget disallows model calls', async () => {
    const checkpoint: any = { sources: [{ id: sourceId, url: 'https://example.invalid/a', canonicalUrl: 'https://example.invalid/a', title: '公告', publisher: null, publishedAt: null, eventAt: null, fetchedAt: at, readStatus: 'full', originGroup: null, originReason: null, queryIds: [], snippet: null, contentHash: 'a'.repeat(64), diagnostic: null }], evidence: [{ id: '00000000-0000-4000-8000-000000000106', origin: { kind: 'source', id: sourceId }, representation: 'verbatim', excerpt: '已保存正文', locator: { kind: 'paragraph', value: '1' }, capturedAt: at, contentHash: 'b'.repeat(64), limitations: [] }], claims: [], candidates: [], queries: [] };
    const limited = services({ claims: [], answerBlocks: [] }); let modelCalls = 0; limited.model = async () => { modelCalls += 1; throw new Error('MODEL_MUST_NOT_BE_CALLED'); };
    limited.budget.snapshot = async () => ({ limits: { activeMs: 100, searches: 0, reads: 4, modelCalls: 0, inputTokens: 24000, outputTokens: 1000, moneyMicros: 100 }, used: { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 }, reserved: { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 }, remaining: { activeMs: 100, searches: 0, reads: 4, modelCalls: 0, inputTokens: 24000, outputTokens: 1000, moneyMicros: 100 }, canSearch: false, canRead: true, canModel: false, blockedBy: ['searches', 'modelCalls'] });
    const result = await investigationModule.runInvestigation({ context, run, scope, basicMode: 'truth', attachments: [], checkpoint, baseline: null, intent: 'initial', followupQuestion: null }, limited, new AbortController().signal);
    expect(modelCalls).toBe(0);
    expect(result.completion).toBe('partial');
    expect(result.draft?.evidence).toHaveLength(1);
  });
});
