import { randomUUID } from 'node:crypto';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { runtimeSeed, time, later } from '../helpers/runtime.js';
let s: ReturnType<typeof runtimeSeed>;
beforeEach(() => { s = runtimeSeed(); });
afterEach(() => s.db.close());
function material() {
  s.runs.setScope(s.run.id, s.run.epoch, s.payload.scope, time);
  s.runs.saveCheckpoint(s.run.id, s.run.epoch, { sources: s.payload.sources, evidence: s.payload.evidence, claims: s.payload.claims }, time);
}
it('atomically finalizes an owned immutable result and retains it after later operations', () => {
  material();
  const version = s.runs.commitResult(s.run.id, s.run.epoch, s.payload, 'completed', later(2));
  expect(version.payload.summary).toContain('十月三十日');
  expect(s.runs.get(s.run.id, s.owner)).toMatchObject({ status: 'completed', activeMs: 2000, createdResultVersionId: version.id });
  expect(s.runs.getResult(version.id, randomUUID())).toBeNull();
  const before = s.runs.getResult(version.id, s.owner)!;
  s.runs.cancel(s.run.id, s.owner, later(3));
  expect(s.runs.getResult(version.id, s.owner)).toEqual(before);
  expect(() => s.db.prepare("UPDATE result_versions SET payload_json='{}' WHERE id=?").run(version.id)).toThrow();
  expect(() => s.db.prepare('DELETE FROM result_versions WHERE id=?').run(version.id)).toThrow();
  expect(s.runs.listEvents(s.investigationId, s.owner).items.at(-1)?.type).toBe('run.finalized');
});
it('rejects foreign ownership and unmatched material without ending the run or inserting a result', () => {
  material();
  expect(() => s.runs.commitResult(s.run.id, s.run.epoch, { ...s.payload, investigationId: randomUUID() }, 'completed', later(1))).toThrow();
  const bad = structuredClone(s.payload); bad.evidence[0]!.excerpt = '未收集的材料';
  expect(() => s.runs.commitResult(s.run.id, s.run.epoch, bad, 'completed', later(1))).toThrow();
  expect(s.runs.get(s.run.id, s.owner)?.status).toBe('running');
  expect(s.db.prepare('SELECT count(*) AS n FROM result_versions').get()).toEqual({ n: 0 });
});
it('does not permit a cancelled epoch to publish a late result', () => {
  material(); s.runs.cancel(s.run.id, s.owner, later(1));
  expect(() => s.runs.commitResult(s.run.id, s.run.epoch, s.payload, 'completed', later(2))).toThrow();
  expect(s.db.prepare('SELECT count(*) AS n FROM result_versions').get()).toEqual({ n: 0 });
});
it('binds result scope to the saved scope and fails atomically on unresolved references', () => {
  material();
  expect(() => s.runs.commitResult(s.run.id, s.run.epoch, { ...s.payload, scope: { ...s.payload.scope, objectText: '换了对象' } }, 'completed', later(1))).toThrow();
  const bad = structuredClone(s.payload); bad.claims[0]!.links[0]!.evidenceId = randomUUID();
  expect(() => s.runs.commitResult(s.run.id, s.run.epoch, bad, 'completed', later(1))).toThrow();
  expect(s.runs.get(s.run.id, s.owner)?.status).toBe('running');
});
it('returns version-bound copy text containing limitations, unknowns, time and sources', () => {
  s.payload.claims[0]!.conditions = ['仅适用于本科生'];
  s.payload.evidence[0]!.limitations = ['受控原文只截取了部分内容'];
  material(); s.payload.unknowns = ['controlled_fixture：尚未确认延期'];
  const v = s.runs.commitResult(s.run.id, s.run.epoch, s.payload, 'partial', later(2));
  const text = s.runs.copyResult(v.id, s.owner)!;
  for (const item of ['十月三十日', '仅用于契约测试', '尚未确认延期', '仅适用于本科生', '受控原文只截取了部分内容', time, 'https://example.invalid/notice']) expect(text).toContain(item);
  expect(s.runs.copyResult(v.id, randomUUID())).toBeNull();
});
