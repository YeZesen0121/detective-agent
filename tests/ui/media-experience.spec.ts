import { prepareDraft } from './draft-setup.js';
import { expect, test } from '@playwright/test';
import sharp from 'sharp';
import { serveMedia } from '../web-model/media-http-fixture.js';

test('controlled_fixture three screenshots survive refresh and unavailable start; narrow screen and session isolation',async({page,browser},info)=>{
 const s=await serveMedia(info.workerIndex,{configured:false});
 // Keep the legacy missing-field start/503 recovery scenario.
 await page.route('**/api/v1/capabilities',async route=>{const response=await route.fetch(),body=await response.json();delete body.data.newInvestigations;await route.fulfill({response,json:body});});
 try{
  await page.goto(s.site);await page.getByLabel('体验码').fill('controlled-media-trial');await page.getByRole('button',{name:'进入事务所'}).click();
  await page.getByLabel('要调查的问题').fill('controlled_fixture 三图待核验');await page.getByRole('button',{name:'侦探伴读',exact:true}).click();await prepareDraft(page);
  await expect(page.getByRole('region',{name:'案件截图'})).toBeVisible();
  const buffer=await sharp({create:{width:32,height:32,channels:3,background:'#448888'}}).png().toBuffer();
  let lost=false;await page.route('**/api/v1/investigations/*/attachments',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
  await page.getByLabel('上传截图').setInputFiles([1,2,3].map(i=>({name:`controlled_fixture_${i}.png`,mimeType:'image/png',buffer})));
  await expect(page.getByRole('img',{name:/截图/})).toHaveCount(3);await page.reload();await expect(page.getByRole('img',{name:/截图/})).toHaveCount(3);
  expect(s.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/attachments'))).toHaveLength(3);expect(s.requests.some(r=>r.url.includes('media-submission?operation=attachment'))).toBe(true);
  await page.getByRole('button',{name:'开查',exact:false}).click();await expect(page.getByRole('alert').filter({hasText:/未启用|不可用|配置|运行/})).toBeVisible();await expect(page.getByRole('img',{name:/截图/})).toHaveCount(3);
  await page.setViewportSize({width:360,height:780});await expect(page.getByRole('button',{name:'重新核对截图'})).toBeVisible();expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  const image=page.getByRole('img',{name:'截图 1',exact:true});const src=await image.getAttribute('src');const other=await browser.newContext();try{await other.request.post(`${s.site}/api/v1/sessions`,{headers:{origin:s.site},data:{code:'controlled-media-trial'}});expect((await other.request.get(`${s.site}${src}`)).status()).toBe(404);}finally{await other.close();}
  await page.getByRole('button',{name:'删除截图 2',exact:true}).click();await expect(page.getByRole('img',{name:/截图/})).toHaveCount(2);
  await page.screenshot({path:info.outputPath('media-three-images-mobile.png'),fullPage:true});expect(s.calls.real).toBe(0);
 }finally{await s.close();}
});

test('controlled_fixture old companion notice keeps paragraphs until explicit new-version selection',async({page},info)=>{
 const s=await serveMedia(info.workerIndex);
 try{
  await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}`);await page.getByRole('button',{name:'生成本版伴读'}).click();await expect(page.getByLabel('阅读段落')).toBeVisible();
  const before=await page.getByRole('region',{name:'固定版本伴读'}).locator('article').innerText();s.publishUpdate();await page.getByRole('button',{name:'重新读取伴读状态'}).click();await expect(page.getByRole('button',{name:'看新版报告'})).toBeVisible();expect(await page.getByRole('region',{name:'固定版本伴读'}).locator('article').innerText()).toBe(before);
  await page.getByRole('button',{name:'看新版报告'}).click();await expect(page.getByRole('heading',{name:'controlled_fixture 新报告，旧版仍保留'})).toBeVisible();await expect(page.getByRole('button',{name:'生成本版伴读'})).toBeVisible();expect(s.calls.model).toBe(1);
 }finally{await s.close();}
});

test('controlled_fixture saved report to companion, interruption, cursor recovery, real browser sequential playback and local stop',async({page},info)=>{
 const s=await serveMedia(info.workerIndex,{playable:true});
 try{
  await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);
  await page.goto(`${s.site}/?case=${s.seed.investigationId}`);
  await page.getByRole('button',{name:'生成本版伴读'}).click();await expect(page.getByLabel('阅读段落')).toBeVisible();
  await page.getByRole('combobox',{name:'音色',exact:true}).selectOption('controlled_voice_b');
  await page.getByRole('button',{name:'生成本段音频',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'音频已保存'})).toBeVisible();
  const tts=s.calls.tts;expect(tts).toBeGreaterThan(1);
  await page.getByRole('button',{name:'播放已保存音频',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'正在播放第 2'})).toBeVisible();await page.getByRole('button',{name:'停止播放',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'正在播放第'})).toHaveCount(0);expect(s.calls.tts).toBe(tts);
  expect(s.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/cancel'))).toHaveLength(0);
  const asset=s.requests.find(r=>r.url.startsWith('/api/v1/audio-assets/'))!.url;
  expect((await page.request.get(s.site+asset,{headers:{range:'bytes=999999999-'}})).status()).toBe(416);
  await page.route('**/api/v1/audio-assets/*',route=>route.fulfill({status:404,body:''}));await page.getByRole('button',{name:'播放已保存音频',exact:true}).click();await expect(page.getByRole('alert').filter({hasText:'音频读取或解码失败'})).toBeVisible();await expect(page.getByRole('heading',{name:'第 1 段',exact:true})).toBeVisible();expect(s.calls.tts).toBe(tts);await page.unroute('**/api/v1/audio-assets/*');
  await page.reload();await expect(page.getByRole('combobox',{name:'音色',exact:true})).toHaveValue('controlled_voice_b');expect(s.calls.tts).toBe(tts);
  await page.setViewportSize({width:360,height:780});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByLabel('阅读段落').selectOption('1');await expect(page.getByLabel('阅读段落')).toHaveValue('1');
  await page.getByLabel('打断追问').fill('controlled_fixture 哪些未知还在？');await page.getByRole('button',{name:'停止播放并追问'}).click();await expect(page.getByText('解释回复')).toBeVisible();
  await page.getByRole('button',{name:'回到第 2 段'}).click();await expect(page.getByLabel('阅读段落')).toHaveValue('1');const posts=s.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/companions')).length;
  await page.reload();await expect(page.getByLabel('阅读段落')).toHaveValue('1');expect(s.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/companions'))).toHaveLength(posts);await expect(page.getByText('解释回复')).toBeVisible();
  await page.getByRole('button',{name:'收尾',exact:true}).click();await expect(page.getByText('本版伴读已收尾。')).toBeVisible();await page.getByRole('button',{name:'重新打开已存伴读'}).click();await expect(page.getByLabel('阅读段落')).toBeVisible();
  await page.screenshot({path:info.outputPath('media-companion-mobile.png'),fullPage:true});expect(s.calls.real).toBe(0);
 }finally{await s.close();}
});

test('controlled_fixture cancel generation is explicit HTTP while playback stop never cancels generation',async({page},info)=>{
 let release!:()=>void;const gate=new Promise<void>(resolve=>{release=resolve;});const s=await serveMedia(info.workerIndex,{ttsGate:gate});
 try{
  await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}`);await page.getByRole('button',{name:'生成本版伴读'}).click();await expect(page.getByLabel('阅读段落')).toBeVisible();await page.getByRole('button',{name:'生成本段音频'}).click();await expect(page.getByRole('button',{name:'取消生成',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'停止播放',exact:true}).click();expect(s.requests.filter(r=>r.url.endsWith('/cancel'))).toHaveLength(0);await page.getByRole('button',{name:'取消生成',exact:true}).click();await expect(page.getByRole('status').filter({hasText:'生成已取消'})).toBeVisible();expect(s.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/cancel'))).toHaveLength(1);
  release();await expect(page.getByRole('heading',{name:'第 1 段',exact:true})).toBeVisible();
 }finally{release();await s.close();}
});
