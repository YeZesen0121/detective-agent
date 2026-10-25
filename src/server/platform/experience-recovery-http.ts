import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { IdSchema } from '../../shared/contracts.js';
import { CompanionHistoryPageSchema, CompanionTurnHistoryPageSchema, ExperienceHistoryQuerySchema,
  MediaSubmissionQuerySchema, MediaSubmissionViewSchema } from '../../shared/experience-recovery-http.js';
import { ApiFault } from './errors.js';
import type { ExperienceStore } from './experience-store.js';
import type { HttpDependencies } from './private-http.js';
import { readSnapshot } from './snapshots.js';

export function registerExperienceRecoveryRoutes(app:FastifyInstance,store:ExperienceStore,deps:HttpDependencies) {
  const {db}=store, {requireSession,envelope}=deps;
  const id=(request:FastifyRequest)=>z.strictObject({id:IdSchema}).parse(request.params).id;
  const missing=()=>new ApiFault(404,'NOT_FOUND','未找到该资源。');
  app.get('/api/v1/investigations/:id/media-submission',async request=>{
    const owner=requireSession(request).id, investigationId=id(request);
    const {operation}=MediaSubmissionQuerySchema.parse(request.query);
    const key=z.string().min(8).max(128).parse(request.headers['idempotency-key']);
    if(!db.prepare('SELECT 1 FROM investigations WHERE id=? AND session_id=?').get(investigationId,owner))throw missing();
    let submission:unknown=null;
    if(operation==='attachment'){
      const row=db.prepare(`SELECT a.id,a.deleted_at FROM attachment_submissions s JOIN attachments a ON a.id=s.attachment_id
        WHERE s.session_id=? AND s.key=? AND a.session_id=? AND a.investigation_id=?`).get(owner,key,owner,investigationId) as {id:string;deleted_at:string|null}|undefined;
      if(row)submission={operation,attachmentId:row.id,deleted:row.deleted_at!==null};
    }else{
      const row=db.prepare(`SELECT j.id,j.companion_session_id,j.result_version_id FROM experience_submissions s JOIN experience_jobs j ON j.id=s.job_id
        WHERE s.session_id=? AND s.operation=? AND s.key=? AND j.session_id=? AND j.investigation_id=? AND j.kind=?`).get(owner,operation,key,owner,investigationId,operation) as {id:string;companion_session_id:string;result_version_id:string}|undefined;
      if(row)submission={operation,companionSessionId:row.companion_session_id,resultVersionId:row.result_version_id,
        ...(operation==='turn'?{turnId:row.id}:operation==='audio'?{audioJobId:row.id}:{})};
    }
    // Absence only means not committed at this instant, not permission to replay an unknown POST.
    return envelope(request,MediaSubmissionViewSchema.parse({submission}));
  });
  app.get('/api/v1/results/:id/companions',async request=>{
    const owner=requireSession(request).id,versionId=id(request),{after=0}=ExperienceHistoryQuerySchema.parse(request.query);
    if(!readSnapshot(db,versionId,owner))throw missing();
    const rows=db.prepare(`SELECT rowid AS cursor,id FROM companion_sessions
      WHERE session_id=? AND result_version_id=? AND rowid>? ORDER BY rowid LIMIT 51`).all(owner,versionId,after) as {cursor:number;id:string}[];
    const page=rows.slice(0,50);
    return envelope(request,CompanionHistoryPageSchema.parse({items:page.map(row=>store.companion(row.id,owner)),nextAfter:rows.length>50?page[49]!.cursor:null}));
  });
  app.get('/api/v1/companions/:id/turns',async request=>{
    const owner=requireSession(request).id,companionId=id(request),{after=0}=ExperienceHistoryQuerySchema.parse(request.query);
    store.companion(companionId,owner);
    const rows=db.prepare(`SELECT ordinal,id FROM experience_jobs
      WHERE session_id=? AND companion_session_id=? AND kind='turn' AND ordinal>? ORDER BY ordinal LIMIT 51`).all(owner,companionId,after) as {ordinal:number;id:string}[];
    const page=rows.slice(0,50),items=page.map(row=>{
      const job=store.job(row.id,owner)!;
      return{turnId:job.id,question:job.request.question,createdAt:job.createdAt,view:{status:job.status,reply:job.output,newRunId:null,
        error:job.errorCode?{code:job.errorCode,message:'问答未完成。'}:null}};
    });
    return envelope(request,CompanionTurnHistoryPageSchema.parse({items,nextAfter:rows.length>50?page[49]!.ordinal:null}));
  });
}
