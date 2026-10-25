import { harness, moduleFor } from './runtime-http-fixture.js';
import { listenLoopback } from '../helpers/loopback-http.js';
import type { InvestigationModule } from '../../src/shared/ports.js';
import { createFoundationApi } from '../../src/web/api/foundation.js';
import { createRuntimeApi } from '../../src/web/api/runtime.js';
import type { TaskScheduler } from '../../src/web/controllers/task.js';
export type Intercept = (path: string, init: RequestInit, send: () => Promise<Response>) => Promise<Response>;
export async function localHarness(module: InvestigationModule = moduleFor()) {
  const h = harness(module);
  const address = await listenLoopback(h.app);
  const requests: { path: string; method: string; key: string | null }[] = [];
  function browser(intercept?: Intercept) {
    let cookie = ''; let origin = 'http://127.0.0.1:5173';
    const transport: typeof fetch = async (path, init = {}) => {
      const route = String(path); const headers = new Headers(init.headers);
      requests.push({ path: route, method: init.method ?? 'GET', key: headers.get('Idempotency-Key') });
      const send = async () => {
        headers.set('Origin', origin); if (cookie) headers.set('Cookie', cookie);
        // Only this test browser-emulation layer handles cookies; W production clients do not.
        const response = await fetch(new URL(route, address), { ...init, headers });
        const setCookie = response.headers.get('set-cookie'); if (setCookie) cookie = setCookie.split(';')[0]!;
        return response;
      };
      return intercept ? intercept(route, init, send) : send();
    };
    const foundation = createFoundationApi(transport); const runtime = createRuntimeApi(transport);
    const signal = new AbortController().signal;
    return { foundation, runtime, signal, setOrigin(value: string) { origin = value; },
      async enter() { await foundation.createSession('controlled-trial-code', signal); },
      async draft() { return foundation.createInvestigation({ originalQuestion: 'controlled_fixture 真实本地端口', basicMode: 'truth', presentationMode: 'evidence' }, 'controlled-draft-key', signal); },
    };
  }
  return { ...h, requests, browser, async close() { await h.app.close(); if (h.paidCalls !== 0) throw Error('controlled_fixture attempted paid provider'); } };
}
export function manualScheduler() {
  const callbacks = new Set<() => void>();
  const scheduler: TaskScheduler = { set(callback) { callbacks.add(callback); return callback; }, clear(handle) { callbacks.delete(handle as () => void); } };
  return { scheduler, tick() { const next = callbacks.values().next().value; if (next) { callbacks.delete(next); next(); } } };
}
export function waitState<T>(controller: { getState(): T; subscribe(listener: () => void): () => void }, predicate: (state: T) => boolean): Promise<void> {
  if (predicate(controller.getState())) return Promise.resolve();
  return new Promise((resolve) => { const unsubscribe = controller.subscribe(() => { if (predicate(controller.getState())) { unsubscribe(); resolve(); } }); });
}
