import { z } from 'zod';
import { IdSchema } from '../../shared/contracts.js';
import { AcceptedFollowupSchema, CreateFollowupSchema, FollowupSubmissionSchema, FollowupViewSchema, FollowupsPageSchema } from '../../shared/followup-http.js';
import { ClientError, parseInput, request } from './client.js';
export type FollowupView=z.infer<typeof FollowupViewSchema>;
const keySchema=z.string().min(8).max(128).regex(/^[\x21-\x7e]+$/);
export function createFollowupApi(transport:typeof fetch){return{
 async create(caseId:string,input:z.infer<typeof CreateFollowupSchema>,key:string,signal:AbortSignal){const id=parseInput(IdSchema,caseId),body=parseInput(CreateFollowupSchema,input);return request(`/api/v1/investigations/${id}/followups`,{method:'POST',signal,headers:{'Content-Type':'application/json','Idempotency-Key':parseInput(keySchema,key)},body:JSON.stringify(body)},AcceptedFollowupSchema,transport);},
 async get(turnId:string,signal:AbortSignal){const id=parseInput(IdSchema,turnId);const value=await request(`/api/v1/followups/${id}`,{signal},FollowupViewSchema,transport);if(value.id!==id)throw new ClientError('PROTOCOL_ERROR','追问响应不属于当前请求。');return value;},
 async list(caseId:string,after:number|null,signal:AbortSignal){const id=parseInput(IdSchema,caseId),cursor=after===null?'':`?after=${parseInput(z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),after)}`;return request(`/api/v1/investigations/${id}/followups${cursor}`,{signal},FollowupsPageSchema,transport);},
 async submission(caseId:string,key:string,signal:AbortSignal){const id=parseInput(IdSchema,caseId);return request(`/api/v1/investigations/${id}/followups/submission`,{signal,headers:{'Idempotency-Key':parseInput(keySchema,key)}},FollowupSubmissionSchema,transport);},
};}
export type FollowupApi=ReturnType<typeof createFollowupApi>;
