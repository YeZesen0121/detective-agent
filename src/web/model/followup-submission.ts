import { z } from 'zod';
import { IdSchema } from '../../shared/contracts.js';
import { snapshot } from './snapshot.js';
const RecordSchema=z.strictObject({kind:z.enum(['question','budget']),caseId:IdSchema,versionId:IdSchema,key:z.string().min(8).max(128),fingerprint:z.string(),turnId:IdSchema.nullable(),previousRunId:IdSchema.nullable(),runId:IdSchema.nullable(),outcome:z.enum(['pending','unknown','confirmed','failed'])});
export type FollowupSubmission=z.infer<typeof RecordSchema>;
export function createFollowupJournal(storage?:Pick<Storage,'getItem'|'setItem'|'removeItem'>,scope='memory'){
 const name=`detective-followup-v1:${scope}`;let rows:FollowupSubmission[]=[];
 try{const saved=storage?.getItem(name);if(saved){const parsed=z.array(RecordSchema).safeParse(JSON.parse(saved));if(parsed.success)rows=parsed.data.map(row=>({...row,outcome:row.outcome==='pending'?'unknown':row.outcome}));}}catch{/* no public text or credentials are stored */}
 const persist=()=>{try{storage?.setItem(name,JSON.stringify(rows));}catch{/* tab storage may be unavailable */}};
 return{list:()=>snapshot(rows),put(row:FollowupSubmission){const saved=RecordSchema.parse(row);const index=rows.findIndex(r=>r.key===saved.key);if(index<0)rows.push(saved);else rows[index]=saved;persist();},clear(){rows=[];try{storage?.removeItem(name);}catch{/* in-memory clear still applies */}}};
}
export type FollowupJournal=ReturnType<typeof createFollowupJournal>;
export async function questionFingerprint(question:string){const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(question));return Array.from(new Uint8Array(bytes),b=>b.toString(16).padStart(2,'0')).join('');}
