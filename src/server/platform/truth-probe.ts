import { randomUUID } from 'node:crypto';
import { closeSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import Database from 'better-sqlite3';
import { buildApp } from '../app.js';
import { createFoundationApi } from '../../web/api/foundation.js';
import { createRuntimeApi } from '../../web/api/runtime.js';
import { BudgetAmountsSchema, type RunStatus } from '../../shared/contracts.js';
import { zeroAmounts } from './budget.js';
import { createTruthRuntime } from './truth-runtime.js';
import { PRICE_20261024 } from './provider-pricing.js';
import type { NetworkOptions } from './provider-transports.js';

export const TRUTH_PROBE_QUESTION='Node.js 是开源、跨平台的 JavaScript 运行时环境，这一说法是否有 Node.js 官方材料支持？';
export const TRUTH_PROBE_LIMITS=Object.freeze({activeMs:120000,searches:1,reads:1,modelCalls:1,inputTokens:24000,outputTokens:1800,moneyMicros:100000});
export const TRUTH_PROBE_CAMPAIGN='truth-20261024-01';
type CallRecord={operation:string;status:string;provider_request_id:string|null;price_revision:string|null;estimated_json:string;actual_json:string|null};
export interface TruthProbeReport {
 campaignId:string;materialKind:'real_provider'|'controlled_fixture';startedAt:string;endedAt:string|null;
 status:'PIPELINE_COMPLETED'|'PIPELINE_INCOMPLETE';runStatus:RunStatus|null;stopReason:string|null;
 limits:typeof TRUTH_PROBE_LIMITS;priceRevision:string;duplicateStartSameRun:boolean;
 sourceSelection:{returned:number;selected:string|null;policy:string};
 accounting:{used:ReturnType<typeof zeroAmounts>;reserved:ReturnType<typeof zeroAmounts>;state:string}|null;
 calls:Array<{operation:string;status:string;providerRequestId:string|null;priceRevision:string|null;estimated:unknown;actual:unknown}>;
 resultVersionId:string|null;resultPath:string|null;failureCode:string|null;
 semanticReview:'PENDING';actualInvoiceMicros:null;productAcceptancePassed:false;
}
function permittedSource(value:string) {
 const url=new URL(value);
 return url.protocol==='https:'&&url.hostname==='nodejs.org'&&/^\/(en|zh-cn)(\/about)?\/?$/.test(url.pathname);
}
export function selectProbeSource<T extends {url:string}>(items:T[]):T|null{return items.find(item=>permittedSource(item.url))??null;}
export function truthProbeFailureSummary(error:unknown) {
 const reason=error instanceof Error&&['CAMPAIGN_CLOSED','CAMPAIGN_ALREADY_STARTED','CONFIGURATION_MISSING_OR_AMBIGUOUS','INVALID_ARGUMENT'].includes(error.message)?error.message:'CONFIGURATION_OR_EXECUTION_FAILED';
 return {status:'BLOCKED',reason,providerAttemptsThisInvocation:reason==='CONFIGURATION_OR_EXECUTION_FAILED'?null:0};
}
/** Administrative single-campaign runner. Never mounted as a product endpoint. */
export async function runTruthProbe(options:{directory:string;network:NetworkOptions;materialKind:TruthProbeReport['materialKind']}):Promise<TruthProbeReport> {
 // This historical real campaign is closed. A fresh directory is not new authorization.
 if(options.materialKind==='real_provider')throw Error('CAMPAIGN_CLOSED');
 mkdirSync(options.directory,{recursive:true});
 let lock:number;
 try{lock=openSync(join(options.directory,'campaign.lock'),'wx');}
 catch{throw Error('CAMPAIGN_ALREADY_STARTED');}
 try{writeFileSync(lock,JSON.stringify({campaignId:TRUTH_PROBE_CAMPAIGN,limits:TRUTH_PROBE_LIMITS,startedAt:new Date().toISOString()}));}
 finally{closeSync(lock);}
 const report:TruthProbeReport={campaignId:TRUTH_PROBE_CAMPAIGN,materialKind:options.materialKind,startedAt:new Date().toISOString(),endedAt:null,
  status:'PIPELINE_INCOMPLETE',runStatus:null,stopReason:null,limits:TRUTH_PROBE_LIMITS,priceRevision:PRICE_20261024.id,duplicateStartSameRun:false,
  sourceSelection:{returned:0,selected:null,policy:'First real search result on nodejs.org home/about; one source; no known-URL fallback.'},
  accounting:null,calls:[],resultVersionId:null,resultPath:null,failureCode:null,semanticReview:'PENDING',actualInvoiceMicros:null,productAcceptancePassed:false};
 const databasePath=join(options.directory,'truth.db');
 let app:ReturnType<typeof buildApp>|null=null;
 try {
  const runtime=createTruthRuntime({...options.network,funding:{global:{...TRUTH_PROBE_LIMITS},trial:{...TRUTH_PROBE_LIMITS},demo:zeroAmounts()}});
  const search=runtime.providers.search;
  runtime.providers.search=async(...args)=>{
   const response=await search(...args);report.sourceSelection.returned=response.items.length;
   const item=selectProbeSource(response.items);report.sourceSelection.selected=item?.url??null;
   return {...response,items:item?[item]:[],warnings:[...response.warnings,'Bounded probe source restriction: official home/about only; one source.']};
  };
  const code=randomUUID(),origin='http://127.0.0.1:5173';
  app=buildApp({databasePath,allowedOrigin:origin,trialCode:code,demoCode:randomUUID(),secureCookies:false,
   serviceEndsAt:new Date(Date.now()+TRUTH_PROBE_LIMITS.activeMs).toISOString(),investigationRuntime:runtime});
  const address=await app.listen({host:'127.0.0.1',port:0});let cookie='';
  const local:typeof fetch=async(path,init)=>{
   const headers=new Headers(init?.headers);headers.set('origin',origin);if(cookie)headers.set('cookie',cookie);
   const response=await fetch(new URL(String(path),address),{...init,headers});
   const received=response.headers.get('set-cookie');if(received)cookie=received.split(';')[0]!;
   return response;
  };
  const foundation=createFoundationApi(local),api=createRuntimeApi(local),signal=AbortSignal.timeout(TRUTH_PROBE_LIMITS.activeMs+5000);
  await foundation.createSession(code,signal);
  const draft=await foundation.createInvestigation({originalQuestion:TRUTH_PROBE_QUESTION,basicMode:'truth',presentationMode:'evidence'},'truth-probe-draft-v1',signal);
  const start=()=>api.startRun(draft.id,{action:'start',previousRunId:null},'truth-probe-start-v1',signal);
  const [first,repeated]=await Promise.all([start(),start()]);report.duplicateStartSameRun=first.runId===repeated.runId;
  for(;;){
   signal.throwIfAborted();const view=await api.getRun(first.runId,signal);
   report.runStatus=view.run.status;report.stopReason=view.run.stopReason;
   if(['completed','partial','failed','cancelled','interrupted','waiting_for_user'].includes(view.run.status)){
    if(view.run.createdResultVersionId){
     const result=await api.getResult(view.run.createdResultVersionId,signal);
     report.resultVersionId=result.version.id;report.resultPath=join(options.directory,'result.json');
     writeFileSync(report.resultPath,JSON.stringify(result,null,2)+'\n');
    }
    break;
   }
   await new Promise<void>(resolve=>setTimeout(resolve,100));
  }
 }catch{report.failureCode='LOCAL_OR_PROTOCOL_FAILURE';}
 finally {
  await app?.close();
  try {
   const db=new Database(databasePath,{readonly:true,fileMustExist:true});
   try {
    const pool=db.prepare("SELECT used_json,reserved_json,state FROM budget_pools WHERE id='runtime:global'").get() as {used_json:string;reserved_json:string;state:string}|undefined;
    if(pool)report.accounting={used:BudgetAmountsSchema.parse(JSON.parse(pool.used_json)),reserved:BudgetAmountsSchema.parse(JSON.parse(pool.reserved_json)),state:pool.state};
    const rows=db.prepare('SELECT operation,status,provider_request_id,price_revision,estimated_json,actual_json FROM usage_ledger ORDER BY created_at,call_id').all() as CallRecord[];
    report.calls=rows.map(row=>({operation:row.operation,status:row.status,providerRequestId:row.provider_request_id,priceRevision:row.price_revision,estimated:JSON.parse(row.estimated_json),actual:row.actual_json?JSON.parse(row.actual_json):null}));
    const settled=['search','read','model'].every(operation=>report.calls.filter(call=>call.operation===operation&&call.status==='settled').length===1);
    const accounting=report.accounting;
    if(accounting&&(Object.keys(TRUTH_PROBE_LIMITS) as Array<keyof typeof TRUTH_PROBE_LIMITS>).some(key=>accounting.used[key]+accounting.reserved[key]>TRUTH_PROBE_LIMITS[key]))report.failureCode='BUDGET_OVERRUN';
    else if(accounting?.state!=='active')report.failureCode??='ACCOUNTING_PAUSED_OR_MISSING';
    if(report.calls.length>3||['search','read','model'].some(op=>report.calls.filter(call=>call.operation===op).length>1))report.failureCode='CALL_LIMIT_OVERRUN';
    if(!report.failureCode&&report.runStatus==='completed'&&report.stopReason==='answered'&&report.resultVersionId&&settled&&report.duplicateStartSameRun)report.status='PIPELINE_COMPLETED';
   }finally{db.close();}
  }catch{report.failureCode??='ACCOUNTING_READ_FAILED';}
  report.endedAt=new Date().toISOString();writeFileSync(join(options.directory,'report.json'),JSON.stringify(report,null,2)+'\n');
 }
 return report;
}
