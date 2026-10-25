import { z } from 'zod';
import { IdSchema } from '../../shared/contracts.js';
import { MediaOperationSchema, MediaSubmissionViewSchema } from '../../shared/experience-recovery-http.js';
import { safeError } from '../api/client.js';
import { snapshot } from '../model/snapshot.js';

const RecordSchema=z.strictObject({key:z.string().min(8).max(128),caseId:IdSchema,versionId:IdSchema.nullable(),parentId:IdSchema.nullable(),segmentId:IdSchema.nullable(),voiceId:z.string().max(128).nullable(),operation:MediaOperationSchema,outcome:z.enum(['pending','unknown','confirmed','failed']),submission:MediaSubmissionViewSchema.shape.submission});
export type SubmissionRecord=z.infer<typeof RecordSchema>;
export function unknownSubmission(error:unknown){const e=safeError(error);return e.status===null||e.status>=500||['INVALID_RESPONSE','PROTOCOL_ERROR'].includes(e.code);}
/** Per-session tab storage: identifiers only. No questions, report text, cookies or bytes. */
export function createMediaJournal(storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>,scope='memory') {
 const storageKey=`detective-media-v1:${scope}`;let records:SubmissionRecord[]=[];
 try{const saved=storage?.getItem(storageKey);if(saved){const parsed=z.array(RecordSchema).max(500).safeParse(JSON.parse(saved));if(parsed.success)records=parsed.data.map(r=>({...r,outcome:r.outcome==='pending'?'unknown':r.outcome}));}}catch{/* Private mode may deny storage. */}
 const persist=()=>{try{storage?.setItem(storageKey,JSON.stringify(records));}catch{/* in-memory operation remains available */}};
 return {
  list:()=>snapshot(records),
  put(record:SubmissionRecord){const parsed=RecordSchema.parse(record);records=records.filter(r=>r.key!==parsed.key);records.push(parsed);persist();},
  clear(){records=[];try{storage?.removeItem(storageKey);}catch{/* no storage access */}},
 };
}
export type MediaJournal=ReturnType<typeof createMediaJournal>;
export function newSubmission(operation:SubmissionRecord['operation'],caseId:string,key:string,versionId:string|null=null,parentId:string|null=null):SubmissionRecord{
 return {operation,caseId,key,versionId,parentId,segmentId:null,voiceId:null,outcome:'pending',submission:null};
}
