import { createHash, randomUUID } from 'node:crypto';
import { afterEach, expect, it, vi } from 'vitest';
import { TTSRequestSchema, type SpeechInput, type TTSResponse } from '../../src/shared/ports.js';
import { prepareSpeechPlan, splitSpeechText, synthesizeSegment, synthesizeSpeechChunk, type SpeechPlan } from '../../src/server/companion/speech.js';
import type { SpeechBinding } from '../../src/server/companion/speech-ports.js';
import { normalizeTextToVoiceResponse, synthesizeTencentOnce, type TextToVoiceTransport } from '../../src/server/providers/tts/tencent.js';
import { companionCase, controlledModel } from './companion-fixture.js';

// controlled_fixture only: header-shaped bytes exercise validation/transport, NOT playable audio.
// No audio file, audible sound, assetId or successful product playback is created by these tests.
const CONTROLLED_BYTES = new Uint8Array([0xff, 0xfb, 0x90, 0x64, 1, 2, 3, 4]);
const response = (): TTSResponse => ({ audioBytes: CONTROLLED_BYTES.slice(), contentType: 'audio/mpeg', providerRequestId: 'controlled-request', billedCharacters: null, usage: null });
function speechCase(text = '截至10月24日，尚未确认延期。仅限广州校区，不适用于其他校区。') {
  const f = companionCase(); const segment = f.turn.session.segments[1]!; segment.text = text;
  const input: SpeechInput = { context: f.input.context, resultVersionId: f.input.version.id,
    companionSessionId: f.turn.session.id, segmentId: segment.id, text, voiceId: 'controlled-voice', speed: 0 };
  const binding: SpeechBinding = { ownerSessionId: input.context.sessionId, accessGroup: input.context.accessGroup,
    version: f.input.version, companion: f.turn.session,
    voice: { id: 'controlled-voice', provider: 'tencent-tts', voiceType: 123456789, revision: 'controlled-only-not-a-real-voice', available: true } };
  return { input, binding };
}
afterEach(() => vi.useRealTimers());

it('splits at complete sentence boundaries without deleting negatives, dates or conditions', () => {
  const unit = '截至2026年10月24日，未确认延期，仅限广州校区，不适用于其他校区。';
  const chunks = splitSpeechText(unit.repeat(12));
  expect(chunks.length).toBeGreaterThan(1); expect(chunks.join('')).toBe(unit.repeat(12));
  expect(chunks.every(text => text.length <= 150 && text.endsWith('。'))).toBe(true);
  expect(chunks.every(text => TTSRequestSchema.safeParse({text,voiceId:'controlled-voice',speed:0,codec:'mp3'}).success)).toBe(true);
});
it('preserves mixed-language whitespace within sentences and does not split surrogate pairs', () => {
  const sentence = '😀 This is not confirmed. 请不要省略“不确定”。';
  const chunks = splitSpeechText(sentence.repeat(10));
  expect(chunks.join('').replace(/\s/gu,'')).toBe(sentence.repeat(10).replace(/\s/gu,''));
  expect(chunks.every(text => Buffer.from(text).toString('utf8') === text && text.length <= 150)).toBe(true);
});
it('accepts exactly 150 characters but rejects one overlong unsplittable sentence', () => {
  expect(splitSpeechText('字'.repeat(149)+'。')).toEqual(['字'.repeat(149)+'。']);
  expect(() => splitSpeechText('字'.repeat(150)+'。')).toThrow();
});
it.each(['', '   ', '<speak>不要忽略限定</speak>', '不确定\u0000', '\ud800'])('rejects unsafe or empty speech text %j', text => {
  expect(() => splitSpeechText(text)).toThrow(/语音|分段|文本/);
});

it('creates a content and owner bound plan using exact server saved text, never audio IDs', () => {
  const f = speechCase(); const plan = prepareSpeechPlan(f.input, f.binding);
  expect(plan.textHash).toBe(createHash('sha256').update(f.input.text).digest('hex'));
  expect(plan.chunks[0]!.text).toBe(f.input.text); expect(plan.chunks[0]!.index).toBe(0);
  expect(Object.isFrozen(plan)).toBe(true); expect(Object.isFrozen(plan.chunks)).toBe(true);
  expect('assetId' in plan).toBe(false); expect('jobId' in plan).toBe(false);
});
it.each(['owner','group','case','version','companion','segment','text','voice'] as const)('rejects %s binding mismatch before synthesis', field => {
  const f = speechCase();
  if (field === 'owner') f.binding.ownerSessionId = randomUUID();
  if (field === 'group') f.binding.accessGroup = 'demo';
  if (field === 'case') f.input.context.investigationId = randomUUID();
  if (field === 'version') f.input.resultVersionId = randomUUID();
  if (field === 'companion') f.input.companionSessionId = randomUUID();
  if (field === 'segment') f.input.segmentId = randomUUID();
  if (field === 'text') f.input.text = '已经确定延期';
  if (field === 'voice') f.input.voiceId = 'not-configured';
  expect(() => prepareSpeechPlan(f.input, f.binding)).toThrow(/绑定|报告|归属|音色|段落|会话|文字/);
});
it('varies cache identity with owner, voice revision and saved version', () => {
  const f = speechCase(); const initial = prepareSpeechPlan(f.input, f.binding).cacheKey;
  const otherOwner = structuredClone(f); otherOwner.input.context.sessionId = randomUUID(); otherOwner.binding.ownerSessionId = otherOwner.input.context.sessionId;
  expect(prepareSpeechPlan(otherOwner.input, otherOwner.binding).cacheKey).not.toBe(initial);
  const voice = structuredClone(f); voice.binding.voice.revision = 'new-revision';
  expect(prepareSpeechPlan(voice.input, voice.binding).cacheKey).not.toBe(initial);
  const version = structuredClone(f); version.input.resultVersionId = randomUUID(); version.binding.version.id = version.input.resultVersionId; version.binding.companion.resultVersionId = version.input.resultVersionId;
  expect(prepareSpeechPlan(version.input, version.binding).cacheKey).not.toBe(initial);
});

