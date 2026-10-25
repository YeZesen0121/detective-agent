import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {investigationModule} from '../../src/server/investigation/index.js';
import {createTruthRuntime} from '../../src/server/platform/truth-runtime.js';
import {ProviderTransportFault} from '../../src/server/platform/provider-transports.js';
import {SourceReadUnavailableError} from '../../src/shared/ports.js';
import {scenario} from '../investigation/controlled.js';
import {zeroAmounts} from '../../src/server/platform/budget.js';
afterEach(()=>vi.restoreAllMocks());
function runtime(){const funds=zeroAmounts();return createTruthRuntime({credentials:{search:{kind:'bearer',apiKey:'controlled_fixture'},deepseekKey:'controlled_fixture'},funding:{global:funds,trial:funds,demo:funds}});}
it.each(['network','invalid_response','invalid_request'] as const)('marks one %s read as source-local and keeps the planned next source available without retry',async kind=>{
 const s=scenario(),read=s.services.read,urls:string[]=[];s.services.read=async(request,context,signal)=>{urls.push(request.url);if(urls.length===1)throw new ProviderTransportFault(kind);return read(request,context,signal);};
 vi.spyOn(investigationModule,'runInvestigation').mockImplementation(async(input,services,signal)=>{
  await expect(services.read({url:'https://example.invalid/unavailable',sourceId:randomUUID()},input.context,signal)).rejects.toBeInstanceOf(SourceReadUnavailableError);expect(signal.aborted).toBe(false);
  const captured=await services.read({url:'https://example.invalid/available',sourceId:randomUUID()},input.context,signal);expect(captured.readStatus).toBe('full');
  return{stopReason:'no_useful_direction',completion:'failed',draft:null,clarification:null};
 });
 await runtime().module.runInvestigation(s.input,s.services,new AbortController().signal);expect(urls).toEqual(['https://example.invalid/unavailable','https://example.invalid/available']);
});
it.each(['auth','balance','rate_limit'] as const)('still stops the entire runtime for %s instead of trying more sources',async kind=>{
 const s=scenario(),failure=new ProviderTransportFault(kind);let calls=0;s.services.read=async()=>{calls++;throw failure;};
 vi.spyOn(investigationModule,'runInvestigation').mockImplementation(async(input,services,signal)=>{await expect(services.read({url:'https://example.invalid/a',sourceId:randomUUID()},input.context,signal)).rejects.toBe(failure);expect(signal.aborted).toBe(true);return{stopReason:'provider_error',completion:'failed',draft:null,clarification:null};});
 await expect(runtime().module.runInvestigation(s.input,s.services,new AbortController().signal)).rejects.toBe(failure);expect(calls).toBe(1);
});
