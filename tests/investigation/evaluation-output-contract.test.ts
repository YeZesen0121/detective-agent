import {expect,it} from 'vitest';
import malformed from './fixtures/ux01-malformed-evaluation.json' with {type:'json'};
import {evaluationRequest,inputCost,reviewRequest} from '../../src/server/investigation/prompts.js';
import {judge} from '../../src/server/investigation/judge.js';
import {runInvestigation} from '../../src/server/investigation/engine.js';
import {scenario} from './controlled.js';
import {reply,f01Material,f01Scope} from './f01-discovery-fixture.js';
import {refreshRawReviewViews} from '../../src/server/investigation/raw-review-view.js';
it('sends precise conditions and gaps array constraints without coercing the actual UX01 string',async()=>{
 const s=scenario();await runInvestigation(s.input,s.services,new AbortController().signal);const material=s.checkpoints.at(-1)!,prepared=evaluationRequest(s.input,material,s.budget())!,contract=JSON.parse(prepared.request.messages[1]!.content).outputContract;
 expect(contract?.claims?.conditions).toMatchObject({type:'array',items:{type:'string'},maxItems:80});expect(contract?.claims?.gaps).toMatchObject({type:'array',items:{type:'string'},maxItems:80});
 expect(typeof malformed.value.claims[0]!.conditions).toBe('string');const checked=judge(malformed.value,material,s.input.scope,prepared.selected);expect(checked.fatalInvalidRefs).toBe(true);expect(checked.claims).toEqual([]);
});
it('retains both F01 complete views and the independent review within the original 24k input cap',()=>{
 const s=scenario();s.input.basicMode='identify';s.input.scope=f01Scope();const material=f01Material();refreshRawReviewViews(s.input,material,true);const prepared=evaluationRequest(s.input,material,s.budget())!;
 expect(prepared.omitted).toBe(false);expect(prepared.selected).toHaveLength(2);expect(inputCost(prepared.request)).toBeLessThanOrEqual(24000);const review=reviewRequest(prepared.request,[],s.budget(),{candidates:[{name:'Soul',evidenceIndexes:prepared.selected}]})!;expect(review).not.toBeNull();expect(inputCost(review)).toBeLessThanOrEqual(24000);
});
it('rejects malformed evaluation wholesale without review, query, retry or adoption',async()=>{
 const s=scenario();s.services.model=async request=>{s.models.push(request);return reply(malformed.value);};const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.completion).toBe('partial');expect(result.draft?.claims).toEqual([]);expect(s.models).toHaveLength(1);expect(s.searches).toHaveLength(1);
});
it('keeps legal array conditions through independent review and issues only an approved same-goal gap query',async()=>{
 const s=scenario();let evaluations=0;s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content),index=body.evidence[0].index;
  if(request.schemaId==='investigation.review.v1')return reply({checks:[{claimIndex:0,verdict:'supported',addressesQuestion:true,reason:'已核对保存材料，不代表当前完整范围已答'}],goalChecks:[{goalIndex:0,claimIndexes:[0],covered:false,reason:'仍需最新原始公告'}],queryChecks:[{queryIndex:0,scopeMatches:true,goalIndex:0,anchors:[],reason:'原目标内补查原始公告'}]});
  evaluations++;return reply({claims:[{statement:'报名截止2026年10月30日',status:'supported',links:[{evidenceIndex:index,relation:'supports',quote:'2026年受控活动报名截止2026年10月30日，仅限本科生。'}],conditions:['仅对应此已保存公告，尚未核对更新'],gaps:['需要当前原始公告'],reasonSummary:'受控旧材料限定'}],answerBlocks:[],...(evaluations===1?{nextQueries:[{query:'2026年受控活动 最新原始公告',purpose:'原目标缺口',goalIndex:0}]}:{})});};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(s.searches).toHaveLength(2);expect(s.models.filter(r=>r.schemaId==='investigation.review.v1').length).toBeGreaterThan(0);expect(result.completion).toBe('partial');expect(result.draft?.claims[0]?.conditions).toContain('仅对应此已保存公告，尚未核对更新');
});
