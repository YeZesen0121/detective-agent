import { AudioManifestSchema, type AudioManifest } from '../../shared/contracts.js';
import { ClientError, parseInput, safeError, type SafeError } from '../api/client.js';
import { snapshot } from '../model/snapshot.js';

export interface AudioDriver {
  /** Resolves when this chunk finishes, not when bytes are merely loaded. Must honor abort/stop. */
  play(assetId: string, signal: AbortSignal): Promise<void>;
  /** Synchronously stops playback and releases current browser resources. */
  stop(): void;
}
export interface AudioPlaybackState {
  epoch: number; jobId: string | null; chunkIndex: number | null;
  status: 'idle' | 'playing' | 'stopped' | 'failed'; error: SafeError | null;
}
export interface AudioController {
  /** For async synthesis: stop(), capture getState().epoch, then pass that epoch with the response. */
  play(manifest: AudioManifest, expectedEpoch?: number): Promise<void>;
  stop(): void;
  dispose(): void;
  getState(): AudioPlaybackState;
  subscribe(listener: () => void): () => void;
}
export function createAudioController(driver: AudioDriver): AudioController {
  let state: AudioPlaybackState = snapshot({ epoch: 0, jobId: null, chunkIndex: null, status: 'idle', error: null });
  let io: AbortController | null = null;
  let disposed = false;
  const listeners = new Set<() => void>();
  const failure = () => new ClientError('AUDIO_FAILED', '朗读未完成，文字仍可阅读，请重试。');
  function update(patch: Partial<AudioPlaybackState>) {
    state = snapshot({ ...state, ...patch });
    for (const listener of [...listeners]) {
      try { listener(); } catch { /* rendering errors belong to the observer */ }
    }
  }
  function halt(): boolean {
    io?.abort(); io = null;
    try { driver.stop(); return true; } catch { return false; }
  }
  function stopCurrent() {
    const epoch = state.epoch + 1;
    const stopped = halt();
    update({ epoch, jobId: null, chunkIndex: null, status: stopped ? 'stopped' : 'failed', error: stopped ? null : safeError(failure()) });
  }
  function stop() { if (!disposed) stopCurrent(); }
  return {
    async play(manifest, expectedEpoch) {
      if (disposed || (expectedEpoch !== undefined && expectedEpoch !== state.epoch)) return;
      const epoch = state.epoch + 1;
      const stopped = halt();
      update({ epoch, jobId: null, chunkIndex: null, status: 'idle', error: null });
      if (disposed || epoch !== state.epoch) return;
      if (!stopped) { update({ status: 'failed', error: safeError(failure()) }); return; }
      const controller = new AbortController(); io = controller;
      const current = () => !disposed && state.epoch === epoch && !controller.signal.aborted;
      try {
        const parsed = parseInput(AudioManifestSchema, manifest);
        const chunks = [...parsed.chunks].sort((a, b) => a.index - b.index);
        if (!['ready', 'partial'].includes(parsed.status) || chunks.length === 0
          || chunks.some((chunk, index) => chunk.index !== index)) throw failure();
        update({ jobId: parsed.jobId });
        for (const chunk of chunks) {
          if (!current()) return;
          update({ chunkIndex: chunk.index });
          if (!current()) return;
          if (chunk.status !== 'ready') throw failure();
          update({ status: 'playing' });
          if (!current()) return;
          await driver.play(chunk.assetId, controller.signal);
        }
        if (!current()) return;
        if (parsed.status === 'partial') throw failure();
        io = null;
        update({ status: 'idle', chunkIndex: null });
      } catch (error) {
        if (!current()) return;
        halt();
        update({ status: 'failed', error: safeError(error instanceof ClientError && error.code === 'AUDIO_FAILED' ? error : failure()) });
      }
    },
    stop,
    dispose() {
      if (disposed) return;
      disposed = true; stopCurrent(); listeners.clear();
    },
    getState: () => state,
    subscribe(listener) {
      if (!disposed) listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
  };
}
