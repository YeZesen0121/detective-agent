import {expect,it} from 'vitest';
import fixture from './fixtures/f01-isolated-reasons.json' with {type:'json'};
import {runInvestigation} from '../../src/server/investigation/engine.js';
import {routeFollowup} from '../../src/server/investigation/followup.js';
import {ResultVersionSchema} from '../../src/shared/contracts.js';
import {WorkingMaterialSchema} from '../../src/shared/ports.js';
import {scenario} from './controlled.js';

function setup(){const s=scenario(),version=ResultVersionSchema.parse(structuredClone(fixture.version));s.input.basicMode='identify';s.input.scope=structuredClone(version.payload.scope);s.input.checkpoint=WorkingMaterialSchema.parse(structuredClone(fixture.checkpoint));s.input.context.investigationId=version.investigationId;s.input.run.investigationId=version.investigationId;s.setBudget({...s.budget(),canModel:false,remaining:{...s.budget().remaining,modelCalls:0}});return {...s,version};}
it('replaces stale affirmative reasons only for already isolated working rows with no model budget while retaining old conditions and citations',async()=>{
 const s=setup(),before=structuredClone(s.input.checkpoint),result=await runInvestigation(s.input,s.services,new AbortController().signal),draft=result.draft!;
 expect(draft.claims[0]!.reasonSummary).not.toBe(before!.claims[0]!.reasonSummary);expect(draft.claims[0]!.reasonSummary).toMatch(/当前.*(?:未核|待核)|不.*采纳/);expect(draft.candidates[0]!.reasonSummary).not.toBe(before!.candidates[0]!.reasonSummary);expect(draft.candidates[0]!.reasonSummary).toMatch(/旧.*匹配.*不.*采纳|当前.*待核/);
 expect(draft.claims[0]!.conditions).toEqual(before!.claims[0]!.conditions);expect(draft.claims[0]!.links.map(l=>l.evidenceId)).toEqual(before!.claims[0]!.links.map(l=>l.evidenceId));expect(draft.evidence.slice(0,before!.evidence.length).map(e=>e.excerpt)).toEqual(before!.evidence.map(e=>e.excerpt));expect(s.input.checkpoint).toEqual(before);expect(s.models).toEqual([]);expect(s.searches).toEqual([]);expect(s.reads).toEqual([]);
});
it('explains the actual saved corrected result at model80 exhausted without repeating invalidated affirmative reasons or changing the snapshot',async()=>{
 const s=setup(),before=structuredClone(s.version),result=await routeFollowup({context:s.input.context,version:s.version,question:'解释这个结论',remainingBudget:s.budget()},s.services,new AbortController().signal);
 expect(result.route).toBe('explain');expect(result.answer!.text).not.toContain(before.payload.claims[0]!.reasonSummary);expect(result.answer!.text).not.toContain(before.payload.candidates[0]!.reasonSummary);expect(result.answer!.text).toContain('当前');expect(result.answer!.text).toContain(before.payload.claims[0]!.conditions[0]!);expect(s.version).toEqual(before);expect(s.models).toEqual([]);
 const riskIds=before.payload.evidence.filter(e=>e.limitations.some(l=>l.startsWith('capture_context_risk'))).map(e=>e.id);expect(result.answer!.evidenceIds.some(id=>riskIds.includes(id))).toBe(false);expect(result.answer!.evidenceIds).toEqual(expect.arrayContaining(before.payload.claims[0]!.links.map(l=>l.evidenceId)));
});
it('includes only answerable candidate evidence and keeps ordinary unisolated reasons unchanged',async()=>{
 const s=setup();s.version.payload.claims=[];s.version.payload.answerBlocks=[];s.version.payload.conflicts=[];const candidate=s.version.payload.candidates[0]!;candidate.missingClues=['上映年份还待核对'];candidate.reasonSummary='普通受控候选理由不应被词面扫描改写，supported只是历史字段名。';
 const result=await routeFollowup({context:s.input.context,version:s.version,question:'解释这个结论',remainingBudget:s.budget()},s.services,new AbortController().signal);expect(result.answer!.text).toContain(candidate.reasonSummary);
 const refs=s.version.payload.evidence.filter(e=>result.answer!.evidenceIds.includes(e.id));expect(refs.length).toBeGreaterThan(0);expect(refs.every(e=>!e.limitations.some(l=>/^(?:raw_capture_only|capture_context_risk|capture_screen_unverified|capture_scope_unrelated)/.test(l)))).toBe(true);expect(s.models).toEqual([]);
});
it('does not rewrite an ordinary insufficient claim just because its reason includes an affirmative word',async()=>{
 const s=setup();s.version.payload.candidates=[];const claim=s.version.payload.claims[0]!;claim.gaps=['信息尚不足'];claim.links=[];claim.reasonSummary='普通模型理由说明 supported 字段的含义，不属于程序隔离。';
 const result=await routeFollowup({context:s.input.context,version:s.version,question:'解释这个结论',remainingBudget:s.budget()},s.services,new AbortController().signal);expect(result.answer!.text).toContain(claim.reasonSummary);expect(s.models).toEqual([]);
});
