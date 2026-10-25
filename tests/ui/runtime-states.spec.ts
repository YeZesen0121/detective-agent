import { prepareDraft } from './draft-setup.js';
import { expect, test, type Request, type Response } from '@playwright/test';
import { RunViewSchema } from '../../src/shared/runtime-http.js';
import { randomUUID } from 'node:crypto';
import { moduleFor } from '../web-model/runtime-http-fixture.js';
import type { InvestigationModule } from '../../src/shared/ports.js';
import { serve, enter } from './runtime-fixture.js';

// Real HTTP, SQLite, host, W controllers and browser. Only the injected business
// module is controlled_fixture; any attempted paid provider call fails the test.
test.use({viewport:{width:1440,height:900}});

test('clarification write failure is visible, keeps the answer and supports an explicit retry',async({page},info)=>{
  const module=moduleFor(),prepare=module.prepareInvestigation;
  module.prepareInvestigation=async(input,services,signal)=>input.clarificationAnswer?prepare(input,services,signal):{scope:null,canInvestigate:false,clarification:{id:randomUUID(),runId:input.context.runId!,prompt:'controlled_fixture 请补充年份',missingFields:['year'],options:[],canProceedWithUnknown:false,answer:null,answeredAt:null}};
  const server=await serve(module,info.workerIndex);
  try{
    await enter(page,server.site);await page.getByRole('textbox',{name:'要调查的问题'}).fill('controlled_fixture 核对报名日期');await prepareDraft(page);await page.getByRole('button',{name:'开查'}).click();
    await expect(page.getByText('controlled_fixture 请补充年份')).toBeVisible();
    await expect(page.getByRole('button',{name:'按现有线索先查'})).toHaveCount(0);
    await page.getByLabel('补充一句').fill('controlled_fixture 2026年');
    let attempts=0;
    await page.route('**/clarifications/*',async route=>{attempts++;await route.fulfill({status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'controlled_fixture 暂时不可用，请保留回答后重试',retryable:true},meta:{requestId:randomUUID(),contractVersion:'0.1.0'}}});});
    await page.getByRole('button',{name:'补充后开查'}).click();
    await expect(page.getByRole('alert')).toContainText('controlled_fixture 暂时不可用');
    await expect(page.getByLabel('补充一句')).toHaveValue('controlled_fixture 2026年');
    await expect(page.getByRole('button',{name:'补充后开查'})).toBeEnabled();expect(attempts).toBe(1);
    await page.unroute('**/clarifications/*');
    await page.route('**/clarifications/*',async route=>{attempts++;await route.abort('failed');});
    await page.getByRole('button',{name:'补充后开查'}).click();
    await expect(page.getByRole('status')).toContainText('本次提交仍未确认');
    await expect(page.getByLabel('补充一句')).toHaveValue('controlled_fixture 2026年');expect(attempts).toBe(2);
    await page.unroute('**/clarifications/*');await page.getByRole('button',{name:'补充后开查'}).click();
    await expect(page.getByRole('heading',{name:'受控材料中的报名截止日期为十月三十日。'})).toBeVisible();
  }finally{await server.close();}
});

test('a cancelled newer run stays visible alongside the old report and resumes its existing budget',async({page},info)=>{
  const module=moduleFor(),work=module.runInvestigation;let executions=0;
  module.runInvestigation=async(input,services,signal)=>{
    executions++;
    if(executions===2){await new Promise<void>(resolve=>{if(signal.aborted)resolve();else signal.addEventListener('abort',()=>resolve(),{once:true});});return{completion:'failed',stopReason:'cancelled',draft:null,clarification:null};}
    const result=await work(input,services,signal);
    return executions===1?{...result,completion:'partial',stopReason:'search_limit',draft:result.draft?{...result.draft,stopReason:'search_limit'}:null}:result;
  };
  const server=await serve(module,info.workerIndex),actions:string[]=[],windows:string[]=[];
  const pendingReads:Promise<void>[]=[],readErrors:unknown[]=[];
  const seenRuns=new Set<string>();let latestObservedRunId:string|null=null;
  const recordAction=(request:Request)=>{if(request.method()==='POST'&&/\/runs$/.test(new URL(request.url()).pathname))actions.push(request.postDataJSON().action);};
  const recordRun=(response:Response)=>{
    if(response.request().method()!=='GET'||!/\/api\/v1\/runs\/[^/]+$/.test(new URL(response.url()).pathname))return;
    const id=new URL(response.url()).pathname.split('/').at(-1)!;
    // The ledger can read the old report's task independently. This assertion
    // tracks the execution chain, not historical reads cancelled on version change.
    if(seenRuns.has(id)&&id!==latestObservedRunId)return;
    seenRuns.add(id);latestObservedRunId=id;
    const read=(async()=>{const body=await response.json();windows.push(RunViewSchema.parse(body.data).run.budgetWindowId);})();
    // Handle rejection immediately, then assert every read error at the awaited boundary.
    pendingReads.push(read.catch(error=>{readErrors.push(error);}));
  };
  const stopRunReads=async()=>{page.off('response',recordRun);await Promise.all(pendingReads.splice(0));expect(readErrors,'run response JSON/schema reads').toEqual([]);};
  page.on('request',recordAction);page.on('response',recordRun);
  try{
    await enter(page,server.site);await page.getByRole('textbox',{name:'要调查的问题'}).fill('controlled_fixture 到限后继续并取消');await prepareDraft(page);await page.getByRole('button',{name:'开查'}).click();
    await expect(page.getByRole('button',{name:'追加一轮'})).toBeVisible();
    await page.getByRole('button',{name:'追加一轮'}).click();await expect(page.getByRole('region',{name:'本轮补查任务'}).getByRole('button',{name:'停止补查'})).toBeVisible();
    await page.getByRole('region',{name:'本轮补查任务'}).getByRole('button',{name:'停止补查'}).click();await expect(page.getByRole('button',{name:'继续调查'})).toBeVisible();
    await expect(page.getByText('受控材料中的报名截止日期为十月三十日。').first()).toBeVisible();
    await expect(page.getByRole('button',{name:'追加一轮'})).toHaveCount(0);
    // Detach and drain before navigation invalidates old response bodies.
    await stopRunReads();const secondWindow=windows.at(-1);expect(secondWindow).toBeTruthy();
    await page.reload();page.on('response',recordRun);await expect(page.getByRole('button',{name:'继续调查'})).toBeVisible();
    await page.getByRole('button',{name:'继续调查'}).click();
    await expect(page.getByRole('button',{name:'看新版'})).toBeVisible();
    await expect(page.getByText('受控材料中的报名截止日期为十月三十日。').first()).toBeVisible();
    await expect(page.getByRole('button',{name:'追加一轮'})).toHaveCount(0);
    await page.getByRole('button',{name:'看新版'}).click();
    await expect(page.getByRole('heading',{name:'controlled_fixture：新版本，旧版保持原文。'})).toBeVisible();
    await stopRunReads();expect(actions).toEqual(['start','add_budget','resume']);expect(windows.at(-1)).toBe(secondWindow);expect(executions).toBe(3);
  }finally{try{await stopRunReads();}finally{page.off('request',recordAction);await server.close();}}
});