it('invokes TTS once with fixed speed/codec, returns only private bytes, and refuses a duplicate attempt', async () => {
  const f = speechCase(); const plan = prepareSpeechPlan(f.input, f.binding); let calls = 0;
  const { services } = controlledModel({});
  services.tts = async (request, context) => { calls++; expect(request).toEqual({text:f.input.text,voiceId:'controlled-voice',speed:0,codec:'mp3'}); expect(context.sessionId).toBe(f.input.context.sessionId); return response(); };
  const result = await synthesizeSpeechChunk(plan, 0, services, new AbortController().signal);
  expect(calls).toBe(1); expect(result.audio.audioBytes).toEqual(CONTROLLED_BYTES); expect('assetId' in result).toBe(false);
  await expect(synthesizeSpeechChunk(plan, 0, services, new AbortController().signal)).rejects.toThrow();
  expect(calls).toBe(1);
});
it('preserves the exact authorized TTS receipt object for P persistence while validating its bytes', async () => {
  const f = speechCase(), plan = prepareSpeechPlan(f.input, f.binding), receipt = response();
  const { services } = controlledModel({}); services.tts = async () => receipt;
  const result = await synthesizeSpeechChunk(plan, 0, services, new AbortController().signal);
  expect(result.audio).toBe(receipt); expect(result.audio.audioBytes).toBe(receipt.audioBytes);
});
it.each(['empty','mime','non-audio'] as const)('rejects %s audio, never retries and stops further chunks', async problem => {
  const f = speechCase('尚未确认延期。'.repeat(30)); const plan = prepareSpeechPlan(f.input,f.binding); let calls = 0;
  const { services } = controlledModel({}); services.tts = async () => { calls++; const audio = response();
    if (problem === 'empty') audio.audioBytes = new Uint8Array();
    if (problem === 'mime') Object.assign(audio, {contentType:'audio/wav'});
    if (problem === 'non-audio') audio.audioBytes = new TextEncoder().encode('PRIVATE_PROVIDER_ERROR');
    return audio;
  };
  await expect(synthesizeSpeechChunk(plan,0,services,new AbortController().signal)).rejects.toThrow();
  await expect(synthesizeSpeechChunk(plan,1,services,new AbortController().signal)).rejects.toThrow(); expect(calls).toBe(1);
});
it('does not accept a forged plan or invalid chunk index', async () => {
  const f = speechCase(); const plan = prepareSpeechPlan(f.input,f.binding); let calls = 0;
  const { services } = controlledModel({}); services.tts = async () => {calls++;return response();};
  await expect(synthesizeSpeechChunk({...plan} as SpeechPlan,0,services,new AbortController().signal)).rejects.toThrow();
  await expect(synthesizeSpeechChunk(plan,99,services,new AbortController().signal)).rejects.toThrow(); expect(calls).toBe(0);
});
it('aborts before send without a TTS call', async () => {
  const f = speechCase(); const plan = prepareSpeechPlan(f.input,f.binding); let calls = 0;
  const { services } = controlledModel({}); services.tts = async () => {calls++;return response();};
  const controller = new AbortController(); controller.abort();
  await expect(synthesizeSpeechChunk(plan,0,services,controller.signal)).rejects.toMatchObject({code:'SPEECH_ABORTED',mayHaveProviderCost:false});
  expect(calls).toBe(0);
});
it('rejects late cancelled TTS and blocks the rest even if provider ignores abort', async () => {
  const f = speechCase('尚未确认延期。'.repeat(30)); const plan = prepareSpeechPlan(f.input,f.binding);
  let started!:()=>void; let finish!:(r:TTSResponse)=>void; const didStart = new Promise<void>(r=>{started=r;});
  const { services } = controlledModel({}); let calls = 0;
  services.tts = () => {calls++;started();return new Promise(r=>{finish=r;});};
  const controller = new AbortController(); const pending = synthesizeSpeechChunk(plan,0,services,controller.signal);
  const assertion = expect(pending).rejects.toMatchObject({code:'SPEECH_ABORTED',mayHaveProviderCost:true});
  await didStart; controller.abort(); await assertion; finish(response());
  await expect(synthesizeSpeechChunk(plan,1,services,new AbortController().signal)).rejects.toThrow(); expect(calls).toBe(1);
});
it('times out once, aborts the service signal and reports uncertain cost without retries', async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-10-25T00:00:00.000Z'));
  const f = speechCase(); const plan = prepareSpeechPlan(f.input,f.binding); let calls = 0; let serviceSignal: AbortSignal | undefined;
  const { services } = controlledModel({}); services.tts = (_r,_c,signal) => {calls++;serviceSignal=signal;return new Promise(()=>{});};
  const pending = synthesizeSpeechChunk(plan,0,services,new AbortController().signal);
  const assertion = expect(pending).rejects.toMatchObject({code:'SPEECH_TIMEOUT',mayHaveProviderCost:true});
  await vi.advanceTimersByTimeAsync(20001); await assertion;
  expect(calls).toBe(1); expect(serviceSignal?.aborted).toBe(true); expect(vi.getTimerCount()).toBe(0);
});
it('sanitizes provider errors and never manufactures a playable manifest without storage', async () => {
  const f = speechCase(); let calls = 0; const { services } = controlledModel({});
  services.tts=async()=>{calls++;throw new Error('PRIVATE_PROVIDER_SECRET');};
  await expect(synthesizeSegment(f.input,services,new AbortController().signal)).rejects.toMatchObject({code:'SPEECH_STORAGE_UNAVAILABLE',mayHaveProviderCost:false});
  expect(calls).toBe(0);
  const plan=prepareSpeechPlan(f.input,f.binding);
  try {await synthesizeSpeechChunk(plan,0,services,new AbortController().signal);throw new Error('must fail');}
  catch(error){expect(String(error)).not.toContain('PRIVATE_PROVIDER_SECRET');expect(String(error)).toMatch(/语音|合成/);}
  expect(calls).toBe(1);
});

