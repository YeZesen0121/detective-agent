import {expect,it} from 'vitest';
import {randomUUID} from 'node:crypto';
import {prepareInvestigation} from '../../src/server/investigation/index.js';
import type {ModelResponse} from '../../src/shared/ports.js';
import {scenario} from './controlled.js';
const adult='主角是成年男老师',piano='弹钢琴',question='我确认主角是成年男老师';
function setup(text=question){
 const s=scenario(),previous={...s.input.scope,basicMode:'identify' as const,objectText:'动画电影',goal:'一部动画电影，有音乐和灵魂世界，我忘了名字。',claimsToCheck:['确定对象名称'],knownClues:['音乐','灵魂世界'],uncertainClues:[adult,piano]};
 const input={context:s.input.context,originalQuestion:previous.goal,basicMode:'identify' as const,attachments:[],previousScope:previous,clarificationAnswer:null as {clarificationId:string;answer:string;proceedWithUnknown:boolean}|null,followup:{kind:'saved_followup' as const,turnId:randomUUID(),resultVersionId:randomUUID(),question:text}};
 const proposal={scopeMatches:true,clues:[] as {text:string;inputRef:string;quote:string;certainty:string}[],clueUpdates:[] as {knownClueIndex:number;inputRef:string;quote:string}[],clueConfirmations:[{uncertainClueIndex:0,inputRef:'saved_followup',quote:question}],reason:'新的真实用户输入明确确认旧记忆，用户确信不等于外部事实'};
 const audit={scopeMatches:true,clueChecks:[] as {clueIndex:number;grounded:boolean;certainty:string;reason:string}[],clueUpdateChecks:[] as {updateIndex:number;approved:boolean;reason:string}[],clueConfirmationChecks:[{confirmationIndex:0,approved:true,certainty:'known',reason:'新原句明确确认旧索引对应的同一记忆'}],reason:'独立核对范围、指代与完整上下文'};
 s.services.model=async request=>{s.models.push(request);return {value:(request.schemaId==='investigation.scope.grounded.v1'?proposal:audit) as ModelResponse['value'],usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'};};
 return {s,previous,input,proposal,audit};
}
const prepare=(f:ReturnType<typeof setup>)=>prepareInvestigation(f.input,f.s.services,new AbortController().signal);
it('moves the exact old uncertain text only after a new explicit confirmation and independent approval',async()=>{
 const f=setup(),before=structuredClone(f.previous),result=await prepare(f);expect(result.canInvestigate).toBe(true);expect(result.scope?.knownClues).toEqual(['音乐','灵魂世界',adult]);expect(result.scope?.uncertainClues).toEqual([piano]);expect(f.previous).toEqual(before);
 const {knownClues:_known,uncertainClues:_uncertain,...identity}=result.scope!,{knownClues:_oldKnown,uncertainClues:_oldUncertain,...oldIdentity}=before;expect(identity).toEqual(oldIdentity);expect(f.s.models.map(request=>[request.schemaId,request.maxOutputTokens])).toEqual([['investigation.scope.grounded.v1',1600],['investigation.scope.review.v1',1200]]);
});
it('uses a real clarification source alongside the saved followup without treating unknown continuation as confirmation',async()=>{
 const f=setup('请根据我补充的回答核对原线索');f.input.clarificationAnswer={clarificationId:randomUUID(),answer:question,proceedWithUnknown:false};f.proposal.clueConfirmations[0]!.inputRef='clarification';const result=await prepare(f);expect(result.scope?.knownClues).toContain(adult);expect(result.scope?.uncertainClues).toEqual([piano]);
});
it.each(['我之前不确定，现在确认主角是成年男老师','我确认主角是成年男老师，之前好像那种说法作废'])('accepts reviewed current certainty independently of historical uncertainty wording: %s',async text=>{
 const f=setup(text);f.proposal.clueConfirmations[0]!.quote=text;const result=await prepare(f);expect(result.canInvestigate).toBe(true);expect(result.scope?.knownClues).toContain(adult);expect(result.scope?.uncertainClues).toEqual([piano]);
});
it('keeps a local uncertain memory while confirming a different exact old clue',async()=>{
 const f=setup(question+'，好像弹钢琴');f.proposal.clues=[{text:piano,inputRef:'saved_followup',quote:'好像弹钢琴',certainty:'uncertain'}];f.audit.clueChecks=[{clueIndex:0,grounded:true,certainty:'uncertain',reason:'局部好像只修饰钢琴'}];const result=await prepare(f);expect(result.scope?.knownClues).toContain(adult);expect(result.scope?.uncertainClues).toEqual([piano]);
});
it('can independently confirm multiple old clue indexes without rewriting either literal',async()=>{
 const f=setup(question+'，我也确认弹钢琴');f.proposal.clueConfirmations.push({uncertainClueIndex:1,inputRef:'saved_followup',quote:'我也确认弹钢琴'});f.audit.clueConfirmationChecks.push({confirmationIndex:1,approved:true,certainty:'known',reason:'第二条明确确认'});const result=await prepare(f);expect(result.scope?.knownClues).toEqual(['音乐','灵魂世界',adult,piano]);expect(result.scope?.uncertainClues).toEqual([]);
});
it('does not upgrade a duplicate known extraction without an explicit indexed confirmation',async()=>{
 const f=setup();f.proposal.clueConfirmations=[];f.audit.clueConfirmationChecks=[];f.proposal.clues=[{text:adult,inputRef:'saved_followup',quote:question,certainty:'known'}];f.audit.clueChecks=[{clueIndex:0,grounded:true,certainty:'known',reason:'重复提取不等于旧记忆确认授权'}];const result=await prepare(f);expect(result.canInvestigate).toBe(true);expect(result.scope?.knownClues).not.toContain(adult);expect(result.scope?.uncertainClues).toEqual([adult,piano]);
});
it('reuses old uncertainty with zero model calls when no new saved input exists',async()=>{
 const f=setup();const {followup:_followup,...input}=f.input;const result=await prepareInvestigation(input,f.s.services,new AbortController().signal);expect(result.scope).toEqual(f.previous);expect(f.s.models).toHaveLength(0);
});
it.each(['duplicate','out_of_range','bad_quote','web_source','missing_review','missing_certainty','duplicate_review','wrong_review_index','review_reject','uncertain_quote','contradictory_clue','unknown_clarification'] as const)('rejects the entire confirmation delta for %s and leaves old scope unchanged',async kind=>{
 const f=setup(),before=structuredClone(f.previous);const confirmation=f.proposal.clueConfirmations[0]!;
 if(kind==='duplicate')f.proposal.clueConfirmations.push({...confirmation});if(kind==='out_of_range')confirmation.uncertainClueIndex=88;if(kind==='bad_quote')confirmation.quote='原输入没有这句话';if(kind==='web_source')confirmation.inputRef='web:source';if(kind==='missing_review')f.audit.clueConfirmationChecks=[];if(kind==='duplicate_review')f.audit.clueConfirmationChecks.push({...f.audit.clueConfirmationChecks[0]!});if(kind==='wrong_review_index')f.audit.clueConfirmationChecks[0]!.confirmationIndex=7;if(kind==='review_reject')f.audit.clueConfirmationChecks[0]!.approved=false;
 if(kind==='missing_certainty')delete (f.audit.clueConfirmationChecks[0] as Partial<typeof f.audit.clueConfirmationChecks[number]>).certainty;
 if(kind==='uncertain_quote'){f.input.followup.question='我可能记错了主角是成年男老师';confirmation.quote=f.input.followup.question;f.audit.clueConfirmationChecks[0]!.certainty='uncertain';}
 if(kind==='contradictory_clue'){f.input.followup.question=question+'，但主角是成年男老师也可能记错';f.proposal.clues=[{text:adult,inputRef:'saved_followup',quote:'主角是成年男老师也可能记错',certainty:'uncertain'}];f.audit.clueChecks=[{clueIndex:0,grounded:true,certainty:'uncertain',reason:'同项后置不确定'}];}
 if(kind==='unknown_clarification'){f.input.clarificationAnswer={clarificationId:randomUUID(),answer:question,proceedWithUnknown:true};confirmation.inputRef='clarification';}
 const result=await prepare(f);expect(result.canInvestigate).toBe(false);expect(result.scope).toBeNull();expect(f.previous).toEqual(before);expect(f.s.models.length).toBeLessThanOrEqual(2);
});
it('does not salvage one confirmation when another old clue confirmation is denied',async()=>{
 const f=setup(question+'，我也确认弹钢琴');f.proposal.clueConfirmations.push({uncertainClueIndex:1,inputRef:'saved_followup',quote:'我也确认弹钢琴'});f.audit.clueConfirmationChecks.push({confirmationIndex:1,approved:false,certainty:'uncertain',reason:'第二条尚未确认指代'});expect((await prepare(f)).canInvestigate).toBe(false);expect(f.previous.uncertainClues).toEqual([adult,piano]);
});
