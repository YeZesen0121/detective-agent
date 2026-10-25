import { createHash, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import sharp from 'sharp';
import { expect, it } from 'vitest';
import { createSpeechSynthesizer } from '../../src/server/companion/speech-persistent.js';
import type { SpeechBinding } from '../../src/server/companion/speech-ports.js';
import type { SpeechInput, TTSResponse } from '../../src/shared/ports.js';
import { createMediaScenario } from '../fixtures/media-e/scenarios.js';
import { controlledModel } from './companion-fixture.js';
import manifest from '../fixtures/media-e/manifest.json' with { type: 'json' };

// controlled_fixture: a locally generated musical tone, NOT a Chinese TTS listening sample.
const audio = readFileSync(new URL('../fixtures/media-e/audio/offline-tone.mp3', import.meta.url));
const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const receipt = (): TTSResponse => ({ audioBytes: new Uint8Array(audio), contentType: 'audio/mpeg', providerRequestId: 'controlled_fixture', billedCharacters: null, usage: null });
function fixture(text: string) {
  const f = createMediaScenario('insufficient-report'); if (f.kind !== 'companion') throw Error('fixture');
  const segment = f.turn.session.segments[0]!; segment.text = text;
  const input: SpeechInput = { context: f.input.context, resultVersionId: f.input.version.id, companionSessionId: f.turn.session.id, segmentId: segment.id, text, voiceId: 'controlled-tone', speed: 0 };
  const binding: SpeechBinding = { ownerSessionId: input.context.sessionId, accessGroup: input.context.accessGroup, version: f.input.version, companion: f.turn.session,
    voice: { id: input.voiceId, provider: 'tencent-tts', voiceType: 123456789, revision: 'controlled_fixture_not_real_voice', available: true } };
  const { services } = controlledModel({}), texts: string[] = [], receipts: TTSResponse[] = [], saved: { index: number; assetId: string }[] = [];
  services.tts = async request => { texts.push(request.text); const value = receipt(); receipts.push(value); return value; };
  services.audio = { jobId: randomUUID(), saveChunk: async (index, value) => {
    // The test adapter acts as a storage acknowledgement. These IDs never enter production.
    expect(value).toBe(receipts[index]); expect(hash(value.audioBytes)).toBe(manifest.audio.sha256);
    const ack = { index, assetId: randomUUID() }; saved.push(ack); return ack;
  } };
  const synthesize = createSpeechSynthesizer(async () => binding);
  return { input, services, texts, saved, receipts, synthesize };
}
it('owned MP3 and PNG assets match their manifest; binary capture identity differs from extracted text identity', async () => {
  expect(hash(audio)).toBe(manifest.audio.sha256); expect(audio.byteLength).toBe(manifest.audio.byteLength);
  for (const entry of manifest.images) {
    const bytes = readFileSync(new URL(`../fixtures/media-e/${entry.path}`, import.meta.url));
    expect(hash(bytes)).toBe(entry.sha256); expect(entry.sha256).not.toBe(entry.extractedTextSha256);
    const f = createMediaScenario(entry.caseId as Parameters<typeof createMediaScenario>[0]); if (f.kind !== 'extraction') throw Error('fixture');
    expect(hash(f.images.find(i => i.path === entry.path)!.text)).toBe(entry.extractedTextSha256);
    const image = await sharp(bytes).metadata(); expect(image).toMatchObject({ format: 'png', width: 960, height: 400 });
  }
});
it.each([
  '字'.repeat(149) + '。',
  '字'.repeat(147) + '😀。' + '\n截至2026-10-30，尚未确认；仅限广州校区，不适用于其他地区。',
  '截至2026-10-30，尚未确认延期。\n不适用于2027届；仅限广州校区。'.repeat(8),
])('uses the original factory and receipt while preserving each character across bounded chunks', async text => {
  const f = fixture(text), result = await f.synthesize(f.input, f.services, new AbortController().signal);
  expect(result.status).toBe('ready'); expect(result.chunks).toEqual(f.saved.map(a => ({ ...a, status: 'ready' })));
  expect(f.texts.join('').replace(/\s/gu, '')).toBe(text.replace(/\s/gu, ''));
  expect(f.texts.every(t => t.length <= 150 && Buffer.from(t).toString('utf8') === t)).toBe(true);
  expect(result.chunks.map(c => c.index)).toEqual(f.texts.map((_, i) => i));
});
it('rejects an unsplittable 151 unit sentence without billing or saving instead of clipping its final limitation', async () => {
  const actual = fixture('字'.repeat(148) + '不适用');
  await expect(actual.synthesize(actual.input, actual.services, new AbortController().signal)).rejects.toMatchObject({ code: 'SPEECH_SENTENCE_TOO_LONG' });
  expect(actual.texts).toEqual([]); expect(actual.saved).toEqual([]);
});
const longText = '尚未确认延期，仅限广州校区，不代表其他地区。'.repeat(20);
it('abort after the first successful save retains that acknowledged chunk and does not send chunk two', async () => {
  const f = fixture(longText), c = new AbortController(), save = f.services.audio!.saveChunk;
  f.services.audio!.saveChunk = async (index, value) => { const ack = await save(index, value); c.abort(); return ack; };
  const result = await f.synthesize(f.input, f.services, c.signal);
  expect(result.status).toBe('cancelled'); expect(result.error).toBe('SPEECH_ABORTED'); expect(f.texts).toHaveLength(1);
  expect(result.chunks).toEqual([{ ...f.saved[0], status: 'ready' }]);
});
it('second chunk provider failure retains the first but never publishes ready or retries unknown', async () => {
  const f = fixture(longText), tts = f.services.tts; let calls = 0;
  f.services.tts = async (...args) => { if (++calls === 2) throw Error('PRIVATE_UNKNOWN_BILLING'); return tts(...args); };
  const result = await f.synthesize(f.input, f.services, new AbortController().signal);
  expect(result).toMatchObject({ status: 'partial', chunks: [{ ...f.saved[0], status: 'ready' }], error: 'SPEECH_PROVIDER_FAILED' });
  expect(calls).toBe(2); expect(JSON.stringify(result)).not.toContain('PRIVATE_UNKNOWN_BILLING');
});
it.each(['failed', 'cancelled'] as const)('empty %s manifest has a safe error and never fabricates a chunk', async expected => {
  const f = fixture(longText), c = new AbortController(); let calls = 0;
  f.services.tts = async () => { calls++; if (expected === 'cancelled') c.abort(); throw Error('PRIVATE_PROVIDER_DETAIL'); };
  const result = await f.synthesize(f.input, f.services, c.signal);
  expect(result).toMatchObject({ status: expected, chunks: [], error: expected === 'cancelled' ? 'SPEECH_ABORTED' : 'SPEECH_PROVIDER_FAILED' });
  expect(calls).toBe(1); expect(f.saved).toEqual([]);
});
it('unknown storage acknowledgement stops without resending or claiming a saved asset', async () => {
  const f = fixture(longText); f.services.audio!.saveChunk = async () => { throw Error('UNKNOWN_COMMIT_PRIVATE_PATH'); };
  const result = await f.synthesize(f.input, f.services, new AbortController().signal);
  expect(result).toMatchObject({ status: 'failed', chunks: [], error: 'SPEECH_STORAGE_FAILED' }); expect(f.texts).toHaveLength(1);
});
