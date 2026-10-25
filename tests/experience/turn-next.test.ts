import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { answerCompanion } from '../../src/server/companion/briefing.js';
import { companionCase, controlledModel } from './companion-fixture.js';

it('answers from the old snapshot, keeps its limits and preserves the interruption cursor', async () => {
  const f = companionCase(); const original = structuredClone(f.turn.session);
  const { services } = controlledModel({ kind: 'answer', text: '已经彻底确认延期。', claimIds: [f.claim.id],
    evidenceIds: [], resumeCursor: 2 });
  const reply = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.resumeCursor).toBe(1); expect(reply.text).toContain('证据不足');
  expect(reply.text).toContain('仅适用于广州校区'); expect(reply.text).toContain('缺少主办方后续公告');
  expect(reply.text).toContain('仅限2026届'); expect(reply.text).not.toContain('已经彻底确认延期');
  expect(f.turn.session).toEqual(original);
});

it.each([-1, 1.5, 4, '2', 'nonsense'])(
  'rejects invalid model cursor %s rather than clamping or coercing', async cursor => {
    const f = companionCase(); const { services } = controlledModel({kind:'finish',text:'结束',claimIds:[],evidenceIds:[],resumeCursor:cursor});
    await expect(answerCompanion(f.turn, services, new AbortController().signal)).rejects.toThrow();
  });

it('returns research_request as a proposal only without changing the report or reading position', async () => {
  const f = companionCase(); const { services, requests } = controlledModel({kind:'research_request',text:'待补查',claimIds:[],evidenceIds:[],resumeCursor:2,followupQuestion:'是否存在更新公告？'});
  const original = structuredClone(f.input.version);
  const reply = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.kind).toBe('research_request'); expect(reply.followupQuestion).toBe('是否存在更新公告？');
  expect(reply.resumeCursor).toBe(1); expect(requests).toHaveLength(1); expect(f.input.version).toEqual(original);
});

it('finishes with the snapshot summary and unknowns instead of a model invented resolution', async () => {
  const f = companionCase(); const { services } = controlledModel({kind:'finish',text:'一切已确认',claimIds:[],evidenceIds:[],resumeCursor:1});
  const reply = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.kind).toBe('finish'); expect(reply.resumeCursor).toBe(3);
  expect(reply.text).toContain('尚未核实'); expect(reply.text).not.toContain('一切已确认');
});

it('rejects a different saved version and an ended session before invoking model', async () => {
  const f = companionCase(); const { services, requests } = controlledModel({});
  f.turn.session.resultVersionId = randomUUID();
  await expect(answerCompanion(f.turn, services, new AbortController().signal)).rejects.toThrow();
  f.turn.session.resultVersionId = f.turn.version.id; f.turn.session.status = 'ended';
  await expect(answerCompanion(f.turn, services, new AbortController().signal)).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

it('rejects unknown reply kinds and research proposals without a question', async () => {
  const f = companionCase();
  for (const output of [
    {kind:'explain',text:'不合法的内部枚举',claimIds:[f.claim.id],evidenceIds:[],resumeCursor:1},
    {kind:'research_request',text:'查一下',claimIds:[],evidenceIds:[],resumeCursor:1},
  ]) {
    const { services } = controlledModel(output);
    await expect(answerCompanion(f.turn, services, new AbortController().signal)).rejects.toThrow();
  }
});

it('retains the current cursor when the model omits it', async () => {
  const f = companionCase(); const { services } = controlledModel({kind:'answer',text:'提案',claimIds:[f.claim.id],evidenceIds:[]});
  const result = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(result.resumeCursor).toBe(1); expect(result.text).toContain('尚未核实');
});

it('carries the saved judgement and qualifiers even when the model selects evidence only', async () => {
  const f = companionCase(); const evidenceId = f.input.version.payload.evidence[0]!.id;
  const { services } = controlledModel({kind:'answer',text:'原文表示已延期',claimIds:[],evidenceIds:[evidenceId],resumeCursor:1});
  const reply = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.claimIds).toContain(f.claim.id); expect(reply.text).toContain('证据不足');
  expect(reply.text).toContain('仅适用于广州校区'); expect(reply.text).toContain('缺少主办方后续公告');
});

it('closes the saved claim/evidence graph without losing another linked judgement', async () => {
  const f = companionCase(); const evidence = f.input.version.payload.evidence[0]!;
  const second = { ...evidence, id: randomUUID(), excerpt: 'controlled_fixture：后续材料有冲突' };
  f.input.version.payload.evidence.push(second);
  f.claim.links.push({ evidenceId: second.id, relation: 'qualifies', rationale: '适用范围限定' });
  const otherClaim = { ...structuredClone(f.claim), id: randomUUID(), statement: '另一条说法', status: 'refuted' as const,
    conditions: ['另一命题仅限旧版通知'], links: [{ evidenceId: second.id, relation: 'contradicts' as const, rationale: '原文反驳' }] };
  f.input.version.payload.claims.push(otherClaim);
  const { services } = controlledModel({kind:'answer',text:'提案',claimIds:[],evidenceIds:[evidence.id],resumeCursor:1});
  const reply = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.claimIds).toEqual(expect.arrayContaining([f.claim.id, otherClaim.id]));
  expect(reply.evidenceIds).toEqual(expect.arrayContaining([evidence.id, second.id]));
  expect(reply.text).toContain('材料反驳'); expect(reply.text).toContain('另一命题仅限旧版通知');
});

it('keeps the stored next action in a finish response', async () => {
  const f = companionCase(); f.input.version.payload.nextSteps = ['请提供主办方后续公告的完整链接或截图'];
  const { services } = controlledModel({kind:'finish',text:'结束',claimIds:[],evidenceIds:[],resumeCursor:1});
  const reply = await answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.text).toContain('请提供主办方后续公告的完整链接或截图');
});

it('returns no late answer after cancellation and does not leak provider error text', async () => {
  const f = companionCase(); const controller = new AbortController();
  const { services } = controlledModel({});
  services.model = async () => { controller.abort(); throw new Error('PRIVATE_PROVIDER_SECRET'); };
  try { await answerCompanion(f.turn, services, controller.signal); throw new Error('must fail'); }
  catch (error) { expect(String(error)).toContain('COMPANION_ABORTED'); expect(String(error)).not.toContain('PRIVATE_PROVIDER_SECRET'); }
});
