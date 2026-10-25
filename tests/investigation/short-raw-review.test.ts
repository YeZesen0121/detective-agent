import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {capturedMaterial} from '../../src/server/investigation/evidence.js';
import {runInvestigation} from '../../src/server/investigation/engine.js';
import {scenario,hash} from './controlled.js';
import {reply,f01Material,f01Scope} from './f01-discovery-fixture.js';

const full='2026年受控活动报名截止2026年10月30日，仅限本科生。\n\n背景介绍甲。\n\n背景介绍乙。\n\n港澳学生延至11月10日。';
function setup(){
 const s=scenario();const captured=capturedMaterial({url:'https://example.invalid/short-complete',title:'controlled_fixture 完整公告',snippet:'',publisher:null,publishedAt:null,providerScore:null},{sourceId:randomUUID(),finalUrl:'https://example.invalid/short-complete',title:null,text:full,readStatus:'full',fetchedAt:s.services.clock.now(),contentHash:null,failureCode:null,usage:null},randomUUID(),s.input.scope);
 const raw=captured.evidence.find(e=>e.limitations.some(l=>l.startsWith('raw_capture_only')))!;
 const excerpts=captured.evidence.filter(e=>e!==raw);for(const e of excerpts){e.limitations.push('capture_selection_partial: controlled_fixture omitted region','capture_context_risk: controlled_fixture omitted exception');}
 const state={revision:hash(JSON.stringify({capture:raw.contentHash,scope:s.input.scope,goals:s.input.scope.claimsToCheck,excerpts:excerpts.map(e=>e.excerpt)})),done:[[0,full.length]],irrelevant:[] as number[][],pending:null as number[]|null};
 raw.limitations.push('context_screen_state:'+JSON.stringify(state));
 s.input.checkpoint={sources:[captured.source],evidence:captured.evidence,claims:[],candidates:[],queries:[]};
 s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content);if(request.schemaId==='investigation.context-screen.v1')throw Error('controlled_fixture completed screen must not be billed again');
  if(request.purpose==='plan')return reply({queryChecks:[]});
  if(request.schemaId==='investigation.review.v1')return reply({checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'完整正文核对例外'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'有条件截止日期'}]});
  const evidence=body.evidence.find((e:any)=>e.rawExcerpt===full);if(!evidence)throw Error('controlled_fixture expects the full qualified raw view');
  return reply({claims:[{statement:'报名截止2026年10月30日',status:'supported',links:[{evidenceIndex:evidence.index,relation:'supports',quote:'2026年受控活动报名截止2026年10月30日，仅限本科生。'}],conditions:['仅限本科生','港澳学生延至11月10日。'],gaps:[],reasonSummary:'完整正文保留人群例外'}],answerBlocks:[]});
 };return {...s,raw,state,excerpts};
}
it('adds a new complete raw view after exact completed screening and answers with all conditions while retaining old risk',async()=>{
 const s=setup(),old=structuredClone(s.input.checkpoint!);const result=await runInvestigation(s.input,s.services,new AbortController().signal);
 expect(result.completion).toBe('completed');expect(result.draft?.conditions.join(' ')).toContain('港澳学生');expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('screened_raw_view:')))).toHaveLength(1);
 expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('capture_context_risk')))).toHaveLength(s.excerpts.length);expect(result.draft?.evidence.find(e=>e.id===s.raw.id)?.excerpt).toBe(full);expect(s.input.checkpoint).toEqual(old);expect(s.models.filter(r=>r.schemaId==='investigation.context-screen.v1')).toEqual([]);expect(s.models.filter(r=>r.schemaId==='investigation.review.v1')).toHaveLength(1);
});
it('reuses the same complete view and proof on resume and a procedural same-scope followup without screening again',async()=>{
 const s=setup();await runInvestigation(s.input,s.services,new AbortController().signal);s.input.checkpoint=s.checkpoints.at(-1)!;const ids=s.input.checkpoint.evidence.map(e=>e.id);s.input.intent='followup';s.input.followupQuestion='继续补查，先核对保存材料，不重读未知来源。';s.input.run={...s.input.run,id:randomUUID(),trigger:'followup'};s.input.context={...s.input.context,runId:s.input.run.id};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.evidence.map(e=>e.id)).toEqual(ids);expect(s.models.filter(r=>r.schemaId==='investigation.context-screen.v1')).toEqual([]);expect(s.models.filter(r=>r.schemaId==='investigation.evaluate.v2').every(r=>JSON.parse(r.messages[1]!.content).goals.length===1)).toBe(true);
});
it.each(['pending','uncovered','irrelevant','partial','bad_hash'] as const)('does not promote a %s raw capture',async kind=>{
 const s=setup();if(kind==='pending')s.state.pending=[0,full.length];if(kind==='uncovered')s.state.done=[[0,full.length-1]];if(kind==='irrelevant')s.state.irrelevant=[[0,full.length]];if(kind==='partial')s.input.checkpoint!.sources[0]!.readStatus='partial';if(kind==='bad_hash')s.raw.contentHash='b'.repeat(64);
 s.raw.limitations=s.raw.limitations.filter(l=>!l.startsWith('context_screen_state:'));s.raw.limitations.push('context_screen_state:'+JSON.stringify(s.state));s.setBudget({...s.budget(),remaining:{...s.budget().remaining,modelCalls:0}});
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.evidence.some(e=>e.limitations.some(l=>l.startsWith('screened_raw_view:')))).toBe(false);expect(result.completion).toBe('partial');expect(s.models).toEqual([]);
});
it('keeps complete raw material partial when the full evaluation input exceeds budget',async()=>{
 const s=setup();s.setBudget({...s.budget(),remaining:{...s.budget().remaining,inputTokens:1}});const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('token_limit');expect(result.completion).toBe('partial');expect(s.models).toEqual([]);
});
it('keeps newly independently reviewed candidates from a full view while old risky links remain downgraded',async()=>{
 const s=setup();s.input.basicMode='identify';s.input.scope={...s.input.scope,basicMode:'identify',objectText:'受控活动',goal:'确定对象名称',claimsToCheck:['确定对象名称'],knownClues:['本科生'],uncertainClues:[]};
 s.state.revision=hash(JSON.stringify({capture:s.raw.contentHash,scope:s.input.scope,goals:['确定对象名称'],excerpts:s.excerpts.map(e=>e.excerpt)}));s.raw.limitations=s.raw.limitations.filter(l=>!l.startsWith('context_screen_state:'));s.raw.limitations.push('context_screen_state:'+JSON.stringify(s.state));
 s.input.checkpoint!.candidates.push({id:randomUUID(),name:'旧伪候选',aliases:[],sourceIds:[s.input.checkpoint!.sources[0]!.id],matchedClues:['本科生'],conflictingClues:[],missingClues:[],reasonSummary:'controlled_fixture old risky candidate'});
 s.input.checkpoint!.claims.push({id:randomUUID(),statement:'旧错误断言',status:'supported',conditions:[],gaps:[],links:[{evidenceId:s.excerpts[0]!.id,relation:'supports',rationale:'旧风险引用'}],reasonSummary:'旧断言不得复活'});
 s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content),e=body.evidence?.find((e:any)=>e.rawExcerpt===full);if(request.schemaId==='investigation.review.v1')return reply({checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],clueChecks:[{clueIndex:0,clueKind:'known',clueText:'本科生',relation:'matches',evidenceIndex:e.index,quote:'仅限本科生',reason:'完整正文原句'}],reason:'身份独审但仍有区分缺口'}]});return reply({claims:[],answerBlocks:[],candidates:[{name:'2026年受控活动',evidenceIndexes:[e.index],missingClues:['仍需排除其他活动'],reasonSummary:'只依据新完整视图'}]});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.candidates.map(c=>c.name)).toEqual(['2026年受控活动']);expect(result.draft?.candidates[0]?.matchedClues).toContain('本科生');expect(result.completion).toBe('partial');expect(s.models.filter(r=>r.schemaId==='investigation.review.v1')).toHaveLength(1);expect(result.draft?.claims.some(c=>c.statement==='旧错误断言'&&c.status==='supported')).toBe(false);
});
it('quarantines an earlier full view and its claims when actual scope changes and a new screen is pending',async()=>{
 const s=setup();await runInvestigation(s.input,s.services,new AbortController().signal);s.input.checkpoint=s.checkpoints.at(-1)!;s.input.scope.knownClues.push('新的真实范围条件');const raw=s.input.checkpoint.evidence.find(e=>e.id===s.raw.id)!;
 raw.limitations=raw.limitations.filter(l=>!l.startsWith('context_screen_state:'));raw.limitations.push('context_screen_state:'+JSON.stringify({...s.state,pending:[0,full.length]}));s.models.length=0;
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.claims.every(c=>c.status==='insufficient')).toBe(true);expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('screened_raw_view:'))).every(e=>e.limitations.some(l=>l.startsWith('capture_screen_unverified')))).toBe(true);expect(s.models.filter(r=>r.schemaId==='investigation.context-screen.v1')).toEqual([]);
});
it('uses actual completed F01 raw captures as new views while preserving all old pending/risk and independently reviewing only uncertain candidates',async()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope=f01Scope();s.input.checkpoint=f01Material();const before=structuredClone(s.input.checkpoint);
 s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content),e=body.evidence.find((e:any)=>e.rawExcerpt.includes('Soul'));
  if(request.schemaId==='investigation.review.v1')return reply({checks:[],candidateChecks:[{candidateIndex:0,grounded:true,identityGoalIndexes:[0],clueChecks:[...s.input.scope.knownClues.map((clueText,clueIndex)=>({clueIndex,clueText,clueKind:'known',relation:'unknown',evidenceIndex:e.index,quote:'Soul',reason:'此处不预设原线索已获支持'})),...s.input.scope.uncertainClues.map((clueText,clueIndex)=>({clueIndex,clueText,clueKind:'uncertain',relation:'unknown',evidenceIndex:e.index,quote:'Soul',reason:'不确定记忆未证实'}))],reason:'新完整视图只提供待查候选'}]});
  return reply({claims:[],answerBlocks:[],candidates:[{name:'Soul',evidenceIndexes:[e.index],missingClues:['必须继续区分'],reasonSummary:'controlled_fixture 不预设唯一身份'}]});
 };
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('screened_raw_view:')))).toHaveLength(2);expect(result.draft?.evidence.filter(e=>e.limitations.some(l=>l.startsWith('capture_context_risk')))).toHaveLength(6);expect(result.draft?.evidence.some(e=>e.limitations.some(l=>l.includes('"pending":[0,880]')))).toBe(true);expect(result.draft?.candidates[0]?.name).toBe('Soul');expect(result.draft?.candidates[0]?.matchedClues).toEqual([]);expect(result.completion).toBe('partial');expect(s.input.checkpoint).toEqual(before);expect(s.models.map(r=>r.schemaId)).toEqual(['investigation.evaluate.v2','investigation.review.v1']);expect(s.searches).toEqual([]);
});
it('requires independent review even when a complete raw view contains a simple direct field',async()=>{
 const s=setup(),text='2026年受控活动报名截止2026年10月30日，仅限本科生。';s.raw.excerpt=text;s.raw.contentHash=hash(text);s.raw.locator.value=`0:${text.length}`;s.input.checkpoint!.sources[0]!.contentHash=s.raw.contentHash;
 s.state.revision=hash(JSON.stringify({capture:s.raw.contentHash,scope:s.input.scope,goals:s.input.scope.claimsToCheck,excerpts:s.excerpts.map(e=>e.excerpt)}));s.state.done=[[0,text.length]];s.raw.limitations=s.raw.limitations.filter(l=>!l.startsWith('context_screen_state:'));s.raw.limitations.push('context_screen_state:'+JSON.stringify(s.state));
 s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content),index=body.evidence[0].index;return reply(request.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'独立核对完整视图'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'原截止'}]}:{claims:[{statement:'报名截止2026年10月30日',status:'supported',evidenceIndexes:[index],conditions:['仅限本科生'],gaps:[],reasonSummary:'直接原句'}],answerBlocks:[]});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('completed');expect(s.models.map(r=>r.schemaId)).toEqual(['investigation.evaluate.v2','investigation.review.v1']);
});
it('retains original header-year restrictions on complete views instead of laundering a footer year into the requested edition',async()=>{
 const s=setup(),text='2025年受控活动公告。\n\n报名免费。\n\n仅限本科生。\n\n版权所有2026。';s.raw.excerpt=text;s.raw.contentHash=hash(text);s.raw.locator.value=`0:${text.length}`;s.input.checkpoint!.sources[0]!.contentHash=s.raw.contentHash;
 for(const e of s.excerpts)e.limitations=[...e.limitations.filter(l=>!l.startsWith('capture_header_years:')),'capture_header_years:2025'];
 s.state.revision=hash(JSON.stringify({capture:s.raw.contentHash,scope:s.input.scope,goals:s.input.scope.claimsToCheck,excerpts:s.excerpts.map(e=>e.excerpt)}));s.state.done=[[0,text.length]];s.raw.limitations=s.raw.limitations.filter(l=>!l.startsWith('context_screen_state:'));s.raw.limitations.push('context_screen_state:'+JSON.stringify(s.state));
 s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content),e=body.evidence[0];return reply(request.schemaId==='investigation.review.v1'?{checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'错误审核不得绕硬年份门'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:true,reason:'不得放宽年份'}]}:{claims:[{statement:'报名免费',status:'supported',evidenceIndexes:[e.index],conditions:['仅限本科生'],gaps:[],reasonSummary:'页脚2026不是公告届次'}],answerBlocks:[]});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal),view=result.draft!.evidence.find(e=>e.limitations.some(l=>l.startsWith('screened_raw_view:')))!;expect(view.limitations).toContain('capture_header_years:2025');expect(result.draft?.claims[0]?.status).toBe('insufficient');expect(result.completion).toBe('partial');
});
