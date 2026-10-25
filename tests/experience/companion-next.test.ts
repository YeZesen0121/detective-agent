import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildCompanion } from '../../src/server/companion/briefing.js';
import { companionCase, controlledModel } from './companion-fixture.js';

it('keeps snapshot uncertainty and limits even when persona/model claim certainty', async () => {
  const f = companionCase(); const original = structuredClone(f.input.version);
  const { services } = controlledModel(f.draft);
  const draft = await buildCompanion(f.input, services, new AbortController().signal);
  const text = draft.summary + draft.segments.map(s => s.text).join('\n');
  expect(text).toContain('仅限2026届'); expect(text).toContain('尚未核实');
  expect(text).toContain('仅适用于广州校区'); expect(text).toContain('缺少主办方后续公告');
  expect(text).toContain('证据不足'); expect(text).not.toContain('已确定延期，可以放心报名');
  expect(text).not.toContain('无条件确定延期'); expect(f.input.version).toEqual(original);
});

it.each(['越界版本', '非法动作', '超长段落', '第六段', '重复段ID'])(
  'rejects %s safely without repeating a model call', async problem => {
    const f = companionCase();
    const draft = structuredClone(f.draft);
    if (problem === '越界版本') draft.segments[0]!.claimIds = [randomUUID()];
    if (problem === '非法动作') Object.assign(draft.segments[0]!, { action: '我已致电主办方并重新搜索' });
    if (problem === '超长段落') draft.segments[0]!.text = '长'.repeat(12001);
    if (problem === '第六段') draft.segments.push(...[0, 1, 2].map(() => ({ ...draft.segments[0]!, id: randomUUID() })));
    if (problem === '重复段ID') draft.segments[1]!.id = draft.segments[0]!.id;
    const { services, requests } = controlledModel(draft);
    await expect(buildCompanion(f.input, services, new AbortController().signal)).rejects.toThrow();
    expect(requests).toHaveLength(1);
  });

it('rejects mismatched case context before any model call', async () => {
  const f = companionCase(); const { services, requests } = controlledModel(f.draft);
  f.input.context.investigationId = randomUUID();
  await expect(buildCompanion(f.input, services, new AbortController().signal)).rejects.toThrow();
  expect(requests).toHaveLength(0);
});

it('fails with a readable safe error for provider failure and never retries', async () => {
  const f = companionCase(); let calls = 0;
  const { services } = controlledModel(f.draft);
  services.model = async () => { calls++; throw new Error('PRIVATE_PROVIDER_DETAIL'); };
  try { await buildCompanion(f.input, services, new AbortController().signal); throw new Error('should fail'); }
  catch (error) {
    expect(String(error)).not.toContain('PRIVATE_PROVIDER_DETAIL');
    expect(String(error)).toMatch(/伴读.*失败|无法.*伴读/);
  }
  expect(calls).toBe(1);
});

it('does not call a model after abort or deliver a late aborted draft', async () => {
  const f = companionCase(); const before = new AbortController(); before.abort();
  const { services, requests } = controlledModel(f.draft);
  await expect(buildCompanion(f.input, services, before.signal)).rejects.toThrow();
  expect(requests).toHaveLength(0);
  const late = new AbortController();
  services.model = async () => { late.abort(); return { value: f.draft, usage: null, providerRequestId: null, modelId: 'controlled_fixture', finishReason: 'stop' }; };
  await expect(buildCompanion(f.input, services, late.signal)).rejects.toThrow();
});

it.each(['supported', 'refuted', 'mixed', 'insufficient'] as const)('renders %s using the saved verdict rather than model prose', async status => {
  const f = companionCase(); f.claim.status = status;
  if (status === 'refuted') f.claim.links[0]!.relation = 'contradicts';
  if (status === 'mixed') f.claim.links.push({ ...f.claim.links[0]!, relation: 'contradicts' });
  const { services } = controlledModel(f.draft);
  const draft = await buildCompanion(f.input, services, new AbortController().signal);
  const expected = { supported: '材料支持', refuted: '材料反驳', mixed: '证据有冲突', insufficient: '证据不足' };
  expect(draft.segments[0]!.text).toContain(expected[status]);
  expect(draft.segments.map(s => s.text).join('\n')).toContain('仅适用于广州校区');
  expect(draft.segments[0]!.text).not.toContain('已确定延期，可以放心报名');
});

it('never drops claim gaps from the overview when the model omits that claim from its outline', async () => {
  const f = companionCase(); f.draft.segments.forEach(s => { s.claimIds = []; s.evidenceIds = []; });
  const { services } = controlledModel(f.draft);
  const result = await buildCompanion(f.input, services, new AbortController().signal);
  expect(result.summary).toContain('缺少主办方后续公告');
  expect(result.summary).toContain('仅适用于广州校区');
  expect(result.summary).not.toContain('无条件确定延期');
});

it.each([false, true])('retains claim limits and next action when closing segment has references=%s', async lastHasRefs => {
  const f = companionCase(); f.draft.segments[0]!.claimIds = [];
  if (lastHasRefs) {
    f.draft.segments[2]!.claimIds = [f.claim.id];
    f.draft.segments[2]!.evidenceIds = [f.input.version.payload.evidence[0]!.id];
  }
  f.input.version.payload.nextSteps = ['请提供主办方后续公告的完整链接或截图'];
  const { services } = controlledModel(f.draft);
  const draft = await buildCompanion(f.input, services, new AbortController().signal);
  expect(draft.segments[0]!.claimIds).toContain(f.claim.id);
  expect(draft.segments[0]!.text).toContain('证据不足');
  expect(draft.segments.map(s => s.text).join('\n')).toContain('仅适用于广州校区');
  expect(draft.segments.at(-1)!.text).toContain('请提供主办方后续公告的完整链接或截图');
});

it.each([null, { segments: [], summary: '缺段' }, { segments: 'wrong', summary: '坏格式' }])('fails malformed or short output without retries', async value => {
  const f = companionCase(); const { services, requests } = controlledModel(value);
  await expect(buildCompanion(f.input, services, new AbortController().signal)).rejects.toThrow(/伴读/);
  expect(requests).toHaveLength(1);
});
