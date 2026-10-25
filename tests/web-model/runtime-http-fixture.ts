import { buildApp, type FoundationOptions } from '../../src/server/app.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import type { InvestigationModule } from '../../src/shared/ports.js';
import { createFoundationApi } from '../../src/web/api/foundation.js';
import { createRuntimeApi } from '../../src/web/api/runtime.js';
import { samplePayload } from '../helpers/result.js';
import { at } from './fixtures.js';

export const fixtureType = 'controlled_fixture';
export function moduleFor(work?: InvestigationModule['runInvestigation']): InvestigationModule {
  return {
    prepareInvestigation: async (input) => ({ scope: { ...samplePayload().scope, basicMode: input.basicMode }, clarification: null, canInvestigate: true }),
    runInvestigation: work ?? (async (input, services) => {
      const draft = { ...samplePayload(), investigationId: input.context.investigationId, runId: input.run.id, scope: input.scope, queryTime: services.clock.now() };
      if (input.baseline) {
        draft.summary = 'controlled_fixture：新版本，旧版保持原文。';
        draft.delta = { previousVersionId: input.baseline.id, changes: [], checkedAt: services.clock.now() };
      }
      await services.checkpoint.save(input.run.id, input.context.epoch, { sources: draft.sources, evidence: draft.evidence, claims: draft.claims });
      return { completion: 'completed', stopReason: 'answered', draft, clarification: null };
    }),
    routeFollowup: async () => { throw Error('not invoked by controlled_fixture'); },
    compareWatchResult: async () => { throw Error('not invoked by controlled_fixture'); },
  };
}
export function harness(module: InvestigationModule | null = moduleFor()) {
  let paidCalls = 0;
  const unavailable = async () => { paidCalls++; throw Error('controlled_fixture: paid provider forbidden'); };
  const funding = { ...zeroAmounts(), activeMs: 10000000, searches: 200, reads: 200, modelCalls: 200, inputTokens: 1000000, outputTokens: 1000000, moneyMicros: 100000000 };
  const origin = 'http://127.0.0.1:5173';
  const options: FoundationOptions = {
    databasePath: ':memory:', allowedOrigin: origin, trialCode: 'controlled-trial-code', demoCode: 'controlled-demo-code', serviceEndsAt: '2026-10-26T08:00:00.000Z', secureCookies: false, now: () => at,
    ...(module ? { investigationRuntime: { module, providers: { search: unavailable, read: unavailable, model: unavailable }, funding: { global: funding, trial: funding, demo: funding },
      pricing: { quote: () => ({ provider: fixtureType, purpose: 'controlled test', priceRevision: 'fixture-v1', estimated: { ...zeroAmounts(), moneyMicros: 1 }, timeoutMs: 1000, attemptNo: 1 }), actual: () => null },
    } } : {}),
  };
  const app = buildApp(options);
  const requests: { path: string; method: string; key: string | null }[] = [];
  function browser() {
    // Browser-emulation cookie jar is test-only; application HTTP consumers never read it.
    let cookie = '';
    const transport: typeof fetch = async (path, init) => {
      if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const headers = new Headers(init?.headers);
      requests.push({ path: String(path), method: init?.method ?? 'GET', key: headers.get('Idempotency-Key') });
      const response = await app.inject({ method: init?.method === 'POST' ? 'POST' : 'GET', url: String(path), headers: { ...Object.fromEntries(headers), origin, ...(cookie ? { cookie } : {}) }, ...(typeof init?.body === 'string' ? { payload: init.body } : {}) });
      if (response.headers['set-cookie']) cookie = String(response.headers['set-cookie']).split(';')[0]!;
      return new Response(response.body, { status: response.statusCode });
    };
    const foundation = createFoundationApi(transport);
    const api = createRuntimeApi(transport);
    const signal = new AbortController().signal;
    return { transport, foundation, api, signal,
      async enter() { await foundation.createSession('controlled-trial-code', signal); },
      async draft(key = 'controlled-draft-key') { return foundation.createInvestigation({ originalQuestion: 'controlled_fixture：核对日期', basicMode: 'truth', presentationMode: 'evidence' }, key, signal); },
    };
  }
  return { app, browser, requests, get paidCalls() { return paidCalls; } };
}
/** P's host dispatches via setImmediate. Pump the event loop, never wait an arbitrary duration. */
export const pump = () => new Promise<void>((resolve) => setImmediate(resolve));
export async function untilRun(api: ReturnType<typeof createRuntimeApi>, runId: string, status: string, signal: AbortSignal) {
  for (let step = 0; step < 30; step++) {
    const view = await api.getRun(runId, signal);
    if (view.run.status === status) return view;
    await pump();
  }
  throw Error(`controlled_fixture run never reached ${status}`);
}
