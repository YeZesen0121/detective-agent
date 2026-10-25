import {expect,it} from 'vitest';
import {runInvestigation} from '../../src/server/investigation/engine.js';
import {scenario} from './controlled.js';
import type {ModelResponse} from '../../src/shared/ports.js';

const reply=(value:unknown):ModelResponse=>({value:value as ModelResponse['value'],usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
function setup(statements=['报名截止2026年10月30日','报名截止2026年10月20日']) {
 const s=scenario();s.input.scope.objectText='受控活动';s.input.scope.goal='核对报名安排';s.input.scope.claimsToCheck=['报名安排'];
 s.services.search=async()=>({items:statements.map((_text,index)=>({url:'https://example.invalid/pair-'+index,title:'主办方受控公告',snippet:'受控活动报名安排',publisher:'controlled_fixture',publishedAt:null,providerScore:null})),providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null});
 s.services.read=async request=>({sourceId:request.sourceId,finalUrl:request.url,title:null,text:'受控活动'+statements[Number(request.url.split('-').at(-1))]+'。',readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null});
 const value={claims:statements.map((statement,index)=>({statement,status:'supported',links:[{evidenceIndex:index,relation:'supports',quote:statement}],conditions:[],gaps:[],reasonSummary:'controlled_fixture 主办方原句'})),answerBlocks:[]};
 const audit={checks:statements.map((_text,claimIndex)=>({claimIndex,verdict:'supported',addressesQuestion:true,reason:'各自有正文原句依据'})),goalChecks:[{goalIndex:0,claimIndexes:statements.map((_text,index)=>index),covered:true,reason:'同一报名安排目标'}],claimPairChecks:[] as unknown[]};
 const pair=(left=0,right=1,relation='conflicts')=>({leftClaimIndex:left,rightClaimIndex:right,objectText:s.input.scope.objectText,sameObject:true,sameFactDimension:true,sameConditions:true,relation,left:{evidenceIndex:left,quote:statements[left]},right:{evidenceIndex:right,quote:statements[right]},reason:'同一对象、届次与适用人群下的截止值互斥，材料没有给出更新或替代关系'});
 s.services.model=async request=>{s.models.push(request);return reply(request.schemaId==='investigation.review.v1'?audit:value);};
 return {s,audit,pair};
}
const run=(s:ReturnType<typeof scenario>)=>runInvestigation(s.input,s.services,new AbortController().signal);
it('preserves a quote-bound conflict between separately supported claims rather than answering both as settled',async()=>{
 const {s,audit,pair}=setup();audit.claimPairChecks=[pair()];const result=await run(s);
 expect(result.completion).toBe('partial');expect(result.stopReason).not.toBe('answered');expect(result.draft?.claims.map(claim=>claim.status)).toEqual(['mixed','mixed']);
 expect(result.draft?.conflicts.some(conflict=>conflict.claimIds.length===2&&conflict.evidenceIds.length===2)).toBe(true);expect(result.draft?.unknowns.join(' ')).toMatch(/核心.*冲突/);expect(s.models).toHaveLength(2);
});
it.each(['missing','duplicate','bad_quote','wrong_echo','false_binding','unknown','extra'] as const)('retains supported claims but cannot silently complete a %s pair audit',async kind=>{
 const {s,audit,pair}=setup();const row=pair();audit.claimPairChecks=[row];
 if(kind==='missing')audit.claimPairChecks=[];if(kind==='duplicate')audit.claimPairChecks=[row,row];if(kind==='bad_quote')row.left.quote='正文没有的引句';if(kind==='wrong_echo')row.objectText='其他活动';if(kind==='false_binding')row.sameConditions=false;if(kind==='unknown')row.relation='unknown';if(kind==='extra')audit.claimPairChecks.push({...row,rightClaimIndex:22});
 const result=await run(s);expect(result.completion).toBe('partial');expect(result.draft?.conflicts).toEqual([]);expect(result.draft?.claims.map(claim=>claim.status)).toEqual(['supported','supported']);expect(result.draft?.unknowns.join(' ')).toMatch(/核心.*(?:对照|冲突)/);expect(s.models).toHaveLength(2);
});
it.each(['different_scope','different_dimension','cumulative','compatible'] as const)('does not invent a conflict for reviewed %s assertions',async relation=>{
 const statements=relation==='different_scope'?['本科生报名截止2026年10月30日','研究生报名截止2026年10月20日']:relation==='cumulative'?['要求本科生','还要求年龄不超过25岁']:relation==='different_dimension'?['报名免费','提供线上报名']:['报名免费','报名不收取费用'];
 const {s,audit,pair}=setup(statements);const row=pair(0,1,relation);row.sameConditions=relation!=='different_scope';row.sameFactDimension=relation!=='different_dimension';row.reason='保留各自适用条件和不同事实维度，未互相否定';audit.claimPairChecks=[row];const result=await run(s);
 expect(result.completion).toBe('completed');expect(result.draft?.conflicts).toEqual([]);expect(result.draft?.claims.map(claim=>claim.status)).toEqual(['supported','supported']);
});
it('does not compare independent atomic goals as competing answers',async()=>{
 const {s,audit}=setup(['报名免费','提供线上报名']);s.input.scope.goal='费用和报名方式';s.input.scope.claimsToCheck=['费用','报名方式'];audit.goalChecks=[{goalIndex:0,claimIndexes:[0],covered:true,reason:'费用'},{goalIndex:1,claimIndexes:[1],covered:true,reason:'方式'}];
 const result=await run(s);expect(result.completion).toBe('completed');expect(result.draft?.conflicts).toEqual([]);
});
it('cannot hide a supported competing assertion by omitting its goal ownership',async()=>{
 const {s,audit}=setup(['报名截止2026年10月30日','报名截止2026年10月31日','报名免费']);s.input.scope.goal='报名截止日和费用';s.input.scope.claimsToCheck=['报名截止日','费用'];audit.goalChecks=[{goalIndex:0,claimIndexes:[0],covered:true,reason:'只列了第一个截止日'},{goalIndex:1,claimIndexes:[2],covered:true,reason:'费用已回答'}];const result=await run(s);expect(result.completion).toBe('partial');expect(result.draft?.claims).toHaveLength(3);expect(result.draft?.claims.every(claim=>claim.status==='supported')).toBe(true);expect(result.draft?.unknowns.join(' ')).toMatch(/核心.*(?:归属|对照)/);
});
it('still obtains one independent pair audit for multiple extractive answers on the direct deadline-field path',async()=>{
 const {s,audit,pair}=setup();s.input.scope.goal='受控活动报名截止日期';s.input.scope.claimsToCheck=['受控活动报名截止日期'];audit.claimPairChecks=[pair()];const result=await run(s);expect(s.models.map(request=>request.schemaId)).toEqual(['investigation.evaluate.v2','investigation.review.v1']);expect(result.draft?.conflicts).toHaveLength(1);expect(result.completion).toBe('partial');
});
it('keeps audited conflict links and a partial report on a budget-limited resume without replaying evaluation',async()=>{
 const {s,audit,pair}=setup();audit.claimPairChecks=[pair()];const first=await run(s);expect(first.draft?.conflicts).toHaveLength(1);s.input.checkpoint=s.checkpoints.at(-1)!;s.setBudget({...s.budget(),canModel:false,remaining:{...s.budget().remaining,modelCalls:0}});const resumed=await run(s);expect(resumed.stopReason).toBe('model_limit');expect(resumed.completion).toBe('partial');expect(resumed.draft?.claims.map(claim=>claim.status)).toEqual(['mixed','mixed']);expect(resumed.draft?.conflicts.length).toBeGreaterThan(0);expect(resumed.draft?.claims.every(claim=>claim.links.some(link=>link.relation==='contradicts'))).toBe(true);expect(s.models).toHaveLength(2);
});
it('allows an independently approved original-update query for a conflicted goal without reopening an answered independent goal',async()=>{
 const {s,audit,pair}=setup(['报名截止2026年10月30日','报名截止2026年10月20日','报名免费']);s.input.scope.goal='报名安排和费用';s.input.scope.claimsToCheck=['报名安排','费用'];audit.goalChecks=[{goalIndex:0,claimIndexes:[0,1],covered:true,reason:'两份冲突日期'},{goalIndex:1,claimIndexes:[2],covered:true,reason:'费用原句'}];audit.claimPairChecks=[pair()];
 const model=s.services.model;s.services.model=async(r,c,a)=>{const result=await model(r,c,a);if(r.schemaId==='investigation.review.v1')Object.assign(result.value as object,{queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[],reason:'同一对象的原始更新公告可解决日期冲突'},{queryIndex:1,scopeMatches:true,goalIndex:1,anchors:[],reason:'费用已回答'}]});else Object.assign(result.value as object,{nextQueries:[{query:'受控活动 主办方延期更新公告',purpose:'解决日期冲突',goalIndex:0},{query:'受控活动 报名费用复查',purpose:'重复已回答费用',goalIndex:1}]});return result;};
 const search=s.services.search;let first=true;s.services.search=async(r,c,a)=>{s.searches.push(r);if(first){first=false;return search(r,c,a);}return {items:[],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};};
 const result=await run(s);expect(s.searches.map(query=>query.query)).toContain('受控活动 主办方延期更新公告');expect(s.searches.some(query=>query.query==='受控活动 报名费用复查')).toBe(false);expect(result.completion).toBe('partial');expect(result.draft?.conflicts).toHaveLength(1);expect(result.draft?.claims.map(claim=>claim.status)).toEqual(['mixed','mixed','supported']);expect(s.models).toHaveLength(2);
});
it('atomically replaces the conflict view with current claims when a later material review fails',async()=>{
 const {s,audit,pair}=setup();s.input.scope.goal='报名安排和住宿';s.input.scope.claimsToCheck=['报名安排','住宿'];audit.goalChecks=[{goalIndex:0,claimIndexes:[0,1],covered:true,reason:'互斥截止日'},{goalIndex:1,claimIndexes:[0],covered:false,reason:'住宿未知'}];audit.claimPairChecks=[pair()];
 const search=s.services.search;let searches=0;s.services.search=async(r,c,a)=>searches++===0?search(r,c,a):({items:[{url:'https://example.invalid/hotel',title:'受控住宿原始公告',snippet:'提供住宿',publisher:'controlled_fixture',publishedAt:null,providerScore:null}],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null});
 const read=s.services.read;s.services.read=async(r,c,a)=>r.url.endsWith('/hotel')?({...await read(r,c,a),text:'受控活动提供住宿。'}):read(r,c,a);
 const model=s.services.model;let evaluations=0;s.services.model=async(r,c,a)=>{if(r.schemaId==='investigation.review.v1'){if(evaluations>1){s.models.push(r);throw Error('controlled_fixture second material review failed');}const response=await model(r,c,a);Object.assign(response.value as object,{queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:1,anchors:[],reason:'原目标住宿缺口'}]});return response;}if(evaluations++===0){const response=await model(r,c,a);Object.assign(response.value as object,{nextQueries:[{query:'受控活动 原始住宿公告',purpose:'核对住宿',goalIndex:1}]});return response;}s.models.push(r);return reply({claims:[{statement:'提供住宿',status:'supported',links:[{evidenceIndex:2,relation:'supports',quote:'提供住宿'}],conditions:[],gaps:[],reasonSummary:'新增受控住宿原句'}],answerBlocks:[]});};
 const result=await run(s);expect(result.stopReason).toBe('provider_error');expect(result.completion).toBe('partial');expect(result.draft?.claims).toHaveLength(1);expect(result.draft?.claims[0]?.status).toBe('insufficient');expect(result.draft?.conflicts).toEqual([]);expect(result.draft?.evidence).toHaveLength(3);expect(s.checkpoints.some(cp=>cp.claims.length===2&&cp.claims.every(claim=>claim.status==='mixed'))).toBe(true);expect(s.models).toHaveLength(4);
});
it('preserves differently scoped annual notices without treating numeric differences as conflict',async()=>{
 const {s,audit,pair}=setup(['2025年报名截止10月30日','2026年报名截止10月20日']);const row=pair(0,1,'different_scope');row.sameConditions=false;row.reason='明确分别适用于不同届次';audit.claimPairChecks=[row];const result=await run(s);expect(result.draft?.conflicts).toEqual([]);expect(result.completion).toBe('completed');
});
it('bounds pair coverage and stops partial without discarding already supported claims or adding another review',async()=>{
 const {s,audit,pair}=setup(['要求学生身份','要求有效证件','要求在读','要求自行提交','要求遵守规则']);s.services.search=async()=>({items:[],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null});
 // Five independently captured requirements are a valid checkpoint; ten comparisons exceed the six-row review allowance.
 const warm=setup(['要求学生身份','要求有效证件','要求在读']);await run(warm.s);const cp=warm.s.checkpoints.at(-1)!;
 const source=cp.sources[0]!,evidence=cp.evidence[0]!;const {randomUUID}=await import('node:crypto');
 for(const text of ['要求自行提交','要求遵守规则']){const id=randomUUID();cp.sources.push({...source,id,url:'https://example.invalid/'+id,canonicalUrl:'https://example.invalid/'+id});cp.evidence.push({...evidence,id:randomUUID(),origin:{kind:'source',id},excerpt:'受控活动'+text+'。'});}
 s.input.checkpoint=cp;audit.claimPairChecks=[pair(0,1,'cumulative'),pair(0,2,'cumulative'),pair(0,3,'cumulative'),pair(0,4,'cumulative'),pair(1,2,'cumulative'),pair(1,3,'cumulative')];
 const result=await run(s);expect(result.completion).toBe('partial');expect(result.draft?.claims).toHaveLength(5);expect(result.draft?.claims.every(claim=>claim.status==='supported')).toBe(true);expect(result.draft?.unknowns.join(' ')).toMatch(/核心.*(?:容量|上限)/);expect(s.models).toHaveLength(2);
});
