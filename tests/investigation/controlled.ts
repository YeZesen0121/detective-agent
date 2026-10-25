import { createHash } from 'node:crypto';
import { RunSchema, type BudgetSnapshot } from '../../src/shared/contracts.js';
import { ModelRequestSchema, type InvestigationInput, type InvestigationServices, type ModelRequest, type SearchRequest, type WorkingMaterial } from '../../src/shared/ports.js';
import { samplePayload, ids, at } from '../helpers/result.js';

export const capture = '2026年受控活动报名截止2026年10月30日，仅限本科生。';
export const hash = (s: string) => createHash('sha256').update(s).digest('hex');
export const directJudgement = () => ({ claims: [{ statement: '报名截止2026年10月30日', status: 'supported', evidenceIndexes: [0], conditions: ['仅限本科生'], gaps: [], reasonSummary: '受控公告原句直接说明' }], answerBlocks: [{ text: '报名截止2026年10月30日，仅限本科生。', claimIndexes: [0], evidenceIndexes: [0] }] });
export function scenario() {
  const limits = { activeMs: 420000, searches: 12, reads: 6, modelCalls: 24, inputTokens: 160000, outputTokens: 24000, moneyMicros: 1000000 };
  const zero = { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 };
  let budget: BudgetSnapshot = { limits, used: zero, reserved: zero, remaining: { ...limits }, canSearch: true, canRead: true, canModel: true, blockedBy: [] };
  const context = { sessionId: ids.claim, accessGroup: 'trial' as const, investigationId: ids.investigation, runId: ids.run, budgetWindowId: ids.source, interactionPoolId: null, watchCheckId: null, epoch: 1, watchLeaseEpoch: null, deadlineAt: '2026-10-25T08:00:00.000Z' };
  const run = RunSchema.parse({ id: ids.run, investigationId: ids.investigation, trigger: 'initial', previousRunId: null, budgetWindowId: ids.source, scopeVersion: 1, status: 'running', stage: 'planning', epoch: 1, queuedAt: at, startedAt: at, endedAt: null, activeIntervals: [], activeMs: 0, stopReason: null, cancelRequestedAt: null, checkpointRef: null, createdResultVersionId: null });
  const scope = { ...samplePayload().scope, objectText: '2026年受控活动', goal: '2026年受控活动报名截止日期是什么？', claimsToCheck: ['2026年受控活动报名截止2026年10月30日'], referenceTime: '2026-10-25T00:00:00.000Z' };
  const input: InvestigationInput = { context, run, scope, basicMode: 'truth', attachments: [], checkpoint: null, baseline: null, intent: 'initial', followupQuestion: null };
  const searches: SearchRequest[] = []; const reads: string[] = []; const models: ModelRequest[] = []; const checkpoints: WorkingMaterial[] = []; const events: string[] = [];
  const services: InvestigationServices = {
    budget: { snapshot: async () => structuredClone(budget) }, clock: { now: () => '2026-10-25T00:00:00.000Z' },
    search: async request => { searches.push(request); return { items: [{ url: 'https://example.invalid/notice', title: '2026年受控公告', snippet: capture, publisher: null, publishedAt: '2026-10-24T00:00:00.000Z', providerScore: null }], providerRequestId: 'controlled_fixture', invalidItemCount: 0, warnings: [], usage: null }; },
    read: async request => { reads.push(request.url); return { sourceId: request.sourceId, finalUrl: request.url, title: '2026年受控公告', text: capture, readStatus: 'full', fetchedAt: at, contentHash: hash(capture), failureCode: null, usage: null }; },
    model: async request => { models.push(ModelRequestSchema.parse(request)); return { value: directJudgement(), usage: null, providerRequestId: 'controlled_fixture', modelId: 'controlled_fixture', finishReason: 'stop' }; },
    checkpoint: { save: async (_id, _epoch, patch) => { checkpoints.push(structuredClone({ sources: [], evidence: [], claims: [], candidates: [], queries: [], ...patch })); } },
    events: { append: async (_id, _epoch, event) => { events.push(event.type); } },
  };
  return { input, services, searches, reads, models, checkpoints, events, budget: () => budget, setBudget: (next: BudgetSnapshot) => { budget = next; } };
}
