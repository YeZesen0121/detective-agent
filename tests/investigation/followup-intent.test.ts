import {expect,it} from 'vitest';
import fixture from './fixtures/f01-followup-intent.json' with {type:'json'};
import echoFixture from './fixtures/f01-followup-echo.json' with {type:'json'};
import {routeFollowup} from '../../src/server/investigation/index.js';
import {FollowupInputSchema,type ModelResponse} from '../../src/shared/ports.js';
import {scenario} from './controlled.js';
const response=(value:ModelResponse['value']):ModelResponse=>({value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
function setup(question=fixture.question){const s=scenario();const input=FollowupInputSchema.parse({context:{...s.input.context,investigationId:fixture.version.investigationId},version:fixture.version,question,remainingBudget:s.budget()});return{s,input};}
const delta=()=>({scopeMatches:true,objectText:fixture.version.payload.scope.objectText,intent:'add_or_correct_clues',deltas:[{text:'成年男老师',quote:'主角是成年男老师',change:'add',certainty:'known',previousClue:null},{text:'弹钢琴',quote:'好像弹钢琴',change:'add',certainty:'uncertain',previousClue:null}],requestQuote:null,reason:'新输入线索不是解释旧材料，同一对象身份目标'});
it('routes the actual misclassified F01 new clues through an independent bounded intent check',async()=>{
 const {s,input}=setup();s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:delta());};const before=structuredClone(input.version);const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('research_same_scope');expect(result.researchPurpose).toContain('好像');expect(input.version).toEqual(before);expect(s.models).toHaveLength(2);expect(s.models.every(r=>r.purpose==='followup')).toBe(true);expect(s.models.reduce((sum,r)=>sum+r.maxOutputTokens,0)).toBeLessThanOrEqual(2000);expect(s.searches).toHaveLength(0);expect(s.reads).toHaveLength(0);expect(s.checkpoints).toHaveLength(0);
});
it('does not force research from new-clue keywords when the user only compares existing clues',async()=>{
 const {s,input}=setup('不要当成新线索，我只是比较原报告里音乐和灵魂世界这两条线索。');s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:{scopeMatches:true,objectText:input.version.payload.scope.objectText,intent:'explain_saved',deltas:[],requestQuote:null,reason:'只是解释已保存线索'});};const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('explain');expect(s.models).toHaveLength(2);expect(s.searches).toHaveLength(0);
});
it.each(['primary','secondary'] as const)('never swallows a %s false scope veto to research',async gate=>{
 const {s,input}=setup();s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.followup.v1'?{...fixture.firstResponse,scopeMatches:gate!=='primary'}:{...delta(),scopeMatches:false});};const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('suggest_new_case');expect(s.models).toHaveLength(gate==='primary'?1:2);
});
it('rejects explain plus a grounded new delta as a contradictory intent instead of silently dropping it',async()=>{
 const {s,input}=setup();s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:{...delta(),intent:'explain_saved'});};await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_INTENT_CONTRADICTION');expect(s.models).toHaveLength(2);
});
it('rejects a novel clue whose quote is not in the actual new question',async()=>{
 const {s,input}=setup();s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:{...delta(),deltas:[{...delta().deltas[0]!,quote:'用户从未说过的记忆'}]});await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_DELTA_UNGROUNDED');
});
it('requires research-budget confirmation for valid new clues without refreshing the interaction or research pools',async()=>{
 const {s,input}=setup();input.remainingBudget.remaining.reads=0;input.remainingBudget.canRead=false;s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:delta());const before=structuredClone(input.remainingBudget);const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('needs_budget_confirmation');expect(input.remainingBudget).toEqual(before);
});
it('makes no second call after cancellation, deadline, or exhausted interaction model allowance',async()=>{
 for(const stop of ['cancel','deadline','budget']){const {s,input}=setup();const controller=new AbortController();s.services.model=async request=>{s.models.push(request);if(stop==='cancel')controller.abort();else if(stop==='deadline')s.services.clock.now=()=>input.context.deadlineAt;else s.setBudget({...s.budget(),remaining:{...s.budget().remaining,modelCalls:0},canModel:false});return response(fixture.firstResponse);};if(stop==='budget'){const result=await routeFollowup(input,s.services,controller.signal);expect(result.route).toBe('needs_budget_confirmation');}else await expect(routeFollowup(input,s.services,controller.signal)).rejects.toThrow();expect(s.models).toHaveLength(1);}
});
it('rejects invented delta text even when the cited new-question quote itself exists',async()=>{
 const {s,input}=setup();s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:{...delta(),deltas:[{...delta().deltas[0]!,text:'来自哈佛的教授'}]});await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_DELTA_UNGROUNDED');
});
it('routes an explicit correction only when it binds an existing clue and the current input quote',async()=>{
 const {s,input}=setup('我记错了，不是主角到了灵魂世界，请在原电影范围内更正这条线索。');s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:{...delta(),deltas:[{text:'不是主角到了灵魂世界',quote:'我记错了，不是主角到了灵魂世界',change:'correct',certainty:'uncertain',previousClue:{kind:'known',index:1}}]});const before=structuredClone(input.version.payload.scope);expect((await routeFollowup(input,s.services,new AbortController().signal)).route).toBe('research_same_scope');expect(input.version.payload.scope).toEqual(before);
});
it('does not treat an exact saved clue as new merely because the model labels it add',async()=>{
 const {s,input}=setup('我重复一遍：和音乐有关。');s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?fixture.firstResponse:{...delta(),deltas:[{text:'和音乐有关',quote:'和音乐有关',change:'add',certainty:'known',previousClue:null}]});await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_INTENT_CONTRADICTION');
});
it('does not reinterpret a malformed or failed intent response as successful explanation or retry it',async()=>{
 for(const failure of ['shape','throw']){const {s,input}=setup();s.services.model=async request=>{s.models.push(request);if(request.schemaId==='investigation.followup.v1')return response(fixture.firstResponse);if(failure==='throw')throw Error('controlled_fixture sent unknown');return response({intent:'explain_saved'});};await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow();expect(s.models).toHaveLength(2);}
});
it('audits the actual true-scope research response with expanded echo instead of declaring a new case',async()=>{
 const {s,input}=setup(echoFixture.question);input.version=FollowupInputSchema.parse({...input,version:echoFixture.version}).version;s.services.model=async request=>{s.models.push(request);const body=JSON.parse(request.messages[1]!.content);expect(body.outputContract.objectText.const).toBe(input.version.payload.scope.objectText);expect(request.messages[0]?.content).toContain('逐字复制');return response(request.schemaId==='investigation.followup.v1'?echoFixture.firstResponse:delta());};const result=await routeFollowup(input,s.services,new AbortController().signal);expect(result.route).toBe('research_same_scope');expect(s.models).toHaveLength(2);expect(s.models.reduce((sum,r)=>sum+r.maxOutputTokens,0)).toBeLessThanOrEqual(2000);
});
it('rejects a second true-scope expanded echo as a technical response instead of inventing a user scope change',async()=>{
 const {s,input}=setup();s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.followup.v1'?echoFixture.firstResponse:{...delta(),objectText:echoFixture.firstResponse.objectText});};await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_OBJECT_ECHO_INVALID');expect(s.models).toHaveLength(2);
});
it('does not swallow independent false scope when verifying a drifted primary echo',async()=>{
 const {s,input}=setup();s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?echoFixture.firstResponse:{...delta(),scopeMatches:false});expect((await routeFollowup(input,s.services,new AbortController().signal)).route).toBe('suggest_new_case');
});
it('does not silently convert a drifted research classification into explanation when the independent intent conflicts',async()=>{
 const {s,input}=setup();s.services.model=async request=>response(request.schemaId==='investigation.followup.v1'?echoFixture.firstResponse:{...delta(),intent:'explain_saved',deltas:[]});await expect(routeFollowup(input,s.services,new AbortController().signal)).rejects.toThrow('FOLLOWUP_INTENT_CONTRADICTION');
});
