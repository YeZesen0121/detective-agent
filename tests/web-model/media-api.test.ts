import { describe, expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION } from '../../src/shared/contracts.js';
import { createExperienceApi } from '../../src/web/api/experience.js';

const signal = new AbortController().signal;
const envelope = (data: unknown) => Response.json({ data, meta: { requestId: randomUUID(), contractVersion: CONTRACT_VERSION } });
describe('controlled_fixture media HTTP', () => {
  it('validates IDs before fetch and does not set a multipart boundary', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => envelope({ items: [] }));
    const api = createExperienceApi(fetcher);
    await expect(api.listAttachments('../escape', signal)).rejects.toMatchObject({code:'VALIDATION_ERROR'});
    expect(fetcher).not.toHaveBeenCalled();
    await api.listAttachments(randomUUID(), signal);
    expect(fetcher.mock.calls[0]![1]).toMatchObject({credentials:'same-origin',redirect:'error'});
    await expect(api.uploadAttachment(randomUUID(), new File(['x'],'x.png',{type:'image/png'}), 'controlled-key', signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    const options = fetcher.mock.calls[1]![1]!;
    expect(options.body).toBeInstanceOf(FormData);
    expect(new Headers(options.headers).has('content-type')).toBe(false);
  });
  it('accepts deletion 204 without JSON parsing and handles binary 416/404 without retry', async () => {
    const fetcher = vi.fn<typeof fetch>(async () => new Response(null,{status:204}));
    const api=createExperienceApi(fetcher);
    await api.deleteAttachment(randomUUID(),randomUUID(),signal);
    fetcher.mockResolvedValueOnce(new Response(null,{status:416}));
    await expect(api.audioBytes(randomUUID(),signal)).rejects.toMatchObject({status:416});
    fetcher.mockResolvedValueOnce(envelope('not binary'));
    await expect(api.audioBytes(randomUUID(),signal)).rejects.toMatchObject({code:'INVALID_RESPONSE'});
    expect(fetcher).toHaveBeenCalledTimes(3);
  });
  it('uses original key on read recovery and preserves null',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>envelope({submission:null}));const api=createExperienceApi(fetcher);
    expect(await api.recover(randomUUID(),'audio','controlled-original',signal)).toEqual({submission:null});
    expect(fetcher.mock.calls[0]![1]!.headers).toMatchObject({'Idempotency-Key':'controlled-original'});
  });
  it('reports authenticated 404 as an asset failure without a second network send',async()=>{
    const fetcher=vi.fn<typeof fetch>(async()=>Response.json({error:{code:'NOT_FOUND',message:'未找到音频',retryable:false},meta:{requestId:randomUUID(),contractVersion:CONTRACT_VERSION}},{status:404}));
    await expect(createExperienceApi(fetcher).audioBytes(randomUUID(),signal)).rejects.toMatchObject({code:'NOT_FOUND',status:404});expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
