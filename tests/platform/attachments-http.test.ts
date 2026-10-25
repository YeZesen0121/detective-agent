import { afterEach, expect, it } from 'vitest';
import sharp from 'sharp';
import { buildApp } from '../../src/server/app.js';
const apps:ReturnType<typeof buildApp>[]=[];
afterEach(async()=>{for(const app of apps.splice(0))await app.close();});
const origin='http://127.0.0.1:5173';
async function setup(){
 const app=buildApp({databasePath:':memory:',allowedOrigin:origin,trialCode:'controlled-trial-code',demoCode:'controlled-demo-code',serviceEndsAt:new Date(Date.now()+86400000).toISOString(),secureCookies:false});apps.push(app);
 async function login(){const r=await app.inject({method:'POST',url:'/api/v1/sessions',headers:{origin},payload:{code:'controlled-trial-code'}});return String(r.headers['set-cookie']).split(';')[0]!;}
 const cookie=await login(),other=await login();const draft=await app.inject({method:'POST',url:'/api/v1/investigations',headers:{origin,cookie,'idempotency-key':'controlled-draft'},payload:{originalQuestion:'controlled_fixture 图片',basicMode:'truth',presentationMode:'evidence'}});
 const id=draft.json().data.id as string,bytes=await sharp({create:{width:3,height:2,channels:3,background:'#223344'}}).png().toBuffer();
 const boundary='controlled-fixture-boundary';const body=Buffer.concat([Buffer.from('--'+boundary+'\r\nContent-Disposition: form-data; name="file"; filename="../../outside.svg"\r\nContent-Type: image/png\r\n\r\n'),bytes,Buffer.from('\r\n--'+boundary+'--\r\n')]);
 return{app,cookie,other,id,bytes,upload:()=>app.inject({method:'POST',url:'/api/v1/investigations/'+id+'/attachments',headers:{origin,cookie,'idempotency-key':'controlled-upload','content-type':'multipart/form-data; boundary='+boundary},payload:body})};
}
it('uploads original content with private metadata, isolates cookies and preserves duplicate uploads',async()=>{
 const s=await setup(),r=await s.upload();expect(r.statusCode).toBe(201);const a=r.json().data;
 expect(a).toMatchObject({mime:'image/png',width:3,height:2,order:0});expect(a).not.toHaveProperty('storageKey');expect(a).not.toHaveProperty('sessionId');
 expect((await s.upload()).json().data.id).toBe(a.id);
 const content=await s.app.inject({url:'/api/v1/attachments/'+a.id+'/content',headers:{cookie:s.cookie}});expect(content.rawPayload).toEqual(s.bytes);expect(content.headers['cache-control']).toContain('private');
 expect((await s.app.inject({url:'/api/v1/attachments/'+a.id+'/content',headers:{cookie:s.other}})).statusCode).toBe(404);
 expect((await s.app.inject({method:'GET',url:'/api/v1/investigations/'+s.id+'/attachments',headers:{cookie:s.cookie}})).json().data.items).toHaveLength(1);
 for(let i=0;i<2;i++)expect((await s.app.inject({method:'DELETE',url:'/api/v1/investigations/'+s.id+'/attachments/'+a.id,headers:{cookie:s.cookie,origin}})).statusCode).toBe(204);
 expect((await s.app.inject({url:'/api/v1/attachments/'+a.id+'/content',headers:{cookie:s.cookie}})).statusCode).toBe(404);
});
