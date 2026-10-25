import { ReadResponseSchema, type ReadRequest, type ReadResponse } from '../../../shared/ports.js';
import { createHash } from 'node:crypto';
export interface ReaderTransport { send(request: ReadRequest): Promise<unknown>; }
export function normalizeFetchResponse(raw: unknown, request: ReadRequest): ReadResponse {
  const x: any = raw;
  const original = typeof x.text === 'string' ? x.text : typeof x.content === 'string' ? x.content : null;
  const truncated = typeof original === 'string' && original.length > 24000;
  // Match ReadResponseSchema's text normalization before hashing the stored capture.
  const text = typeof original === 'string' ? original.slice(0, 24000).trim() : null;
  const contentHash = typeof text === 'string' ? createHash('sha256').update(text).digest('hex') : x.contentHash ?? null;
  return ReadResponseSchema.parse({
    sourceId: request.sourceId, finalUrl: x.finalUrl ?? request.url, title: x.title ?? null, text,
    readStatus: truncated ? 'partial' : (x.readStatus ?? (text ? 'full' : 'inaccessible')),
    fetchedAt: x.fetchedAt ?? new Date().toISOString(), contentHash,
    failureCode: truncated ? 'content_truncated' : (x.failureCode ?? null), usage: x.usage ?? null,
  });
}
export async function readWithFetch(request:ReadRequest, transport?: ReaderTransport):Promise<ReadResponse>{ if(!transport) throw new Error('READER_ADAPTER_NOT_CONFIGURED'); return normalizeFetchResponse(await transport.send(request),request); }
