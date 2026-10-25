import { expect,test } from '@playwright/test';
import { serveMedia } from '../web-model/media-http-fixture.js';

for(const fault of ['503','network'] as const)test(`controlled_fixture fixed old URL survives one ${fault} failure and retries only the selected version`,async({page},info)=>{
 const s=await serveMedia(info.workerIndex),newer=s.publishUpdate();let oldReads=0;
 try{
  await page.route(`**/api/v1/results/${s.seed.version.id}`,async route=>{oldReads++;if(oldReads!==1){await route.continue();return;}if(fault==='network')await route.abort('failed');else await route.fulfill({status:503,json:{error:{code:'PROVIDER_UNAVAILABLE',message:'controlled_fixture 固定旧版暂时不可读',retryable:true},meta:{requestId:'controlled-old-version',contractVersion:'0.1.0'}}});});
  await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${s.seed.version.id}`);
  await expect(page.getByRole('alert').filter({hasText:fault==='network'?'连接中断':'固定旧版暂时不可读'})).toBeVisible();
  expect(new URL(page.url()).searchParams.get('version')).toBe(s.seed.version.id);expect(oldReads).toBe(1);await expect(page.getByRole('heading',{name:newer.payload.summary,exact:true})).toHaveCount(0);
  const retried=page.waitForRequest(request=>new URL(request.url()).pathname===`/api/v1/results/${s.seed.version.id}`);await page.getByRole('button',{name:'重试所选报告',exact:true}).click();await retried;
  await expect(page.getByRole('heading',{name:s.seed.version.payload.summary,exact:true})).toBeVisible();expect(new URL(page.url()).searchParams.get('version')).toBe(s.seed.version.id);await expect(page.getByRole('heading',{name:newer.payload.summary,exact:true})).toHaveCount(0);await expect(page.getByRole('button',{name:'看新版 →',exact:true})).toBeVisible();
  expect(s.requests.filter(r=>r.method!=='GET')).toHaveLength(0);expect(s.calls.real).toBe(0);
 }finally{await s.close();}
});
