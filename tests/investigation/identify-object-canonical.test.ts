import {expect,it} from 'vitest';
import {prepareInvestigation} from '../../src/server/investigation/index.js';
import {scenario} from './controlled.js';
import {reply} from './f01-discovery-fixture.js';
const question='我以前在4399玩过一个吃鸡的游戏，我记得可以双人玩，有点偏我的世界风格，然后还记得有个彩蛋是一个跑酷，里面有丰厚的物资，是啥游戏来着';
const quote='我以前在4399玩过一个吃鸡的游戏';
function setup(text='4399上一款吃鸡游戏',objectQuote=quote){const s=scenario();s.services.model=async request=>{s.models.push(request);return reply(request.schemaId==='investigation.scope.review.v1'?{objectSupported:true,allUserGoalsRepresented:true,clueChecks:[0,1,2,3].map(clueIndex=>({clueIndex,certainty:'known',reason:'controlled_fixture 用户明确回忆，不是外部事实'})),goalChecks:[{goalIndex:0,inScope:true,reason:'识别原游戏名称'}],criticalChecks:[]}:{canLocate:true,object:{text,inputRef:'question',quote:objectQuote},clues:['4399','可以双人玩','我的世界风格','彩蛋是一个跑酷'].map(text=>({text,inputRef:'question',quote:text,certainty:'known'})),goals:[{text:'确定游戏名称',inputRef:'question',quote:'是啥游戏来着',kind:'identity'}],resolutions:[]});};return s;}
it.each(['4399上玩过的一个吃鸡游戏','4399上一款吃鸡游戏','4399上的一款吃鸡游戏'])('sends the complete original description to independent review instead of rejecting rewritten object %s',async text=>{
 const s=setup(text),result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode:'identify',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);
 expect(result.canInvestigate).toBe(true);expect(result.scope?.objectText).toBe(quote);expect(result.scope?.goal).toBe(question);expect(result.scope?.claimsToCheck).toEqual(['确定对象名称']);expect(s.models).toHaveLength(2);const reviewed=JSON.parse(s.models[1]!.messages.at(-1)!.content).proposal;expect(reviewed.object.text).toBe(quote);expect(reviewed.object.quote).toBe(quote);expect(result.scope?.knownClues).toEqual(['4399','可以双人玩','我的世界风格','彩蛋是一个跑酷']);expect(s.searches).toEqual([]);
});
it.each(['truth','latest'] as const)('does not canonicalize a rewritten %s object to bypass its original identity gate',async basicMode=>{
 const s=setup();const result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode,attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(s.models).toHaveLength(1);
});
it('rejects a fabricated object quote without sending independent review',async()=>{
 const s=setup('4399上一款吃鸡游戏','原输入里没有的游戏描述');const result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode:'identify',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(s.models).toHaveLength(1);
});
it('preserves the independent reviewer veto after canonicalization',async()=>{
 const s=setup(),model=s.services.model;s.services.model=async(request,context,signal)=>{const response=await model(request,context,signal);if(request.schemaId==='investigation.scope.review.v1')return reply({objectSupported:false,allUserGoalsRepresented:true,clueChecks:[],goalChecks:[{goalIndex:0,inScope:true,reason:'原目标'}],criticalChecks:[]});return response;};const result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode:'identify',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(s.models).toHaveLength(2);
});
it('does not truncate an oversized original description to make a canonical object',async()=>{
 const long='4399原始游戏描述'.repeat(40),s=setup('改写游戏',long);const result=await prepareInvestigation({context:s.input.context,originalQuestion:long+'，'+question,basicMode:'identify',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);expect(result.canInvestigate).toBe(false);expect(s.models).toHaveLength(1);
});
