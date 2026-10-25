import { randomUUID } from 'node:crypto';
import { InvestigationInputSchema, InvestigationOutcomeSchema, WorkingMaterialSchema, SourceReadUnavailableError, type InvestigationInput, type InvestigationOutcome, type InvestigationServices, type WorkingMaterial } from '../../shared/ports.js';
import { ResultPayloadSchema, SourceSchema, type StopReason, type Claim, type ResultPayload } from '../../shared/contracts.js';
import { canonicalUrl, capturedMaterial, hashText, answerEvidence } from './evidence.js';
import { budgetStop, initialQuery, nextQueries, queryKey, readingCandidates, needsQueryReview } from './planner.js';
import { evaluationRequest, reviewRequest } from './prompts.js';
import { judge, reviewed } from './judge.js';
import { applyMode, hasCandidates, resolvedIdentity } from './modes/strategy.js';
import { atomicGoals, entityText } from './goals.js';
import { screenCaptureContext } from './context-screen.js';
import { discoveryDirections } from './discovery.js';
import { selectReadingLeads } from './reading-selection.js';
import {refreshRawReviewViews,isRawReviewView} from './raw-review-view.js';
import { reviewClaimPairs } from './claim-pairs.js';
import {claimIsolationGap,candidateIsolationGap,isolatedClaimReason,isolatedCandidateReason,hasClaimIsolation,hasCandidateIsolation} from './isolation.js';

