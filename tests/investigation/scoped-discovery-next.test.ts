import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {discoveryDirections} from '../../src/server/investigation/discovery.js';
import {runInvestigation} from '../../src/server/investigation/engine.js';
import {createTruthRuntime} from '../../src/server/platform/truth-runtime.js';
import {answerEvidence,quoteRange} from '../../src/server/investigation/evidence.js';
import {scenario} from './controlled.js';
import {fixture,f01Scope,f01Material,beforePlan,reply,approvedGap,scopeGap,unresolvedDiscoveryMaterial} from './f01-discovery-fixture.js';
function setup(){const s=scenario();s.input.basicMode='identify';s.input.scope=f01Scope();s.input.checkpoint=unresolvedDiscoveryMaterial();s.services.model=async request=>{s.models.push(request);return reply(request.schemaId==='investigation.reading-selection.v1'?{selectedIndexes:[0]}:approvedGap(request));};return s;}
it('locates both actual screen quotes while retaining all old context risks and the pending source',()=>{
 const material=f01Material(),raw=material.evidence.find(e=>e.origin.id===material.sources[1]!.id&&e.limitations.some(l=>l.startsWith('raw_capture_only')))!;
 for(const quote of fixture.screenResponses[0]!.omittedRelevantQuotes)expect(quoteRange(raw.excerpt,quote)).not.toBeNull();expect(material.evidence.filter(answerEvidence)).toHaveLength(0);expect(material.evidence.some(e=>e.limitations.some(l=>l.includes('"pending":[0,880]')))).toBe(true);
});
it('adds one neutral original-scope direction to the actual unsupported candidate plan only with an exact independent echo',async()=>{
 const s=setup(),material=s.input.checkpoint!,old=structuredClone(material);const result=await discoveryDirections(s.input,material,s.services,new AbortController().signal,async()=>{});
 expect(result.queries).toHaveLength(1);expect(result.queries[0]!.query).toContain(s.input.scope.objectText);for(const clue of s.input.scope.knownClues)expect(result.queries[0]!.query).toContain(clue);expect(result.queries[0]!.query).not.toMatch(/Soul|心灵奇旅/);expect(result.queries[0]!.claimIds).toEqual([]);expect(s.models).toHaveLength(1);expect(material.claims).toEqual(old.claims);expect(material.candidates).toEqual(old.candidates);
 for(const [index,evidence] of old.evidence.entries())expect(material.evidence[index]!.limitations.filter(l=>!l.startsWith('direction_plan_state:'))).toEqual(evidence.limitations.filter(l=>!l.startsWith('direction_plan_state:')));
});
it('gives the independent discovery reviewer a complete structured echo protocol without the rejected candidate proposals',async()=>{
 const s=setup();await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});
 const review=s.models.find(request=>request.schemaId==='investigation.review.v1')!,body=JSON.parse(review.messages.at(-1)!.content);
 expect(body.outputContract?.properties?.queryChecks?.items?.required).toEqual(expect.arrayContaining(['queryIndex','queryText','objectText','goalIndex','scopeMatches','basis','anchors','reason']));
 expect(review.messages[0]!.content).toContain('outputContract');expect(body.scope).toEqual(s.input.scope);expect(body.scopeGapQuery).toBeDefined();
 expect(JSON.stringify(review.messages)).not.toMatch(/Soul|心灵奇旅/);
});
it.each([true,false])('rejects an unsupported candidate query even when it repeats the original object; approved fallback=%s',async approveFallback=>{
 const s=setup();expect(s.input.checkpoint!.evidence.filter(answerEvidence)).toHaveLength(0);
 s.services.model=async request=>{
  s.models.push(request);
  if(request.schemaId==='investigation.plan.v1')return reply({nextQueries:[{query:s.input.scope.objectText+' Soul 心灵奇旅 主角是成年男老师',purpose:'controlled_fixture 未核片名假设',goalIndex:0}]});
  const gap=scopeGap(request)!;
  return reply({queryChecks:[...(approveFallback?[{...gap,scopeMatches:true,basis:'confirmed_scope',anchors:[],reason:'只批准逐字回显的原范围中性查询'}]:[])]});
 };
 const result=await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});
 expect(result.queries).toHaveLength(approveFallback?1:0);
 expect(result.queries.every(query=>!(/Soul|心灵奇旅/.test(query.query)))).toBe(true);
 expect(s.models).toHaveLength(1);expect(s.input.checkpoint!.candidates).toEqual([]);
});
it.each(['old_response','wrong_query','wrong_object','wrong_goal','scope_false','fake_evidence','missing_echo','missing_anchors'] as const)('rejects a scope fallback with %s without adopting unsupported names',async kind=>{
 const s=setup();s.services.model=async request=>{s.models.push(request);if(request.schemaId==='investigation.plan.v1')return reply(fixture.proposal);if(kind==='old_response')return reply(fixture.audit);const audit=approvedGap(request),row=audit.queryChecks.at(-1)! as Record<string,unknown>;if(kind==='wrong_query')row.queryText='另一条原文没有的查询';if(kind==='wrong_object')row.objectText='另一对象';if(kind==='wrong_goal')row.goalIndex=77;if(kind==='scope_false')row.scopeMatches=false;if(kind==='fake_evidence')row.anchors=[{text:'Soul',evidenceIndex:0,quote:'Soul'}];if(kind==='missing_echo')delete row.queryText;if(kind==='missing_anchors')delete row.anchors;return reply(audit);};
 const result=await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(result.queries).toEqual([]);expect(s.input.checkpoint!.candidates).toEqual([]);expect(s.models).toHaveLength(1);
});
it('keeps an unresolved-screen snapshot quiet on resume and labels current user scope separately from historical failed claims',async()=>{
 const s=setup();s.input.checkpoint=unresolvedDiscoveryMaterial(f01Material());s.input.run.trigger='resume';const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.models).toHaveLength(0);expect(s.searches).toHaveLength(0);expect(result.completion).toBe('partial');expect(result.draft?.summary).toMatch(/用户.*线索/);expect(result.draft?.summary).toContain('主角是成年男老师');expect(result.draft?.summary).toContain('好像弹钢琴');expect(result.draft?.summary).toMatch(/历史.*未(?:核实|采用)/);expect(result.draft?.candidates).toEqual([]);
});
it('keeps current scope and uncertainty through the production wrapper even when historical failed answer blocks exist',async()=>{
 const s=setup();s.input.checkpoint=unresolvedDiscoveryMaterial(f01Material());s.input.run.trigger='resume';const before=structuredClone(s.input.checkpoint),funds=s.budget().limits;
 const module=createTruthRuntime({credentials:{search:{kind:'bearer',apiKey:'controlled_fixture'},deepseekKey:'controlled_fixture'},funding:{global:funds,trial:funds,demo:funds},fetch:async()=>{throw Error('controlled_fixture forbids external transport');}}).module;
 const result=await module.runInvestigation(s.input,s.services,new AbortController().signal);
 expect(result.draft!.answerBlocks.length).toBeGreaterThan(0);expect(result.draft!.summary).toContain('当前用户明确陈述线索');
 expect(result.draft!.summary).toContain('主角是成年男老师');expect(result.draft!.summary).toContain('好像弹钢琴');expect(result.draft!.summary).toContain('历史未采用命题');
 expect(result.completion).toBe('partial');expect(s.input.checkpoint).toEqual(before);expect(s.models).toHaveLength(0);expect(s.searches).toHaveLength(0);
});
it('uses a truly fresh qualified capture after the neutral search without clearing old risks or promoting an old candidate',async()=>{
 const s=setup(),model=s.services.model;const text='受控影片甲是一部动画电影，与音乐有关，主角是一名成年男老师并进入灵魂世界。';s.services.search=async request=>{s.searches.push(request);return {items:[{url:'https://example.invalid/controlled-primary',title:'controlled_fixture 原始简介',snippet:'',publisher:'controlled_fixture',publishedAt:null,providerScore:null}],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};};
 s.services.read=async request=>{s.reads.push(request.url);return {sourceId:request.sourceId,finalUrl:request.url,title:null,text,readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null};};
 s.services.model=async(request,context,signal)=>{if(request.purpose==='plan')return model(request,context,signal);s.models.push(request);const body=JSON.parse(request.messages[1]!.content),index=body.evidence[0].index;expect(body.evidence).toHaveLength(1);return reply(request.schemaId==='investigation.review.v1'?{checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],clueChecks:[...s.input.scope.knownClues.map((clueText,clueIndex)=>({clueIndex,clueKind:'known',clueText,relation:'matches',evidenceIndex:index,quote:clueIndex===0?'与音乐有关':clueIndex===1?'进入灵魂世界':'一名成年男老师',reason:'只核对新捕获原语'})),...s.input.scope.uncertainClues.map((clueText,clueIndex)=>({clueIndex,clueKind:'uncertain',clueText,relation:'unknown',evidenceIndex:index,quote:'一名成年男老师',reason:'没有证实钢琴记忆'}))],reason:'候选尚不唯一'}]}:{claims:[],answerBlocks:[],candidates:[{name:'受控影片甲',aliases:[],evidenceIndexes:[index],missingClues:['其他记忆候选仍待排除'],reasonSummary:'新原始材料提供可核候选，不继承旧无效主张'}]});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(1);expect(s.reads).toHaveLength(1);expect(result.draft?.candidates.map(candidate=>candidate.name)).toEqual(['受控影片甲']);expect(result.completion).toBe('partial');expect(s.models.filter(request=>request.schemaId==='investigation.evaluate.v2')).toHaveLength(1);expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('capture_context_risk')))).toHaveLength(6);expect(result.draft?.evidence.some(e=>e.limitations.some(l=>l.includes('"pending":[0,880]')))).toBe(true);
});
it.each(['proposal','review'] as const)('never replays an old unknown %s plan even in a new approved followup',async stage=>{
 const s=setup();s.input.intent='followup';s.input.run.trigger='followup';s.input.followupQuestion='请在原范围继续补查原始材料';const raw=s.input.checkpoint!.evidence.find(e=>e.limitations.some(l=>l.startsWith('raw_capture_only')))!;raw.limitations.push('direction_plan_state:'+JSON.stringify({revision:'old',stage,runId:randomUUID()}));const result=await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(result.queries).toEqual([]);expect(s.models).toHaveLength(0);
});
it('allows one new admitted followup after an old done plan but not the same run, resume or budget-only continuation',async()=>{
 const s=setup();s.input.checkpoint=unresolvedDiscoveryMaterial(f01Material());s.input.intent='followup';s.input.run.trigger='followup';s.input.followupQuestion='请在原电影范围继续补查原始介绍';const first=await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(first.queries).toHaveLength(1);expect(s.models).toHaveLength(1);await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(s.models).toHaveLength(1);
 for(const trigger of ['resume','initial'] as const){s.input.run={...s.input.run,id:randomUUID(),trigger};await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(s.models).toHaveLength(1);}s.input.run.trigger='followup';s.input.followupQuestion=null;await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(s.models).toHaveLength(1);
});
it('does not turn another failed capture into a second discovery phase in the same run or a budget-only resume',async()=>{
 const s=setup();await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(s.models).toHaveLength(1);const source=s.input.checkpoint!.sources[0]!;s.input.checkpoint!.sources.push({...source,id:randomUUID(),url:'https://example.invalid/another-unverified',canonicalUrl:'https://example.invalid/another-unverified'});await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(s.models).toHaveLength(1);s.input.run={...s.input.run,id:randomUUID(),trigger:'resume'};await discoveryDirections(s.input,s.input.checkpoint!,s.services,new AbortController().signal,async()=>{});expect(s.models).toHaveLength(1);
});
it('preserves unchanged-scope unresolved screens in a new admitted followup while leaving pending and risks quarantined',async()=>{
 const s=setup();s.input.checkpoint=unresolvedDiscoveryMaterial(f01Material());s.input.intent='followup';s.input.run.trigger='followup';s.input.followupQuestion='请在原电影范围补查原始资料，继续核对名称。';s.services.search=async request=>{s.searches.push(request);return {items:[],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.models.map(request=>request.purpose)).toEqual(['plan']);expect(s.searches).toHaveLength(1);expect(s.reads).toHaveLength(0);expect(result.completion).toBe('partial');expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('capture_context_risk')))).toHaveLength(6);expect(result.draft?.evidence.some(e=>e.limitations.some(l=>l.includes('"pending":[0,880]')))).toBe(true);
});
it('focuses a fresh neutral direction on the newest confirmed clue after the full-clue query and never rereads an unresolved source',async()=>{
 const s=setup(),material=s.input.checkpoint!,scope=structuredClone(s.input.scope);
 const first=await discoveryDirections(s.input,material,s.services,new AbortController().signal,async()=>{}),queryId=randomUUID();
 material.queries.push({...first.queries[0]!,id:queryId,runId:s.input.run.id,budgetWindowId:s.input.run.budgetWindowId,scopeVersion:s.input.run.scopeVersion,batchNo:1,attemptCount:1});
 const failed={...material.sources[0]!,id:randomUUID(),url:'https://example.invalid/unresolved-read',canonicalUrl:'https://example.invalid/unresolved-read',readStatus:'snippet_only' as const,diagnostic:'read_attempt_unresolved: controlled_fixture sent request has no result',queryIds:[queryId],contentHash:null};material.sources.push(failed);
 s.input.intent='followup';s.input.run={...s.input.run,id:randomUUID(),trigger:'followup'};s.input.context={...s.input.context,runId:s.input.run.id};s.input.followupQuestion='请针对原范围已确认线索继续补查，不增加新事实。';
 s.services.search=async request=>{s.searches.push(request);return {items:[{url:failed.url,title:'controlled_fixture unresolved source',snippet:'only an unverified lead',publisher:null,publishedAt:null,providerScore:null}],providerRequestId:'controlled_fixture',invalidItemCount:0,warnings:[],usage:null};};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(s.searches).toHaveLength(1);expect(s.searches[0]!.query).not.toBe(first.queries[0]!.query);expect(s.searches[0]!.query).toContain(scope.knownClues.at(-1)!);expect(s.searches[0]!.query).not.toMatch(/Soul|心灵奇旅/);
 expect(s.reads).toEqual([]);expect(material.sources.find(source=>source.id===failed.id)).toEqual(failed);expect(result.draft!.scope).toEqual(scope);expect(result.completion).toBe('partial');expect(s.models).toHaveLength(3);
});
