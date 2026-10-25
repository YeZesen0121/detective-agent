import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildCompanion, answerCompanion } from '../../src/server/companion/briefing.js';
import { ResultVersionSchema } from '../../src/shared/contracts.js';
import { companionCase, controlledBudget, controlledModel } from './companion-fixture.js';

// controlled_fixture: full captures model I-N1's storage shape, not actual fetched sources.
function longCase() {
  const f = companionCase(), p = f.input.version.payload, sample = p.evidence[0]!;
  for (let i = 0; i < 3; i++) {
    p.evidence.push({ ...sample, id: randomUUID(), excerpt: `${i}档案` + '原'.repeat(23997), limitations: ['raw_capture_only:完整捕获不是额外信源'] });
    for (let j = 0; j < 2; j++) p.evidence.push({ ...sample, id: randomUUID(), excerpt: '未关联备用片段'.repeat(100), limitations: ['同一捕获的另一片段'] });
  }
  p.conflicts = [{ description: '旧公告与群聊说法冲突，未确认更新。', claimIds: [f.claim.id], evidenceIds: [sample.id] }];
  ResultVersionSchema.parse(f.input.version);
  return f;
}
for (const mode of ['build', 'turn'] as const) {
  function run(f: ReturnType<typeof companionCase>, services: ReturnType<typeof controlledModel>['services'], signal = new AbortController().signal) {
    return mode === 'build' ? buildCompanion(f.input, services, signal) : answerCompanion(f.turn, services, signal);
  }
  function output(f: ReturnType<typeof companionCase>) {
    return mode === 'build' ? f.draft : { kind: 'answer', text: '提案', claimIds: [f.claim.id], evidenceIds: [], resumeCursor: 1 };
  }
  it(`${mode}: excludes 3x24000 captures and unreferenced snippets, keeps full qualifiers/closure and saved version`, async () => {
    const f = longCase(), before = structuredClone(f), { services, requests } = controlledModel(output(f));
    let snapshots = 0; services.budget.snapshot = async () => { snapshots++; return controlledBudget(); };
    await run(f, services);
    expect(snapshots).toBe(1); expect(requests).toHaveLength(1);
    const text = JSON.stringify(requests[0]!.messages);
    expect(Buffer.byteLength(text) + 512).toBeLessThanOrEqual(24000);
    for (const expected of [f.input.version.id, f.claim.id, f.claim.links[0]!.evidenceId, '仅适用于广州校区', '缺少主办方后续公告', '旧公告与群聊说法冲突', f.input.version.payload.queryTime]) expect(text).toContain(expected);
    expect(text).not.toContain('raw_capture_only'); expect(text).not.toContain('未关联备用片段'); expect(text).not.toContain('原'.repeat(100));
    expect(f).toEqual(before);
  });
  it(`${mode}: refuses a legacy claim depending on a raw archive without a model call`, async () => {
    const f = longCase(); f.claim.links.push({ evidenceId: f.input.version.payload.evidence.find(e => e.limitations[0]?.startsWith('raw_capture_only'))!.id, relation: 'qualifies', rationale: '旧报告依赖完整档案' });
    const { services, requests } = controlledModel(output(f));
    await expect(run(f, services)).rejects.toMatchObject({ code: 'COMPANION_RAW_CAPTURE_DEPENDENCY' }); expect(requests).toHaveLength(0);
  });
  it(`${mode}: refuses an oversized necessary quote rather than silently deleting negation`, async () => {
    const f = companionCase(); f.input.version.payload.evidence[0]!.excerpt = '必要材料'.repeat(4000) + '但不适用于2027届。';
    const { services, requests } = controlledModel(output(f));
    await expect(run(f, services)).rejects.toMatchObject({ code: 'COMPANION_MATERIAL_TOO_LONG' }); expect(requests).toHaveLength(0);
  });
  it(`${mode}: measures the entire escaped UTF8 messages plus margin against the fresh remaining balance`, async () => {
    const f = companionCase(), good = controlledModel(output(f)); await run(f, good.services);
    const cost = Buffer.byteLength(JSON.stringify(good.requests[0]!.messages)) + 512;
    const exact = controlledModel(output(f)); exact.services.budget.snapshot = async () => controlledBudget(cost);
    await run(f, exact.services); expect(exact.requests).toHaveLength(1);
    const small = controlledModel(output(f)); small.services.budget.snapshot = async () => controlledBudget(cost - 1);
    await expect(run(f, small.services)).rejects.toMatchObject({ code: 'COMPANION_MATERIAL_TOO_LONG' }); expect(small.requests).toHaveLength(0);
  });
  it(`${mode}: abort during budget lookup never dispatches a model`, async () => {
    const f = companionCase(), c = new AbortController(), { services, requests } = controlledModel(output(f));
    services.budget.snapshot = async () => { c.abort(); return controlledBudget(); };
    await expect(run(f, services, c.signal)).rejects.toMatchObject({ code: 'COMPANION_ABORTED' }); expect(requests).toHaveLength(0);
  });
  it(`${mode}: fails safely when the authoritative budget is unavailable`, async () => {
    const f = companionCase(), { services, requests } = controlledModel(output(f));
    services.budget.snapshot = async () => { throw Error('PRIVATE_LEDGER_DETAIL'); };
    await expect(run(f, services)).rejects.toMatchObject({ code: 'COMPANION_BUDGET_UNAVAILABLE' }); expect(requests).toHaveLength(0);
  });
  it.each(['canModel', 'modelCalls', 'outputTokens'] as const)(`${mode}: respects the remaining %s gate without retry`, async dimension => {
    const f = companionCase(), { services, requests } = controlledModel(output(f)), budget = controlledBudget();
    if (dimension === 'canModel') budget.canModel = false;
    else budget.remaining[dimension] = 0;
    services.budget.snapshot = async () => budget;
    await expect(run(f, services)).rejects.toMatchObject({ code: 'COMPANION_BUDGET_EXHAUSTED' }); expect(requests).toHaveLength(0);
  });
  it(`${mode}: cannot promote an omitted capture into independent evidence through model output`, async () => {
    const f = longCase(), raw = f.input.version.payload.evidence.find(e => e.limitations.some(s => s.startsWith('raw_capture_only')))!;
    const value = mode === 'build' ? { ...f.draft, segments: f.draft.segments.map((s, i) => i ? s : { ...s, claimIds: [], evidenceIds: [raw.id] }) }
      : { kind: 'answer', text: '档案足以证明', claimIds: [], evidenceIds: [raw.id] };
    const { services, requests } = controlledModel(value);
    await expect(run(f, services)).rejects.toMatchObject({ code: 'COMPANION_RAW_CAPTURE_DEPENDENCY' }); expect(requests).toHaveLength(1);
  });
}
