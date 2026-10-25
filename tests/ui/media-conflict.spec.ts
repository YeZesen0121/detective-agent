import { expect,test } from '@playwright/test';
import { serveConflicts } from '../web-model/conflict-http-fixture.js';

test('controlled_fixture mutually exclusive deadlines stay unresolved in a fixed partial report with both sources',async({page},info)=>{
 const s=await serveConflicts(info.workerIndex);
 try{
  await page.context().addCookies([{name:'detective_session',value:s.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${s.version.id}`);
  await expect(page.getByRole('heading',{name:'现有证据有冲突，暂时无法确定',exact:true})).toBeVisible();await expect(page.locator('.vnote').filter({hasText:s.payload.summary})).toBeVisible();await expect(page.getByText('存在冲突',{exact:true})).toHaveCount(2);await expect(page.locator('.tally')).toContainText('反证/冲突 2');
  for(const day of [30,31])await expect(page.locator('.claimtop').getByText(`报名截止2026年10月${day}日`,{exact:true})).toBeVisible();
  await expect(page.locator('.unknown').last()).toContainText(s.payload.unknowns[0]!);await expect(page.getByText(s.payload.conditions[0]!,{exact:false}).first()).toBeVisible();await expect(page.getByText('部分成立',{exact:true})).toHaveCount(0);await expect(page.getByText(/调查完成|已确定截止日/)).toHaveCount(0);
  const wire=await page.request.get(`${s.site}/api/v1/results/${s.version.id}`),body=(await wire.json()).data;expect(wire.status()).toBe(200);expect(body.version.payload.conflicts).toEqual(s.payload.conflicts);expect(body.version.payload.claims.map((c:{status:string})=>c.status)).toEqual(['mixed','mixed']);expect(body.version.payload.queryTime).toBe(s.payload.queryTime);expect(body.updateNotice.latestResultVersionId).toBe(s.newer.id);
  const run=await page.request.get(`${s.site}/api/v1/runs/${s.seed.run.id}`);expect((await run.json()).data.run).toMatchObject({status:'partial',stopReason:'no_useful_direction'});
  for(const [index,side] of ['A','B'].entries()){
   if(index>0)await page.locator('.claim').first().getByText('其他引用来源（1）',{exact:false}).click();
   const evidence=page.locator('.claim').first().locator('.ev').filter({hasText:`controlled_fixture 公告${side}`});await expect(evidence).toContainText(s.payload.evidence[index]!.excerpt);
   const opened=page.waitForEvent('popup');await evidence.getByRole('link',{name:'打开原文 →'}).click();const popup=await opened;try{await expect(popup.locator('body')).toContainText(s.payload.evidence[index]!.excerpt);expect(popup.url()).toBe(s.payload.sources[index]!.url);}finally{await popup.close();}
  }
  const metadata=await page.locator('.vmeta span').allTextContents();await page.reload();await expect(page.locator('.vmeta span')).toHaveText(metadata);await expect(page.getByText('存在冲突',{exact:true})).toHaveCount(2);await expect(page.locator('.vnote').filter({hasText:s.payload.summary})).toBeVisible();expect(new URL(page.url()).searchParams.get('version')).toBe(s.version.id);await expect(page.locator('.vnote').filter({hasText:s.newer.payload.summary})).toHaveCount(0);await expect(page.getByText(s.payload.conditions[0]!,{exact:false}).first()).toBeVisible();await expect(page.locator('.sealbig span')).toHaveText('有冲突');expect(s.realCalls).toBe(0);
 }finally{try{await page.context().close();}finally{await s.close();}}
});
