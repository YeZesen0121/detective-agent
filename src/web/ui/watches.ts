import { z } from 'zod';
import { IdSchema, WatchPublicSchema } from '../../shared/contracts.js';
import { CreateWatchRequestSchema, WatchActionSchema, WatchesSchema } from '../../shared/watch-http.js';
import { ClientError, parseInput, request } from '../api/client.js';

export type WatchPublic = z.infer<typeof WatchPublicSchema>;

export const watchesApi = {
  list: (signal: AbortSignal) => request('/api/v1/watches', { signal }, WatchesSchema),
  create: (input: z.infer<typeof CreateWatchRequestSchema>, key: string, signal: AbortSignal) =>
    request('/api/v1/watches', {
      method: 'POST', signal, headers: { 'Content-Type': 'application/json', 'Idempotency-Key': key },
      body: JSON.stringify(parseInput(CreateWatchRequestSchema, input)),
    }, WatchPublicSchema),
  change: (id: string, action: 'pause' | 'resume', signal: AbortSignal) =>
    request(`/api/v1/watches/${parseInput(IdSchema, id)}`, {
      method: 'PATCH', signal, headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(parseInput(WatchActionSchema, { action })),
    }, WatchPublicSchema),
  async remove(id: string, signal: AbortSignal) {
    const path = `/api/v1/watches/${parseInput(IdSchema, id)}`;
    let response: Response;
    try { response = await fetch(path, { method: 'DELETE', signal, credentials: 'same-origin', mode: 'same-origin', redirect: 'error' }); }
    catch { throw new ClientError('NETWORK_ERROR', '连接中断，请重试。'); }
    if (response.status === 204) return;
    throw new ClientError('INVALID_RESPONSE', '删除结果无法确认，请刷新列表。', null, response.status);
  },
};