const unique = (values: string[]) => [...new Set(values)].filter(Boolean).slice(0,80);
/** Capture/provenance identity is input; eventAt is a mutable mode judgement. */
function materialRevision(material:WorkingMaterial,selected:number[]) {
  return hashText(JSON.stringify(selected.map(index=>{
    const evidence=material.evidence[index]!,source=material.sources.find(item=>item.id===evidence.origin.id);
    return {index,id:evidence.id,origin:evidence.origin,contentHash:evidence.contentHash,excerpt:evidence.excerpt,locator:evidence.locator,limitations:evidence.limitations,
      source:source?{id:source.id,canonicalUrl:source.canonicalUrl,title:source.title,publisher:source.publisher,publishedAt:source.publishedAt,readStatus:source.readStatus,originGroup:source.originGroup,originReason:source.originReason}:null};
  })));
}
function invalidateExcludedEvidence(material:WorkingMaterial) {
  const excluded=material.evidence.filter(e=>e.limitations.some(limit=>/^(?:capture_screen_unverified|capture_scope_unrelated|capture_context_risk)/.test(limit)));
  const ids=new Set(excluded.map(e=>e.id)),reviewedSources=new Set(material.evidence.filter(e=>isRawReviewView(e)&&answerEvidence(e)).map(e=>e.origin.id)),sources=new Set(excluded.filter(e=>!reviewedSources.has(e.origin.id)).map(e=>e.origin.id));
  for(const claim of material.claims)if(claim.links.some(link=>ids.has(link.evidenceId))||hasClaimIsolation(claim)){claim.status='insufficient';claim.reasonSummary=isolatedClaimReason;claim.gaps=unique([claimIsolationGap,...claim.gaps]);claim.links=claim.links.map(link=>ids.has(link.evidenceId)?{...link,relation:'background' as const,rationale:'该捕获未核验、范围不对应或存在条件遗漏风险，仅保留历史定位，不能支持结论。'}:link);}
  for(const candidate of material.candidates)if(candidate.sourceIds.some(id=>sources.has(id))||hasCandidateIsolation(candidate)){candidate.reasonSummary=isolatedCandidateReason;candidate.matchedClues=[];candidate.conflictingClues=[];candidate.missingClues=unique([candidateIsolationGap,...candidate.missingClues]);}
}
function claimText(claim: Claim) {
  const label = {supported:'材料支持',refuted:'材料反驳',mixed:'存在支持与反对证据',insufficient:'证据不足'}[claim.status];
  const suffix = claim.conditions.length?'；条件：'+claim.conditions.join('；'):'';
  const gaps = claim.gaps.length?'；未解决：'+claim.gaps.join('；'):'';
  const text = `${label}：${claim.statement}${suffix}${gaps}`;
  return text.length<=10000?text:`${label}：${claim.statement}；完整条件和缺口见下列列表，不得去掉限定使用。`;
}
function outcome(input: InvestigationInput, material: WorkingMaterial, now: string, reason: StopReason, extra: string[] = [],verifiedConflicts:ResultPayload['conflicts']=[]): InvestigationOutcome {
  invalidateExcludedEvidence(material);
  if (!material.sources.length && !material.evidence.length) return InvestigationOutcomeSchema.parse({stopReason:reason,completion:'failed',draft:null,clarification:null});
  const conditions = unique([...material.claims.flatMap(c=>c.conditions),...(material.sources.some(s=>s.readStatus!=='full')?['部分材料没有完整正文，不能据此输出无条件结论。']:[])]);
  const unknowns = unique([...extra,...material.claims.flatMap(c=>c.gaps),...(material.evidence.some(e=>e.limitations.some(limit=>/^(?:capture_screen_unverified|capture_scope_unrelated|capture_context_risk)/.test(limit)))?['部分捕获未核验、范围不对应或有关键条件遗漏风险，未作为确证结论依据。']:[]),...(material.sources.some(s=>s.readStatus==='partial')?['正文截断，完整适用条件尚未核对。']:[])]);
  const blocks = material.claims.map(claim=>({id:'claim-'+claim.id,text:claimText(claim),claimIds:[claim.id],evidenceIds:unique(claim.links.map(l=>l.evidenceId))}));
  if(input.basicMode==='identify')for(const candidate of material.candidates)blocks.push({id:'candidate-'+candidate.id,text:`候选：${candidate.name}；匹配：${candidate.matchedClues.join('、')||'待核对'}；冲突：${candidate.conflictingClues.join('、')||'尚无已确认冲突'}；缺失：${candidate.missingClues.join('、')||'尚无'}`,claimIds:[],evidenceIds:material.evidence.filter(e=>candidate.sourceIds.includes(e.origin.id)&&answerEvidence(e)).map(e=>e.id)});
  const scopeStatus=input.basicMode==='identify'&&!material.evidence.some(answerEvidence)?`本轮尚无可核验身份的合格正文。当前用户明确陈述线索：${input.scope.knownClues.join('；')||'暂无'}；仍不确定的记忆：${input.scope.uncertainClues.join('；')||'暂无'}。${material.claims.length?'以下为保留的历史未采用命题，尚未核实，不代表本轮已确定候选。':''}`:'';
  const summary = [scopeStatus,blocks.length?blocks.map(b=>b.text).join('\n'):'已保存来源材料；目前不足以回答，尚未形成可核验结论。'].filter(Boolean).join('\n').slice(0,12000);
  const draft = ResultPayloadSchema.parse({schemaVersion:'0.1.0',investigationId:input.run.investigationId,runId:input.run.id,scope:input.scope,queryTime:now,summary,conditions,unknowns,nextSteps:[],stopReason:reason,
    sources:material.sources,evidence:material.evidence,claims:material.claims,candidates:material.candidates,conflicts:[...verifiedConflicts,...material.claims.filter(c=>c.status==='mixed'&&!verifiedConflicts.some(conflict=>conflict.claimIds.includes(c.id))).map(c=>({description:'同范围材料存在支持与反对，不能按来源数量消除冲突：'+c.statement,claimIds:[c.id],evidenceIds:unique(c.links.map(l=>l.evidenceId))}))],answerBlocks:blocks,attachments:[],delta:input.baseline?{previousVersionId:input.baseline.id,changes:[],checkedAt:now}:null});
  draft.nextSteps=input.basicMode==='identify'?unique(material.candidates.flatMap(c=>c.missingClues).map(clue=>'下一步可核对的区分线索：'+clue)):[];
  const identified=input.basicMode==='identify'&&!!resolvedIdentity(material);
  const completed = reason==='answered' && (identified||(material.claims.some(c=>c.status!=='insufficient') && material.claims.every(c=>c.status!=='insufficient')));
  return InvestigationOutcomeSchema.parse({stopReason:reason,completion:completed?'completed':'partial',draft,clarification:null});
}

