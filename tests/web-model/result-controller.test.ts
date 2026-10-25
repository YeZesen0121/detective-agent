import { describe, expect, it } from 'vitest';
import { createResultController } from '../../src/web/controllers/result.js';
import { createAudioController } from '../../src/web/controllers/audio.js';
import { updatedVersionFixture } from '../../src/shared/fixtures/index.js';
import type { ResultVersion, AudioManifest } from '../../src/shared/contracts.js';
import type { RuntimeApi } from '../../src/web/api/runtime.js';
import { deferred, id } from './fixtures.js';
import { ClientError } from '../../src/web/api/client.js';

const { before, after } = updatedVersionFixture;
type Response = Awaited<ReturnType<RuntimeApi['getResult']>>;
function setup(read?: RuntimeApi['getResult'], copy?: RuntimeApi['copyResult'], changed?: (previous: string, next: string) => void) {
  const reads: string[] = []; const copies: string[] = [];
  const runtime = { getResult: async (version: string, signal: AbortSignal) => { reads.push(version); return read ? read(version, signal) : { version: version === after.id ? after : before, updateNotice: null }; }, copyResult: async (version: string, signal: AbortSignal) => { copies.push(version); return copy ? copy(version, signal) : { text: `controlled_fixture 版本 ${version} 条件/未知/时间/来源` }; } };
  return { controller: createResultController({ runtime, ...(changed ? { onVersionChange: changed } : {}) }), reads, copies };
}
describe('fixed result request coordination (controlled_fixture)', () => {
  it('retains a failed initial fixed selection and retries it despite a newer notice',async()=>{
    let fail=true;const h=setup(async version=>{if(fail){fail=false;throw new ClientError('PROVIDER_UNAVAILABLE','controlled_fixture unavailable',null,503);}return{version:version===before.id?before:after,updateNotice:{latestResultVersionId:after.id,createdAt:after.createdAt}};});
    await h.controller.select(before.id,before.investigationId);expect(h.controller.getState()).toMatchObject({phase:'error',requestedVersionId:before.id,data:null,error:{status:503}});await h.controller.retrySelection();expect(h.reads).toEqual([before.id,before.id]);expect(h.controller.getState().data?.selectedVersionId).toBe(before.id);h.controller.dispose();
  });
  it('validates the initial restored version against its expected case without a separate preflight',async()=>{
    const h=setup();await h.controller.select(before.id,id(999));expect(h.controller.getState()).toMatchObject({phase:'error',requestedVersionId:before.id,data:null,error:{code:'PROTOCOL_ERROR'}});await h.controller.retrySelection();expect(h.controller.getState().data).toBeNull();expect(h.reads).toEqual([before.id,before.id]);h.controller.dispose();
  });
  it('refreshes only the notice and explicitly opens latest without changing the old hash/body first', async () => {
    let updated = false; const changes: string[][] = [];
    const h = setup(async (version) => ({ version: version === after.id ? after : before, updateNotice: updated && version === before.id ? { latestResultVersionId: after.id, createdAt: after.createdAt } : null }), undefined, (a, b) => changes.push([a, b]));
    await h.controller.select(before.id); updated = true; await h.controller.refreshNotice();
    expect(h.controller.getState().data).toMatchObject({ selectedVersionId: before.id, result: { summary: before.payload.summary, payloadHash: before.payloadHash }, updateNotice: { latestResultVersionId: after.id } });
    expect(changes).toEqual([]); expect(h.reads).toEqual([before.id, before.id]);
    await h.controller.openLatest();
    expect(h.controller.getState().data?.selectedVersionId).toBe(after.id); expect(changes).toEqual([[before.id, after.id]]); h.controller.dispose();
  });
  it('late select or notice requests cannot roll back a newer selected version', async () => {
    const slow = deferred<Response>(); let requests = 0;
    const h = setup(async (version) => ++requests === 2 ? slow.promise : { version: version === after.id ? after : before, updateNotice: null });
    await h.controller.select(before.id); const notice = h.controller.refreshNotice(); await h.controller.select(after.id);
    slow.resolve({ version: before, updateNotice: null }); await notice;
    expect(h.controller.getState().data?.selectedVersionId).toBe(after.id);
    const pending = deferred<Response>(); const other = setup(async (version) => version === before.id ? pending.promise : { version: after, updateNotice: null });
    const first = other.controller.select(before.id); await other.controller.select(after.id); pending.resolve({ version: before, updateNotice: null }); await first;
    expect(other.controller.getState().data?.selectedVersionId).toBe(after.id); h.controller.dispose(); other.controller.dispose();
  });
  it('rejects cross-case versions and read failures without clearing the current report', async () => {
    const alien = structuredClone(after); alien.investigationId = id(999); alien.payload.investigationId = id(999);
    let fail = false; const h = setup(async (version) => { if (fail) throw Error('cookie=secret'); return { version: version === before.id ? before : alien, updateNotice: null }; });
    await h.controller.select(before.id); await h.controller.select(after.id);
    expect(h.controller.getState()).toMatchObject({ data: { selectedVersionId: before.id }, error: { code: 'PROTOCOL_ERROR' } });
    fail = true; await h.controller.select(after.id);
    expect(h.controller.getState()).toMatchObject({ data: { selectedVersionId: before.id }, error: { code: 'NETWORK_ERROR' } });
    expect(JSON.stringify(h.controller.getState())).not.toContain('secret'); h.controller.dispose();
  });
  it('stops old audio on version commit and stale play/manifest completion cannot revive it', async () => {
    const ended = deferred<void>(); let plays = 0;
    const audio = createAudioController({ play: async () => { plays++; return ended.promise; }, stop() {} });
    const h = setup(undefined, undefined, () => audio.stop()); await h.controller.select(before.id);
    const manifest: AudioManifest = { jobId: id(800), status: 'ready', chunks: [{ index: 0, assetId: id(801), status: 'ready' }], error: null };
    const playing = audio.play(manifest); const epoch = audio.getState().epoch;
    const late = deferred<AudioManifest>(); const lateRequest = late.promise.then((value) => audio.play(value, epoch));
    await h.controller.select(after.id); expect(audio.getState().status).toBe('stopped');
    ended.resolve(); late.resolve(manifest); await Promise.all([playing, lateRequest]);
    expect(plays).toBe(1); expect(audio.getState().status).toBe('stopped'); h.controller.dispose(); audio.dispose();
  });
  it('a notice alone never stops or changes the existing version companion/audio', async () => {
    const ended = deferred<void>(); let stops = 0;
    const audio = createAudioController({ play: async () => ended.promise, stop() { stops++; } });
    const h = setup(async () => ({ version: before, updateNotice: { latestResultVersionId: after.id, createdAt: after.createdAt } }), undefined, () => audio.stop());
    await h.controller.select(before.id);
    const playback = audio.play({ jobId: id(800), status: 'ready', chunks: [{ index: 0, assetId: id(801), status: 'ready' }], error: null }); const count = stops;
    await h.controller.refreshNotice(); expect(stops).toBe(count); expect(audio.getState().status).toBe('playing');
    expect(updatedVersionFixture.oldCompanion.resultVersionId).toBe(h.controller.getState().data?.selectedVersionId);
    ended.resolve(); await playback; h.controller.dispose(); audio.dispose();
  });
  it('copies the selected version despite latest notice and discards a late copy after selection changes', async () => {
    const pending = deferred<{ text: string }>(); const h = setup(async (version) => ({ version: version === after.id ? after : before, updateNotice: { latestResultVersionId: after.id, createdAt: after.createdAt } }), async () => pending.promise);
    await h.controller.select(before.id); const copy = h.controller.copy(); expect(h.copies).toEqual([before.id]);
    await h.controller.select(after.id); pending.resolve({ text: 'controlled_fixture 旧文本' });
    expect(await copy).toBeNull(); expect(h.controller.getState().copy).toBeNull(); h.controller.dispose();
    const ready = setup(); await ready.controller.select(before.id);
    expect(await ready.controller.copy()).toEqual({ versionId: before.id, text: `controlled_fixture 版本 ${before.id} 条件/未知/时间/来源` }); ready.controller.dispose();
  });
  it('copy failure preserves a readable report and exposes safe error', async () => {
    const h = setup(undefined, async () => { throw Error('cookie=secret'); }); await h.controller.select(before.id);
    expect(await h.controller.copy()).toBeNull(); expect(h.controller.getState()).toMatchObject({ copying: false, data: { selectedVersionId: before.id }, error: { code: 'NETWORK_ERROR' } }); h.controller.dispose();
  });
  it('disconnect invalidates a late selection and retains old report', async () => {
    const pending = deferred<Response>(); const h = setup(async (version) => version === before.id ? { version: before, updateNotice: null } : pending.promise);
    await h.controller.select(before.id); const selection = h.controller.select(after.id); h.controller.disconnect();
    pending.resolve({ version: after, updateNotice: null }); await selection;
    expect(h.controller.getState()).toMatchObject({ phase: 'idle', data: { selectedVersionId: before.id } }); h.controller.dispose();
  });
  it('ignores an older notice response and rejects changed immutable report content', async () => {
    const old = deferred<Response>(); let n = 0;
    const h = setup(async () => ++n === 2 ? old.promise : { version: before, updateNotice: n > 2 ? { latestResultVersionId: after.id, createdAt: after.createdAt } : null });
    await h.controller.select(before.id); const first = h.controller.refreshNotice(); await h.controller.refreshNotice(); old.resolve({ version: before, updateNotice: null }); await first;
    expect(h.controller.getState().data?.updateNotice?.latestResultVersionId).toBe(after.id); h.controller.dispose();
    const changed = structuredClone(before); changed.payloadHash = 'f'.repeat(64);
    let reads = 0; const invalid = setup(async () => ({ version: ++reads === 1 ? before : changed, updateNotice: null }));
    await invalid.controller.select(before.id); await invalid.controller.refreshNotice();
    expect(invalid.controller.getState()).toMatchObject({ data: { result: { payloadHash: before.payloadHash } }, error: { code: 'PROTOCOL_ERROR' } }); invalid.controller.dispose();
  });
  it('keeps a fresher V3 notice that arrives before the delayed V2 selection commits', async () => {
    const selecting = deferred<Response>(); let oldReads = 0;
    const h = setup(async (version) => version === after.id ? selecting.promise : { version: before, updateNotice: ++oldReads > 1 ? { latestResultVersionId: id(903), createdAt: after.createdAt } : null });
    await h.controller.select(before.id); const pending = h.controller.select(after.id); await h.controller.refreshNotice();
    selecting.resolve({ version: after, updateNotice: null }); await pending;
    expect(h.controller.getState()).toMatchObject({ data: { selectedVersionId: after.id, updateNotice: { latestResultVersionId: id(903) } }, noticeRefreshing: false }); h.controller.dispose();
  });
  it('ends old-version notice loading when selection commits before the notice response', async () => {
    const selecting = deferred<Response>(); const refreshing = deferred<Response>(); let reads = 0;
    const h = setup(async (version) => version === after.id ? selecting.promise : ++reads === 1 ? { version: before, updateNotice: null } : refreshing.promise);
    await h.controller.select(before.id); const selection = h.controller.select(after.id); const notice = h.controller.refreshNotice();
    selecting.resolve({ version: after, updateNotice: null }); await selection;
    refreshing.resolve({ version: before, updateNotice: null }); await notice;
    expect(h.controller.getState()).toMatchObject({ phase: 'ready', data: { selectedVersionId: after.id }, noticeRefreshing: false }); h.controller.dispose();
  });
});
