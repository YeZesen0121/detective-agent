import { expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { prepareInvestigation, runInvestigation } from '../../src/server/investigation/index.js';
import { scenario } from './controlled.js';
import { movieQuestion, movieFollowup, savedFollowupFixture } from './saved-followup-fixture.js';
import type { InvestigationServices } from '../../src/shared/ports.js';

function setup(question=movieFollowup) {
 const s=scenario(),fixture=savedFollowupFixture();
 const scope={...s.input.scope,basicMode:'identify' as const,objectText:'动画电影',goal:movieQuestion,claimsToCheck:['确定对象名称'],knownClues:['动画电影','音乐','灵魂世界'],uncertainClues:[] as string[],region:'全球',timeScope:'用户原确认范围',userConfirmed:true};
 const input={context:s.input.context,originalQuestion:movieQuestion,basicMode:'identify' as const,attachments:[],previousScope:scope,clarificationAnswer:null,followup:{kind:'saved_followup' as const,turnId:randomUUID(),resultVersionId:randomUUID(),question}};
 const services:InvestigationServices={...s.services,...fixture.providers};
 return{s,fixture,scope,input,services};
}
it('grounds a real saved followup independently of clarification and freezes every original scope field',async()=>{
 const {input,scope,services,fixture}=setup();const before=structuredClone(scope);const result=await prepareInvestigation(input,services,new AbortController().signal);
 expect(result.canInvestigate).toBe(true);expect(result.scope?.knownClues).toEqual(['动画电影','音乐','灵魂世界','成年男老师']);expect(result.scope?.uncertainClues).toEqual(['弹钢琴']);expect(scope).toEqual(before);
 for(const field of ['objectText','goal','claimsToCheck','timeScope','region','basicMode','userConfirmed','referenceTime'] as const)expect(result.scope?.[field]).toEqual(before[field]);
 expect(fixture.calls.map(call=>call.promptVersion)).toEqual(['investigation.scope.saved-followup.v3','investigation.scope.saved-followup-review.v3']);
});
it('uses enriched identity clues without making the followup statement additional factual goals',async()=>{
 const {s,fixture,scope,services}=setup();s.input.basicMode='identify';s.input.scope=scope;const original=await runInvestigation(s.input,services,new AbortController().signal);expect(original.completion).toBe('partial');
 s.input={...s.input,intent:'followup',followupQuestion:movieFollowup,checkpoint:s.checkpoints.at(-1)!,scope:{...scope,knownClues:[...scope.knownClues,'成年男老师'],uncertainClues:['弹钢琴']}};
 let sentGoals:unknown;const model=services.model;services.model=async(request,context,signal)=>{if(request.schemaId==='investigation.evaluate.v2')sentGoals=JSON.parse(request.messages[1]!.content).goals;return model(request,context,signal);};
 const result=await runInvestigation(s.input,services,new AbortController().signal);expect(result.completion).toBe('completed');expect(result.draft?.unknowns.join(' ')).not.toMatch(/核心目标未覆盖.*(?:成年|钢琴)/);expect(sentGoals).toEqual([{goalIndex:0,goal:'确定对象名称'}]);expect(result.draft?.claims).toEqual([]);expect(result.draft?.candidates.find(candidate=>candidate.name==='Coco')?.conflictingClues).toContain('成年男老师');expect(fixture.calls.filter(call=>call.op==='search')).toHaveLength(1);
});
it('reuses an already persisted clue scope with no repeated turn extraction when followup is omitted on resume',async()=>{
 const {input,services,fixture,scope}=setup();const resumed={...input,previousScope:{...scope,knownClues:[...scope.knownClues,'成年男老师'],uncertainClues:['弹钢琴']}};delete (resumed as Partial<typeof resumed>).followup;
 const result=await prepareInvestigation(resumed,services,new AbortController().signal);expect(result.scope).toEqual(resumed.previousScope);expect(fixture.calls).toHaveLength(0);
});
it('does not treat already extracted attachments as a new scope input on resume',async()=>{
 const {input,services,fixture}=setup();const resumed={...input,attachments:[{attachmentId:randomUUID(),visibleText:'旧截图材料',speakerClues:[],visibleDates:[],claimSuggestions:[],uncertainSpans:[],warnings:[]}]};delete (resumed as Partial<typeof resumed>).followup;
 const result=await prepareInvestigation(resumed,services,new AbortController().signal);expect(result.scope).toEqual(input.previousScope);expect(fixture.calls).toHaveLength(0);
});
it('demotes an explicitly corrected old clue only with a grounded, separately reviewed update and retains it',async()=>{
 const {input,scope,services}=setup('我记错了，不是少年弹吉他，是成年男老师。');scope.knownClues.push('少年弹吉他');const before=structuredClone(scope);const model=services.model;
 services.model=async(request,context,signal)=>{const result=await model(request,context,signal);result.value=request.promptVersion==='investigation.scope.saved-followup.v3'?{scopeMatches:true,clues:[{text:'成年男老师',inputRef:'saved_followup',quote:'成年男老师',certainty:'known'}],clueUpdates:[{knownClueIndex:3,inputRef:'saved_followup',quote:'我记错了，不是少年弹吉他'}],reason:'用户显式更正'}:{scopeMatches:true,clueChecks:[{clueIndex:0,grounded:true,certainty:'known',reason:'新记忆'}],clueUpdateChecks:[{updateIndex:0,approved:true,reason:'明确否定旧记忆，仅降级不删除'}],reason:'同对象'};return result;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.scope?.knownClues).not.toContain('少年弹吉他');expect(result.scope?.uncertainClues).toContain('少年弹吉他');expect(result.scope?.knownClues).toContain('成年男老师');expect(scope).toEqual(before);
});
it('rejects a correction whose quote comes from old scope instead of the actual new user input',async()=>{
 const {input,services,scope}=setup();const model=services.model;services.model=async(request,context,signal)=>{const result=await model(request,context,signal);result.value={scopeMatches:true,clues:[],clueUpdates:[{knownClueIndex:0,inputRef:'previousScope:knownClues:0',quote:'动画电影'}],reason:'模型自己降级'};return result;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(scope.knownClues).toEqual(['动画电影','音乐','灵魂世界']);
});
it('rejects duplicated contradictory update checks instead of removing a known clue',async()=>{
 const {input,scope,services}=setup('我记错了，不是灵魂世界。');const model=services.model;services.model=async(request,context,signal)=>{const result=await model(request,context,signal);result.value=request.promptVersion==='investigation.scope.saved-followup.v3'?{scopeMatches:true,clues:[],clueUpdates:[{knownClueIndex:2,inputRef:'saved_followup',quote:'不是灵魂世界'}],reason:'纠正'}:{scopeMatches:true,clueChecks:[],clueUpdateChecks:[{updateIndex:0,approved:false,reason:'不确定是否对应'},{updateIndex:0,approved:true,reason:'声称对应'}],reason:'矛盾'};return result;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(scope.knownClues).toContain('灵魂世界');
});
it('does not change the scope when the new source describes another object or goal',async()=>{
 const {input,services}=setup('改查另一部电影的票价');const model=services.model;services.model=async(request,context,signal)=>{const result=await model(request,context,signal);result.value={scopeMatches:false,clues:[],clueUpdates:[],reason:'另一对象及费用目标'};return result;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(result.scope).toBeNull();expect(result.clarification?.prompt).toMatch(/原范围|新调查|另开/);
});
it('does not send a review or publish changed clues after cancellation of a sent proposal',async()=>{
 const {input,scope,services,fixture}=setup();const controller=new AbortController();const before=structuredClone(scope);const model=services.model;services.model=async(request,context,signal)=>{const response=await model(request,context,signal);controller.abort();return response;};
 await expect(prepareInvestigation(input,services,controller.signal)).rejects.toThrow();expect(fixture.calls).toHaveLength(1);expect(scope).toEqual(before);
});
it('does not import a canonical clue rejected by the independent source support check',async()=>{
 const {input,services}=setup();const model=services.model;services.model=async(request,context,signal)=>{const response=await model(request,context,signal);response.value=request.promptVersion==='investigation.scope.saved-followup.v3'?{scopeMatches:true,clues:[{text:'哈佛大学教授',inputRef:'saved_followup',quote:'成年男老师',certainty:'known'}],clueUpdates:[],reason:'第一模型补常识'}:{scopeMatches:true,clueChecks:[{clueIndex:0,grounded:false,certainty:'known',reason:'原句没说大学或哈佛'}],clueUpdateChecks:[],reason:'不支持'};return response;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(input.previousScope.knownClues).not.toContain('哈佛大学教授');
});
it('does not truncate old clues to fit a new followup when the retained clue capacity is full',async()=>{
 const {input,scope,services}=setup();scope.knownClues=Array.from({length:80},(_,index)=>'旧线索'+index);const before=structuredClone(scope);
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(result.clarification?.prompt).toMatch(/容量|旧线索/);expect(scope).toEqual(before);
});
it('stops on a sent proposal failure without an automatic second model call',async()=>{
 const {input,services,scope}=setup();const before=structuredClone(scope);let calls=0;services.model=async()=>{calls++;throw Error('controlled_fixture: unknown sent request');};
 await expect(prepareInvestigation(input,services,new AbortController().signal)).rejects.toThrow('unknown sent request');expect(calls).toBe(1);expect(scope).toEqual(before);
});
it('keeps uncertain memory uncertain even if both model stages label it known',async()=>{
 const {input,services}=setup();const model=services.model;services.model=async(request,context,signal)=>{const response=await model(request,context,signal);if(request.promptVersion==='investigation.scope.saved-followup-review.v3')response.value={scopeMatches:true,clueChecks:[{clueIndex:0,grounded:true,certainty:'known',reason:'成人老师'},{clueIndex:1,grounded:true,certainty:'known',reason:'误把好像当确定'}],clueUpdateChecks:[],reason:'同一范围'};return response;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.scope?.knownClues).not.toContain('弹钢琴');expect(result.scope?.uncertainClues).toContain('弹钢琴');
});
it('keeps a repeated new canonical clue uncertain when its reviewed extractions disagree',async()=>{
 const {input,services}=setup('主角是成年男老师，或者我记错了。');const model=services.model;
 services.model=async(request,context,signal)=>{const response=await model(request,context,signal);response.value=request.promptVersion==='investigation.scope.saved-followup.v3'?{scopeMatches:true,clues:[{text:'成年男老师',inputRef:'saved_followup',quote:'主角是成年男老师',certainty:'known'},{text:'成年男老师',inputRef:'saved_followup',quote:'或者我记错了',certainty:'uncertain'}],clueUpdates:[],reason:'同项记忆有确定性冲突'}:{scopeMatches:true,clueChecks:[{clueIndex:0,grounded:true,certainty:'known',reason:'前句'},{clueIndex:1,grounded:true,certainty:'uncertain',reason:'后置不确定记忆'}],clueUpdateChecks:[],reason:'同一对象'};return response;};
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.canInvestigate).toBe(true);expect(result.scope?.knownClues).not.toContain('成年男老师');expect(result.scope?.uncertainClues).toEqual(['成年男老师']);
});
it('does not promote an old uncertain clue through a duplicate new known extraction',async()=>{
 const {input,scope,services}=setup();scope.uncertainClues=['成年男老师'];
 const result=await prepareInvestigation(input,services,new AbortController().signal);expect(result.scope?.knownClues).not.toContain('成年男老师');expect(result.scope?.uncertainClues).toContain('成年男老师');
});
it('screens long identify captures against identity goals while retaining followup clues in scope',async()=>{
 const {s,fixture,scope,services}=setup();s.input={...s.input,basicMode:'identify',intent:'followup',followupQuestion:movieFollowup,scope:{...scope,knownClues:[...scope.knownClues,'成年男老师'],uncertainClues:['弹钢琴']}};
 const read=services.read;services.read=async(request,context,signal)=>{const result=await read(request,context,signal);return{...result,text:result.text+'\n\n网站背景甲。\n\n网站背景乙。\n\n网站背景丙。\n\n网站页脚。'};};
 const model=services.model;const seen:{goals:string[];scope:{knownClues:string[];uncertainClues:string[]}}[]=[];services.model=async(request,context,signal)=>{if(request.schemaId==='investigation.context-screen.v1'){seen.push(JSON.parse(request.messages[1]!.content));return{value:{screened:true,omittedRelevantQuotes:[],reason:'完整背景无新增条件'},usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'};}return model(request,context,signal);};
 const result=await runInvestigation(s.input,services,new AbortController().signal);expect(result.completion).toBe('completed');expect(fixture.calls.filter(call=>call.op==='search')).toHaveLength(1);expect(seen.length).toBeGreaterThan(0);for(const body of seen){expect(body.goals).toEqual(['确定对象名称']);expect(body.scope.knownClues).toContain('成年男老师');expect(body.scope.uncertainClues).toContain('弹钢琴');}
});
