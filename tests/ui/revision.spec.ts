import { prepareDraft } from './draft-setup.js';
import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { moduleFor } from '../web-model/runtime-http-fixture.js';
import { serve, enter } from './runtime-fixture.js';
test.use({viewport:{width:1440,height:900}});

for(const hasOldReport of [false,true])test(`failed run ${hasOldReport?'with an old report':'without a report'} never offers an unsupported resume`,async({page},info)=>{
  const module=moduleFor(),work=module.runInvestigation;let executions=0;
  if(hasOldReport)module.runInvestigation=async(input,services,signal)=>{
    if(++executions>1){await services.checkpoint.save(input.run.id,input.context.epoch,{sources:[],evidence:[],claims:[]});throw Error('controlled_fixture failed business without reusable current material');}
    const result=await work(input,services,signal);return{...result,completion:'partial',stopReason:'search_limit',draft:result.draft?{...result.draft,stopReason:'search_limit'}:null};
  };else module.prepareInvestigation=async()=>{throw Error('controlled_fixture failed prepare');};
  const server=await serve(module,info.workerIndex),actions:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&/\/runs$/.test(new URL(request.url()).pathname))actions.push(request.postDataJSON().action);});
  try{
    await enter(page,server.site);await page.getByRole('textbox',{name:'要调查的问题'}).fill('controlled_fixture 失败不是已查完');await prepareDraft(page);await page.getByRole('button',{name:'开查'}).click();
    if(hasOldReport){await page.getByRole('button',{name:'追加一轮'}).click();await expect(page.getByText('这次未生成新报告',{exact:false})).toBeVisible();await expect(page.getByRole('button',{name:'复制结论 + 出处'})).toBeVisible();await expect(page.getByText('受控材料中的报名截止日期为十月三十日。').first()).toBeVisible();}
    else await expect(page.getByRole('heading',{name:/这次没查成/})).toBeVisible();
    await expect(page.getByRole('button',{name:'继续调查'})).toHaveCount(0);
    await expect(page.getByRole('button',{name:'追加一轮'})).toHaveCount(0);
    await expect(page.getByRole('alert')).toContainText(/失败|未完成|没有形成/);
    expect(actions).toEqual(hasOldReport?['start','add_budget']:['start']);
    await page.getByRole('button',{name:'新开一桩',exact:true}).click();await expect(page.getByRole('textbox',{name:'要调查的问题'})).toHaveValue('');
    expect(actions).toEqual(hasOldReport?['start','add_budget']:['start']);
  }finally{await server.close();}
});

test('cancelled-page resume failure and unknown response expose read-only recovery without replaying writes',async({page},info)=>{
  const module=moduleFor(),work=module.runInvestigation;let executions=0;
  module.runInvestigation=async(input,services,signal)=>{if(++executions===1){await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return{completion:'failed',stopReason:'cancelled',draft:null,clarification:null};}return work(input,services,signal);};
  const server=await serve(module,info.workerIndex),keys:string[]=[];
  let release!:()=>void,arrive!:()=>void;const arrived=new Promise<void>(resolve=>{arrive=resolve;}),gate=new Promise<void>(resolve=>{release=resolve;});
  let mode:'503'|'unknown'|'send'='503',failReads=false;
  await page.route('**/api/v1/investigations/*',async route=>{if(failReads&&route.request().method()==='GET')await route.abort('failed');else await route.continue();});
  await page.route('**/runs',async route=>{
    if(route.request().method()!=='POST'||route.request().postDataJSON().action!=='resume'){await route.continue();return;}
    keys.push(route.request().headers()['idempotency-key']!);
    if(mode==='503'){arrive();await gate;await route.fulfill({status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'controlled_fixture 恢复暂不可用',retryable:true},meta:{requestId:randomUUID(),contractVersion:'0.1.0'}}});}
    else if(mode==='unknown')await route.abort('failed');else await route.continue();
  });
  try{
    await enter(page,server.site);await page.getByRole('textbox',{name:'要调查的问题'}).fill('controlled_fixture 取消页恢复');await prepareDraft(page);await page.getByRole('button',{name:'开查'}).click();await page.getByRole('button',{name:'停止调查'}).click();
    await page.getByRole('button',{name:'继续调查'}).click();await arrived;
    await expect(page.getByRole('button',{name:'继续调查'})).toBeDisabled();release();
    await expect(page.getByRole('alert')).toContainText('controlled_fixture 恢复暂不可用');expect(keys).toHaveLength(1);
    mode='unknown';failReads=true;await page.getByRole('button',{name:'继续调查'}).click();
    await expect(page.getByRole('status')).toContainText('本次提交仍未确认');await expect(page.getByRole('button',{name:'继续调查'})).toBeDisabled();expect(keys).toHaveLength(2);
    await page.getByRole('button',{name:'重新读取状态'}).click();await expect(page.getByRole('alert')).toBeVisible();await expect(page.getByRole('button',{name:'继续调查'})).toBeDisabled();await expect(page.getByRole('status')).toContainText('本次提交仍未确认');expect(keys).toHaveLength(2);
    failReads=false;await page.getByRole('button',{name:'重新读取状态'}).click();await expect(page.getByRole('button',{name:'继续调查'})).toBeEnabled();expect(keys).toHaveLength(2);
    mode='send';await page.getByRole('button',{name:'继续调查'}).click();await expect(page.getByRole('heading',{name:'受控材料中的报名截止日期为十月三十日。'})).toBeVisible();
    expect(keys).toHaveLength(3);expect(new Set(keys).size).toBe(1);expect(executions).toBe(2);
  }finally{release();await server.close();}
});

