import {backupRuntime,restoreRuntime,verifyRuntimeBackup} from '../../src/server/platform/runtime-backup.js';

// No environment loading, credentials, network providers, recovery workers or database migrations.
async function main(){
 const [action,...args]=process.argv.slice(2);let result;
 if(action==='backup'&&args.length===3)result=await backupRuntime({databasePath:args[0]!,assetsRoot:args[1]!,destination:args[2]!});
 else if(action==='restore'&&args.length===2)result=await restoreRuntime({backupDirectory:args[0]!,destination:args[1]!});
 else if(action==='verify'&&args.length===1)result=await verifyRuntimeBackup(args[0]!);
 else throw Error('STORAGE_ARGUMENTS_INVALID');
 console.log(JSON.stringify({action,status:'operation_complete',directory:result.directory,databasePath:result.databasePath,assetsRoot:result.assetsRoot,schemaVersion:result.manifest.schemaVersion,assetCount:result.manifest.assets.length,newSupplierRequests:0}));
}
try{await main();}catch(error){const code=error instanceof Error&&/^[A-Z_]+$/.test(error.message)?error.message:'STORAGE_OPERATION_FAILED';console.log(JSON.stringify({status:'failed',code}));process.exitCode=1;}