export async function runInvestigation(raw: InvestigationInput, services: InvestigationServices, signal: AbortSignal): Promise<InvestigationOutcome> {
  const input = InvestigationInputSchema.parse(raw);
  const material = WorkingMaterialSchema.parse(input.checkpoint ?? {sources:[],evidence:[],claims:[],candidates:[],queries:[]});
  const scopeForGoals=input.scope;
  try {refreshRawReviewViews(input,material);}catch{return InvestigationOutcomeSchema.parse({stopReason:'invalid_output',completion:'failed',draft:null,clarification:null});}
  const seen = new Set(material.queries.map(queryKey));
  const discoveryQueries=new Set<string>();
  const readThisRun=new Set(material.sources.filter(source=>source.queryIds.some(id=>material.queries.some(query=>query.id===id&&query.runId===input.run.id))).map(source=>canonicalUrl(source.url)));
  let verifiedConflicts:ResultPayload['conflicts']=[];let hadUnavailableRead=false;
  const finish = (reason: StopReason, unknowns: string[] = []) => outcome(input,material,services.clock.now(),reason,[...(hadUnavailableRead?['部分已计划来源未取得正文，保留未决记录且未重试；其摘要未作为证据。']:[]),...unknowns],verifiedConflicts);
  const cancelled = () => signal.aborted;
  let unrestricted=false;
  const timeExpired = () => !unrestricted&&Date.parse(services.clock.now())>=Date.parse(input.context.deadlineAt);
  const stopped = (): StopReason | null => cancelled()?'cancelled':timeExpired()?'time_limit':null;
  const save = () => services.checkpoint.save(input.run.id,input.run.epoch,structuredClone(material));
  const event = (type: 'query.started'|'query.completed'|'source.read'|'evidence.updated'|'provider.failed',message: string,queryId: string|null=null,sourceIds: string[] = []) => services.events.append(input.run.id,input.run.epoch,{type,message,queryId,sourceIds,visibility:'public'});
  let pending:ReturnType<typeof initialQuery>[]=[];
  try {pending=material.evidence.length?[]:[initialQuery(input.scope)];}
  catch {return finish(cancelled()?'cancelled':'invalid_output',['无法保留合法的调查对象，未发送无对象或空查询。']);}
  if(input.intent==='followup'&&input.followupQuestion&&pending[0])pending[0].query=(entityText(input.scope.objectText).slice(0,300)+' '+input.followupQuestion.slice(0,650)).trim();
  const currentWindowQueries=()=>material.queries.filter(query=>query.budgetWindowId?query.budgetWindowId===input.context.budgetWindowId:query.runId===input.run.id);
  let rounds=Math.max(0,...currentWindowQueries().map(query=>query.batchNo)),windowBase=0,sentThisRun=0;const reviewedRevisions=new Set<string>(),evaluatedRevisions=new Set<string>(),evaluatedEvidence=new Set<string>();let currentUnknowns:string[]=[];let lastReason: StopReason = 'no_useful_direction';
  try {
    if(cancelled())return finish('cancelled');
    const initialBudget=await services.budget.snapshot(input.context);unrestricted=initialBudget.unrestricted===true;windowBase=initialBudget.used.searches+initialBudget.reserved.searches;lastReason=budgetStop(initialBudget,'search')??lastReason;
    while(true) {
      if(stopped())return finish(stopped()!);
      if(pending.length) {
        if(!unrestricted&&(rounds>=4 || windowBase+sentThisRun>=12))return finish('search_limit');
        let batch:number|null=null;
        for(const request of pending.slice(0,3)) {
          if(stopped())return finish(stopped()!);
          const key = queryKey(request); if(seen.has(key))continue;
          const searchBudget=await services.budget.snapshot(input.context);
          const attempts=Math.max(windowBase+sentThisRun,searchBudget.used.searches+searchBudget.reserved.searches,...currentWindowQueries().map(query=>query.attemptCount));
          if(!unrestricted&&attempts>=12)return finish('search_limit');
          const stop = budgetStop(searchBudget,'search');
          if(stop) { lastReason=stop; break; }
          if(batch===null)batch=++rounds;
          seen.add(key); const queryId = randomUUID();
          const query={...request,id:queryId,runId:input.run.id,budgetWindowId:input.context.budgetWindowId??undefined,scopeVersion:input.run.scopeVersion,batchNo:batch,attemptCount:attempts+1};
          if(!WorkingMaterialSchema.safeParse({...material,queries:[...material.queries,query]}).success)return finish('invalid_output',['历史查询留存容量不足，需P扩公共容量；没有丢弃未知历史或发送新请求。']);
          material.queries.push(query);
          await save(); await event('query.started','正在核对已确认范围的证据缺口。',queryId);
          if(stopped())return finish(stopped()!);
          let response;
          try { sentThisRun++;response=await services.search(request,input.context,signal); }
          catch { if(cancelled())return finish('cancelled'); await event('provider.failed','搜索未完成，停止本轮；没有自动重试。',queryId); return finish('provider_error'); }
          await save(); if(stopped())return finish(stopped()!);
          await event('query.completed',`检索返回${response.items.length}条候选，仅按计划选择材料。`,queryId);
          let selected=readingCandidates(response.items,request.limit);
          if(discoveryQueries.has(key)&&response.items.length){
            const selection=await selectReadingLeads({...input,scope:scopeForGoals},material,services,signal,save,request,queryId,response.items);
            if(selection.stop)return finish(selection.stop,[selection.unknown]);
            selected=selection.items;
          }
          for(const item of selected) {
            if(stopped())return finish(stopped()!);
            const url = canonicalUrl(item.url);
            if(material.sources.some(source=>canonicalUrl(source.url)===url&&source.diagnostic?.startsWith('read_attempt_unresolved:')))continue;
            if(readThisRun.has(url)||(input.intent!=='followup'&&material.sources.some(s=>canonicalUrl(s.url)===url)))continue;
            const stopRead = budgetStop(await services.budget.snapshot(input.context),'read'); if(stopRead)return finish(stopRead);
            if(stopped())return finish(stopped()!);
            // A capture contains at most three excerpts plus its original raw archive.
            if(!unrestricted&&(material.sources.length>=120||material.evidence.length+4>400))return finish('read_limit',['工作材料容量不足以完整保留读取记录与捕获，未发送请求。']);
            const sourceId = randomUUID();
            const sourceIndex=material.sources.length;
            material.sources.push(SourceSchema.parse({id:sourceId,url:item.url,canonicalUrl:url,title:item.title,publisher:item.publisher,publishedAt:item.publishedAt,eventAt:null,fetchedAt:null,readStatus:item.snippet.trim()?'snippet_only':'inaccessible',originGroup:null,originReason:null,queryIds:[queryId],snippet:item.snippet.trim()||null,contentHash:null,diagnostic:'read_attempt_unresolved: 拟读取，发送/费用及目标可达性未确认；仅保存搜索来源线索。'}));
            await save();
            if(stopped())return finish(stopped()!);
            let read;
            readThisRun.add(url);
            try { read = await services.read({url:item.url,sourceId},input.context,signal); }
            catch(error) { if(cancelled())return finish('cancelled'); if(error instanceof SourceReadUnavailableError){hadUnavailableRead=true;lastReason='provider_error';await event('provider.failed','一份来源未取得正文，保留未决记录且不重试；继续其他已计划来源。',queryId,[sourceId]);continue;} await event('provider.failed','来源读取未完成，停止本轮；保留未核验来源线索，没有自动重发。',queryId,[sourceId]); return finish('provider_error',['未取得该来源正文；发送、费用及目标可达性未确认，没有自动重发。']); }
            const captured = capturedMaterial(item,{...read,sourceId},queryId,input.scope);
            if(!unrestricted&&material.evidence.length+captured.evidence.length>400)return finish('read_limit');
            material.sources[sourceIndex]=captured.source; material.evidence.push(...captured.evidence);
            await save(); if(stopped())return finish(stopped()!);
            await event('source.read',captured.source.readStatus==='full'?'已保存一份来源捕获及可定位片段。':'材料读取不完整，已保留限制。',queryId,[sourceId]);
          }
        }
      }
      if(stopped())return finish(stopped()!);
      if(!material.evidence.length)return finish(lastReason,['未获得可核验正文；搜索摘要仅作线索。']);
      const screening=await screenCaptureContext(input,material,services,signal,save);
      invalidateExcludedEvidence(material);
      refreshRawReviewViews(input,material,true);
      await save();
      if(screening&&!screening.sourceOnly)return finish(screening.stop,[screening.unknown]);
      if(!material.evidence.some(answerEvidence)) {
        if(!unrestricted&&(rounds>=4||windowBase+sentThisRun>=12))return finish('search_limit',screening?[screening.unknown]:[]);
        const direction=await discoveryDirections({...input,scope:scopeForGoals},material,services,signal,save);
        pending=direction.queries;
        for(const query of pending)discoveryQueries.add(queryKey(query));
        if(pending.length)continue;
        return finish(direction.stop,[...(screening?[screening.unknown]:[]),direction.unknown]);
      }
      const budget = await services.budget.snapshot(input.context); const modelStop=budgetStop(budget,'model');
      if(modelStop)return finish(modelStop);
      const prepared = evaluationRequest(input,material,budget); if(!prepared)return finish('token_limit',['输入额度不足以提供可核验证据，不发送超额请求。']);
      const revision=materialRevision(material,prepared.selected);
      const evidenceRevisions=prepared.selected.map(index=>materialRevision(material,[index]));
      if(evaluatedRevisions.has(revision)||(evaluatedRevisions.size>0&&evidenceRevisions.every(item=>evaluatedEvidence.has(item)))) {
        const unexamined=material.evidence.some((evidence,index)=>answerEvidence(evidence)&&!evaluatedEvidence.has(materialRevision(material,[index])));
        return finish('no_useful_direction',[...currentUnknowns,unexamined?'本轮可核验输入没有新增；新材料已保存但尚未进入核验输入，未依据它改变原结论，保留已有审核与冲突。':'本轮可核验输入没有新增，保留已有审核与冲突，停止重复模型判断。']);
      }
      if(stopped())return finish(stopped()!);
      let response;
      try { evaluatedRevisions.add(revision);for(const item of evidenceRevisions)evaluatedEvidence.add(item);response = await services.model(prepared.request,input.context,signal); }
      catch { return finish(cancelled()?'cancelled':'provider_error',['模型判断未完成，已保留捕获材料。']); }
      if(stopped())return finish(stopped()!);
      let judgement = judge(response.value,material,scopeForGoals,prepared.selected);
      if(prepared.selected.some(index=>isRawReviewView(material.evidence[index]!)))judgement.needsReview=[...new Set([...judgement.needsReview,...judgement.claims.flatMap((claim,index)=>claim.status!=='insufficient'?[index]:[])])];
      if(judgement.fatalInvalidRefs)return finish('no_useful_direction',['模型输出整体无法核验，没有采用其中结论。']);
      if(prepared.omitted)judgement.unknowns.push('模型输入只选择部分证据片段，未展示材料不构成反证不存在。');
      let auditValue:unknown;let missingReviewStop:StopReason|null=null;
      if(judgement.needsReview.length || judgement.claims.filter(claim=>claim.status!=='insufficient').length>1 || (input.basicMode==='identify'&&hasCandidates(response.value)) || needsQueryReview(response.value,input.scope,material)) {
        const fresh = await services.budget.snapshot(input.context);
        const proposals=typeof response.value==='object'&&response.value!==null&&!Array.isArray(response.value)?response.value.nextQueries:undefined;
        const review = !reviewedRevisions.has(revision)&&!budgetStop(fresh,'model')?reviewRequest(prepared.request,judgement.claims,fresh,input.basicMode==='identify'?response.value:undefined,proposals):null;
        if(review) {
          reviewedRevisions.add(revision); if(stopped())return finish(stopped()!);
          try { const audit=await services.model(review,input.context,signal); if(stopped())return finish(stopped()!); auditValue=audit.value;judgement=reviewed(judgement,audit.value); }
          catch { judgement=reviewed(judgement,null); material.claims=judgement.claims;verifiedConflicts=[]; await save(); return finish(cancelled()?'cancelled':'provider_error',judgement.unknowns); }
        } else {judgement=reviewed(judgement,null);missingReviewStop=budgetStop(fresh,'model')??'token_limit';}
      }
      reviewClaimPairs(judgement,auditValue,scopeForGoals,material,prepared.selected);
      applyMode(input,material,judgement,response.value,auditValue,prepared.selected);
      material.claims=judgement.claims;verifiedConflicts=judgement.conflicts??[];currentUnknowns=judgement.unknowns; await save();
      await event('evidence.updated','已检查命题与来源片段的对应关系，保留条件和未知。');
      if(missingReviewStop)return finish(missingReviewStop,[...judgement.unknowns,'独立复核未发送：完整输入或可用额度不足，未跳过审核或执行未批准查询。']);
      const decisive = material.claims.length>0 && material.claims.every(c=>c.status!=='insufficient'&&!c.gaps.length) && !judgement.unknowns.some(gap=>gap.startsWith('核心'));
      const identified=input.basicMode==='identify'&&!!resolvedIdentity(material);
      const covered=judgement.coveredGoals.length===judgement.goals.length;
      if((decisive||identified) && covered && !judgement.unknowns.some(gap=>gap.startsWith('核心')) && !prepared.omitted)return finish('answered',judgement.unknowns);
      const gaps = unique([...judgement.unknowns,...material.claims.flatMap(c=>c.gaps)]);
      pending = nextQueries(response.value,scopeForGoals,material,gaps,judgement.goals.flatMap((_goal,index)=>judgement.coveredGoals.includes(index)?[]:[index]),auditValue,prepared.selected);
      if(!pending.length)return finish(lastReason,gaps);
      if(!unrestricted&&(rounds>=4 || windowBase+sentThisRun>=12))return finish('search_limit',gaps);
    }
  } catch {
    return finish(cancelled()?'cancelled':'provider_error',['工作材料或状态写入未完成，本轮停止，没有继续调用。']);
  }
}
