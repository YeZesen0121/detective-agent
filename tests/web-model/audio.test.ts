import { describe, expect, it } from 'vitest';
import type { AudioManifest } from '../../src/shared/contracts.js';
import { createAudioController, type AudioDriver } from '../../src/web/controllers/audio.js';
import { deferred, id } from './fixtures.js';

function manifest(n = 1): AudioManifest {
  return { jobId: id(n), status: 'ready', chunks: [0, 1, 2].map((index) => ({ index, assetId: id(100 + index), status: 'ready' })), error: null };
}
function driver() {
  const starts: string[] = [];
  const pending: ReturnType<typeof deferred<void>>[] = [];
  const signals: AbortSignal[] = [];
  let stops = 0;
  const value: AudioDriver = {
    play: async (assetId, signal) => { starts.push(assetId); signals.push(signal); const item = deferred<void>(); pending.push(item); return item.promise; },
    stop: () => { stops++; },
  };
  return { value, starts, pending, signals, get stops() { return stops; } };
}
const flush = async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); };

describe('audio controller with strict fake driver (controlled_fixture)', () => {
  it('does nothing until explicit play and plays chunks by index, awaiting completion before each next chunk', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    expect(fake.starts).toEqual([]);
    expect(controller.getState()).toMatchObject({ epoch: 0, jobId: null, chunkIndex: null, status: 'idle', error: null });
    const input = manifest(); input.chunks.reverse();
    const playback = controller.play(input);
    expect(fake.starts).toEqual([id(100)]);
    expect(controller.getState()).toMatchObject({ status: 'playing', chunkIndex: 0 });
    fake.pending[0]!.resolve(); await flush(); expect(fake.starts).toEqual([id(100), id(101)]);
    fake.pending[1]!.resolve(); await flush(); expect(fake.starts).toEqual([id(100), id(101), id(102)]);
    fake.pending[2]!.resolve(); await playback;
    expect(controller.getState()).toMatchObject({ status: 'idle', chunkIndex: null });
  });
  it('stop immediately stops the driver, aborts IO, and late completion never advances the old queue', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    const playback = controller.play(manifest()); const stops = fake.stops;
    controller.stop(); expect(fake.stops).toBe(stops + 1); expect(fake.signals[0]!.aborted).toBe(true);
    expect(controller.getState()).toMatchObject({ status: 'stopped', chunkIndex: null });
    fake.pending[0]!.resolve(); await playback;
    expect(fake.starts).toEqual([id(100)]);
    expect(controller.getState().status).toBe('stopped');
  });
  it('rapid repeated play replaces the chain and ignores both late resolution and rejection', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    const first = controller.play(manifest(1));
    const second = controller.play(manifest(2));
    expect(fake.signals[0]!.aborted).toBe(true);
    expect(controller.getState()).toMatchObject({ jobId: id(2), status: 'playing', chunkIndex: 0 });
    fake.pending[0]!.reject(Error('old failure')); await first;
    expect(controller.getState()).toMatchObject({ jobId: id(2), status: 'playing', error: null });
    fake.pending[1]!.resolve(); await flush();
    expect(fake.starts).toEqual([id(100), id(100), id(101)]);
    controller.stop(); fake.pending[2]!.resolve(); await second;
  });
  it('an async manifest captured before stop or another request cannot revive audio', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    const late = deferred<AudioManifest>();
    const epoch = controller.getState().epoch;
    const request = late.promise.then((value) => controller.play(value, epoch));
    controller.stop(); late.resolve(manifest()); await request;
    expect(fake.starts).toEqual([]); expect(controller.getState().status).toBe('stopped');
  });
  it('a current epoch admits a prepared manifest, but later user clicks invalidate it', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    controller.stop(); const requestEpoch = controller.getState().epoch;
    const playback = controller.play(manifest(), requestEpoch);
    expect(fake.starts).toEqual([id(100)]);
    controller.stop(); fake.pending[0]!.resolve(); await playback;
    await controller.play(manifest(), requestEpoch);
    expect(fake.starts).toEqual([id(100)]);
  });
  it('a chunk failure keeps safe error state and prevents later chunks without touching text models', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    const input = manifest(); const before = structuredClone(input);
    const playback = controller.play(input);
    fake.pending[0]!.reject(Error('cookie=secret')); await playback;
    expect(controller.getState()).toMatchObject({ status: 'failed', jobId: id(1), error: { code: 'AUDIO_FAILED' } });
    expect(JSON.stringify(controller.getState())).not.toContain('secret');
    expect(fake.starts).toEqual([id(100)]); expect(input).toEqual(before);
  });
  it.each([
    { ...manifest(), chunks: [] },
    { ...manifest(), chunks: [{ index: 1, assetId: id(101), status: 'ready' }] },
    { ...manifest(), chunks: [{ index: 0, assetId: id(100), status: 'ready' }, { index: 0, assetId: id(101), status: 'ready' }] },
    { ...manifest(), status: 'generating' },
    { ...manifest(), chunks: [{ index: 0, assetId: '../secret', status: 'ready' }] },
  ] as AudioManifest[])('rejects malformed/unready manifests without starting a driver chain', async (input) => {
    const fake = driver(); const controller = createAudioController(fake.value);
    await controller.play(input);
    expect(controller.getState().status).toBe('failed'); expect(fake.starts).toEqual([]);
  });
  it('plays only the contiguous ready prefix of a partial manifest, and surfaces the missing chunk', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    const input = manifest(); input.status = 'partial'; input.chunks[1]!.status = 'failed';
    const playback = controller.play(input);
    fake.pending[0]!.resolve(); await playback;
    expect(fake.starts).toEqual([id(100)]);
    expect(controller.getState()).toMatchObject({ status: 'failed', chunkIndex: 1, error: { code: 'AUDIO_FAILED' } });
  });
  it('dispose prevents all future playback including late manifests and notifies subscribers', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    let updates = 0; const unsubscribe = controller.subscribe(() => updates++);
    const playback = controller.play(manifest());
    controller.dispose(); const before = updates; unsubscribe();
    fake.pending[0]!.resolve(); await playback; await controller.play(manifest());
    expect(fake.starts).toEqual([id(100)]); expect(controller.getState().status).toBe('stopped');
    expect(updates).toBe(before); expect(updates).toBeGreaterThan(0);
    expect(() => { controller.getState().status = 'playing'; }).toThrow();
  });
  it('dispose locks playback before publishing its final notification to reentrant subscribers', async () => {
    const fake = driver(); const controller = createAudioController(fake.value);
    const playback = controller.play(manifest());
    const replays: Promise<void>[] = [];
    controller.subscribe(() => {
      if (controller.getState().status === 'stopped') replays.push(controller.play(manifest(2)));
    });
    controller.dispose();
    expect(fake.starts).toEqual([id(100)]);
    expect(controller.getState().status).toBe('stopped');
    fake.pending.forEach((item) => item.resolve());
    await Promise.all([playback, ...replays]);
  });
});
