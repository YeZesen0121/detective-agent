import { expect, it } from 'vitest';
import { prepareInvestigation } from '../../src/server/investigation/index.js';
import { scenario } from './controlled.js';

it('waits for an actual object even when a generic question is long', async () => {
  const s = scenario();
  const result = await prepareInvestigation({ context: s.input.context, originalQuestion: '这个活动明天截止是真的吗？', basicMode: 'truth', attachments: [], previousScope: null, clarificationAnswer: null }, s.services, new AbortController().signal);
  expect(result.canInvestigate).toBe(false); expect(result.scope).toBeNull(); expect(s.models).toHaveLength(0);
});
it.each(['这个活动靠谱吗？','这个比赛明天结束报名是真的吗？','帮我查一下这个活动靠谱吗？','请问这个比赛明天结束报名是真的吗？'])('does not mistake a generic predicate for an object: %s', async originalQuestion => {
  const s = scenario(); const result = await prepareInvestigation({context:s.input.context,originalQuestion,basicMode:'truth',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);
  expect(result.canInvestigate).toBe(false); expect(result.scope).toBeNull();
});
it('uses the clarification as an object clue while preserving the original goal and injected clock', async () => {
  const s = scenario();
  s.services.model=async request=>({value:request.schemaId==='investigation.scope.grounded.v1'?{canLocate:true,object:{text:'2026年受控活动',inputRef:'clarification',quote:'2026年受控活动'},clues:[{text:'2026年受控活动',inputRef:'clarification',quote:'2026年受控活动',certainty:'known'}],goals:[{text:'是否真实',inputRef:'question',quote:'是真的吗',kind:'fact'}],resolutions:[]}:{objectSupported:true,allUserGoalsRepresented:true,clueChecks:[{clueIndex:0,certainty:'known',reason:'用户提供定位对象'}],goalChecks:[{goalIndex:0,inScope:true,reason:'保留原核验目标'}],criticalChecks:[]},usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
  const result = await prepareInvestigation({ context: s.input.context, originalQuestion: '是真的吗？', basicMode: 'truth', attachments: [], previousScope: null, clarificationAnswer: { clarificationId: s.input.run.id, answer: '2026年受控活动', proceedWithUnknown: false } }, s.services, new AbortController().signal);
  expect(result.scope?.objectText).toBe('2026年受控活动'); expect(result.scope?.goal).toBe('是真的吗？');
  expect(result.scope?.knownClues).toContain('2026年受控活动'); expect(result.scope?.referenceTime).toBe('2026-10-25T00:00:00.000Z');
});
it('does not turn proceedWithUnknown into permission to invent an object', async () => {
  const s = scenario(); const result = await prepareInvestigation({ context: s.input.context, originalQuestion: '这个是真的吗？', basicMode: 'truth', attachments: [], previousScope: null, clarificationAnswer: { clarificationId: s.input.run.id, answer: '不知道', proceedWithUnknown: true } }, s.services, new AbortController().signal);
  expect(result.canInvestigate).toBe(false); expect(result.scope).toBeNull();
});
it('adds answered clues without silently replacing an already confirmed scope', async () => {
  const s = scenario();s.services.model=async request=>({value:request.schemaId==='investigation.scope.grounded.v1'?{canLocate:true,object:{text:'2026年受控活动',inputRef:'question',quote:'2026年受控活动'},clues:[{text:'只查本科生通知',inputRef:'clarification',quote:'只查本科生通知',certainty:'known'}],goals:[{text:s.input.scope.goal,inputRef:'question',quote:s.input.scope.goal,kind:'fact'}],resolutions:[]}:{objectSupported:true,allUserGoalsRepresented:true,clueChecks:[{clueIndex:0,certainty:'known',reason:'用户确认范围线索'}],goalChecks:[{goalIndex:0,inScope:true,reason:'原目标'}],criticalChecks:[]},usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});const result = await prepareInvestigation({ context: s.input.context, originalQuestion: s.input.scope.goal, basicMode: 'truth', attachments: [], previousScope: s.input.scope, clarificationAnswer: { clarificationId: s.input.run.id, answer: '只查本科生通知', proceedWithUnknown: false } }, s.services, new AbortController().signal);
  expect(result.scope?.objectText).toBe('2026年受控活动'); expect(result.scope?.knownClues).toContain('只查本科生通知'); expect(result.scope?.userConfirmed).toBe(true);
});
