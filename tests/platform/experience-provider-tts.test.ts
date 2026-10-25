import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { createTencentSpeechProvider } from '../../src/server/platform/experience-tts-provider.js';
const voice = { id: 'zh-male-zhike', provider: 'tencent-tts' as const, voiceType: 101030, revision: 'tencent-basic-2026-10-09', available: true as const };
const ctx = { sessionId: randomUUID(), accessGroup: 'trial' as const, investigationId: randomUUID(), runId: null, budgetWindowId: null, interactionPoolId: randomUUID(), watchCheckId: null, epoch: 1, watchLeaseEpoch: null, deadlineAt: new Date(Date.now() + 60000).toISOString() };
const credentials = { secretId: 'controlled_fixture_id', secretKey: 'controlled_fixture_key' };
const request = { text: '截至目前仍不确定；请核对来源。', voiceId: voice.id, speed: 0 as const, codec: 'mp3' as const };
const audio = readFileSync('tests/fixtures/media-e/audio/offline-tone.mp3');
it('sends one TC3 signed basic TextToVoice request matching the locked official SDK signature', async () => {
  let calls = 0, init: RequestInit | undefined, body: any, target: unknown;
  const timestamp = 1551113065; // UTC date differs from Asia/Shanghai date.
  const provider = createTencentSpeechProvider({ ...credentials, voices: [voice], now: () => timestamp * 1000, fetch: async (url, options) => {
    calls++; target = url; init = options; body = JSON.parse(String(options?.body));
    return Response.json({ Response: { SessionId: body.SessionId, Audio: audio.toString('base64'), RequestId: 'controlled_fixture_tts' } });
  } });
  const result = await provider(request, ctx, new AbortController().signal);
  expect(calls).toBe(1); expect(target).toBe('https://tts.tencentcloudapi.com/'); expect(init!.redirect).toBe('error');
  expect(body).toMatchObject({ Text: request.text, VoiceType: 101030, Speed: 0, Codec: 'mp3' }); expect(body.SessionId).toMatch(/^[0-9a-f-]{36}$/);
  const headers = new Headers(init!.headers);
  expect(headers.get('X-TC-Action')).toBe('TextToVoice'); expect(headers.get('X-TC-Version')).toBe('2019-08-23'); expect(headers.get('X-TC-Timestamp')).toBe(String(timestamp));
  expect(headers.get('Authorization')).toContain('/2019-02-25/tts/tc3_request');
  // The installed WSA dependency locks this official SDK signer; used as an independent test oracle only.
  const require = createRequire(import.meta.url), Sign = require('tencentcloud-sdk-nodejs-common/tencentcloud/common/sign.js').default;
  const expected = Sign.sign3({ method: 'POST', url: 'https://tts.tencentcloudapi.com/', payload: Buffer.from(String(init!.body)), timestamp, service: 'tts', ...credentials, headers: { 'Content-Type': 'application/json; charset=utf-8' } });
  expect(headers.get('Authorization')).toBe(expected);
  expect(Buffer.from(result.audioBytes)).toEqual(audio); expect(result.providerRequestId).toBe('controlled_fixture_tts');
  expect(result.billedCharacters).toBe(request.text.length); expect(result.usage).toBeNull(); // request upper bound, not provider invoice
});
it('rejects an unavailable voice or an aborted request before sending and never retries a provider error', async () => {
  let calls = 0; const provider = createTencentSpeechProvider({ ...credentials, voices: [voice], fetch: async () => { calls++; return Response.json({ Response: { Error: { Code: 'AuthFailure', Message: 'controlled_fixture_private_message' }, RequestId: 'controlled_fixture' } }); } });
  await expect(provider({ ...request, voiceId: 'unconfigured_voice' }, ctx, new AbortController().signal)).rejects.toThrow(); expect(calls).toBe(0);
  const stopped = new AbortController(); stopped.abort(); await expect(provider(request, ctx, stopped.signal)).rejects.toThrow(); expect(calls).toBe(0);
  await expect(provider(request, ctx, new AbortController().signal)).rejects.toMatchObject({ code: 'SPEECH_PROVIDER_FAILED' }); expect(calls).toBe(1);
});
it('rejects mismatched response sessions and masks network errors without logging private fields', async () => {
  let calls = 0;
  const bad = createTencentSpeechProvider({ ...credentials, voices: [voice], fetch: async () => { calls++; return Response.json({ Response: { SessionId: 'wrong', Audio: audio.toString('base64'), RequestId: 'controlled_fixture' } }); } });
  await expect(bad(request, ctx, new AbortController().signal)).rejects.toMatchObject({ code: 'SPEECH_INVALID_AUDIO' }); expect(calls).toBe(1);
  const network = createTencentSpeechProvider({ ...credentials, voices: [voice], fetch: async () => { throw Error('controlled_fixture_private_message'); } });
  await expect(network(request, ctx, new AbortController().signal)).rejects.toMatchObject({ code: 'SPEECH_PROVIDER_FAILED' });
});
it('rejects audio larger than the platform private chunk cap before handing a successful receipt to storage', async () => {
  const huge = Buffer.alloc(2 * 1024 * 1024 + 1); huge.write('ID3'); let calls = 0;
  const provider = createTencentSpeechProvider({ ...credentials, voices: [voice], fetch: async (_url, init) => { calls++; const body = JSON.parse(String(init?.body)); return Response.json({ Response: { SessionId: body.SessionId, Audio: huge.toString('base64'), RequestId: 'controlled_fixture' } }); } });
  const outcome = await provider(request, ctx, new AbortController().signal).then(() => 'accepted', error => error.code);
  expect(outcome).toBe('SPEECH_INVALID_AUDIO'); expect(calls).toBe(1);
});
