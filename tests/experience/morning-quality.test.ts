import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { createExperienceModule } from '../../src/server/companion/module.js';
import { ResultVersionSchema } from '../../src/shared/contracts.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture: saved conflict semantics, not fresh investigation or real model quality.
const module = createExperienceModule(async () => { throw Error('Unexpected TTS authorization'); });
const conflictDescription = '两份通知的截止日互斥，但尚无证据说明哪份已经替代另一份；不能把抓取时间较晚当作新通知生效。';
function conflictOnlyDetails() {
  const f = companionCase(), p = f.input.version.payload, first = p.evidence[0]!;
  p.summary = '两份原材料分别留存，当前未选定最终截止日。'; p.conditions = ['仅限同一届别和同一校区']; p.unknowns = ['有效时间及替代关系尚未核实'];
  const source = { ...structuredClone(p.sources[0]!), id: randomUUID(), url: 'https://example.invalid/notice-b', canonicalUrl: 'https://example.invalid/notice-b' };
  const second = { ...structuredClone(first), id: randomUUID(), origin: { kind: 'source' as const, id: source.id }, excerpt: '乙通知：2026年10月31日截止；不表示已替代甲通知。' };
  const other = { ...structuredClone(f.claim), id: randomUUID(), statement: '乙通知写10月31日截止', reasonSummary: '只核对到乙通知的原定说法。',
    conditions: ['仅适用于乙通知原文范围'], gaps: ['尚未核实乙通知是否有效'], links: [{ evidenceId: second.id, relation: 'qualifies' as const, rationale: '乙通知原语' }] };
  f.claim.statement = '甲通知写10月30日截止'; f.claim.reasonSummary = '只核对到甲通知的原定说法。';
  p.sources.push(source); p.evidence.push(second); p.claims.push(other);
  p.conflicts = [{ description: conflictDescription, claimIds: [f.claim.id, other.id], evidenceIds: [first.id, second.id] }];
  // The opposing side is related ONLY by the saved conflict, never by shared claim links.
  expect(f.claim.links.some(link => link.evidenceId === second.id)).toBe(false);
  expect(other.links.some(link => link.evidenceId === first.id)).toBe(false);
  expect([p.summary, ...p.conditions, ...p.unknowns, ...p.claims.flatMap(c => [c.reasonSummary, ...c.gaps])].join('\n')).not.toContain(conflictDescription);
  ResultVersionSchema.parse(f.input.version);
  return { f, other, second };
}
it('preserves conflict-only qualifications in the overview even when all model outline references are empty', async () => {
  const { f } = conflictOnlyDetails(), before = structuredClone(f.input.version);
  f.draft.segments.forEach(s => { s.claimIds = []; s.evidenceIds = []; });
  const { services, requests } = controlledModel(f.draft);
  const draft = await module.buildCompanion(f.input, services, new AbortController().signal);
  expect(draft.summary).toContain(conflictDescription); expect(draft.segments.map(s => s.text).join('\n')).toContain(conflictDescription);
  expect(f.input.version).toEqual(before); expect(requests).toHaveLength(1);
});
it.each(['claim', 'evidence'] as const)('keeps both sides and the unique conflict limitation when a question selects one %s', async selection => {
  const { f, other, second } = conflictOnlyDetails(), before = structuredClone(f.turn);
  const { services, requests } = controlledModel({ kind: 'answer', text: '抓取较晚，因此乙通知已取代甲。',
    claimIds: selection === 'claim' ? [f.claim.id] : [], evidenceIds: selection === 'evidence' ? [f.claim.links[0]!.evidenceId] : [], resumeCursor: 2 });
  const reply = await module.answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.text).toContain(conflictDescription);
  expect(reply.claimIds).toEqual([f.claim.id, other.id]); expect(reply.evidenceIds).toEqual([f.claim.links[0]!.evidenceId, second.id]);
  for (const claim of f.input.version.payload.claims) for (const value of [claim.statement, ...claim.conditions, ...claim.gaps]) expect(reply.text).toContain(value);
  expect(reply.text).not.toContain('因此乙通知已取代甲'); expect(reply.resumeCursor).toBe(1); expect(f.turn).toEqual(before); expect(requests).toHaveLength(1);
});
it('keeps the saved conflict qualification when finishing and does not move the persisted session itself', async () => {
  const { f } = conflictOnlyDetails(), before = structuredClone(f.turn.session);
  const { services } = controlledModel({ kind: 'finish', text: '已经解决冲突。', claimIds: [], evidenceIds: [] });
  const reply = await module.answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.text).toContain(conflictDescription); expect(reply.text).not.toContain('已经解决冲突'); expect(reply.resumeCursor).toBe(3); expect(f.turn.session).toEqual(before);
});
it('does not sweep an unrelated claim or excerpt into the conflict closure merely because it shares a source', async () => {
  const { f, other, second } = conflictOnlyDetails(), p = f.input.version.payload;
  const evidence = { ...structuredClone(p.evidence[0]!), id: randomUUID(), excerpt: '另一校区的无关受控材料，不涉及本冲突。' };
  const unrelated = { ...structuredClone(f.claim), id: randomUUID(), statement: '另一校区的独立问题', links: [{ evidenceId: evidence.id, relation: 'qualifies' as const, rationale: '独立问题' }] };
  p.evidence.push(evidence); p.claims.push(unrelated);
  const { services } = controlledModel({ kind: 'answer', text: '提案', claimIds: [f.claim.id], evidenceIds: [] });
  const reply = await module.answerCompanion(f.turn, services, new AbortController().signal);
  expect(reply.claimIds).toEqual([f.claim.id, other.id]); expect(reply.evidenceIds).toEqual([f.claim.links[0]!.evidenceId, second.id]);
  expect(reply.text).toContain(conflictDescription); expect(reply.text).not.toContain(unrelated.statement); expect(reply.text).not.toContain(evidence.excerpt);
});
