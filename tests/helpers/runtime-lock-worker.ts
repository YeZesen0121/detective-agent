import { acquireRuntimeLock } from '../../src/server/platform/runtime-lock.js';
try{
 const release=acquireRuntimeLock(process.argv[2]!);
 process.once('message',()=>{release();process.disconnect();});
 process.send?.({acquired:true});
}catch{process.send?.({acquired:false},()=>process.disconnect());}