test('an interrupted run after a real persistent host restart still resumes the same budget',async({page},info)=>{
  const module=moduleFor(),work=module.runInvestigation;let executions=0;
  module.runInvestigation=async(input,services,signal)=>{if(++executions===1){await new Promise<void>(resolve=>signal.addEventListener('abort',()=>resolve(),{once:true}));return{completion:'failed',stopReason:'cancelled',draft:null,clarification:null};}return work(input,services,signal);};
  const server=await serve(module,info.workerIndex,true),windows:string[]=[];
  page.on('response',async response=>{if(response.request().method()==='GET'&&/\/api\/v1\/runs\/[^/]+$/.test(new URL(response.url()).pathname)){const data=(await response.json()).data;if(data?.run)windows.push(data.run.budgetWindowId);}});
  try{
    await enter(page,server.site);await page.getByRole('textbox',{name:'要调查的问题'}).fill('controlled_fixture 重启恢复');await prepareDraft(page);await page.getByRole('button',{name:'开查'}).click();await expect(page.getByRole('button',{name:'停止调查'})).toBeVisible();
    await expect.poll(()=>windows.length).toBeGreaterThan(0);const firstWindow=windows[0];await server.restart();await page.reload();
    await expect(page.getByRole('button',{name:'继续调查'})).toBeVisible();await page.getByRole('button',{name:'继续调查'}).click();await expect(page.getByRole('heading',{name:'受控材料中的报名截止日期为十月三十日。'})).toBeVisible();expect(windows.at(-1)).toBe(firstWindow);
  }finally{await server.close();}
});

for(const length of [501,4000,4001])test(`question ${length} characters respects the existing 4000 limit without truncation`,async({page},info)=>{
  const server=await serve(moduleFor(),info.workerIndex);const questions:string[]=[];
  page.on('request',request=>{if(request.method()==='POST'&&new URL(request.url()).pathname==='/api/v1/investigations')questions.push(request.postDataJSON().originalQuestion);});
  const question='controlled_fixture '+ '字'.repeat(length-'controlled_fixture '.length);
  try{
    await enter(page,server.site);await page.getByRole('textbox',{name:'要调查的问题'}).fill(question);
    await expect(page.getByRole('textbox',{name:'要调查的问题'})).toHaveValue(question);
    await expect(page.getByText(`${length} / 4000`,{exact:true})).toBeVisible();
    if(length>4000){await expect(page.getByRole('alert')).toContainText('4000');await expect(page.getByRole('button',{name:'开查'})).toBeDisabled();expect(questions).toHaveLength(0);}
    else{await prepareDraft(page);await page.getByRole('button',{name:'开查'}).click();await expect(page.getByRole('heading',{name:'受控材料中的报名截止日期为十月三十日。'})).toBeVisible();expect(questions).toEqual([question]);await page.reload();await expect(page.getByText(question,{exact:true}).first()).toBeVisible();}
  }finally{await server.close();}
});
