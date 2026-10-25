import {ScopeSchema} from '../../src/shared/contracts.js';
import {expect,it} from 'vitest';
import fixture from './fixtures/ux01-review-input.json' with {type:'json'};
import {evaluationRequest,inputCost,reviewRequest,reviewRequestDraft} from '../../src/server/investigation/prompts.js';
import {judge} from '../../src/server/investigation/judge.js';
import {runInvestigation} from '../../src/server/investigation/engine.js';
import {WorkingMaterialSchema} from '../../src/shared/ports.js';
import {scenario} from './controlled.js';
import {reply} from './f01-discovery-fixture.js';
import {quoteRange} from '../../src/server/investigation/evidence.js';
function setup(){const s=scenario();s.input.scope=ScopeSchema.parse(structuredClone(fixture.scope));s.input.intent='followup';s.input.followupQuestion='继续核对原来的游客预约进校问题。先复核本案已经保存的原文，保留历史指引的适用日期；如不能说明当前政策，请在同一校区和原目标内补查现行官方依据，不增加新目标。';s.input.checkpoint=WorkingMaterialSchema.parse(structuredClone(fixture.checkpoint));return s;}
it('fits the actual UX01 complete original and all reviewed claims/query proposals without dropping conditions',()=>{
 const s=setup(),material=s.input.checkpoint!,prepared=evaluationRequest(s.input,material,s.budget())!,judgement=judge(fixture.evaluation,material,s.input.scope,prepared.selected),draft=reviewRequestDraft(prepared.request,judgement.claims,s.budget(),undefined,fixture.evaluation.nextQueries)!;
 expect(reviewRequest(prepared.request,judgement.claims,s.budget(),undefined,fixture.evaluation.nextQueries),JSON.stringify({evaluateCost:inputCost(prepared.request),reviewCost:inputCost(draft),selected:prepared.selected,omitted:prepared.omitted})).not.toBeNull();
 const body=JSON.parse(draft.messages[1]!.content);expect(body.scope).toEqual(s.input.scope);expect(body.evidence).toHaveLength(1);expect(body.evidence[0].index).toBe(12);expect(body.evidence[0].rawExcerpt??body.evidence[0].view).toBe(material.evidence[12]!.excerpt);expect(inputCost(draft)).toBeLessThanOrEqual(24000);expect(prepared.omitted).toBe(false);
});
it('reports token_limit explicitly when a required review cannot fit, without sending or adopting it',async()=>{
 const s=setup();s.services.model=async request=>{s.models.push(request);s.setBudget({...s.budget(),remaining:{...s.budget().remaining,inputTokens:1}});return reply(fixture.evaluation);};
 const result=await runInvestigation(s.input,s.services,new AbortController().signal);expect(result.stopReason).toBe('token_limit');expect(s.models).toHaveLength(1);expect(s.searches).toEqual([]);expect(result.draft?.claims.every(c=>c.status==='insufficient')).toBe(true);expect(result.draft?.unknowns.join(' ')).toMatch(/未发送.*复核|复核.*未发送/);
});
it('persists actual UX01 quotes after hard location checks and includes them in the bounded independent review',()=>{
 const s=setup(),material=s.input.checkpoint!,prepared=evaluationRequest(s.input,material,s.budget())!,checked=judge(fixture.evaluation,material,s.input.scope,prepared.selected);
 const originalQuotes=fixture.evaluation.claims.flatMap(c=>c.links.map(l=>l.quote));const links=checked.claims.flatMap(c=>c.links);expect(links.length).toBeGreaterThan(0);for(const link of links){expect(link.quote).toBeDefined();expect(originalQuotes).toContain(link.quote);const evidence=material.evidence.find(e=>e.id===link.evidenceId)!;expect(quoteRange(evidence.excerpt,link.quote!)).not.toBeNull();}
 const request=reviewRequest(prepared.request,checked.claims,s.budget(),undefined,fixture.evaluation.nextQueries)!;expect(request).not.toBeNull();expect(inputCost(request)).toBeLessThanOrEqual(24000);expect(JSON.parse(request.messages[2]!.content).claims.flatMap((c:any)=>c.links).every((l:any)=>typeof l.quote==='string')).toBe(true);
});
it('never persists an invented ellipsis quote or coerces old no-quote links into new quotes',()=>{
 const s=setup(),material=s.input.checkpoint!,base={statement:'受控命题',status:'supported',conditions:[],gaps:[],reasonSummary:'controlled_fixture'};
 const bad=judge({claims:[{...base,links:[{evidenceIndex:12,relation:'supports',quote:'不存在的起点…不存在的终点'}]}]},material,s.input.scope,[12]);expect(bad.claims[0]!.links).toEqual([]);
 const legacy=judge({claims:[{...base,evidenceIndexes:[12]}]},material,s.input.scope,[12]);expect(legacy.claims[0]!.links[0]).not.toHaveProperty('quote');
});
