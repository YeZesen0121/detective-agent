import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import captures from './fixtures/t01-discovery-captures.json' with {type:'json'};
import {prepareInvestigation,runInvestigation} from '../../src/server/investigation/index.js';
import {scenario,directJudgement} from './controlled.js';
import type {ModelRequest,ModelResponse} from '../../src/shared/ports.js';
import {discoveryDirections} from '../../src/server/investigation/discovery.js';
import {capturedMaterial} from '../../src/server/investigation/evidence.js';
const response=(value:ModelResponse['value']):ModelResponse=>({value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
const question='元宝搜索 API 能直接搜索微信公众号文章吗？请核对官方明确的能力边界。';
function approvedNeutralDirection(request:ModelRequest){
 const gap=request.messages.map(message=>{try{return JSON.parse(message.content);}catch{return {};}}).find(body=>body.scopeGapQuery)?.scopeGapQuery;
 return {queryChecks:gap?[{...gap,scopeMatches:true,basis:'confirmed_scope',anchors:[],reason:'controlled_fixture 只批准逐字回显的原对象与目标中性方向'}]:[]};
}
it.each(['truth','latest'] as const)('grounds every new concrete %s question without requiring invented known clues',async basicMode=>{
 const s=scenario();s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.scope.grounded.v1'?{canLocate:true,object:{text:'元宝搜索 API',inputRef:'question',quote:'元宝搜索 API'},clues:[],goals:[{kind:'fact',text:question,inputRef:'question',quote:question}],resolutions:[]}:{objectSupported:true,allUserGoalsRepresented:true,clueChecks:[],goalChecks:[{goalIndex:0,inScope:true,reason:'能力和官方边界同一目标'}],criticalChecks:[]});};
 const prepared=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode,attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(prepared.canInvestigate).toBe(true);expect(prepared.scope?.objectText).toBe('元宝搜索 API');expect(prepared.scope?.knownClues).toEqual([]);expect(s.models.map(r=>r.schemaId)).toEqual(['investigation.scope.grounded.v1','investigation.scope.review.v1']);
});
function capturedScenario(){
 const s=scenario();s.input.scope={...s.input.scope,objectText:'元宝搜索 API',goal:question,claimsToCheck:[question],knownClues:[],uncertainClues:[]};
 s.services.search=async request=>{s.searches.push(request);return{items:s.searches.length===1?captures.items.map(item=>({...item,publisher:null,publishedAt:null,providerScore:null})):[],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};};
 s.services.read=async request=>{const item=captures.items.find(item=>item.url===request.url)!;s.reads.push(request.url);return{sourceId:request.sourceId,finalUrl:request.url,title:item.title,text:item.text,readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null};};
 s.services.model=async request=>{s.models.push(request);if(request.schemaId==='investigation.context-screen.v1'){const body=JSON.parse(request.messages[1]!.content);return response(body.chunk.includes('UgliAI')||body.chunk.includes('快速结论')?{screened:false,relevant:false,omittedRelevantQuotes:[],reason:'这是个人App页面，不能完成API范围核对'}:{screened:true,relevant:false,omittedRelevantQuotes:[],reason:'已检查当前完整分块，讨论个人助手而非该API'});}if(request.schemaId==='investigation.review.v1')return response(approvedNeutralDirection(request));throw Error('controlled_fixture must not evaluate unverified or unrelated captures');};return s;
}
it('isolates a failed screen in the three actual T01 captures and continues only a reviewed official direction',async()=>{
 const s=capturedScenario();const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(2);expect(s.searches[1]?.query).toContain('元宝搜索 API');expect(s.searches[1]?.query).toContain('微信公众号');expect(s.searches[1]?.query).toContain('官方介绍');expect(result.completion).toBe('partial');expect(result.draft?.claims).toEqual([]);expect(s.models.filter(r=>r.purpose==='plan')).toHaveLength(1);expect(s.models.some(r=>r.schemaId==='investigation.evaluate.v2')).toBe(false);expect(result.draft?.evidence.some(e=>e.limitations.some(l=>l.includes('pending')))).toBe(true);
 const before=s.models.length;s.input.checkpoint=s.checkpoints.at(-1)!;await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.models).toHaveLength(before);
});
it('keeps a sent unknown direction plan pending instead of replaying it on resume',async()=>{
 const s=capturedScenario();const model=s.services.model;s.services.model=async(request,context,signal)=>{if(request.promptVersion==='investigation.discovery.review.v3'){s.models.push(request);throw Error('controlled_fixture sent unknown');}return model(request,context,signal);};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(s.models.filter(r=>r.promptVersion==='investigation.discovery.review.v3')).toHaveLength(1);s.input.checkpoint=s.checkpoints.at(-1)!;const before=s.models.length;await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.models).toHaveLength(before);expect(s.searches).toHaveLength(1);
});
it('does not turn an irrelevant capture into an answer or grant an out-of-scope direction',async()=>{
 const s=capturedScenario();const model=s.services.model;s.services.model=async(request,context,signal)=>request.schemaId==='investigation.review.v1'?response({queryChecks:[{queryIndex:0,scopeMatches:false,goalIndex:0,anchors:[],reason:'拒绝方向'}]}):model(request,context,signal);
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(1);expect(result.completion).toBe('partial');expect(result.draft?.claims).toEqual([]);
});
it('treats a completed irrelevant screen as an excluded lead rather than invalid output',async()=>{
 const s=capturedScenario();const model=s.services.model;s.services.model=async(request,context,signal)=>{if(request.schemaId==='investigation.context-screen.v1'){s.models.push(request);expect(request.messages[0]?.content).toContain('screened表示是否完成核对，不表示与问题相关');return response({screened:true,relevant:false,omittedRelevantQuotes:[],reason:'完整核对，仅讨论另一产品层级'});}return model(request,context,signal);};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('no_useful_direction');expect(result.draft?.claims).toEqual([]);expect(s.searches).toHaveLength(2);expect(result.draft?.evidence.some(e=>e.limitations.some(l=>l.startsWith('capture_scope_unrelated')))).toBe(true);
});
it('does not accept an unlocatable screen quote as clearance while pursuing an independent direction',async()=>{
 const s=capturedScenario();const model=s.services.model;s.services.model=async(request,context,signal)=>request.schemaId==='investigation.context-screen.v1'?response({screened:true,relevant:true,omittedRelevantQuotes:['原文中没有的能力边界'],reason:'错误引句'}):model(request,context,signal);
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.claims).toEqual([]);expect(result.draft?.evidence.filter(e=>!e.limitations.some(l=>l.startsWith('raw_capture_only'))).every(e=>e.limitations.some(l=>l.startsWith('capture_screen_unverified')))).toBe(true);expect(s.searches).toHaveLength(2);
});
it('rejects an answer smuggled into direction planning rather than publishing it',async()=>{
 const s=capturedScenario();const model=s.services.model;s.services.model=async(request,context,signal)=>request.promptVersion==='investigation.discovery.review.v3'?response({claims:[{statement:'凭App可搜索所以API一定支持',status:'supported'}],nextQueries:[]}):model(request,context,signal);
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('no_useful_direction');expect(result.draft?.claims).toEqual([]);expect(s.searches).toHaveLength(1);
});
it('does not fabricate a raw source to persist a discovery plan',async()=>{
 const s=scenario();const result=await discoveryDirections(s.input,{sources:[],evidence:[],claims:[],candidates:[],queries:[]},s.services,new AbortController().signal,async()=>{});expect(result.queries).toEqual([]);expect(s.models).toHaveLength(0);expect(result.unknown).toMatch(/真实捕获|造来源/);
});
it('does not send a plan review or search after cancellation of its proposal',async()=>{
 const s=capturedScenario();const model=s.services.model,controller=new AbortController();s.services.model=async(request,context,signal)=>{const value=await model(request,context,signal);if(request.promptVersion==='investigation.discovery.review.v3')controller.abort();return value;};
 const result=await runInvestigation(s.input,s.services,controller.signal);expect(result.stopReason).toBe('cancelled');expect(s.models.filter(r=>r.purpose==='plan')).toHaveLength(1);expect(s.searches).toHaveLength(1);
});
it('can answer from a later independently checked source without using the failed long capture',async()=>{
 const s=scenario();const phrase='2026年受控活动报名截止2026年10月30日，仅限本科生。';s.services.search=async request=>{s.searches.push(request);return{items:[{url:'https://example.invalid/'+s.searches.length,title:'受控原文',snippet:'',publisher:null,publishedAt:null,providerScore:null}],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};};
 s.services.read=async request=>({sourceId:request.sourceId,finalUrl:request.url,title:null,text:request.url.endsWith('/1')?'其他产品介绍。\n\n背景甲。\n\n背景乙。\n\n无法定位原目标。':phrase,readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null});
 s.services.model=async request=>{s.models.push(request);if(request.schemaId==='investigation.context-screen.v1')return response({screened:false,relevant:false,omittedRelevantQuotes:[],reason:'无法完成该来源检查'});if(request.schemaId==='investigation.reading-selection.v1')return response({selectedIndexes:[0]});if(request.purpose==='plan')return response(approvedNeutralDirection(request));const body=JSON.parse(request.messages[1]!.content);expect(body.evidence).toHaveLength(1);expect(body.evidence[0].rawExcerpt).toBe(phrase);return response({claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[body.evidence[0].index],conditions:['仅限本科生'],gaps:[],reasonSummary:'独立新原句'}],answerBlocks:[]});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('completed');expect(s.searches).toHaveLength(2);expect(result.draft?.claims[0]?.links.every(link=>result.draft?.evidence.find(e=>e.id===link.evidenceId)?.excerpt===phrase)).toBe(true);expect(result.draft?.conditions).toContain('仅限本科生');
});
it.each(['review'] as const)('does not send a %s phase after persisting its marker consumes the remaining active time',async phase=>{
 const s=capturedScenario();let now='2026-10-25T00:00:00.000Z';s.services.clock.now=()=>now;const save=s.services.checkpoint.save;s.services.checkpoint.save=async(id,epoch,patch)=>{await save(id,epoch,patch);if(patch.evidence?.some(e=>e.limitations.some(l=>l.startsWith('direction_plan_state:')&&l.includes('"stage":"'+phase+'"'))))now=s.input.context.deadlineAt;};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('time_limit');expect(s.models.filter(r=>r.purpose==='plan')).toHaveLength(0);
});
it('downgrades a previously supported checkpoint claim if its source is now quarantined',async()=>{
 const s=scenario();const read=s.services.read;s.services.read=async(request,context,signal)=>({...await read(request,context,signal),text:'2026年受控活动报名截止2026年10月30日，仅限本科生。\n\n背景甲。\n\n背景乙。\n\n背景丙。\n\n页脚。'});
 s.services.model=async request=>response(request.schemaId==='investigation.context-screen.v1'?{screened:true,relevant:true,omittedRelevantQuotes:[],reason:'已完整核对无遗漏'}:request.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'截止日期原句'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'原截止目标'}]}:{...directJudgement(),claims:directJudgement().claims.map(claim=>({...claim,evidenceIndexes:[JSON.parse(request.messages[1]!.content).evidence[0].index]}))});
 const first=await runInvestigation(s.input,s.services,new AbortController().signal);expect(first.completion).toBe('completed');s.input.checkpoint=s.checkpoints.at(-1)!;expect(s.input.checkpoint.claims[0]?.status).toBe('supported');s.input.checkpoint.candidates.push({id:randomUUID(),name:'旧受控候选',aliases:[],sourceIds:[s.input.checkpoint.sources[0]!.id],matchedClues:['原线索'],conflictingClues:[],missingClues:[],reasonSummary:'旧版本有匹配'});s.input.scope.knownClues.push('需要原始通知');
 s.services.model=async request=>response(request.schemaId==='investigation.context-screen.v1'?{screened:false,relevant:false,omittedRelevantQuotes:[],reason:'本轮无法核对'}:{nextQueries:[]});const next=await runInvestigation(s.input,s.services,new AbortController().signal);expect(next.completion).toBe('partial');expect(next.draft?.claims[0]?.status).toBe('insufficient');expect(next.draft?.claims[0]?.links.every(link=>link.relation==='background')).toBe(true);expect(next.draft?.claims[0]?.gaps.join(' ')).toMatch(/未核验|不对应/);expect(next.draft?.candidates[0]?.matchedClues).toEqual([]);expect(next.draft?.candidates[0]?.missingClues.join(' ')).toMatch(/未核验/);
});
it('does not send context screening after saving the pending marker crosses the active deadline',async()=>{
 const s=capturedScenario();let now='2026-10-25T00:00:00.000Z';s.services.clock.now=()=>now;const save=s.services.checkpoint.save;s.services.checkpoint.save=async(id,epoch,patch)=>{await save(id,epoch,patch);if(patch.evidence?.some(e=>e.limitations.some(l=>l.startsWith('context_screen_state:')&&l.includes('"pending":['))))now=s.input.context.deadlineAt;};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('time_limit');expect(s.models).toHaveLength(0);
});
it('downgrades an old checkpoint conclusion when screening finds a missing exception but exhausts the model budget',async()=>{
 const s=scenario();const text='2026年受控活动报名截止2026年10月30日，仅限本科生。\n\n仅限完成流程甲的学生。\n\n仅限完成流程乙的学生。\n\n港澳学生延至11月10日。';const cap=capturedMaterial({url:'https://example.invalid/notice',title:'受控原文',snippet:'',publisher:null,publishedAt:null,providerScore:null},{sourceId:randomUUID(),finalUrl:'https://example.invalid/notice',title:null,text,readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null},randomUUID(),s.input.scope);
 s.input.checkpoint={sources:[cap.source],evidence:cap.evidence,claims:[{id:randomUUID(),statement:'报名截止2026年10月30日',status:'supported',conditions:[],gaps:[],reasonSummary:'旧checkpoint待重核',links:[{evidenceId:cap.evidence[0]!.id,relation:'supports',rationale:'旧引句'}]}],candidates:[],queries:[]};
 s.services.model=async()=>{s.setBudget({...s.budget(),remaining:{...s.budget().remaining,modelCalls:0}});return response({screened:true,relevant:true,omittedRelevantQuotes:['港澳学生延至11月10日。'],reason:'发现遗漏人群例外'});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('model_limit');expect(result.draft?.claims[0]?.status).toBe('insufficient');expect(result.draft?.unknowns.join(' ')).toMatch(/遗漏|条件/);
});
