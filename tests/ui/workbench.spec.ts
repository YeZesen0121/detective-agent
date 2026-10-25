import { prepareDraft } from './draft-setup.js';
import { expect, test } from '@playwright/test';
import { resolve } from 'node:path';
import { buildApp } from '../../src/server/app.js';

let site: string;
let app: ReturnType<typeof buildApp>;
test.beforeAll(async ({}, testInfo) => {
  const port = 31457 + testInfo.workerIndex;
  site = `http://127.0.0.1:${port}`;
  app = buildApp({ databasePath: ':memory:', allowedOrigin: site,
    trialCode: 'controlled-e2e-trial', demoCode: 'controlled-e2e-demo',
    serviceEndsAt: new Date(Date.now() + 86400000).toISOString(), secureCookies: false,
    webRoot: resolve('dist/web') });
  await app.listen({ host: '127.0.0.1', port });
});
test.afterAll(async () => { await app.close(); });

test('real browser authenticates, opens an empty workbench, and reports unavailable runtime', async ({ page }) => {
  await page.goto(site);
  await expect(page.getByRole('heading', { name: /先核对一下/ })).toBeVisible();
  await expect(page.getByText('旧书市集截止日期')).toHaveCount(0);
  await page.getByLabel('体验码').fill('controlled-e2e-trial');
  await page.getByRole('button', { name: '进入事务所' }).click();
  await expect(page.getByRole('heading', { name: /这一桩/ })).toBeVisible();
  await expect(page.getByText('还没有打开案卷')).toBeVisible();
  await expect(page.getByRole('button', { name: '查最新' })).toBeDisabled();
  await page.getByRole('button', { name: '暗房' }).click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '亮房' }).click();
  await page.getByRole('tab', { name: '盯梢' }).click();
  await expect(page.getByText('当前没有盯梢记录')).toBeVisible();
  await page.getByRole('tab', { name: '调查台' }).click();
  await page.getByRole('textbox', { name: '要调查的问题' }).fill('社区通知下周三停水，是真的吗？');
  await prepareDraft(page);
  await expect(page.getByRole('button', { name: '开查' })).toBeDisabled();
  expect((await(await page.request.get(`${site}/api/v1/capabilities`)).json()).data.newInvestigations.available).toBe(false);
  await expect(page.getByText('社区通知下周三停水，是真的吗？').first()).toBeVisible();
  await expect(page.getByText('街道办 10-18 推送')).toHaveCount(0);
});

test('real HTTP cookies isolate two browser contexts sharing one code', async ({ browser, baseURL }) => {
  const a = await browser.newContext(); const b = await browser.newContext();
  const headers = { origin: baseURL! };
  try {
    for (const context of [a, b]) {
      const login = await context.request.post(`${baseURL}/api/v1/sessions`, { headers, data: { code: 'controlled-e2e-trial' } });
      expect(login.status()).toBe(200);
    }
    const created = await a.request.post(`${baseURL}/api/v1/investigations`, {
      headers: { ...headers, 'idempotency-key': 'browser-create-001' },
      data: { originalQuestion: '受控浏览器隔离样例', basicMode: 'truth', presentationMode: 'brief' },
    });
    expect(created.status()).toBe(201);
    const id = (await created.json()).data.id as string;
    expect((await a.request.get(`${baseURL}/api/v1/investigations/${id}`)).status()).toBe(200);
    expect((await b.request.get(`${baseURL}/api/v1/investigations/${id}`)).status()).toBe(404);
    const page = await a.newPage(); await page.goto('/');
    expect(await page.evaluate(() => document.cookie)).not.toContain('detective_session');
  } finally { await a.close(); await b.close(); }
});
