import {afterEach,expect,it,vi} from 'vitest';
import {randomUUID} from 'node:crypto';
import {PaidGateway} from '../../src/server/platform/gateway.js';
import {zeroAmounts} from '../../src/server/platform/budget.js';
import {SpeechError} from '../../src/server/companion/speech-errors.js';
import {budgetScenario} from '../helpers/budget-scenario.js';
const cleanup:Array<()=>void>=[];afterEach(()=>{for(const close of cleanup.splice(0))close();});
const spec={provider:'controlled_fixture',operation:'tts' as const,purpose:'controlled_fixture failure',attemptNo:1,estimated:{...zeroAmounts(),moneyMicros:7},priceRevision:'fixture-v1',timeoutMs:1000};
function setup(extract:(error:unknown)=>unknown){const s=budgetScenario();cleanup.push(()=>s.db.close());const failureDiagnostic=vi.fn(extract);return{...s,failureDiagnostic,gateway:new PaidGateway({book:s.book,poolIds:()=>s.poolIds,assertCurrent:()=>{},concurrency:{search:1,read:1,model:1,tts:1},failureDiagnostic})};}
it('keeps bounded private failure metadata while preserving unknown money and the original error',async()=>{
 const requestId=randomUUID(),error=new SpeechError('SPEECH_PROVIDER_FAILED','controlled_fixture public',true,{providerErrorCode:'FailedOperation.NoFreeAccount',providerRequestId:requestId});
 const s=setup(error=>error instanceof SpeechError?error.privateDiagnostic:undefined);let sends=0;
 await expect(s.gateway.invoke(s.context,spec,async()=>{sends++;throw error;},new AbortController().signal)).rejects.toBe(error);
 expect(s.failureDiagnostic).toHaveBeenCalledTimes(1);expect(sends).toBe(1);expect(s.book.inspectPool('trial').reserved.moneyMicros).toBe(7);
 expect(s.db.prepare('SELECT status,error_code,provider_request_id FROM usage_ledger').get()).toEqual({status:'unknown',error_code:'FailedOperation.NoFreeAccount',provider_request_id:requestId});
 expect(JSON.stringify(error)).not.toContain(requestId);
});
it.each(['extractor','sql'])('isolates %s diagnostic failure from authoritative accounting and the original error',async failure=>{
 const error=new SpeechError('SPEECH_PROVIDER_FAILED','controlled_fixture public',true,{providerErrorCode:'InternalError',providerRequestId:randomUUID()});
 const s=setup(()=>{if(failure==='extractor')throw Error('controlled_fixture diagnostic failure');return error.privateDiagnostic;});
 if(failure==='sql')s.db.exec("CREATE TRIGGER reject_diagnostic BEFORE UPDATE OF error_code ON usage_ledger BEGIN SELECT RAISE(ABORT,'controlled_fixture diagnostic write failure'); END");
 await expect(s.gateway.invoke(s.context,spec,async()=>{throw error;},new AbortController().signal)).rejects.toBe(error);
 expect(s.failureDiagnostic).toHaveBeenCalledTimes(1);expect(s.db.prepare('SELECT status,error_code,provider_request_id FROM usage_ledger').get()).toEqual({status:'unknown',error_code:null,provider_request_id:null});expect(s.book.inspectPool('trial').reserved.moneyMicros).toBe(7);
});
it('rejects malformed metadata and never annotates or changes a settled receipt',async()=>{
 const s=setup(()=>({providerErrorCode:'<controlled_fixture sensitive>',providerRequestId:'not-a-uuid'}));
 await expect(s.gateway.invoke(s.context,spec,async()=>{throw Error('controlled_fixture');},new AbortController().signal)).rejects.toThrow('controlled_fixture');
 expect(s.db.prepare('SELECT error_code,provider_request_id FROM usage_ledger').get()).toEqual({error_code:null,provider_request_id:null});
 const good=await s.gateway.invoke(s.context,{...spec,estimated:{...zeroAmounts(),moneyMicros:1}},async()=>({value:'controlled_fixture',actual:{...zeroAmounts(),moneyMicros:1},providerRequestId:'controlled-success'}),new AbortController().signal);
 expect(s.book.recordFailureDiagnostic(good.callId,{providerErrorCode:'InternalError',providerRequestId:randomUUID()})).toBe(false);
 expect(s.db.prepare('SELECT status,error_code,provider_request_id FROM usage_ledger WHERE call_id=?').get(good.callId)).toEqual({status:'settled',error_code:null,provider_request_id:'controlled-success'});
});
