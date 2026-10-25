import type Database from 'better-sqlite3';
import type { InvocationContext } from '../../shared/contracts.js';
import { ModelRequestSchema,ModelResponseSchema,type ModelRequest,type ModelResponse } from '../../shared/ports.js';
import type { ResearchCallObserver } from './services.js';
import { ApiFault } from './errors.js';
import { hashValue } from './snapshots.js';
type Row={request_hash:string;run_id:string;call_id:string|null;state:'pending'|'sent'|'received'|'unsent'|'unknown';response_json:string|null};
const blocked=()=>new ApiFault(409,'INVALID_STATE','范围请求已有未确认结果或输入已改变，不能自动重发；请保留已有材料核对。');
const contentHash=(raw:ModelRequest)=>{const{maxOutputTokens:_limit,...content}=raw;return hashValue(content);};
/** These are receipts, not published scope changes. Late valid responses may be retained. */
export class ScopeModelReceipts{
 constructor(private readonly db:Database.Database){}
 private row(key:string,schemaId:string){return this.db.prepare('SELECT * FROM scope_model_receipts WHERE preparation_key=? AND schema_id=?').get(key,schemaId) as Row|undefined;}
 async invoke(key:string,raw:ModelRequest,context:InvocationContext,signal:AbortSignal,guard:()=>void,send:(observer:ResearchCallObserver)=>Promise<ModelResponse>):Promise<ModelResponse>{
  guard();signal.throwIfAborted();const input=ModelRequestSchema.parse(raw),limit=input.schemaId==='investigation.scope.grounded.v1'?1600:input.schemaId==='investigation.scope.review.v1'?1200:0;
  if(input.purpose!=='scope'||!limit||input.maxOutputTokens>limit||!context.runId)throw blocked();
  const hash=contentHash(input),prior=this.row(key,input.schemaId);
  if(prior){
   if(prior.request_hash!==hash)throw blocked();
   if(prior.response_json){const cached=ModelResponseSchema.parse(JSON.parse(prior.response_json));guard();signal.throwIfAborted();return cached;}
   // A process crash before call_id was attached is also uncertain, never proof of no send.
   if(prior.state!=='unsent')throw blocked();
   this.db.prepare("UPDATE scope_model_receipts SET state='pending',run_id=?,call_id=NULL WHERE preparation_key=? AND schema_id=?").run(context.runId,key,input.schemaId);
  }else this.db.prepare("INSERT INTO scope_model_receipts(preparation_key,schema_id,request_hash,run_id,state) VALUES (?,?,?,?,'pending')").run(key,input.schemaId,hash,context.runId);
  let sent=false,callId:string|null=null;
  const observer:ResearchCallObserver={
   sent:(operation,request,id)=>{
    if(operation!=='model'||contentHash(ModelRequestSchema.parse(request))!==hash)throw blocked();
    this.db.prepare("UPDATE scope_model_receipts SET state='sent',call_id=? WHERE preparation_key=? AND schema_id=? AND state='pending'").run(id,key,input.schemaId);sent=true;callId=id;
   },
   received:(operation,value,id)=>{
    if(operation!=='model'||!sent||id!==callId)throw blocked();
    const response=ModelResponseSchema.parse(value),json=JSON.stringify(response);if(Buffer.byteLength(json,'utf8')>128*1024)throw blocked();
    this.db.prepare("UPDATE scope_model_receipts SET state='received',response_json=? WHERE preparation_key=? AND schema_id=? AND call_id=?").run(json,key,input.schemaId,id);
   },
  };
  try{const response=await send(observer);guard();signal.throwIfAborted();return response;}
  catch(error){if(!this.row(key,input.schemaId)?.response_json)this.db.prepare('UPDATE scope_model_receipts SET state=? WHERE preparation_key=? AND schema_id=?').run(sent?'unknown':'unsent',key,input.schemaId);throw error;}
 }
}
