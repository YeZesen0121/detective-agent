import { randomInt } from 'node:crypto';
import type { FastifyInstance } from 'fastify';

/** Real HTTP fixtures must avoid browser/undici blocked ports in custom Windows dynamic ranges. */
export async function listenLoopback(app:FastifyInstance,choosePort:()=>number=()=>randomInt(20000,60000)):Promise<string>{
 for(let attempt=0;attempt<16;attempt++){
  const port=choosePort();if(!Number.isInteger(port)||port<20000||port>=60000)throw new RangeError('controlled_fixture requires a browser-safe high loopback port');
  try{return await app.listen({host:'127.0.0.1',port});}
  // Windows may deny a selected high port. Pick another allowed port; never change OS policy.
  catch(error){if(!(error instanceof Error&&'code'in error&&['EADDRINUSE','EACCES'].includes(String(error.code))))throw error;}
 }
 throw new Error('controlled_fixture could not bind a free loopback port after 16 attempts');
}
