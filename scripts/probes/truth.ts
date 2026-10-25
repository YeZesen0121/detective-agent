import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { RuntimeCredentialsSchema } from '../../src/server/platform/provider-transports.js';
import { runTruthProbe, truthProbeFailureSummary, TRUTH_PROBE_CAMPAIGN, TRUTH_PROBE_LIMITS } from '../../src/server/platform/truth-probe.js';

async function main() {
 if(process.argv.slice(2).some(arg=>arg!=='--live'))throw Error('INVALID_ARGUMENT');
 if(existsSync('.env'))process.loadEnvFile('.env');
 const bearer=process.env.YUANBAO_API_KEY?.trim(),id=process.env.TENCENT_SECRET_ID?.trim(),key=process.env.TENCENT_SECRET_KEY?.trim(),deepseek=process.env.DEEPSEEK_API_KEY?.trim();
 const auth=bearer?(!id&&!key?'bearer':null):id&&key?'tc3':null;
 const configured=!!auth&&!!deepseek;
 if(!process.argv.includes('--live')){
  console.log(JSON.stringify({campaignId:TRUTH_PROBE_CAMPAIGN,mode:'configuration-only',configured,authMode:auth,deepseekConfigured:!!deepseek,limits:TRUTH_PROBE_LIMITS,providerAttempts:0}));return;
 }
 if(!configured)throw Error('CONFIGURATION_MISSING_OR_AMBIGUOUS');
 const credentials=RuntimeCredentialsSchema.parse({search:auth==='bearer'?{kind:'bearer',apiKey:bearer}:{kind:'tc3',secretId:id,secretKey:key},deepseekKey:deepseek});
 const directory=resolve('.local/truth-probes',TRUTH_PROBE_CAMPAIGN);
 const report=await runTruthProbe({directory,network:{credentials},materialKind:'real_provider'});
 console.log(JSON.stringify({status:report.status,campaignId:report.campaignId,runStatus:report.runStatus,stopReason:report.stopReason,
  providerAttempts:report.calls.length,accounting:report.accounting,sourceSelection:report.sourceSelection,reportPath:resolve(directory,'report.json'),semanticReview:report.semanticReview,actualInvoiceMicros:null}));
 if(report.status!=='PIPELINE_COMPLETED')process.exitCode=1;
}
try{await main();}catch(error){
 console.log(JSON.stringify(truthProbeFailureSummary(error)));process.exitCode=2;
}
