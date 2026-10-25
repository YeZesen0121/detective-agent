import { investigationModule } from '../investigation/index.js';
import { ResultPayloadSchema } from '../../shared/contracts.js';
import type { InvestigationModule, InvestigationServices, SearchResponse } from '../../shared/ports.js';
import {SourceReadUnavailableError} from '../../shared/ports.js';
import type { InvestigationRuntimeOptions } from './host.js';
import { createResearchProviders, ProviderTransportFault, type NetworkOptions } from './provider-transports.js';
import { createProviderPricing, PRICE_20261024, type PriceRevisionSchema } from './provider-pricing.js';
import { stableJson } from './snapshots.js';
import type { z } from 'zod';

// P adapter: keep accepted I code intact; enforce runtime failure and snapshot semantics here.
const truthModule: InvestigationModule = {
 ...investigationModule,
 async runInvestigation(input, services, parent) {
  const controller=new AbortController();
  const abort=()=>controller.abort(parent.reason);
  if(parent.aborted)abort();else parent.addEventListener('abort',abort,{once:true});
  let failed:unknown;
  const cache=new Map<string,SearchResponse>();
  const event=async(type:'query.started'|'query.completed'|'source.read'|'provider.failed',message:string,queryId:string|null=null,sourceIds:string[]=[])=>{
   await services.events.append(input.run.id,input.run.epoch,{type,message,queryId,sourceIds,visibility:'public'});
  };
  async function guarded<T>(call:()=>Promise<T>):Promise<T> {
   controller.signal.throwIfAborted();
   try{return await call();}catch(error){failed??=error;controller.abort();throw error;}
  }
  const wrapped:InvestigationServices={...services,
   search:async(request,ctx)=>guarded(async()=>{
    const key=stableJson(request),cached=cache.get(key);if(cached)return cached;
    const response=await services.search(request,ctx,controller.signal);cache.set(key,response);
    return response;
   }),
   read:async(request,ctx)=>{
    controller.signal.throwIfAborted();
    try{const response=await services.read(request,ctx,controller.signal);
    // Search snippets remain leads; a failed capture must not enter I's snippet fallback as verified material.
    if(!response.text||response.readStatus==='inaccessible'||response.readStatus==='snippet_only')throw new ProviderTransportFault('invalid_response');
    return response;
    }catch(error){
     if(!parent.aborted&&!controller.signal.aborted&&error instanceof ProviderTransportFault&&['network','invalid_response','invalid_request'].includes(error.kind)){
      throw new SourceReadUnavailableError();
     }
     failed??=error;controller.abort();throw error;
    }
   },
   model:async(request,ctx)=>guarded(()=>services.model(request,ctx,controller.signal)),
  };
  try {
   const result=await investigationModule.runInvestigation(input,wrapped,controller.signal);
   if(failed&&!parent.aborted){
    const category=failed instanceof ProviderTransportFault?{
     auth:'鉴权失败',balance:'余额不足',rate_limit:'服务限流',network:'网络调用未完成',invalid_response:'返回格式无法使用',invalid_request:'请求目标无法使用',
    }[failed.kind]:'调用未完成';
    await event('provider.failed',category+'，已停止本轮；未自动重发。');
    // Throw to the host so its persisted checkpoint becomes a conservative partial report.
    throw failed;
   }
   if(result.stopReason!=='answered'&&!parent.aborted){
    const remaining=await services.budget.snapshot(input.context);
    if(remaining.remaining.moneyMicros===0)result.stopReason='cost_limit';
   }
   if(result.draft){
    const draft=result.draft;
    result.draft=ResultPayloadSchema.parse({...draft,
     // I builds this summary from saved scope and checked claims. Rebuilding it
     // from answerBlocks would erase current uncertainty and failed-claim labels.
     summary:draft.summary,
     stopReason:result.stopReason,
     conditions:[...new Set([...draft.conditions,...draft.claims.flatMap(claim=>claim.conditions)])].slice(0,80),
     unknowns:[...new Set([...draft.unknowns,...draft.claims.flatMap(claim=>claim.gaps)])].slice(0,80),
     delta:input.baseline?{previousVersionId:input.baseline.id,changes:[],checkedAt:services.clock.now()}:null,
    });
   }
   return result;
  }finally{parent.removeEventListener('abort',abort);}
 },
};

export interface TruthRuntimeOptions extends NetworkOptions {
 funding:InvestigationRuntimeOptions['funding'];
 now?:()=>string;price?:z.infer<typeof PriceRevisionSchema>;
}
export function createTruthRuntime(options:TruthRuntimeOptions):InvestigationRuntimeOptions {
 return {module:truthModule,providers:createResearchProviders(options),
  pricing:createProviderPricing(options.price??PRICE_20261024,options.now??(()=>new Date().toISOString())),
  funding:options.funding,supportedBasicModes:['truth','latest','identify'],enableWatches:true,enableFollowups:true};
}
