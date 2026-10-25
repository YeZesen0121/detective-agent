import {expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {createInvestigationsApi} from '../../src/web/api/investigations.js';

it('single-case deletion validates identity, sends no body/key, and rejects a mismatched acknowledgement',async()=>{
 const id=randomUUID(),signal=new AbortController().signal,result={investigationId:id,deleted:true,billingAuditRetained:true,mediaCleanup:'not_needed'},transport=vi.fn(async()=>new Response(JSON.stringify({data:result,meta:{requestId:'controlled_fixture',contractVersion:'0.1.0'}}),{status:200,headers:{'content-type':'application/json'}})),api=createInvestigationsApi(transport as typeof fetch);
 await expect(api.remove('../foreign',signal)).rejects.toMatchObject({code:'VALIDATION_ERROR'});expect(transport).not.toHaveBeenCalled();await expect(api.remove(id,signal)).resolves.toEqual(result);const [path,options]=transport.mock.calls[0] as unknown as [string,RequestInit];expect(path).toBe(`/api/v1/investigations/${id}`);expect(options).toMatchObject({method:'DELETE',signal,credentials:'same-origin'});expect(options.body).toBeUndefined();expect(options.headers).toBeUndefined();result.investigationId=randomUUID();await expect(api.remove(id,signal)).rejects.toMatchObject({code:'PROTOCOL_ERROR'});
});
it('a network-unknown deletion is never automatically retried',async()=>{
 const transport=vi.fn().mockRejectedValue(new TypeError('controlled_fixture')),api=createInvestigationsApi(transport as typeof fetch);await expect(api.remove(randomUUID(),new AbortController().signal)).rejects.toMatchObject({code:'NETWORK_ERROR'});expect(transport).toHaveBeenCalledTimes(1);
});
