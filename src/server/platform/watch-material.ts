import { randomUUID, createHash } from 'node:crypto';
import type { InvestigationServices, WorkingMaterial } from '../../shared/ports.js';
import type { WatchLease } from '../watch/ports.js';
export async function readWatchTargets(lease:WatchLease,services:InvestigationServices,signal:AbortSignal) {
 const material:WorkingMaterial={sources:[],evidence:[],claims:[],candidates:[],queries:[]};
 const readFailures:Array<{sourceId:string;errorCode:string}>=[];
 for(const [index,url] of lease.watch.targetUrls.entries()) {
  signal.throwIfAborted();const sourceId=randomUUID();let response:Awaited<ReturnType<InvestigationServices['read']>>|null=null;
  let errorCode:string|null=null;
  if(index>=3)errorCode='READ_LIMIT';
  else try {response=await services.read({url,sourceId},lease.context,signal);if(response.failureCode||response.readStatus==='inaccessible'||!response.text)errorCode='READ_FAILED';}
  catch {signal.throwIfAborted();errorCode='READ_FAILED';}
  if(errorCode)readFailures.push({sourceId,errorCode});
  material.sources.push({id:sourceId,url,canonicalUrl:response?.finalUrl??url,title:response?.title??'监测目标',publisher:null,publishedAt:null,eventAt:null,
   fetchedAt:response?.fetchedAt??null,readStatus:response?.readStatus??'inaccessible',originGroup:null,originReason:null,queryIds:[],snippet:null,
   contentHash:response?.contentHash??null,diagnostic:errorCode});
  if(response?.text&&!errorCode)material.evidence.push({id:randomUUID(),origin:{kind:'source',id:sourceId},representation:response.readStatus==='full'||response.readStatus==='partial'?'verbatim':'snippet',
   excerpt:response.text,locator:{kind:'char_range',value:'0:'+response.text.length},capturedAt:response.fetchedAt,contentHash:createHash('sha256').update(response.text).digest('hex'),limitations:response.readStatus==='partial'?['正文只取得部分内容。']:[]});
 }
 return {material,readFailures};
}
