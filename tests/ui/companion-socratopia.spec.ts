import {expect,test} from '@playwright/test';
import {serveMedia} from '../web-model/media-http-fixture.js';

for(const viewport of [{width:1440,height:960},{width:390,height:844}])test(`controlled_fixture Socratopia companion workspace ${viewport.width}: reading, evidence, interruption and return`,async({page},info)=>{
 const s=await serveMedia(info.workerIndex+300,{audioAvailable:false});
 try{
  await page.setViewportSize(viewport);await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);
  await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${s.seed.version.id}`);
  const companion=page.getByRole('region',{name:'固定版本伴读'});
  await expect(companion.getByRole('navigation',{name:'伴读段落'})).toBeVisible();
  await expect(companion.getByRole('button',{name:'返回报告',exact:true})).toBeVisible();
  await expect(companion.getByRole('button',{name:'生成本版伴读'})).toBeVisible();expect(s.calls.model).toBe(0);
  await companion.getByRole('button',{name:'生成本版伴读'}).click();await expect(companion.getByLabel('阅读段落')).toHaveValue('0');
  await companion.getByLabel('打断追问').focus();const firstHeader=await companion.getByRole('button',{name:'返回报告',exact:true}).boundingBox();expect(firstHeader!.y).toBeGreaterThanOrEqual(58);
  await expect(companion.getByRole('article',{name:'侦探讲述第 1 段'})).toContainText(s.seed.payload.claims[0]!.statement);
  await companion.screenshot({path:info.outputPath('workspace-initial.png')});
  await companion.getByRole('button',{name:'跳到第 2 段',exact:true}).click();await expect(companion.getByLabel('阅读段落')).toHaveValue('1');
  await companion.getByText('本段证据',{exact:true}).click();await expect(companion.getByRole('link',{name:'打开原始来源'}).first()).toBeVisible();
  const input=companion.getByLabel('打断追问');await input.fill('controlled_fixture 保留这个未提交问题');await input.focus();
  const box=await input.boundingBox();expect(box).not.toBeNull();expect(box!.x).toBeGreaterThanOrEqual(0);expect(box!.x+box!.width).toBeLessThanOrEqual(viewport.width+1);
  const returnBox=await companion.getByRole('button',{name:'返回报告',exact:true}).boundingBox();expect(returnBox!.y).toBeGreaterThanOrEqual(58);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1)).toBe(true);
  await companion.getByRole('button',{name:'返回报告',exact:true}).click();await expect(page.getByRole('button',{name:'进入侦探伴读',exact:true})).toBeVisible();
  await page.getByRole('button',{name:'进入侦探伴读',exact:true}).click();await expect(input).toHaveValue('controlled_fixture 保留这个未提交问题');await expect(companion.getByLabel('阅读段落')).toHaveValue('1');
  await input.fill('controlled_fixture 为什么这样判断');await companion.getByRole('button',{name:'停止播放并追问',exact:true}).click();
  await expect(companion.getByText('问：controlled_fixture 为什么这样判断',{exact:true})).toBeVisible();
  await expect(companion.getByText('解释回复',{exact:true}).last()).toBeVisible();
  expect(new URL(page.url()).searchParams.get('version')).toBe(s.seed.version.id);expect(s.calls.real).toBe(0);expect(s.calls.tts).toBe(0);
  await companion.screenshot({path:info.outputPath(`companion-${viewport.width}.png`)});
 }finally{await s.close();}
});

test('controlled_fixture short saved companion audio stops locally on return and reopens without regeneration',async({page},info)=>{
 const s=await serveMedia(info.workerIndex+300,{playable:true});
 try{
  await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}`);
  const companion=page.getByRole('region',{name:'固定版本伴读'});await companion.getByRole('button',{name:'生成本版伴读'}).click();
  await companion.getByRole('button',{name:'生成本段音频',exact:true}).click();await expect(companion.getByRole('status').filter({hasText:'音频已保存'})).toBeVisible();
  const calls=s.calls.tts;expect(calls).toBeGreaterThanOrEqual(1);
  await companion.getByRole('button',{name:'播放已保存音频',exact:true}).click();await expect(companion.getByRole('status').filter({hasText:'正在播放第'})).toBeVisible();
  await companion.getByRole('button',{name:'停止播放',exact:true}).click();await expect(companion.getByRole('status').filter({hasText:'正在播放第'})).toHaveCount(0);
  await companion.getByRole('button',{name:'播放已保存音频',exact:true}).click();await expect(companion.getByRole('status').filter({hasText:'正在播放第'})).toBeVisible();
  await companion.getByRole('button',{name:'返回报告',exact:true}).click();await page.getByRole('button',{name:'进入侦探伴读',exact:true}).click();
  await expect(companion.getByRole('status').filter({hasText:'正在播放第'})).toHaveCount(0);await expect(companion.getByRole('button',{name:'播放已保存音频',exact:true})).toBeEnabled();
  expect(s.calls.tts).toBe(calls);expect(s.requests.filter(r=>r.method==='POST'&&r.url.endsWith('/cancel'))).toHaveLength(0);expect(s.calls.real).toBe(0);
 }finally{await s.close();}
});
