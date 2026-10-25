import { expect, it } from 'vitest';
import { createExperienceModule } from '../../src/server/companion/module.js';
import { companionCase, controlledModel } from './companion-fixture.js';

const module = createExperienceModule(async () => { throw Error('No TTS'); });
// controlled_fixture: no provider, copied private payload, or real semantic acceptance.
it('distributes saved facts and limits once across short sections despite repeated model references', async () => {
  const f = companionCase(), p = f.input.version.payload;
  p.evidence[0]!.limitations = ['screened_raw_view:{"rawId":"private-proof","revision":"opaque"}', 'capture_header_years:2020', 'capture_partial：正文截断，真实性未确认。'];
  p.evidence[0]!.excerpt = '开头背景。报名仅限广州校区，不能证明延期。' + '其他背景。'.repeat(70);
  f.claim.links[0]!.quote = '报名仅限广州校区，不能证明延期。';
  f.draft.segments.forEach(s => { s.claimIds = [f.claim.id]; s.evidenceIds = [p.evidence[0]!.id]; });
  const before = structuredClone(f.input.version), { services, requests } = controlledModel(f.draft);
  const result = await module.buildCompanion(f.input, services, new AbortController().signal);
  const text = result.segments.map(s => s.text).join('\n');
  expect(result.segments.length).toBeGreaterThanOrEqual(3); expect(result.segments.length).toBeLessThanOrEqual(5);
  expect(result.segments.every(s => s.text.length <= 900)).toBe(true);
  for (const value of [...p.conditions, ...p.unknowns, ...f.claim.conditions, ...f.claim.gaps, p.queryTime]) expect(text).toContain(value);
  expect(result.summary).toContain(p.summary); expect(text).not.toContain(f.claim.reasonSummary);
  expect(text.split(p.conditions[0]!)).toHaveLength(2);
  expect(text).toContain(f.claim.links[0]!.quote); expect(text).toContain('2020'); expect(text).toContain('正文截断，真实性未确认');
  expect(text + result.summary).not.toMatch(/screened_raw_view|rawId|revision|capture_header_years|capture_partial/);
  expect(result.segments.filter(s => s.text.includes(f.claim.links[0]!.quote!)).every(s => s.claimIds.includes(f.claim.id) && s.evidenceIds.includes(p.evidence[0]!.id))).toBe(true);
  expect(f.input.version).toEqual(before); expect(requests).toHaveLength(1);
});
it('rejects invented quotes and keeps partial snippet material explicitly unverified', async () => {
  const f = companionCase(), p = f.input.version.payload;
  f.claim.links[0]!.quote = '伪造已延期';
  const { services } = controlledModel(f.draft);
  const draft = await module.buildCompanion(f.input, services, new AbortController().signal);
  expect(draft.segments.map(s => s.text).join('\n')).not.toContain('伪造已延期');
  p.claims = []; p.conflicts = []; p.answerBlocks = []; p.summary = '本轮未完成核验，没有可确认结论。';
  p.evidence[0]!.representation = 'snippet'; p.evidence[0]!.excerpt = '搜索摘要提到一部影片，尚未打开正文。';
  f.draft.segments.forEach(s => { s.claimIds = []; s.evidenceIds = []; });
  const partial = await module.buildCompanion(f.input, controlledModel(f.draft).services, new AbortController().signal);
  const text = partial.segments.map(s => s.text).join('\n');
  expect(text).toContain(p.summary); expect(text).toContain(p.evidence[0]!.excerpt); expect(text).toContain('摘要线索');
  expect(partial.segments.every(s => !s.claimIds.length)).toBe(true);
});
it('also projects internal limitations in grounded interruption answers without changing cursor', async () => {
  const f = companionCase();
  f.input.version.payload.evidence[0]!.limitations = ['screened_raw_view:{"rawId":"opaque"}', 'capture_header_years:2020', 'capture_scope_unrelated：与当前对象不对应，不作为回答依据。'];
  const { services } = controlledModel({ kind: 'answer', text: '虚构', claimIds: [f.claim.id], evidenceIds: [] });
  const result = await module.answerCompanion(f.turn, services, new AbortController().signal);
  expect(result.text).not.toMatch(/screened_raw_view|rawId|capture_scope_unrelated|capture_header_years/);
  expect(result.text).toContain('与当前对象不对应'); expect(result.text).toContain('2020'); expect(result.resumeCursor).toBe(1);
});
it('keeps the surrounding sentence when a saved substring quote starts inside a negation', async () => {
  const f = companionCase(), e = f.input.version.payload.evidence[0]!;
  e.excerpt = '公告说明：不同意延期；目前不接受变更。' + '其他背景。'.repeat(70);
  f.claim.links[0]!.quote = '同意延期';
  const result = await module.buildCompanion(f.input, controlledModel(f.draft).services, new AbortController().signal);
  const text = result.segments.map(s => s.text).join('\n');
  expect(text).toContain('公告说明：不同意延期；目前不接受变更。');
  expect(text).not.toContain('原材料引文：“同意延期”');
});
it('does not mistake an opposite substring in an earlier sentence for an already delivered condition', async () => {
  const f = companionCase();
  f.claim.reasonSummary = '材料写的不是仅适用于广州校区；适用范围尚有冲突。';
  f.claim.conditions = ['仅适用于广州校区'];
  const result = await module.buildCompanion(f.input, controlledModel(f.draft).services, new AbortController().signal);
  expect(result.segments.at(-1)!.text).toContain('仅适用于广州校区');
});
