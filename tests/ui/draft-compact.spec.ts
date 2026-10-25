import { expect,test,type Page } from '@playwright/test';
import sharp from 'sharp';
import { serve,enter } from './runtime-fixture.js';
import { moduleFor } from '../web-model/runtime-http-fixture.js';

async function startFits(page:Page){
  const box=await page.getByRole('button',{name:'开查',exact:false}).boundingBox();
  expect(box).not.toBeNull();
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y+box!.height).toBeLessThanOrEqual(page.viewportSize()!.height);
  expect(await page.locator('main.stage').evaluate(el=>el.scrollTop)).toBe(0);
  return box!.y+box!.height;
}
for(const viewport of [{width:1440,height:900},{width:1920,height:1080},{width:1366,height:768}])test.describe(`compact draft ${viewport.width}x${viewport.height}`,()=>{
 test.use({viewport});
 test('controlled_fixture screenshot selection and start stay reachable without scrolling',async({page},info)=>{
  const s=await serve(moduleFor(),info.workerIndex);
  try{
   await enter(page,s.site);await page.getByLabel('要调查的问题').fill('controlled_fixture 紧凑截图输入');
   await expect(page.getByRole('button',{name:'开查',exact:false})).toBeEnabled();
   const startBottom=await startFits(page);
   const panel=page.getByRole('region',{name:'开查前截图'});
   const panelHeight=(await panel.boundingBox())!.height;
   expect(panelHeight).toBeLessThanOrEqual(120);
   const buffer=await sharp({create:{width:16,height:16,channels:3,background:'#448888'}}).png().toBuffer();
   await page.getByLabel('选择截图（暂存本页）').setInputFiles([1,2,3].map(i=>({name:`controlled_fixture_${i}.png`,mimeType:'image/png',buffer})));
   await expect(panel.getByRole('button',{name:'移除待上传截图'})).toHaveCount(3);
   const selectedStartBottom=await startFits(page);
   console.log(JSON.stringify({viewport,panelHeight,startBottom,selectedStartBottom,stageScrollTop:0}));
   await page.screenshot({path:info.outputPath('draft-compact-selected.png')});
   for(let i=3;i>0;i--)await page.getByRole('button',{name:`移除待上传截图 ${i}`,exact:true}).click();
   await expect(panel.getByRole('button',{name:'移除待上传截图'})).toHaveCount(0);
   await page.screenshot({path:info.outputPath('draft-compact.png')});
  }finally{await page.context().close();await s.close();}
 });
});
