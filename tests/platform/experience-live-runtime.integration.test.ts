import { expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { buildApp } from '../../src/server/app.js';
import { createLiveExperienceRuntime } from '../../src/server/platform/experience-runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { openDatabase } from '../../src/server/platform/database.js';
import { PaidCampaign } from '../../src/server/platform/paid-campaign.js';
import { samplePayload } from '../helpers/result.js';
import { listenLoopback } from '../helpers/loopback-http.js';
import type { InvestigationModule } from '../../src/shared/ports.js';

it.each([false,true])('controlled_fixture connects real HTTP, SQLite, E and signed speech (supplier failure=%s)', async failedSpeech => {
  const root = mkdtempSync(join(tmpdir(), 'detective-live-runtime-')), databasePath = join(root, 'runtime.db'), audio = readFileSync('tests/fixtures/media-e/audio/offline-tone.mp3');
  const amounts = { ...zeroAmounts(), activeMs: 10000000, searches: 100, reads: 100, modelCalls: 100, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 20000000 };
  const funding = { global: amounts, trial: amounts, demo: zeroAmounts() }, sent: { url: string; body: any }[] = [];
  const failureId=randomUUID(),failureCode='AuthFailure.SecretIdNotFound',privateMessage='controlled_fixture_sensitive_supplier_message';
  const network: typeof fetch = async (url, init) => {
    const body = JSON.parse(String(init?.body)); sent.push({ url: String(url), body });
    if (String(url).includes('tts.tencentcloudapi.com')) return Response.json({Response:failedSpeech?{Error:{Code:failureCode,Message:privateMessage},RequestId:failureId}:{SessionId:body.SessionId,Audio:audio.toString('base64'),RequestId:'controlled_fixture_tts'}});
    const content = body.messages.at(-1).content;
    const value = Array.isArray(content) ? { attachmentId: JSON.parse(content[0].text).attachmentId, visibleText: 'controlled_fixture 图上未注明延期', speakerClues: [], visibleDates: [], claimSuggestions: [], uncertainSpans: [], warnings: [] }
      : { summary: 'controlled_fixture', segments: Array.from({ length: 3 }, () => ({ id: randomUUID(), text: 'controlled_fixture 提案', action: null, claimIds: [samplePayload().claims[0]!.id], evidenceIds: [samplePayload().evidence[0]!.id] })) };
    return Response.json({ id: 'controlled_fixture_model', model: 'deepseek-flash', choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 1000, completion_tokens: 100 } });
  };
  const experienceRuntime = createLiveExperienceRuntime({ deepseekKey: 'controlled_fixture_key', funding, fetch: network, tts: { secretId: 'controlled_fixture_id', secretKey: 'controlled_fixture_key', voiceIds: ['zh-male-zhike'] } });
  const unavailable = async () => { throw Error('controlled_fixture unexpected research provider'); };
  const module: InvestigationModule = {
    prepareInvestigation: async () => ({ canInvestigate: true, scope: samplePayload().scope, clarification: null }),
    runInvestigation: async (input, services) => {
      const draft = { ...samplePayload(), investigationId: input.context.investigationId, runId: input.run.id, scope: input.scope, queryTime: services.clock.now(), conditions: ['controlled_fixture：仅用于受控验收，符号🕵与否定词均需保留。'] };
      expect(input.attachments[0]!.visibleText).toContain('未注明延期');
      await services.checkpoint.save(input.run.id, input.context.epoch, { sources: draft.sources, evidence: draft.evidence, claims: draft.claims });
      return { completion: 'completed', stopReason: 'answered', draft, clarification: null };
    }, routeFollowup: unavailable, compareWatchResult: unavailable,
  };
  const origin = 'http://127.0.0.1:5173', app = buildApp({ databasePath, allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code', serviceEndsAt: new Date(Date.now() + 3600000).toISOString(), secureCookies: false,
    investigationRuntime: { module, funding, supportsAttachments: true, enableWatches: false, providers: { model: unavailable, read: unavailable, search: unavailable }, pricing: { quote: () => { throw Error('controlled_fixture unexpected research quote'); }, actual: () => null } }, experienceRuntime,
    paidCampaign: { id: 'controlled_fixture-media', moneyMicros: 20000000, requestLimit: 100, operationLimits: { search: 15, read: 25, model: 40, tts: 20 }, expiresAt: new Date(Date.now() + 3600000).toISOString() } });
  try {
    const base = await listenLoopback(app); let cookie = '';
    async function call(url: string, method = 'GET', input?: unknown, key = 'controlled-action') {
      const headers: Record<string, string> = { origin, Connection: 'close', ...(cookie ? { cookie } : {}), 'Idempotency-Key': key };
      if (input !== undefined && !(input instanceof FormData)) headers['Content-Type'] = 'application/json';
      const r = await fetch(base + url, { method, headers, ...(input === undefined ? {} : { body: input instanceof FormData ? input : JSON.stringify(input) }) });
      const received = r.headers.get('set-cookie'); if (received) cookie = received.split(';')[0]!;
      const json = await r.json(); expect(r.status, JSON.stringify(json.error)).toBeLessThan(300); return json.data;
    }
    async function until(url: string, ready: (value: any) => boolean) { for (let i = 0; i < 300; i++) { const view = await call(url); if (ready(view)) return view; await new Promise(r => setTimeout(r, 5)); } throw Error('controlled_fixture media did not reach terminal'); }
    await call('/api/v1/sessions', 'POST', { code: 'controlled-trial-code' }); const ownerCookie = cookie;
    const inv = await call('/api/v1/investigations', 'POST', { originalQuestion: 'controlled_fixture 核对截图日期', basicMode: 'truth', presentationMode: 'evidence' });
    const form = new FormData(); form.append('file', new Blob([readFileSync('tests/fixtures/media-e/images/dense-negation-0.png')], { type: 'image/png' }), 'controlled_fixture.png');
    await call(`/api/v1/investigations/${inv.id}/attachments`, 'POST', form);
    const started = await call(`/api/v1/investigations/${inv.id}/runs`, 'POST', { action: 'start', previousRunId: null });
    const done = await until('/api/v1/runs/' + started.runId, value => ['completed', 'failed', 'partial'].includes(value.run.status)); expect(done.run.status).toBe('completed');
    const report = await call('/api/v1/results/' + done.run.createdResultVersionId); expect(report.version.payload.attachments[0].extraction.visibleText).toContain('未注明延期');
    const accepted = await call(`/api/v1/results/${report.version.id}/companions`, 'POST', { personaId: 'default' });
    const companion = await until('/api/v1/companions/' + accepted.companionSessionId, value => ['ready', 'failed'].includes(value.session.status)); expect(companion.session.status).toBe('ready');
    const first = companion.session.segments[0], request = { segmentId: first.id, voiceId: 'zh-male-zhike', speed: 0 };
    const audioJob = await call(`/api/v1/companions/${companion.session.id}/audio`, 'POST', request);
    const manifest = await until('/api/v1/audio-jobs/' + audioJob.audioJobId, value => ['ready', 'failed', 'partial'].includes(value.status));
    if(failedSpeech){
      expect(manifest.status).toBe('failed');expect(manifest.chunks).toEqual([]);expect(JSON.stringify(manifest)).not.toContain(failureCode);expect(JSON.stringify(manifest)).not.toContain(failureId);expect(JSON.stringify(manifest)).not.toContain(privateMessage);
      const db=openDatabase(databasePath);try{expect(db.prepare("SELECT status,error_code,provider_request_id FROM usage_ledger WHERE operation='tts'").get()).toEqual({status:'unknown',error_code:failureCode,provider_request_id:failureId});expect(new PaidCampaign(db).inspect()).toMatchObject({requestCount:3,unknownCount:1,operations:{model:2,tts:1}});expect(new PaidCampaign(db).inspect()!.heldMicros).toBeGreaterThan(0);}finally{db.close();}
      await call('/api/v1/audio-jobs/'+audioJob.audioJobId);expect(sent.filter(item=>item.url.includes('tts.tencentcloudapi.com'))).toHaveLength(1);expect((await call('/api/v1/results/'+report.version.id)).version).toEqual(report.version);return;
    }
    expect(manifest.status).toBe('ready'); expect(manifest.chunks.length).toBeGreaterThan(0);
    const range = await fetch(`${base}/api/v1/audio-assets/${manifest.chunks[0].assetId}`, { headers: { cookie, Range: 'bytes=0-7', Connection: 'close' } }); expect(range.status).toBe(206); expect(Buffer.from(await range.arrayBuffer())).toEqual(audio.subarray(0, 8));
    const before = sent.length; const repeat = await call(`/api/v1/companions/${companion.session.id}/audio`, 'POST', request); expect(repeat.audioJobId).toBe(audioJob.audioJobId); expect(sent).toHaveLength(before);
    expect((await call('/api/v1/results/' + report.version.id)).version).toEqual(report.version);
    const db = openDatabase(databasePath); try {
      const speech = sent.filter(item => item.url.includes('tts.tencentcloudapi.com')), state = new PaidCampaign(db).inspect()!;
      expect(state.requestCount).toBe(2 + speech.length); expect(state.operations.model).toBe(2); expect(state.operations.tts).toBe(speech.length); expect(state.unknownCount).toBe(0);
      const traces=db.prepare('SELECT schema_id,request_json,response_json FROM provider_model_traces ORDER BY rowid').all() as Array<{schema_id:string;request_json:string;response_json:string}>;
      expect(traces).toHaveLength(2);expect(traces.every(trace=>trace.schema_id.startsWith('experience.')&&JSON.parse(trace.response_json).finishReason==='stop')).toBe(true);
      expect(JSON.stringify(traces)).not.toContain('controlled_fixture_key');expect(JSON.stringify(traces)).not.toContain('Authorization');expect(JSON.stringify(traces)).not.toContain('data:image/');
      const characters = (db.prepare('SELECT characters_used,characters_reserved FROM experience_scopes WHERE investigation_id=?').get(inv.id) as { characters_used: number; characters_reserved: number });
      expect(characters.characters_used).toBe(speech.reduce((n, call) => n + call.body.Text.length, 0)); expect(characters.characters_reserved).toBe(0);
    } finally { db.close(); }
    await call('/api/v1/sessions', 'POST', { code: 'controlled-trial-code' });
    const denied = await fetch(`${base}/api/v1/audio-assets/${manifest.chunks[0].assetId}`, { headers: { cookie, Connection: 'close' } }); expect(denied.status).toBe(404); await denied.arrayBuffer(); cookie = ownerCookie;
  } finally { await app.close(); rmSync(root, { recursive: true, force: true }); }
}, 15000);
