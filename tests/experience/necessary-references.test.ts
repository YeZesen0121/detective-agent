import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildCompanion, answerCompanion } from '../../src/server/companion/briefing.js';
import { ResultVersionSchema } from '../../src/shared/contracts.js';
import type { ModelRequest } from '../../src/shared/ports.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture: independently referenced excerpts, never real captures/providers.
type Dependency = 'answerBlock' | 'conflict' | 'currentSegment';
type Mode = 'build' | 'turn';
const cases: { mode: Mode; dependency: Dependency }[] = [
  { mode: 'build', dependency: 'answerBlock' }, { mode: 'turn', dependency: 'answerBlock' },
  { mode: 'build', dependency: 'conflict' }, { mode: 'turn', dependency: 'conflict' },
  { mode: 'turn', dependency: 'currentSegment' },
];
function fixture(dependency: Dependency, raw = false) {
  const f = companionCase(), payload = f.input.version.payload;
  payload.answerBlocks = []; payload.conflicts = [];
  const originalSource = payload.sources[0]!, originalEvidence = payload.evidence[0]!;
  originalSource.originGroup = 'controlled-shared-original-announcement';
  originalSource.originReason = '主办方原公告';
  const source = { ...structuredClone(originalSource), id: randomUUID(),
    url: 'https://example.invalid/reprint', canonicalUrl: 'https://example.invalid/reprint',
    title: 'controlled_fixture 同一公告的转载', originReason: '转载自同一主办方公告，不是第二份独立证明' };
  const evidence = { ...structuredClone(originalEvidence), id: randomUUID(), origin: { kind: 'source' as const, id: source.id },
    excerpt: '仅限2026届；不得将转载计为独立确认。',
    limitations: raw ? ['raw_capture_only:完整原始捕获，不是额外信源'] : ['转载保留原公告条件，尚无后续公告'] };
  const spareSource = { ...structuredClone(source), id: randomUUID(), originGroup: 'controlled-unneeded-source', originReason: '未被必要引用选中' };
  const spare = { ...structuredClone(evidence), id: randomUUID(), origin: { kind: 'source' as const, id: spareSource.id }, limitations: [], excerpt: '未被任何必要依赖引用的备用证据' };
  payload.sources.push(source, spareSource); payload.evidence.push(evidence, spare);
  if (dependency === 'answerBlock') payload.answerBlocks.push({ id: 'controlled-answer-only', text: '此结论块另有适用条件。', claimIds: [], evidenceIds: [evidence.id] });
  if (dependency === 'conflict') payload.conflicts.push({ description: '此冲突的限制不能从命题引用推导。', claimIds: [], evidenceIds: [evidence.id] });
  if (dependency === 'currentSegment') {
    const current = f.turn.session.segments[f.turn.session.cursor]!;
    current.claimIds = []; current.evidenceIds = [evidence.id];
    current.text = '当前段落单独引用转载的适用条件。';
  }
  // Critical isolation: no claim links to the added evidence, and only one owner references it.
  expect(payload.claims.flatMap(c => c.links.map(l => l.evidenceId))).not.toContain(evidence.id);
  expect(payload.answerBlocks.flatMap(b => b.evidenceIds)).toEqual(dependency === 'answerBlock' ? [evidence.id] : []);
  expect(payload.conflicts.flatMap(c => c.evidenceIds)).toEqual(dependency === 'conflict' ? [evidence.id] : []);
  expect(f.turn.session.segments.flatMap(s => s.evidenceIds).includes(evidence.id)).toBe(dependency === 'currentSegment');
  ResultVersionSchema.parse(f.input.version);
  return { f, evidence, source, originalSource, spare, spareSource };
}
function sentMaterial(request: ModelRequest) {
  const line = request.messages.find(m => m.role === 'user')!.content.split('\n')[0]!;
  // Decode the actual request at the injected service boundary, not material() itself.
  return JSON.parse(line.slice(line.indexOf('{'))) as {
    resultVersionId: string; queryTime: string; conditions: string[]; unknowns: string[]; cursor: number;
    evidence: { id: string; excerpt: string; origin: { kind: string; id: string }; limitations: string[] }[];
    sources: { id: string; originGroup: string | null; originReason: string | null; canonicalUrl: string; readStatus: string }[];
  };
}
for (const { mode, dependency } of cases) {
  it(`${mode}: keeps ${dependency}-only evidence and shared source identity without promoting a reprint`, async () => {
    const { f, evidence, source, originalSource, spare, spareSource } = fixture(dependency), before = structuredClone(f);
    const output = mode === 'build' ? f.draft : { kind: 'answer', text: '受控讲解提案', claimIds: [f.claim.id], evidenceIds: [], resumeCursor: 2 };
    const { services, requests } = controlledModel(output);
    if (mode === 'build') await buildCompanion(f.input, services, new AbortController().signal);
    else {
      const reply = await answerCompanion(f.turn, services, new AbortController().signal);
      expect(reply.resumeCursor).toBe(1);
    }
    expect(requests).toHaveLength(1);
    const material = sentMaterial(requests[0]!);
    expect(material.evidence.find(e => e.id === evidence.id)).toEqual(evidence);
    expect(material.evidence.some(e => e.id === spare.id)).toBe(false);
    expect(material.sources.find(s => s.id === source.id)).toMatchObject({
      canonicalUrl: 'https://example.invalid/reprint', originGroup: 'controlled-shared-original-announcement',
      originReason: '转载自同一主办方公告，不是第二份独立证明', readStatus: 'full',
    });
    expect(material.sources.find(s => s.id === originalSource.id)).toMatchObject({
      originGroup: 'controlled-shared-original-announcement', originReason: '主办方原公告',
    });
    expect(material.sources.some(s => s.id === spareSource.id)).toBe(false);
    expect(material).toMatchObject({ resultVersionId: f.input.version.id, queryTime: f.input.version.payload.queryTime,
      conditions: ['仅限2026届，且以10月24日公告为准'], unknowns: ['是否发布延期公告尚未核实'], cursor: mode === 'build' ? 0 : 1 });
    expect(Buffer.byteLength(JSON.stringify(requests[0]!.messages)) + 512).toBeLessThanOrEqual(24000);
    expect(f).toEqual(before);
  });
  it(`${mode}: refuses a ${dependency}-only raw capture dependency before any model call`, async () => {
    const { f } = fixture(dependency, true), before = structuredClone(f);
    const { services, requests } = controlledModel({});
    const result = mode === 'build' ? buildCompanion(f.input, services, new AbortController().signal)
      : answerCompanion(f.turn, services, new AbortController().signal);
    await expect(result).rejects.toMatchObject({ code: 'COMPANION_RAW_CAPTURE_DEPENDENCY' });
    expect(requests).toHaveLength(0); expect(f).toEqual(before);
  });
}
