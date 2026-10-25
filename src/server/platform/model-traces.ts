import type Database from 'better-sqlite3';
import { ModelRequestSchema,ModelResponseSchema } from '../../shared/ports.js';
import type { ResearchCallObserver } from './services.js';
import { hashValue } from './snapshots.js';
/** Private diagnostics only. No transport headers, credentials, public API or replay logic. */
export class ProviderModelTraces{
 constructor(private readonly db:Database.Database){}
 observer(next?:ResearchCallObserver):ResearchCallObserver{return{
  sent:(operation,input,callId)=>{
   try{if(operation==='model'){
    const request=ModelRequestSchema.parse(input),json=JSON.stringify(request),omitted=Buffer.byteLength(json,'utf8')>32768;
    this.db.prepare('INSERT INTO provider_model_traces(call_id,schema_id,prompt_version,request_hash,request_json,request_omitted) VALUES (?,?,?,?,?,?)').run(callId,request.schemaId,request.promptVersion,hashValue(request),omitted?null:json,Number(omitted));
   }}catch{/* Optional diagnostics must not interrupt payment or authoritative receipts. */}
   next?.sent?.(operation,input,callId);
  },
  received:(operation,value,callId)=>{
   try{if(operation==='model'){
    const response=ModelResponseSchema.parse(value),json=JSON.stringify(response),omitted=Buffer.byteLength(json,'utf8')>128*1024;
    this.db.prepare('UPDATE provider_model_traces SET response_hash=?,response_json=?,response_omitted=?,model_id=?,finish_reason=? WHERE call_id=?').run(hashValue(response),omitted?null:json,Number(omitted),response.modelId,response.finishReason,callId);
   }}catch{/* Keep the valid provider response available to settlement and scope receipts. */}
   next?.received?.(operation,value,callId);
  },
 };}
}
