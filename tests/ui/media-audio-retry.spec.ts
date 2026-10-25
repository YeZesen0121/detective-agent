import { expect,test } from '@playwright/test';
import { serveMedia } from '../web-model/media-http-fixture.js';

test('controlled_fixture retry after rejected voice switch uses the restored saved voice',async({page},info)=>{
 const s=await serveMedia(info.workerIndex),sent:string[]=[];
 try{
  // Only these fault boundaries are injected. Creation, history, storage and the
  // original audio generation use actual P HTTP/host and controlled_fixture E.
  await page.route('**/api/v1/audio-jobs/*',async route=>{const response=await route.fetch();const body=await response.json();if(body.data?.status==='ready')body.data={...body.data,status:'partial',error:'controlled_fixture retained prefix'};await route.fulfill({response,json:body});});
  await page.route('**/api/v1/companions/*/audio',async route=>{
   const voice=route.request().postDataJSON().voiceId as string;sent.push(voice);
   if(voice==='controlled_voice_b')await route.fulfill({status:409,json:{error:{code:'INVALID_STATE',message:'controlled_fixture voice B rejected',retryable:false},meta:{requestId:'controlled-rejection',contractVersion:'0.1.0'}}});else await route.continue();
  });
  await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}`);
  await page.getByRole('button',{name:'生成本版伴读'}).click();await expect(page.getByLabel('阅读段落')).toBeVisible();
  const audio=page.getByRole('region',{name:'本段音频'});
  await audio.getByRole('button',{name:'生成本段音频',exact:true}).click();await expect(audio.getByRole('status').filter({hasText:'音频只保存了一部分'})).toBeVisible();
  await audio.getByRole('combobox',{name:'音色',exact:true}).selectOption('controlled_voice_b');await audio.getByRole('button',{name:'用所选音色生成新音频'}).click();await expect(audio.getByRole('alert')).toContainText('voice B rejected');
  await page.reload();await expect(audio.getByRole('combobox',{name:'音色',exact:true})).toHaveValue('controlled_voice');await expect(audio.getByText('当前任务音色：controlled_fixture 提示音 controlled_voice',{exact:true})).toBeVisible();
  const retry=page.waitForRequest(request=>request.method()==='POST'&&/\/companions\/[^/]+\/audio$/.test(new URL(request.url()).pathname));const manifest=page.waitForResponse(response=>response.request().method()==='GET'&&/\/audio-jobs\/[^/]+$/.test(new URL(response.url()).pathname));await audio.getByRole('button',{name:'明确重试生成',exact:true}).click();const request=await retry;
  expect(request.postDataJSON().voiceId).toBe('controlled_voice');expect(sent).toEqual(['controlled_voice','controlled_voice_b','controlled_voice']);await(await manifest).finished();await expect(audio.getByRole('button',{name:'明确重试生成',exact:true})).toBeEnabled();expect(s.calls.real).toBe(0);
 }finally{await page.unrouteAll({behavior:'wait'});await s.close();}
});
