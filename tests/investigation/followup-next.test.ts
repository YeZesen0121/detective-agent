import { expect, it } from 'vitest';
import { routeFollowup, runInvestigation } from '../../src/server/investigation/index.js';
import { randomUUID } from 'node:crypto';
import { samplePayload, ids, at } from '../helpers/result.js';
import { scenario, hash } from './controlled.js';
function setup(question:string){const s=scenario();const payload=samplePayload();s.services.model=async request=>{s.models.push(request);return{value:{route:'research_same_scope',scopeMatches:true,objectText:payload.scope.objectText},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};const version={id:ids.source,investigationId:payload.investigationId,runId:payload.runId,previousVersionId:null,createdAt:at,payloadHash:hash(JSON.stringify(payload)),payload};return {s,input:{context:s.input.context,version,question,remainingBudget:structuredClone(s.budget())}};}
it('explains saved evidence with its conditions and citations without searching',async()=>{
 const {s,input}=setup('为什么得出这个结论，依据是什么？');const result=await routeFollowup(input,s.services,new AbortController().signal);
 expect(result.route).toBe('explain');expect(result.answer?.claimIds).toContain(ids.claim);expect(result.answer?.evidenceIds).toContain(ids.evidence);expect(result.answer?.text).toContain('十月三十日');expect(s.searches).toHaveLength(0);expect(s.models).toHaveLength(0);
});
it('can explain existing material even after research funds are exhausted',async()=>{
 const {s,input}=setup('解释已有证据的限制');input.remainingBudget.canSearch=false;input.remainingBudget.canModel=false;input.remainingBudget.remaining.moneyMicros=0;
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('explain');expect(s.models).toHaveLength(0);
});
it('routes an explicit same-scope gap to research without doing the search itself',async()=>{
 const {s,input}=setup('请对同一活动补查有没有延期公告');const result=await routeFollowup(input,s.services,new AbortController().signal);
 expect(result.route).toBe('research_same_scope');expect(result.researchPurpose).toContain('延期');expect(s.searches).toHaveLength(0);
});
it('suggests a new case instead of silently changing the object or edition',async()=>{
 const {s,input}=setup('改查另一个活动：2024年的受控活动');const result=await routeFollowup(input,s.services,new AbortController().signal);
 expect(result.route).toBe('suggest_new_case');expect(result.suggestedQuestion).toBe(input.question);expect(s.models).toHaveLength(0);
});
it('requires budget confirmation for a new same-scope research step without refreshing funds',async()=>{
 const {s,input}=setup('请对同一活动补查延期公告');input.remainingBudget.canSearch=false;
 const before=structuredClone(input.remainingBudget);const result=await routeFollowup(input,s.services,new AbortController().signal);
 expect(result.route).toBe('needs_budget_confirmation');expect(input.remainingBudget).toEqual(before);expect(s.searches).toHaveLength(0);
});
it('preserves an independent scope veto when the primary research response has a different object label',async()=>{
 const {s,input}=setup('还可以进一步核对另一个产品吗');s.services.model=async request=>({value:request.schemaId==='investigation.followup.v1'?{route:'research_same_scope',scopeMatches:true,objectText:'另一个产品',researchPurpose:'改查另一个产品'}:{scopeMatches:false,objectText:input.version.payload.scope.objectText,intent:'new_case',deltas:[],requestQuote:null,reason:'用户提出另一个产品'},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('suggest_new_case');expect(s.searches).toHaveLength(0);
});
it('makes no new call after cancellation',async()=>{
 const {s,input}=setup('需要继续查吗');const controller=new AbortController();controller.abort();
 await expect(routeFollowup(input,s.services,controller.signal)).rejects.toThrow();expect(s.models).toHaveLength(0);
});
it('preserves saved version conditions and unresolved goals in an explanation',async()=>{
 const {s,input}=setup('解释已有证据的限制');input.version.payload.conditions=['仅适用于境内本科生'];input.version.payload.unknowns=['住宿尚未核对'];
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.answer?.text).toContain('仅适用于境内本科生');expect(result.answer?.text).toContain('住宿尚未核对');
});
it('can explain why an older dated source appears in this fixed version without changing cases',async()=>{
 const {s,input}=setup('为什么这个结论使用2024年的旧通知？');input.version.payload.scope.objectText='2026年受控活动';input.version.payload.claims[0]!.conditions=['引文来自2024年旧通知，不能作为2026年报名依据'];
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('explain');expect(result.answer?.text).toContain('旧通知');expect(s.searches).toHaveLength(0);
});
it('classifies an added target instead of treating same-object wording as permission to expand scope',async()=>{
 const {s,input}=setup('请对同一活动补查住宿和保险安排');s.services.model=async request=>{s.models.push(request);return{value:{route:'suggest_new_case',scopeMatches:false,objectText:input.version.payload.scope.objectText},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('suggest_new_case');expect(s.models).toHaveLength(1);expect(s.models.every(request=>request.purpose==='followup')).toBe(true);expect(s.searches).toHaveLength(0);expect(s.reads).toHaveLength(0);expect(s.checkpoints).toHaveLength(0);
});
it('uses the interaction grant for route classification and the research window for the resulting action',async()=>{
 const {s,input}=setup('还可以进一步核对吗');input.remainingBudget.remaining.moneyMicros=0;input.remainingBudget.canSearch=false;
 s.services.model=async request=>{s.models.push(request);return{value:{route:'research_same_scope',scopeMatches:true,objectText:input.version.payload.scope.objectText},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(s.models).toHaveLength(1);expect(result.route).toBe('needs_budget_confirmation');expect(result.researchPurpose).toContain(input.version.payload.scope.objectText);expect(s.models[0]!.maxOutputTokens).toBeLessThanOrEqual(2000);
});
it('does not authorize a new research purpose when the interaction pool was exhausted before scope classification',async()=>{
 const {s,input}=setup('奖金金额是多少');s.setBudget({...s.budget(),canModel:false,remaining:{...s.budget().remaining,modelCalls:0}});const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('needs_budget_confirmation');expect(result.researchPurpose).toBeNull();expect(s.models).toHaveLength(0);
});
it('does not trust a model budget route as an already authorized research scope',async()=>{
 const {s,input}=setup('奖金金额是多少');s.services.model=async()=>({value:{route:'needs_budget_confirmation',scopeMatches:true,objectText:input.version.payload.scope.objectText,researchPurpose:'模型自行填入的研究目的'},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'});const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('needs_budget_confirmation');expect(result.researchPurpose).toBeNull();
});
it('stops after one malformed or failed route response without retrying or searching',async()=>{
 const {s,input}=setup('进一步说明它的含义');s.services.model=async request=>{s.models.push(request);return{value:{route:'explain',scopeMatches:true,objectText:input.version.payload.scope.objectText,claimIndexes:[999]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_REFERENCE_OUT_OF_VERSION');expect(s.models).toHaveLength(1);expect(s.searches).toHaveLength(0);
});
it('does not explain a claimed extension to another object and edition as though the saved scope covered it',async()=>{
 const {s,input}=setup('为什么这个结论也适用于北京大学2027年的活动？');input.version.payload.scope.objectText='2026年受控活动';
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('suggest_new_case');expect(s.searches).toHaveLength(0);
});
it('classifies mixed sentences with another edition instead of matching a saved-reference substring',async()=>{
 for(const question of ['关于北京大学2027年活动，这个结论的依据是什么？','解释这个结论对2027年受控活动的报名条件。']){const {s,input}=setup(question);input.version.payload.scope.objectText='2026年受控活动';const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('suggest_new_case');expect(s.searches).toHaveLength(0);}
});
it('requires confirmation when research model or reading allowance is exhausted despite an available interaction grant',async()=>{
 for(const exhausted of ['model','read'] as const){const {s,input}=setup('请对同一活动补查延期公告');if(exhausted==='model'){input.remainingBudget.canModel=false;input.remainingBudget.remaining.modelCalls=0;input.remainingBudget.remaining.outputTokens=0;}else{input.remainingBudget.canRead=false;input.remainingBudget.remaining.reads=0;}
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('needs_budget_confirmation');expect(s.models).toHaveLength(1);expect(s.searches).toHaveLength(0);}
});
it('refreshes an already captured URL once during an explicitly authorized followup and preserves both captures',async()=>{
 const s=scenario();await runInvestigation(s.input,s.services,new AbortController().signal);const checkpoint=s.checkpoints.at(-1)!;const previous=s.input.run.id;const nextRun=randomUUID();s.input={...s.input,intent:'followup',followupQuestion:'延期后的报名截止日期是什么？',checkpoint,run:{...s.input.run,id:nextRun,previousRunId:previous,trigger:'followup'},context:{...s.input.context,runId:nextRun}};
 s.searches.length=0;s.reads.length=0;s.setBudget({...s.budget(),used:{...s.budget().used,searches:1}});const read=s.services.read;s.services.read=async(r,c,a)=>({...await read(r,c,a),text:'2026年受控活动原报名截止2026年10月30日现已延期，报名截止2026年10月31日，仅限本科生。'});
 let evaluations=0;s.services.model=async request=>{
  if(request.schemaId==='investigation.review.v1')return{value:evaluations===1?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'原截止'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:false,reason:'原截止目标需核对延期公告'}],queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[],reason:'同一报名目标补查延期'}]}:{checks:[{claimIndex:0,verdict:'refuted',addressesQuestion:true,reason:'后续公告使原截止不再适用'},{claimIndex:1,verdict:'supported',addressesQuestion:true,reason:'更新截止原句'}],goalChecks:[{goalIndex:0,claimIndexes:[0,1],covered:true,reason:'原截止目标已由延期公告更新'}],claimPairChecks:[{leftClaimIndex:0,rightClaimIndex:1,objectText:s.input.scope.objectText,sameObject:true,sameFactDimension:true,sameConditions:true,relation:'compatible',left:{evidenceIndex:1,quote:'原报名截止2026年10月30日现已延期'},right:{evidenceIndex:1,quote:'报名截止2026年10月31日'},reason:'旧日期已反驳与新日期被支持相容'}]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};
  evaluations++;return{value:evaluations===1?{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[0],conditions:['仅限本科生'],gaps:[],reasonSummary:'旧捕获'}],answerBlocks:[],nextQueries:[{query:'2026年受控活动 延期公告',purpose:'新公告核对',goalIndex:0}]}:{claims:[{statement:'报名截止2026年10月30日',status:'refuted',links:[{evidenceIndex:1,relation:'contradicts',quote:'原报名截止2026年10月30日现已延期'}],conditions:['仅限本科生'],gaps:[],reasonSummary:'已延期'},{statement:'报名截止2026年10月31日',status:'supported',evidenceIndexes:[1],conditions:['仅限本科生'],gaps:[],reasonSummary:'更新原句'}],answerBlocks:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};
 };
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.reads).toHaveLength(1);expect(result.draft?.sources).toHaveLength(2);expect(result.draft?.evidence.some(e=>e.excerpt.includes('现已延期'))).toBe(true);expect(result.completion,JSON.stringify(result)).toBe('completed');expect(checkpoint.sources).toHaveLength(1);
});
it('explains saved identity candidates and their distinguishing evidence without inventing factual claims',async()=>{
 const {s,input}=setup('解释这个结论的依据');input.version.payload.scope.basicMode='identify';input.version.payload.claims=[];input.version.payload.answerBlocks=[];input.version.payload.candidates=[{id:randomUUID(),name:'受控电影甲',aliases:[],sourceIds:[ids.source],matchedClues:['成年音乐教师','不确定记忆：钢琴'],conflictingClues:[],missingClues:['上映年份尚未确认'],reasonSummary:'固定版本英文材料中有相应角色描述'}];
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('explain');expect(result.answer?.text).toContain('受控电影甲');expect(result.answer?.text).toContain('成年音乐教师');expect(result.answer?.text).toContain('上映年份尚未确认');expect(result.answer?.claimIds).toEqual([]);expect(result.answer?.evidenceIds).toContain(ids.evidence);expect(s.searches).toHaveLength(0);expect(s.models).toHaveLength(0);
});
it('routes a comparison of saved identity candidates using their fixed version context',async()=>{
 const {s,input}=setup('受控电影甲与受控电影乙有哪些匹配线索差异？');input.version.payload.scope.basicMode='identify';input.version.payload.claims=[];input.version.payload.answerBlocks=[];input.version.payload.candidates=['受控电影甲','受控电影乙'].map(name=>({id:randomUUID(),name,aliases:[],sourceIds:[ids.source],matchedClues:['音乐'],conflictingClues:[],missingClues:['年龄线索'],reasonSummary:'固定材料'}));
 s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content) as {candidates?:unknown[]};return{value:request.schemaId==='investigation.followup.intent.v1'?{scopeMatches:true,objectText:input.version.payload.scope.objectText,intent:'explain_saved',deltas:[],requestQuote:null,reason:'比较固定版本已有两候选'}:{route:body.candidates?.length===2?'explain':'suggest_new_case',scopeMatches:true,objectText:input.version.payload.scope.objectText,claimIndexes:[]},usage:null,providerRequestId:null,modelId:'controlled_fixture',finishReason:'stop'};};
 const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('explain');expect(result.answer?.text).toContain('受控电影甲');expect(result.answer?.text).toContain('受控电影乙');expect(s.searches).toHaveLength(0);
});
