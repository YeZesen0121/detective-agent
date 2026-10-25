import { z } from 'zod';
import { expect, it } from 'vitest';
import { buildCompanion, answerCompanion } from '../../src/server/companion/briefing.js';
import { createExperienceModelProvider } from '../../src/server/platform/provider-transports.js';
import { CompanionDraftSchema, CompanionReplySchema, type ModelRequest } from '../../src/shared/ports.js';
import { ResultVersionSchema } from '../../src/shared/contracts.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture: this is a deliberately schema-dependent wire simulator, not
// a reconstruction of the missing real model response or a model-quality test.
function explicitSchemaWire(value: unknown) {
  const requests: ModelRequest[] = [], wireBodies: { response_format: unknown; messages: { role: string; content: string }[] }[] = [];
  const declared: z.ZodType[] = [];
  const provider = createExperienceModelProvider({ deepseekKey: 'controlled_fixture_not_a_credential', fetch: async (_url, init) => {
    const body = JSON.parse(String(init?.body)); wireBodies.push(body);
    const line = body.messages.flatMap((m: { role: string; content: string }) => m.role === 'system' ? m.content.split('\n') : [])
      .find((s: string) => s.startsWith('OUTPUT_SCHEMA_JSON='));
    if (!line) throw Error('controlled_fixture: no explicit output schema on wire');
    const schema = z.fromJSONSchema(JSON.parse(line.slice('OUTPUT_SCHEMA_JSON='.length)));
    declared.push(schema);
    return Response.json({ id: 'controlled_fixture_output_schema', model: 'deepseek-flash',
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 500, completion_tokens: 100 } });
  } });
  const { services } = controlledModel({});
  services.model = async (request, context, signal) => { requests.push(request); return provider(request, context, signal); };
  return { services, requests, wireBodies, declared };
}
function noJudgements() {
  const f = companionCase(), p = f.input.version.payload;
  p.scope.objectText = 'controlled_fixture：某搜索服务的公开能力边界';
  p.summary = '已保存来源材料；目前不足以回答，尚未形成可核验结论。';
  p.conditions = []; p.unknowns = ['完整捕获筛查未明确通过，不能排除遗漏关键条件或例外。'];
  p.claims = []; p.answerBlocks = []; p.conflicts = []; p.nextSteps = []; p.stopReason = 'invalid_output';
  p.evidence.push({ ...structuredClone(p.evidence[0]!), id: '90000000-0000-4000-8000-000000000099',
    excerpt: 'controlled_fixture 原始捕获，仅存档。', limitations: ['raw_capture_only:不是额外信源'] });
  f.draft.segments.forEach(s => { s.claimIds = []; s.evidenceIds = []; s.action = null; s.text = '模型提案：服务肯定支持该能力，已电话确认。'; });
  f.turn.session.segments = structuredClone(f.draft.segments);
  ResultVersionSchema.parse(f.input.version);
  return f;
}
it('sends a complete private build schema over the actual JSON wire and can explain a failed report with no verified claims', async () => {
  const f = noJudgements(), before = structuredClone(f.input.version), wire = explicitSchemaWire(f.draft);
  const result = await buildCompanion(f.input, wire.services, new AbortController().signal);
  CompanionDraftSchema.parse(result);
  expect(result.segments).toHaveLength(3); expect(result.resultVersionId).toBe(f.input.version.id);
  expect(result.segments.every(s => !s.claimIds.length && !s.evidenceIds.includes('90000000-0000-4000-8000-000000000099'))).toBe(true);
  expect(result.segments[0]!.text).toContain('目前不足以回答');
  expect(result.summary).toContain('不能排除遗漏关键条件或例外');
  expect(JSON.stringify(result)).not.toContain('服务肯定支持该能力'); expect(JSON.stringify(result)).not.toContain('已电话确认');
  expect(f.input.version).toEqual(before); expect(wire.requests).toHaveLength(1); expect(wire.wireBodies).toHaveLength(1);
  expect(wire.wireBodies[0]!.response_format).toEqual({ type: 'json_object' });
  const schema = wire.declared[0]!;
  expect(schema.safeParse(f.draft).success).toBe(true);
  for (const value of [
    { ...f.draft, resultVersionId: f.input.version.id }, { ...f.draft, summary: null },
    { ...f.draft, segments: f.draft.segments.slice(0, 2) },
    { ...f.draft, segments: f.draft.segments.map((s, i) => i ? s : { ...s, id: 'overview' }) },
    { ...f.draft, segments: f.draft.segments.map((s, i) => i ? s : { ...s, action: {} }) },
    { ...f.draft, segments: f.draft.segments.map((s, i) => i ? s : { ...s, claimIds: null }) },
    { ...f.draft, segments: f.draft.segments.map(({ action: _action, ...s }) => s) },
  ]) expect(schema.safeParse(value).success).toBe(false);
});
it.each(['answer', 'research_request', 'finish'] as const)('sends reply field types and nullable/optional semantics for %s without weakening saved references', async kind => {
  const f = companionCase(), before = structuredClone(f.turn);
  const reply = { kind, text: '模型自由正文不可升级事实', claimIds: kind === 'answer' ? [f.claim.id] : [], evidenceIds: [],
    ...(kind === 'research_request' ? { followupQuestion: '是否有后续公告？' } : { followupQuestion: null }) };
  const wire = explicitSchemaWire(reply), result = await answerCompanion(f.turn, wire.services, new AbortController().signal);
  CompanionReplySchema.parse(result); expect(result.kind).toBe(kind); expect(result.resumeCursor).toBe(kind === 'finish' ? 3 : 1);
  expect(result.text).not.toContain('模型自由正文不可升级事实'); expect(f.turn).toEqual(before);
  expect(wire.requests).toHaveLength(1); expect(wire.wireBodies).toHaveLength(1);
  const schema = wire.declared[0]!;
  expect(schema.safeParse(reply).success).toBe(true);
  expect(schema.safeParse({ ...reply, resumeCursor: 0 }).success).toBe(true);
  for (const bad of [
    { ...reply, kind: 'explain' }, { ...reply, claimIds: null }, { ...reply, evidenceIds: ['not-a-uuid'] },
    { ...reply, resumeCursor: null }, { ...reply, resumeCursor: '1' }, { ...reply, resumeCursor: -1 },
    { ...reply, resumeCursor: 0.5 }, { ...reply, followupQuestion: {} }, { ...reply, newRunId: 'invented' },
  ]) expect(schema.safeParse(bad).success).toBe(false);
});
it('still rejects a factual answer with no references on a failed report, with no retry or fabricated investigation', async () => {
  const f = noJudgements(), wire = explicitSchemaWire({ kind: 'answer', text: '服务肯定支持', claimIds: [], evidenceIds: [] });
  await expect(answerCompanion(f.turn, wire.services, new AbortController().signal)).rejects.toMatchObject({ code: 'COMPANION_UNGROUNDED_ANSWER' });
  expect(wire.wireBodies).toHaveLength(1);
});
it.each(['finish', 'research_request'] as const)('allows no-claim report %s while preserving uncertainty and cursor', async kind => {
  const f = noJudgements(), before = structuredClone(f.turn), wire = explicitSchemaWire({ kind, text: '已有答案', claimIds: [], evidenceIds: [],
    followupQuestion: kind === 'research_request' ? '请核查该服务官方公开能力边界。' : null });
  const result = await answerCompanion(f.turn, wire.services, new AbortController().signal);
  expect(result.kind).toBe(kind); expect(result.resumeCursor).toBe(kind === 'finish' ? 3 : 1);
  expect(result.text).toContain(kind === 'finish' ? '目前不足以回答' : '不是当前报告的新结论');
  expect(f.turn).toEqual(before); expect(wire.wireBodies).toHaveLength(1);
});
