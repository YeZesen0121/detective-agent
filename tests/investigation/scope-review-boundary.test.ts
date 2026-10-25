import {expect,it} from 'vitest';
import {prepareInvestigation} from '../../src/server/investigation/index.js';
import {scenario} from './controlled.js';
import type {ModelRequest,ModelResponse} from '../../src/shared/ports.js';
const question='元宝搜索 API 能直接搜索微信公众号文章吗？请核对官方明确的能力边界。';
const proposal={canLocate:true,object:{text:'元宝搜索 API',inputRef:'question',quote:'元宝搜索 API'},clues:[],goals:[{kind:'fact',text:'元宝搜索 API 能直接搜索微信公众号文章吗',inputRef:'question',quote:'元宝搜索 API 能直接搜索微信公众号文章吗'},{kind:'fact',text:'核对官方明确的能力边界',inputRef:'question',quote:'核对官方明确的能力边界'}],resolutions:[]};
const review=(objectSupported=true)=>({objectSupported,allUserGoalsRepresented:true,clueChecks:[],goalChecks:[{goalIndex:0,inScope:true,reason:'用户待调查的能力问题'},{goalIndex:1,inScope:true,reason:'用户要求官方边界'}],criticalChecks:[]});
const response=(value:ModelResponse['value']):ModelResponse=>({value,usage:null,providerRequestId:'controlled_fixture',modelId:'controlled_fixture',finishReason:'stop'});
async function prepare(audit:(request:ModelRequest)=>ModelResponse['value'],value:ModelResponse['value']=proposal){const s=scenario();s.services.model=async request=>{s.models.push(request);return response(request.schemaId==='investigation.scope.grounded.v1'?value:audit(request));};const result=await prepareInvestigation({context:s.input.context,originalQuestion:question,basicMode:'truth',attachments:[],previousScope:null,clarificationAnswer:null},s.services,new AbortController().signal);return{...s,result};}
it('defines scope review as input attribution rather than asking the user to supply the unknown API answer',async()=>{
 const {result,models,searches}=await prepare(request=>{const system=request.messages[0]!.content;expect(system).toContain('objectSupported只检查');expect(system).toContain('不判断对象是否真实存在');expect(system).toContain('不能要求用户先提供答案');expect(system).toContain('critical为空时criticalChecks必须为[]');const input=JSON.parse(request.messages[1]!.content);expect(input.answer).toBe('');expect(input.critical).toEqual([]);return review();});
 expect(result.canInvestigate).toBe(true);expect(result.scope?.objectText).toBe('元宝搜索 API');expect(result.scope?.claimsToCheck).toHaveLength(2);expect(result.scope?.knownClues).toEqual([]);expect(models).toHaveLength(2);expect(searches).toHaveLength(0);
});
it('keeps an explicit objectSupported false veto even when its reason incorrectly demands the answer',async()=>{
 const {result,models}=await prepare(()=>({...review(false),criticalChecks:[{inputRef:'question',resolved:false,answerQuote:'',reason:'补充回答为空，无法确认该API是否支持直接搜索微信公众号文章'}]}));expect(result.canInvestigate).toBe(false);expect(result.scope).toBeNull();expect(models).toHaveLength(2);
});
it('still rejects a proposed object that the independent reviewer says changed the user product layer',async()=>{
 const {result}=await prepare(()=>review(false));expect(result.canInvestigate).toBe(false);expect(result.scope).toBeNull();
});
it('does not create a question critical field that was absent from the actual input checklist',async()=>{
 const {result}=await prepare(()=>({...review(),criticalChecks:[{inputRef:'question',resolved:false,answerQuote:'',reason:'模型自己创设确认义务'}]}));expect(result.canInvestigate).toBe(false);expect(result.scope).toBeNull();
});
it('rejects an ungrounded object before review even if later review would approve it',async()=>{
 const {result,models}=await prepare(()=>review(),{...proposal,object:{text:'不存在于用户输入的另一个产品',inputRef:'question',quote:'元宝搜索 API'}});expect(result.canInvestigate).toBe(false);expect(models).toHaveLength(1);
});
