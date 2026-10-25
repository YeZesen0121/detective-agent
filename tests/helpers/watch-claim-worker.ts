import { openDatabase } from '../../src/server/platform/database.js';
import { WatchStore } from '../../src/server/platform/watch-store.js';
const db=openDatabase(process.argv[2]!);
try {
 const lease=new WatchStore(db,{serviceEndsAt:process.argv[4]!}).claimDue(process.argv[3]!);
 db.close();process.send?.({checkId:lease?.check.id??null},()=>process.disconnect?.());
} catch(error) {db.close();process.send?.({error:String(error)},()=>process.disconnect?.());}
