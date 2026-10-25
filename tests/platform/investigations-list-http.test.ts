import {expect,it} from 'vitest';
import {harness} from '../web-model/runtime-http-fixture.js';
it('lists only the current session with stable bounded pagination and leaves cases unchanged',async()=>{
 const h=harness(null);try{
 expect((await h.app.inject({url:'/api/v1/investigations'})).statusCode).toBe(401);
 const one=h.browser(),two=h.browser();await one.enter();await two.enter();
 const created=[];for(let i=0;i<3;i++)created.push(await one.foundation.createInvestigation({originalQuestion:'controlled_fixture 案卷'+i,basicMode:'truth',presentationMode:'brief'},'controlled-list-'+i,one.signal));
 const foreign=await two.foundation.createInvestigation({originalQuestion:'controlled_fixture another session',basicMode:'truth',presentationMode:'brief'},'controlled-list-foreign',two.signal);
 const response=await one.transport('/api/v1/investigations?limit=2');expect(response.status).toBe(200);const first=(await response.json()).data;expect(first.items).toHaveLength(2);expect(first.nextBefore).toBe(first.items[1].id);expect(first.items.every((item:any)=>!('sessionId'in item)&&!('tokenHash'in item))).toBe(true);
 const second=(await(await one.transport('/api/v1/investigations?limit=2&before='+first.nextBefore)).json()).data;expect(second.items).toHaveLength(1);expect(second.nextBefore).toBeNull();expect(new Set([...first.items,...second.items].map((v:any)=>v.id))).toEqual(new Set(created.map(v=>v.id)));
 expect((await one.transport('/api/v1/investigations?before='+foreign.id)).status).toBe(404);expect((await one.transport('/api/v1/investigations?limit=100')).status).toBe(400);
 expect((await(await two.transport('/api/v1/investigations')).json()).data.items.map((v:any)=>v.id)).toEqual([foreign.id]);
 for(const value of created){const saved=await one.foundation.getInvestigation(value.id,one.signal);expect(saved.investigation).toEqual(value);expect(saved.activeRun).toBeNull();}
 expect(h.paidCalls).toBe(0);
 }finally{await h.app.close();}
});
