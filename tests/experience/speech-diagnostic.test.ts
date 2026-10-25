import { afterEach, expect, it, vi } from 'vitest';
import { SpeechError } from '../../src/server/companion/speech-errors.js';
import { normalizeTextToVoiceResponse, synthesizeTencentOnce } from '../../src/server/providers/tts/tencent.js';
import { speechAttempt } from '../../src/server/providers/tts/attempt.js';

// controlled_fixture only; these codes/IDs never diagnose the historical lost response.
const requestId = '90000000-0000-4000-8000-000000000001';
const providerCode = 'AuthFailure.InvalidAuthorization';
const marker = 'CONTROLLED_PRIVATE_MESSAGE_Text_headers_Authorization';
function failed(raw: unknown): SpeechError {
  try { normalizeTextToVoiceResponse(raw, 'controlled-session'); }
  catch (error) { expect(error).toBeInstanceOf(SpeechError); return error as SpeechError; }
  throw Error('Expected a controlled provider failure');
}
function response(...values: [code?: unknown, id?: unknown]) {
  const code = values.length > 0 ? values[0] : providerCode;
  const id = values.length > 1 ? values[1] : requestId;
  return { Response: { Error: { Code: code, Message: marker }, RequestId: id, Text: marker,
    headers: { Authorization: marker }, Audio: marker } };
}
afterEach(() => vi.useRealTimers());

