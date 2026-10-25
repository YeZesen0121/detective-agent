import { expect, test } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { moduleFor } from '../web-model/runtime-http-fixture.js';
import { serveMedia } from '../web-model/media-http-fixture.js';
import { serve, enter } from './runtime-fixture.js';

test('controlled_fixture ledger follows clarification, completion and page context', async ({ page }, info) => {
  const module = moduleFor(), prepare = module.prepareInvestigation, work = module.runInvestigation;
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  module.runInvestigation = async (input, services, signal) => {
    await services.events.append(input.run.id, input.context.epoch, { type: 'query.started', message: 'controlled_fixture 正在检索台账线索', queryId: null, sourceIds: [], visibility: 'public' });
    await gate;
    return work(input, services, signal);
  };
  module.prepareInvestigation = async (input, services, signal) => input.clarificationAnswer ? prepare(input, services, signal) : {
    scope: null, canInvestigate: false, clarification: { id: randomUUID(), runId: input.context.runId!, prompt: 'controlled_fixture 请补充年份', missingFields: ['year'], options: [], canProceedWithUnknown: false, answer: null, answeredAt: null },
  };
  const server = await serve(module, info.workerIndex);
  try {
    await enter(page, server.site);
    await page.getByRole('textbox', { name: '要调查的问题' }).fill('controlled_fixture 台账澄清联动');
    await page.getByRole('button', { name: /^开查/ }).click();
    await expect(page.getByLabel('补充一句')).toBeVisible();
    const ledger = page.locator('.ledger');
    await expect(ledger.getByLabel('台账状态', { exact: true })).toContainText('等待补充');
    await expect(ledger).toContainText('任务暂停');
    await page.screenshot({ path: info.outputPath('ledger-clarify.png') });
    await page.getByLabel('补充一句').fill('2026年');
    await page.getByRole('button', { name: /补充后开查/ }).click();
    await expect(ledger.getByLabel('台账状态', { exact: true })).toContainText('调查中');
    await expect(ledger).toContainText('controlled_fixture 正在检索台账线索');
    release();
    await expect(page.getByRole('heading', { name: '受控材料中的报名截止日期为十月三十日。' })).toBeVisible();
    await expect(ledger.getByLabel('台账状态', { exact: true })).toContainText('已保存报告');
    await expect(ledger).toContainText('已保存结果');
    await page.getByRole('tab', { name: '盯梢', exact: true }).click();
    await expect(ledger).not.toContainText('任务暂停');
    await expect(ledger.locator('.usage')).toHaveCount(0);
    await expect(ledger.getByLabel('台账状态', { exact: true })).toContainText('盯梢');
    await page.getByRole('tab', { name: '调查台', exact: true }).click();
    await expect(ledger).toContainText('已保存结果');
  } finally { release(); await server.close(); }
});

test('controlled_fixture ledger follows selected report run and does not retain another case', async ({ page }, info) => {
  const s = await serveMedia(info.workerIndex, { followupModule: moduleFor() }), newer = s.publishUpdate();
  for (const [runId, label] of [[s.seed.run.id, 'controlled_fixture 旧版调查事件'], [newer.runId, 'controlled_fixture 新版调查事件']]) {
    s.seed.db.prepare("UPDATE progress_events SET payload_json=json_set(payload_json,'$.message',?) WHERE run_id=?").run(label, runId);
  }
  try {
    await page.context().addCookies([{ name: 'detective_session', value: s.seed.token, url: s.site, httpOnly: true }]);
    await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${s.seed.version.id}`);
    const ledger = page.locator('.ledger');
    await expect(page.getByRole('heading', { name: s.seed.version.payload.summary, exact: true })).toBeVisible();
    await expect(ledger).toContainText('controlled_fixture 旧版调查事件');
    await expect(ledger).not.toContainText('controlled_fixture 新版调查事件');
    await page.getByRole('button', { name: '看新版 →', exact: true }).click();
    await expect(ledger).toContainText('controlled_fixture 新版调查事件');
    await expect(ledger).not.toContainText('controlled_fixture 旧版调查事件');
    await page.getByRole('button', { name: '返回旧版 →', exact: true }).click();
    await expect(ledger).toContainText('controlled_fixture 旧版调查事件');
    const draft = await page.request.post(`${s.site}/api/v1/investigations`, { headers: { origin: s.site, 'idempotency-key': randomUUID() }, data: { originalQuestion: 'controlled_fixture 另一个案卷', basicMode: 'truth', presentationMode: 'brief' } });
    expect(draft.status()).toBe(201);
    const other = (await draft.json()).data.id as string;
    await page.goto(`${s.site}/?case=${other}`);
    await expect(page.getByRole('textbox', { name: '要调查的问题' })).toHaveValue('controlled_fixture 另一个案卷');
    await expect(ledger).not.toContainText('controlled_fixture 旧版调查事件');
    await expect(ledger.locator('.usage')).toHaveCount(0);
    expect(s.calls.real).toBe(0);
  } finally { await s.close(); }
});

test('controlled_fixture an unreadable historical ledger shows its error and recovers without a write', async ({ page }, info) => {
  const s = await serveMedia(info.workerIndex, { followupModule: moduleFor() });
  s.publishUpdate();
  let blocked = true, writes = 0;
  page.on('request', request => { if (request.method() !== 'GET') writes++; });
  try {
    await page.route(`**/api/v1/runs/${s.seed.run.id}`, async route => {
      if (!blocked) { await route.continue(); return; }
      await route.fulfill({ status: 503, json: { error: { code: 'PROVIDER_UNAVAILABLE', message: 'controlled_fixture 旧版台账暂时不可读', retryable: true }, meta: { requestId: 'controlled-ledger-read', contractVersion: '0.1.0' } } });
    });
    await page.context().addCookies([{ name: 'detective_session', value: s.seed.token, url: s.site, httpOnly: true }]);
    await page.goto(`${s.site}/?case=${s.seed.investigationId}&version=${s.seed.version.id}`);
    const ledger = page.locator('.ledger');
    await expect(page.getByRole('heading', { name: s.seed.version.payload.summary, exact: true })).toBeVisible();
    await expect(ledger.getByRole('alert')).toContainText('controlled_fixture 旧版台账暂时不可读');
    await expect(ledger.locator('.log')).toHaveCount(0);
    await expect(ledger.getByLabel('台账状态', { exact: true })).not.toContainText('尚未开查');
    blocked = false;
    await ledger.getByRole('button', { name: '重新读取台账' }).click();
    await expect(ledger.getByRole('alert')).toHaveCount(0);
    await expect(ledger).toContainText('已保存结果');
    expect(writes).toBe(0);
    expect(s.calls.real).toBe(0);
  } finally { await page.unrouteAll({ behavior: 'wait' }); await s.close(); }
});
