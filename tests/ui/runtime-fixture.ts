import { expect, type Page } from '@playwright/test';
import { resolve, join } from 'node:path';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { buildApp } from '../../src/server/app.js';
import { zeroAmounts } from '../../src/server/platform/budget.js';
import type { InvestigationModule } from '../../src/shared/ports.js';

// Only the injected business module is controlled_fixture. HTTP, host, SQLite and
// the browser run normally. Every real provider send is forbidden and counted.
export async function serve(module: InvestigationModule, worker: number, persistent=false) {
  const site=`http://127.0.0.1:${31560+worker}`,funds={...zeroAmounts(),activeMs:10000000,searches:200,reads:200,modelCalls:200,inputTokens:1000000,outputTokens:1000000,moneyMicros:100000000};
  const root=persistent?mkdtempSync(join(tmpdir(),'controlled-ui-restart-')):null;
  let paidCalls=0;
  const unavailable=async()=>{paidCalls++;throw Error('controlled_fixture forbids paid requests');};
  const options={databasePath:root?join(root,'state.db'):':memory:',allowedOrigin:site,trialCode:'controlled-ui-trial',demoCode:'controlled-ui-demo',serviceEndsAt:new Date(Date.now()+86400000).toISOString(),secureCookies:false,webRoot:resolve('dist/web'),
    investigationRuntime:{module,providers:{search:unavailable,read:unavailable,model:unavailable},funding:{global:funds,trial:funds,demo:funds},enableWatches:false,
      pricing:{quote:()=>({provider:'controlled_fixture',purpose:'controlled_fixture',priceRevision:'controlled_fixture',attemptNo:1,estimated:{...zeroAmounts(),moneyMicros:1},timeoutMs:1000}),actual:()=>null}}};
  let app=buildApp(options);await app.listen({host:'127.0.0.1',port:31560+worker});
  return{site,async restart(){if(!root)throw Error('Persistent fixture required');await app.close();app=buildApp(options);await app.listen({host:'127.0.0.1',port:31560+worker});},async close(){try{await app.close();expect(paidCalls).toBe(0);}finally{if(root)rmSync(root,{recursive:true,force:true});}}};
}
export async function enter(page:Page,site:string){await page.goto(site);await page.getByLabel('体验码').fill('controlled-ui-trial');await page.getByRole('button',{name:'进入事务所'}).click();await expect(page.getByRole('heading',{name:/这一桩/})).toBeVisible();}
