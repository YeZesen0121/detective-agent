import {expect,test} from '@playwright/test';
import {randomUUID} from 'node:crypto';
import {moduleFor} from '../web-model/runtime-http-fixture.js';
import {serve,enter} from './runtime-fixture.js';

for(const outcome of ['confirmed','unknown','excluded'])test(`controlled_fixture explicit original description recheck ${outcome}`,async({page},info)=>{
 const module=moduleFor(),prepare=module.prepareInvestigation,question='controlled_fixture 原描述：记不清名字的电影，主角追随一只猫。';let writes=0,body:unknown;
 module.prepareInvestigation=async(input,services,signal)=>input.clarificationAnswer?prepare(input,services,signal):{scope:null,canInvestigate:false,clarification:{id:randomUUID(),runId:input.context.runId!,prompt:'controlled_fixture 对象范围需重新核对',missingFields:outcome==='excluded'?['objectText','attachmentCriticalText']:['objectText','groundedScope'],options:[],canProceedWithUnknown:false,answer:null,answeredAt:null}};
 const s=await serve(module,info.workerIndex);
 try{await enter(page,s.site);await page.getByLabel('要调查的问题').fill(question);await page.getByRole('button',{name:'开查',exact:false}).click();await expect(page.getByText('controlled_fixture 对象范围需重新核对',{exact:true})).toBeVisible();await page.route('**/clarifications/*',async route=>{writes++;body=route.request().postDataJSON();if(outcome==='unknown')await route.abort('failed');else await route.continue();});const button=page.getByRole('button',{name:'按原描述重新核对',exact:true});expect(writes).toBe(0);if(outcome==='excluded'){await expect(button).toHaveCount(0);return;}await button.click();if(outcome==='unknown'){await expect(page.getByRole('status').filter({hasText:'本次提交仍未确认'})).toBeVisible();await expect(button).toBeDisabled();expect(writes).toBe(1);}else await expect(page.getByRole('heading',{name:'受控材料中的报名截止日期为十月三十日。',exact:true})).toBeVisible();expect(writes).toBe(1);expect(body).toEqual({answer:question,proceedWithUnknown:false});
 }finally{try{await page.unrouteAll({behavior:'wait'});await page.context().close();}finally{await s.close();}}
});