it('normalizes direct and Response-wrapped Tencent audio without inventing usage or assets', () => {
  for (const wrapped of [false,true]) {
    const data={Audio:Buffer.from(CONTROLLED_BYTES).toString('base64'),SessionId:'controlled-session',RequestId:'controlled-request'};
    const audio=normalizeTextToVoiceResponse(wrapped?{Response:data}:data,'controlled-session');
    expect(audio.audioBytes).toEqual(CONTROLLED_BYTES);expect(audio.contentType).toBe('audio/mpeg');
    expect(audio.billedCharacters).toBeNull();expect(audio.usage).toBeNull();expect('assetId' in audio).toBe(false);
  }
});
it('handles bounded larger base64 audio without recursive regex overflow', () => {
  const bytes=Buffer.alloc(512*1024);bytes.set(CONTROLLED_BYTES);
  const audio=normalizeTextToVoiceResponse({Audio:bytes.toString('base64'),SessionId:'controlled-session',RequestId:'controlled-request'},'controlled-session');
  expect(audio.audioBytes.byteLength).toBe(512*1024);
});
it.each(['bad-base64','empty','wrong-session','provider-error','wav'] as const)('rejects Tencent %s response safely', problem => {
  const data: Record<string,unknown>={Audio:Buffer.from(CONTROLLED_BYTES).toString('base64'),SessionId:'controlled-session',RequestId:'controlled-request'};
  if(problem==='bad-base64')data.Audio='not base64!';
  if(problem==='empty')data.Audio='';
  if(problem==='wrong-session')data.SessionId='wrong-session';
  if(problem==='provider-error')data.Error={Code:'AuthFailure.InvalidAuthorization',Message:'PRIVATE_KEY'};
  if(problem==='wav')data.Audio=Buffer.from('RIFFnot-mp3').toString('base64');
  try {normalizeTextToVoiceResponse({Response:data},'controlled-session');throw new Error('must fail');}
  catch(error){expect(String(error)).not.toContain('PRIVATE_KEY');expect(String(error)).toMatch(/语音|音频|合成/);}
});
it('performs exactly one raw transport call using configured voice, mp3 and normal speed', async () => {
  const f=speechCase();let calls=0;const transport:TextToVoiceTransport={send:async(request,signal)=>{calls++;expect(request.Speed).toBe(0);expect(request.Codec).toBe('mp3');expect(request.VoiceType).toBe(f.binding.voice.voiceType);expect(signal.aborted).toBe(false);return{Response:{Audio:Buffer.from(CONTROLLED_BYTES).toString('base64'),SessionId:request.SessionId,RequestId:'controlled-request'}};}};
  await synthesizeTencentOnce({text:'未确认延期。',voiceId:'controlled-voice',speed:0,codec:'mp3'},f.binding.voice,transport,new AbortController().signal);
  expect(calls).toBe(1);
  await expect(synthesizeTencentOnce({text:'未确认延期。',voiceId:'wrong-voice',speed:0,codec:'mp3'},f.binding.voice,transport,new AbortController().signal)).rejects.toThrow();expect(calls).toBe(1);
});
