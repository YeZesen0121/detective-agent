import { z } from 'zod';
import { CountSchema, IdSchema } from '../../shared/contracts.js';
import { CancelledRunSchema } from '../../shared/runtime-http.js';
import { ClientError, parseInput, request } from './client.js';
import { RunViewSchema, EventPageSchema } from './task-port.js';
import type { TaskPort } from './task-port.js';
const keySchema = z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/);
function active(signal: AbortSignal) {
  if (signal.aborted) throw new ClientError('ABORTED', '已停止本地读取。');
}
const protocol = () => new ClientError('PROTOCOL_ERROR', '任务响应与请求不一致，已停止读取。');
export function createTaskHttpPort(transport: typeof fetch): TaskPort {
  const getRun: TaskPort['getRun'] = async (runId, signal) => {
    const id = parseInput(IdSchema, runId); active(signal);
    const data = await request(`/api/v1/runs/${id}`, { signal }, RunViewSchema, transport);
    if (data.run.id !== id || (data.clarification && data.clarification.runId !== id)) throw protocol();
    return data;
  };
  return {
    getRun,
    async getEvents(investigationId, afterSeq, signal) {
      const id = parseInput(IdSchema, investigationId);
      const after = parseInput(CountSchema, afterSeq); active(signal);
      const page = await request(`/api/v1/investigations/${id}/events?afterSeq=${after}`, { signal }, EventPageSchema, transport);
      if (page.nextSeq < after || (page.hasMore && page.nextSeq <= after)
        || page.items.some((event) => event.investigationId !== id || event.seq > page.nextSeq)) throw protocol();
      return { ...page, items: page.items.filter((event) => event.visibility === 'public') };
    },
    async cancel(runId, key, signal) {
      const id = parseInput(IdSchema, runId);
      const fixedKey = parseInput(keySchema, key); active(signal);
      // P's cancellation operation is naturally idempotent; the caller key is kept for explicit retries.
      const ack = await request(`/api/v1/runs/${id}/cancel`, { method: 'POST', signal, headers: { 'Idempotency-Key': fixedKey } }, CancelledRunSchema, transport);
      if (ack.runId !== id) throw protocol();
      // Never synthesize a full Run from the short acknowledgement or retry POST on a read failure.
      return (await getRun(id, signal)).run;
    },
  };
}