it.each([true, false])('keeps only safe code/requestId from a known error envelope (wrapped=%s)', wrapped => {
  const raw = response(), error = failed(wrapped ? raw : raw.Response);
  expect(error).toMatchObject({ code: 'SPEECH_PROVIDER_FAILED', mayHaveProviderCost: false,
    privateDiagnostic: { providerErrorCode: providerCode, providerRequestId: requestId } });
  expect(Object.keys(error.privateDiagnostic!)).toEqual(['providerErrorCode', 'providerRequestId']);
  for (const publicView of [String(error), error.publicMessage, error.stack, JSON.stringify(error), JSON.stringify({ ...error })]) {
    expect(publicView).not.toContain(marker); expect(publicView).not.toContain(providerCode); expect(publicView).not.toContain(requestId);
  }
  expect(Object.keys(error)).not.toContain('privateDiagnostic'); expect(Object.isFrozen(error.privateDiagnostic)).toBe(true);
});
it.each(['UnsupportedOperation', 'UnsupportedOperation.NoFreeAccount', 'InvalidParameterValue.TextTooLong', 'RequestLimitExceeded.IPLimitExceeded', 'InternalError.ErrorGetRoute'])('accepts the documented Tencent error family %s', code => {
  expect(failed(response(code)).privateDiagnostic).toEqual({ providerErrorCode: code, providerRequestId: requestId });
});
it.each([undefined, null, 42, [], {}, '', 'PrivateError.Code', 'authfailure.Code', 'AuthFailure.',
  'AuthFailure.Bad_Code', 'AuthFailure.Code\n', 'AuthFailure.Code with text', 'AuthFailure.<script>',
  'AuthFailure.错误', 'AuthFailure.' + 'A'.repeat(130), 'AuthFailure.A.B.C.D'].map(code => ({ code })))('drops malformed/unknown provider code $code but retains the valid requestId', ({ code }) => {
  const error = failed(response(code));
  expect(error.privateDiagnostic).toEqual({ providerRequestId: requestId });
  expect(JSON.stringify(error)).not.toContain(marker);
});
it.each([undefined, null, 42, [], {}, '', 'not-a-uuid', 'x'.repeat(257), requestId + '\n', 'https://example.invalid/' + requestId].map(id => ({ id })))('drops malformed requestId $id but retains the valid provider code', ({ id }) => {
  expect(failed(response(providerCode, id)).privateDiagnostic).toEqual({ providerErrorCode: providerCode });
});
it.each([{}, { Error: null }, { Error: marker }, { Error: { Message: marker }, RequestId: marker },
  { Error: { Code: marker, RequestId: requestId }, requestId, code: providerCode }])('does not discover diagnostics in arbitrary or malformed fields %j', raw => {
  const error = failed({ Response: raw }); expect(error.privateDiagnostic).toBeUndefined(); expect(JSON.stringify(error)).not.toContain(marker);
});
it('preserves three-argument SpeechError callers and defensively validates the optional private argument', () => {
  const old = new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败。', true);
  expect(old).toMatchObject({ code: 'SPEECH_PROVIDER_FAILED', publicMessage: '语音合成失败。', mayHaveProviderCost: true });
  expect(old.privateDiagnostic).toBeUndefined();
  const source = { providerErrorCode: providerCode, providerRequestId: requestId, Message: marker, raw: { Text: marker } };
  const error = new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败。', false, source);
  source.providerErrorCode = 'PrivateCode.Injected';
  expect(error.privateDiagnostic).toEqual({ providerErrorCode: providerCode, providerRequestId: requestId });
  expect(new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败。', false, { providerErrorCode: marker, providerRequestId: marker }).privateDiagnostic).toBeUndefined();
});
it('does not read provider Message or diagnostic accessors or inherit values from arbitrary prototypes', () => {
  const raw = response(); let reads = 0;
  Object.defineProperty(raw.Response.Error, 'Message', { get: () => { reads++; throw Error(marker); } });
  expect(failed(raw).privateDiagnostic).toEqual({ providerErrorCode: providerCode, providerRequestId: requestId });
  const candidate = Object.create({ providerErrorCode: providerCode });
  Object.defineProperty(candidate, 'providerRequestId', { get: () => { reads++; return requestId; } });
  expect(new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败。', false, candidate).privateDiagnostic).toBeUndefined();
  expect(reads).toBe(0);
});
it('preserves validated diagnostic and uncertain cost through nested attempts with exactly one raw send', async () => {
  let calls = 0;
  const input = { text: '尚未确认。', voiceId: 'controlled-voice', speed: 0 as const, codec: 'mp3' as const };
  const voice = { id: input.voiceId, provider: 'tencent-tts' as const, voiceType: 123456789, revision: 'controlled_fixture', available: true as const };
  const pending = speechAttempt(signal => synthesizeTencentOnce(input, voice, { send: async () => { calls++; return response(); } }, signal), new AbortController().signal);
  await expect(pending).rejects.toMatchObject({ code: 'SPEECH_PROVIDER_FAILED', mayHaveProviderCost: true,
    privateDiagnostic: { providerErrorCode: providerCode, providerRequestId: requestId } });
  expect(calls).toBe(1);
});
it('preserves a pre-existing mayHaveProviderCost flag when wrapping a known error', async () => {
  const error = new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败。', true, { providerRequestId: requestId });
  await expect(speechAttempt(async () => { throw error; }, new AbortController().signal)).rejects.toMatchObject({ mayHaveProviderCost: true, privateDiagnostic: { providerRequestId: requestId } });
});
it('does not copy diagnostic-looking properties from arbitrary errors', async () => {
  const error = Object.assign(Error(marker), { privateDiagnostic: { providerErrorCode: providerCode, providerRequestId: requestId } });
  try { await speechAttempt(async () => { throw error; }, new AbortController().signal); throw Error('Expected failure'); }
  catch (caught) { expect(caught).toBeInstanceOf(SpeechError); expect((caught as SpeechError).privateDiagnostic).toBeUndefined(); expect(String(caught)).not.toContain(marker); }
});
it('revalidates a forged private property on a SpeechError instead of trusting the class identity alone', async () => {
  const error = new SpeechError('SPEECH_PROVIDER_FAILED', '语音合成失败。');
  Object.defineProperty(error, 'privateDiagnostic', { value: { providerErrorCode: marker, providerRequestId: requestId, Message: marker } });
  await expect(speechAttempt(async () => { throw error; }, new AbortController().signal)).rejects.toMatchObject({
    mayHaveProviderCost: true, privateDiagnostic: { providerRequestId: requestId },
  });
});
it('aborts before invocation with no invented diagnostic or supplier cost', async () => {
  const controller = new AbortController(); controller.abort(); let calls = 0;
  await expect(speechAttempt(async () => { calls++; return 1; }, controller.signal)).rejects.toMatchObject({ code: 'SPEECH_ABORTED', mayHaveProviderCost: false });
  try { await speechAttempt(async () => 1, controller.signal); } catch (error) { expect((error as SpeechError).privateDiagnostic).toBeUndefined(); }
  expect(calls).toBe(0);
});
it('expires before send without inventing diagnostic or supplier cost', async () => {
  let calls = 0;
  const error = await speechAttempt(async () => { calls++; return 1; }, new AbortController().signal, '1970-01-01T00:00:00.000Z').catch(error => error as SpeechError);
  expect(error).toMatchObject({ code: 'SPEECH_TIMEOUT', mayHaveProviderCost: false });
  expect((error as SpeechError).privateDiagnostic).toBeUndefined(); expect(calls).toBe(0);
});
it('cancels an invoked attempt without copying a late response diagnostic or retrying', async () => {
  const controller = new AbortController(); let calls = 0, rejectLate!: (error: unknown) => void, started!: () => void;
  const didStart = new Promise<void>(resolve => { started = resolve; });
  const pending = speechAttempt<never>(() => { calls++; started(); return new Promise((_resolve, reject) => { rejectLate = reject; }); }, controller.signal);
  const checked = pending.catch(error => error as SpeechError); await didStart; controller.abort();
  const error = await checked; expect(error).toMatchObject({ code: 'SPEECH_ABORTED', mayHaveProviderCost: true }); expect(error.privateDiagnostic).toBeUndefined();
  rejectLate(failed(response())); await Promise.resolve(); expect(error.privateDiagnostic).toBeUndefined(); expect(calls).toBe(1);
});
it('times out once with uncertain cost, no invented response metadata and no remaining timer', async () => {
  vi.useFakeTimers(); let calls = 0;
  const checked = speechAttempt<never>(() => { calls++; return new Promise(() => {}); }, new AbortController().signal).catch(error => error as SpeechError);
  await vi.advanceTimersByTimeAsync(20001); const error = await checked;
  expect(error).toMatchObject({ code: 'SPEECH_TIMEOUT', mayHaveProviderCost: true }); expect(error.privateDiagnostic).toBeUndefined(); expect(calls).toBe(1); expect(vi.getTimerCount()).toBe(0);
});
it('keeps the successful audio path and its actual receipt untouched by private error metadata', async () => {
  let calls = 0;
  const bytes = new Uint8Array([255, 251, 144, 100, 1, 2, 3, 4]); // controlled signature only, not playback acceptance.
  const audio = normalizeTextToVoiceResponse({ Response: { Audio: Buffer.from(bytes).toString('base64'), SessionId: 'controlled-session', RequestId: requestId } }, 'controlled-session');
  expect(audio.audioBytes).toEqual(bytes); expect(audio.providerRequestId).toBe(requestId); expect(audio).not.toHaveProperty('privateDiagnostic');
  expect(await speechAttempt(async () => { calls++; return audio; }, new AbortController().signal)).toBe(audio); expect(calls).toBe(1);
});
