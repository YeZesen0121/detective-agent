import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { wsa } from 'tencentcloud-sdk-nodejs-wsa';
import { HttpUrlSchema, IdSchema } from '../../src/shared/contracts.js';

if (existsSync('.env')) process.loadEnvFile('.env');
const key = process.env.YUANBAO_API_KEY?.trim();
const secretId = process.env.TENCENT_SECRET_ID?.trim();
const secretKey = process.env.TENCENT_SECRET_KEY?.trim();
const authMode = key ? 'bearer-api-key' : secretId && secretKey ? 'tc3-signature' : null;
const live = process.argv.includes('--live');
const startedAt = new Date().toISOString();
const report: Record<string, unknown> = {
  provider: 'yuanbao', probe: 'single-search-request', startedAt,
  authMode, endpoint: authMode === 'tc3-signature' ? 'https://wsa.tencentcloudapi.com/' : 'https://api.wsa.cloud.tencent.com/SearchPro',
  query: 'Node.js 24 官方发布', maxHttpAttempts: 1, httpAttempts: 0,
  status: 'NOT_RUN', productInvestigationVerified: false,
};
if (!authMode) {
  report.status = 'BLOCKED'; report.reason = 'MISSING_SEARCH_CREDENTIALS';
  report.costMicros = 0; process.exitCode = 2;
} else if (!live) {
  report.reason = 'Add --live to perform one potentially billable request; no automatic retries.';
  report.costMicros = 0;
} else {
  report.httpAttempts = 1;
  report.costMicros = null; // A sent/unknown request is never recorded as free.
  const begin = performance.now();
  try {
    let json: unknown;
    let ok = false;
    if (authMode === 'tc3-signature') {
      const client = new wsa.v20250508.Client({
        credential: { secretId: secretId!, secretKey: secretKey! },
        profile: { signMethod: 'TC3-HMAC-SHA256', httpProfile: { reqMethod: 'POST', reqTimeout: 20, endpoint: 'wsa.tencentcloudapi.com' } },
      });
      const result = await client.SearchPro({ Query: String(report.query) });
      json = { Response: result }; ok = true;
      report.httpStatus = 200;
    } else {
      const response = await fetch(String(report.endpoint), {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
        headers: { 'Content-Type': 'application/json; charset=UTF-8', Authorization: `Bearer ${key}` },
        body: JSON.stringify({ Query: report.query }),
      });
      report.httpStatus = response.status; ok = response.ok;
      json = await response.json();
    }
    const data = json && typeof json === 'object' && 'Response' in json ? json.Response : null;
    if (!ok || !data || typeof data !== 'object' || 'Error' in data) {
      report.status = 'FAIL'; report.reason = 'HTTP_OR_PROVIDER_ERROR';
      if (data && typeof data === 'object' && 'Error' in data && data.Error && typeof data.Error === 'object' && 'Code' in data.Error) {
        // Only a bounded machine code is retained, never raw messages or headers.
        const code = String(data.Error.Code);
        if (/^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(code)) report.providerErrorCode = code;
      }
      process.exitCode = 1;
    } else if (!('Pages' in data) || !Array.isArray(data.Pages)) {
      report.status = 'FAIL'; report.reason = 'PAGES_FIELD_MISSING'; process.exitCode = 1;
    } else {
      let invalidItemCount = 0;
      const items: { title: string; url: string; snippetAvailable: boolean }[] = [];
      for (const page of data.Pages.slice(0, 50)) {
        try {
          if (typeof page !== 'string') throw new Error('Expected JSON string');
          const item: unknown = JSON.parse(page);
          if (!item || typeof item !== 'object' || !('url' in item) || !('title' in item)
            || typeof item.title !== 'string' || !item.title.trim()) throw new Error('Invalid page');
          const url = HttpUrlSchema.parse(item.url);
          items.push({ title: item.title.slice(0, 500), url, snippetAvailable: ('passage' in item && typeof item.passage === 'string') || ('content' in item && typeof item.content === 'string') });
        } catch { invalidItemCount++; }
      }
      if ('RequestId' in data && IdSchema.safeParse(data.RequestId).success) report.providerRequestId = data.RequestId;
      if ('Version' in data && ['lite', 'standard', 'flagship'].includes(String(data.Version))) report.providerVersion = data.Version;
      report.validItemCount = items.length; report.invalidItemCount = invalidItemCount; report.items = items.slice(0, 3);
      report.status = items.length > 0 ? 'PASS_API_RESPONSE' : data.Pages.length === 0 ? 'PASS_EMPTY_RESPONSE' : 'FAIL';
      if (report.status === 'FAIL') { report.reason = 'ALL_ITEMS_INVALID'; process.exitCode = 1; }
      report.readStatus = 'snippet_only';
    }
  } catch (error) {
    report.status = 'FAIL'; report.reason = 'NETWORK_TIMEOUT_OR_INVALID_RESPONSE'; process.exitCode = 1;
    if (error && typeof error === 'object') {
      if ('code' in error && typeof error.code === 'string' && /^[A-Za-z][A-Za-z0-9.]{0,127}$/.test(error.code)) {
        report.providerErrorCode = error.code;
        report.reason = 'SDK_PROVIDER_ERROR';
      }
      if ('requestId' in error && IdSchema.safeParse(error.requestId).success) report.providerRequestId = error.requestId;
    }
  }
  report.elapsedMs = Math.round(performance.now() - begin);
}
mkdirSync('.local/probes', { recursive: true });
writeFileSync(live ? '.local/probes/yuanbao-latest.json' : '.local/probes/yuanbao-configuration.json', JSON.stringify(report, null, 2) + '\n');
if (live) writeFileSync(`.local/probes/yuanbao-${startedAt.replace(/[:.]/g, '-')}.json`, JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));
