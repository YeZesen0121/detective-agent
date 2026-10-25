import {expect,test} from '@playwright/test';
import {serveConflicts} from '../web-model/conflict-http-fixture.js';

for(const viewport of [{width:1440,height:1000},{width:360,height:800}]){
 test(`controlled_fixture next step is readable before evidence and opens the existing clue field without sending at ${viewport.width}px`,async({page},info)=>{
  const s=await serveConflicts(info.workerIndex,payload=>({...payload,summary:'controlled_fixture 还不能确定你说的是哪一份公告。',stopReason:'needs_user',claims:payload.claims.map(claim=>({...claim,status:'insufficient',links:[]})),answerBlocks:[],conflicts:[],unknowns:['controlled_fixture 尚不清楚你问的是哪一届活动'],nextSteps:['controlled_fixture 你记得公告大概是哪一年的吗？记不清也可以说明。']}),false);
  let posts=0;page.on('request',request=>{if(request.method()==='POST')posts++;});
  try{
   await page.setViewportSize(viewport);await page.context().addCookies([{name:'detective_session',value:s.token,url:s.site,httpOnly:true}]);
   await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${s.version.id}`);
   await expect(page.getByRole('heading',{name:'现有证据还不能确定答案',exact:true})).toBeVisible();
   const next=page.getByLabel('下一步',{exact:true});
   await expect(next).toContainText(s.payload.nextSteps[0]!);
   await expect(page.getByLabel('仍拿不准的',{exact:true})).toContainText(s.payload.unknowns[0]!);
   await expect(page.getByText('材料不全',{exact:true})).toHaveCount(0);
   const nextBox=await next.boundingBox(),evidenceBox=await page.getByRole('heading',{name:'证据链',exact:true}).boundingBox();
   expect(nextBox!.y).toBeLessThan(evidenceBox!.y);
   expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
   await page.screenshot({path:info.outputPath(`result-guidance-${viewport.width}.png`),fullPage:true});
   await page.getByRole('link',{name:'补充线索',exact:true}).click();
   await expect(page.getByLabel('报告追问',{exact:true})).toBeFocused();
   await page.getByLabel('报告追问',{exact:true}).fill('controlled_fixture 我不记得年份');
   expect(posts).toBe(0);
   const stored=(await(await page.request.get(`${s.site}/api/v1/results/${s.version.id}`)).json()).data.version;
   expect(stored.payloadHash).toBe(s.version.payloadHash);expect(stored.payload).toEqual(s.payload);expect(s.realCalls).toBe(0);
  }finally{try{await page.context().close();}finally{await s.close();}}
 });
}
