import { expect,test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { serveMedia } from '../web-model/media-http-fixture.js';

test('controlled_fixture reading distinguishes claim/source counts and citation use, with long evidence on demand',async({page},info)=>{
 const s=await serveMedia(info.workerIndex);let writes=0;page.on('request',r=>{if(r.method()==='POST')writes++;});
 try{const source=s.seed.payload.sources[0]!;s.seed.payload.sources.push({...source,id:randomUUID(),title:'controlled_fixture 未用于当前结论的材料'});s.seed.payload.claims[0]!.links[0]!.quote='controlled_fixture 短引句。'.repeat(30);const version=s.publishUpdate();await page.context().addCookies([{name:'detective_session',value:s.seed.token,url:s.site,httpOnly:true}]);await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${version.id}`);await expect(page.getByText('核验命题 1 项 · 已查看来源 2 项',{exact:false})).toBeVisible();await expect(page.getByLabel('服务状态',{exact:true})).toHaveCount(0);await page.getByRole('button',{name:'查看证据链',exact:true}).click();const excerpt=page.locator('.claim .evq').first();expect((await excerpt.innerText()).length).toBeLessThan(180);await page.getByText('来源（2）',{exact:true}).click();await expect(page.locator('li').filter({hasText:'controlled_fixture 未用于当前结论的材料'}).last()).toContainText('未被当前命题引用');await expect(page.getByText('被当前命题引用',{exact:false}).first()).toBeVisible();expect(writes).toBe(0);expect(s.calls.real).toBe(0);
 }finally{try{await page.context().close();}finally{await s.close();}}
});
