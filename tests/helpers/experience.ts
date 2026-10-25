import { randomUUID } from 'node:crypto';
import { runtimeSeed } from './runtime.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import { sha256 } from '../../src/server/platform/repository.js';
import { DEFAULT_PERSONA, ExperienceStore } from '../../src/server/platform/experience-store.js';
export const experienceFunds={...zeroAmounts(),activeMs:100000000,searches:1000,reads:1000,modelCalls:1000,inputTokens:10000000,outputTokens:10000000,moneyMicros:100000000};
export function experienceSeed(path=':memory:'){
 const s=runtimeSeed(path),at=new Date().toISOString(),ends=new Date(Date.now()+86400000).toISOString(),token='controlled_fixture_token';
 const session=JSON.parse((s.db.prepare('SELECT payload_json FROM sessions WHERE id=?').get(s.owner) as {payload_json:string}).payload_json);
 s.db.prepare('UPDATE sessions SET token_hash=?,payload_json=? WHERE id=?').run(sha256(token),JSON.stringify({...session,tokenHash:sha256(token),expiresAt:ends}),s.owner);
 s.runs.setScope(s.run.id,s.run.epoch,s.payload.scope,at);s.runs.saveCheckpoint(s.run.id,s.run.epoch,{sources:s.payload.sources,evidence:s.payload.evidence,claims:s.payload.claims},at);
 const version=s.runs.commitResult(s.run.id,s.run.epoch,s.payload,'completed',at);
 for(const name of ['global','trial','demo'] as const)s.book.createPool({id:'runtime:'+name,kind:name==='global'?'global':'access_group',accessGroup:name==='global'?null:name,sessionId:null,investigationId:null,limits:experienceFunds});
 const store=new ExperienceStore(s.db,ends);return{...s,store,version,at,ends,token};
}
export function experienceDraft(s:ReturnType<typeof experienceSeed>){return{resultVersionId:s.version.id,personaVersion:DEFAULT_PERSONA.version,summary:'controlled_fixture 伴读',segments:Array.from({length:3},(_,i)=>({id:randomUUID(),text:'controlled_fixture 第'+i+'段；仅基于已存证据。',action:null,claimIds:[s.payload.claims[0]!.id],evidenceIds:[s.payload.evidence[0]!.id]}))};}
