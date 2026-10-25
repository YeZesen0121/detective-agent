import { expect, it, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { CONTRACT_VERSION } from '../../src/shared/contracts.js';
import { createFollowupApi } from '../../src/web/api/followup.js';
it('controlled_fixture validates fixed version/questions and recovers null by original key without writes',async()=>{
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({data:{submission:null},meta:{requestId:randomUUID(),contractVersion:CONTRACT_VERSION}}));const api=createFollowupApi(fetcher),signal=new AbortController().signal;
 await expect(api.create(randomUUID(),{resultVersionId:randomUUID(),question:'x'.repeat(2001)},'controlled-key',signal)).rejects.toMatchObject({code:'VALIDATION_ERROR'});expect(fetcher).not.toHaveBeenCalled();
 expect(await api.submission(randomUUID(),'controlled-original',signal)).toEqual({submission:null});expect(fetcher.mock.calls[0]![1]).toMatchObject({credentials:'same-origin',headers:{'Idempotency-Key':'controlled-original'}});
});
