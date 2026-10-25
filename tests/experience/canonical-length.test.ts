import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import { buildCompanion } from '../../src/server/companion/briefing.js';
import { CompanionDraftSchema } from '../../src/shared/ports.js';
import { ResultVersionSchema } from '../../src/shared/contracts.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture: representative length/closure cases, not a copy of private
// model exports. The authorized exact real-response replay is documented separately.
function linkedClaims(reason: string) {
  const f = companionCase(), claim = f.claim;
  claim.reasonSummary = reason;
  for (let i = 0; i < 2; i++) f.input.version.payload.claims.push({ ...structuredClone(claim), id: randomUUID(), statement: `第${i + 2}条待核命题，仍无官方直接材料。` });
  ResultVersionSchema.parse(f.input.version);
  return f;
}
it('keeps oversized report summary available without repeating it in the short mainline', async () => {
  const f = companionCase(), p = f.input.version.payload;
  p.summary = '证据不足：' + '未取得官方直接材料，不能确认当前状态；'.repeat(56);
  p.conditions = ['仅用于controlled_fixture代表性长度回归，不代表实际调查结论。'];
  p.unknowns = ['尚无可排序的官方生效时间。', '不能把第三方说法当作官方确认。'];
  f.draft.segments.forEach(s => { s.claimIds = []; s.evidenceIds = []; });
  const before = structuredClone(f.input.version), { services, requests } = controlledModel(f.draft);
  const result=await buildCompanion(f.input,services,new AbortController().signal);
  expect(result.summary).toContain(p.summary);expect(result.segments.every(s=>s.text.length<=400)).toBe(true);
  expect(f.input.version).toEqual(before); expect(requests).toHaveLength(1);
});
it('retains all shared-evidence claim limits while reading a repeated long reason only once', async () => {
  const reason = '这只是controlled_fixture二手转述，不能确认官方当前状态；'.repeat(8);
  const f = linkedClaims(reason), before = structuredClone(f.input.version), { services, requests } = controlledModel(f.draft);
  const result = await buildCompanion(f.input, services, new AbortController().signal);
  CompanionDraftSchema.parse(result);
  expect(result.segments.map(s => s.text).join('\n')).not.toContain(reason);
  expect(result.segments[0]!.claimIds).toEqual(f.input.version.payload.claims.map(c => c.id));
  expect(result.segments[0]!.evidenceIds).toEqual([f.input.version.payload.evidence[0]!.id]);
  for (const claim of f.input.version.payload.claims) {
    expect(result.segments[0]!.claimIds).toContain(claim.id);
    claim.conditions.concat(claim.gaps).forEach(value => expect(result.segments.map(s => s.text).join('\n')).toContain(value));
  }
  expect(result.segments.map(s => s.text).join('\n')).toContain('证据不足'); expect(f.input.version).toEqual(before); expect(requests).toHaveLength(1);
});
it('rejects necessary content that cannot fit five intact paragraphs without clipping or retry', async () => {
  const f = linkedClaims('controlled_fixture:not_verified;'.padEnd(3999, 'x'));
  f.input.version.payload.conditions=['不可删的完整限定。'.repeat(60)];
  const before = structuredClone(f.input.version), { services, requests } = controlledModel(f.draft);
  await expect(buildCompanion(f.input, services, new AbortController().signal)).rejects.toMatchObject({ code: 'COMPANION_CONTENT_TOO_LONG' });
  expect(requests).toHaveLength(1); expect(f.input.version).toEqual(before);
});
it('does not relax the 1200-character model proposal limit while allowing longer canonical rendering', async () => {
  const f = companionCase(); f.draft.segments[0]!.text = '模'.repeat(1201);
  const { services, requests } = controlledModel(f.draft);
  await expect(buildCompanion(f.input, services, new AbortController().signal)).rejects.toMatchObject({ code: 'COMPANION_INVALID_OUTPUT' });
  expect(requests).toHaveLength(1);
});
