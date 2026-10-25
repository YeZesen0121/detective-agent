import { openDatabase } from '../../src/server/platform/database.js';
import { RunStore } from '../../src/server/platform/runs.js';

const db = openDatabase(process.argv[2]!);
const runs = new RunStore(db);
let closed=false;const close=()=>{if(!closed){closed=true;db.close();}};
process.on('disconnect',close);
process.on('message', (input: { at: string; enqueue?: Parameters<RunStore['enqueue']>[0];stop?:boolean }) => {
  if(input.stop){close();process.disconnect();return;}
  try {
    const run = input.enqueue ? runs.enqueue(input.enqueue) : runs.claimNext(input.at);
    process.send?.({ id: run?.id ?? null });
  } catch (error) {
    process.send?.({ error: (error as { code?: string }).code ?? 'UNEXPECTED' });
  }
});
process.send?.({ ready: true });
