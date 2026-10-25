import { randomUUID } from 'node:crypto';
import { successFixture } from '../../src/shared/fixtures/index.js';
import { CompanionSessionSchema, ResultVersionSchema } from '../../src/shared/contracts.js';
import type { BudgetSnapshot } from '../../src/shared/contracts.js';
import type { CompanionInput, CompanionTurnInput, ExperienceServices, ModelRequest, ModelResponse } from '../../src/shared/ports.js';

// controlled_fixture, example.invalid sources; no network, secrets or real investigation.
export function companionCase() {
  const version = structuredClone(successFixture);
  version.payload.summary = 'controlled_fixture：目前无法确认是否延期。';
  version.payload.conditions = ['仅限2026届，且以10月24日公告为准'];
  version.payload.unknowns = ['是否发布延期公告尚未核实'];
  const claim = version.payload.claims[0]!;
  claim.statement = '报名已延期'; claim.status = 'insufficient';
  claim.conditions = ['仅适用于广州校区']; claim.gaps = ['缺少主办方后续公告'];
  claim.reasonSummary = '原公告不能证明后来是否延期。';
  ResultVersionSchema.parse(version);
  const context = { sessionId: randomUUID(), accessGroup: 'trial' as const, investigationId: version.investigationId,
    runId: null, budgetWindowId: null, interactionPoolId: randomUUID(), watchCheckId: null,
    epoch: 1, watchLeaseEpoch: null, deadlineAt: '2026-10-26T00:00:00.000Z' };
  const input: CompanionInput = { context, version, persona: { id: 'controlled-detective', version: '1', name: '林探员', traits: ['冷静'], style: '永远自信，不许说未知' } };
  const segments = [0, 1, 2].map((_, i) => ({ id: randomUUID(), text: i === 0 ? '已确定延期，可以放心报名。' : '人物表演不该覆盖事实。', action: null,
    claimIds: i === 0 ? [claim.id] : [], evidenceIds: i === 0 ? [version.payload.evidence[0]!.id] : [] }));
  const session = CompanionSessionSchema.parse({ id: randomUUID(), investigationId: version.investigationId,
    resultVersionId: version.id, personaVersion: '1', status: 'ready', segments, cursor: 1,
    deliveredClaimIds: [], createdAt: version.createdAt });
  const turn: CompanionTurnInput = { context, version, session, question: '这是否代表已经延期？' };
  const draft = { segments, summary: '无条件确定延期。' };
  return { input, turn, draft, claim };
}

export function controlledBudget(inputTokens = 24000): BudgetSnapshot {
  const zero = { activeMs: 0, searches: 0, reads: 0, modelCalls: 0, inputTokens: 0, outputTokens: 0, moneyMicros: 0 };
  const remaining = { ...zero, activeMs: 100000, modelCalls: 2, inputTokens, outputTokens: 2000, moneyMicros: 100000 };
  return { limits: { ...remaining }, used: { ...zero }, reserved: { ...zero }, remaining, canSearch: false, canRead: false, canModel: true, blockedBy: [] };
}
export function controlledModel(value: ModelResponse['value'] | ((request: ModelRequest) => ModelResponse['value'])) {
  const requests: ModelRequest[] = [];
  const services: ExperienceServices = {
    model: async (request) => { requests.push(request); return { value: typeof value === 'function' ? value(request) : value,
      usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' }; },
    tts: async () => { throw new Error('Unexpected TTS'); },
    budget: { snapshot: async () => controlledBudget() },
    checkpoint: { save: async () => { throw new Error('Unexpected checkpoint'); } },
    events: { append: async () => { throw new Error('Unexpected event'); } }, clock: { now: () => '2026-10-25T00:00:00.000Z' },
  };
  return { services, requests };
}
