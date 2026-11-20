import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { existsSync } from 'node:fs';
import { createLocalService } from '../../src/service/app.js';

const executablePath = [
  process.env.CHROMIUM_EXECUTABLE_PATH,
  chromium.executablePath(),
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
].find((p) => p && existsSync(p));
test('local dashboard completes a real demo capture and downloads a validated package', async () => {
  const app = await createLocalService({ port: 0 });
  const browser = await chromium.launch({ headless: true, executablePath, chromiumSandbox: true });
  try {
    const page = await browser.newPage();
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(app.url.replace('127.0.0.1', 'localhost'));
    assert.match(await page.title(), /Hla.Sh/);
    await page.getByRole('button', { name: 'Capture owned demo' }).click();
    await page.waitForFunction(
      () => document.getElementById('status')?.textContent?.startsWith('Captured '),
      {},
      { timeout: 30000 },
    );
    assert.equal(await page.locator('#screens img').count(), 2);
    const download = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Download capture package' }).click();
    assert.equal((await download).suggestedFilename(), 'website-capture.json');
    await mkdir('output/playwright', { recursive: true });
    await page.screenshot({ path: 'output/playwright/dashboard.png', fullPage: true });
    assert.deepEqual(errors, []);
  } finally {
    await browser.close();
    await app.close();
  }
});

const source = (
  request: import('../../src/service/jobs.js').CaptureRequest,
): import('../../src/core/scene.js').ScenePackage => ({
  version: 1,
  capture: {
    id: 'owned-ui-test',
    url: request.url ?? 'fixture:owned',
    title: 'Owned test',
    capturedAt: '2026-10-30',
    engine: 'test',
    ...(request.language ? { language: request.language } : {}),
  },
  screens: request.widths.map((width) => ({
    id: 'viewport-' + width,
    viewport: { width, height: 900, dpr: 1 },
    root: {
      id: 'root',
      name: 'Page',
      kind: 'frame',
      source: { tag: 'body' },
      bounds: { x: 0, y: 0, width, height: 100 },
      style: { opacity: 1 },
      children: [],
    },
  })),
  assets: [],
  issues: [],
});
async function mount(
  app: Awaited<ReturnType<typeof createLocalService>>,
  options: {
    missing?: boolean;
    delayFonts?: number;
    offline?: boolean;
    relay?: 'synthetic' | 'self';
    verificationFixture?: 'reference' | 'features';
  } = {},
) {
  const browser = await chromium.launch({ headless: true, executablePath, chromiumSandbox: true });
  const page = await browser.newPage({ viewport: { width: 400, height: 510 } });
  page.setDefaultTimeout(7000);
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.evaluate('globalThis.__name = value => value');
  let ui = (
    await readFile(options.verificationFixture ? 'dist/diagnostic/ui.html' : 'dist/ui.html', 'utf8')
  )
    .replaceAll('__HLA_LOCAL_PAIRING_KEY__', app.pairingKey)
    .replaceAll('http://localhost:4017', app.url.replace('127.0.0.1', 'localhost'));
  if (options.verificationFixture)
    ui = ui.replaceAll(
      '__HLA_VERIFICATION_URL__',
      encodeURIComponent('fixture:' + options.verificationFixture),
    );
  if (options.relay)
    ui = ui.replace(
      '<head>',
      `<head><script>window.addEventListener('message',e=>{if(!e.data?.__relay)return;${options.relay === 'synthetic' ? "window.dispatchEvent(new MessageEvent('message',{data:e.data.__relay}));" : "window.postMessage(e.data.__relay,'*');"}});</script>`,
    );
  if (options.offline) await page.context().setOffline(true);
  // Simulate only Figma's main-sandbox messages. The UI itself runs in a real
  // opaque sandbox iframe with real HTTP/CORS and without randomUUID.
  await page.evaluate(
    ({ ui, pairingKey, options }) => {
      document.body.style.margin = '0';
      (window as any).imports = [];
      (window as any).preflights = [];
      (window as any).saved = [];
      const frame = document.createElement('iframe');
      frame.id = 'plugin';
      frame.sandbox.add('allow-scripts');
      frame.style.cssText = 'width:400px;height:510px;border:0';
      window.addEventListener('message', (event) => {
        if (event.source !== frame.contentWindow) return;
        const message = event.data?.pluginMessage;
        if (!message || message.__channel !== pairingKey) return;
        const reply = (data: object) =>
          frame.contentWindow!.postMessage(
            options.relay
              ? { __relay: { pluginMessage: { ...data, __channel: pairingKey } } }
              : { pluginMessage: { ...data, __channel: pairingKey } },
            '*',
          );
        if (message.type === 'READY')
          reply({
            type: 'PREFERENCES',
            preferences: { size: '1440', theme: 'light', language: 'original' },
          });
        if (message.type === 'CONNECT')
          reply(
            options.offline ? { type: 'CONNECTION_ERROR' } : { type: 'PAIR_SERVICE', pairingKey },
          );
        if (message.type === 'SAVE_PREFERENCES') (window as any).saved.push(message.preferences);
        if (message.type === 'PREFLIGHT') (window as any).preflights.push(message);
        if (message.type === 'PREFLIGHT')
          setTimeout(
            () =>
              reply({
                type: 'PREFLIGHT_RESULT',
                requestId: message.requestId,
                missing: options.missing
                  ? [
                      {
                        requested: 'Source font',
                        replacement: { family: 'Inter', style: 'Regular' },
                      },
                    ]
                  : [],
                availableFamilies: ['Inter'],
              }),
            options.delayFonts ?? 0,
          );
        if (message.type === 'IMPORT') {
          (window as any).imports.push(message);
          reply({
            type: 'IMPORT_RESULT',
            requestId: message.requestId,
            result: { issues: [], stats: { text: 1, autoLayout: 1, variables: 0 } },
          });
        }
      });
      frame.srcdoc = ui;
      document.body.append(frame);
    },
    { ui, pairingKey: app.pairingKey, options },
  );
  const frame = page.frameLocator('#plugin');
  await frame.getByLabel('رابط الموقع').waitFor();
  return { browser, page, frame, errors };
}
async function expectStatus(host: Awaited<ReturnType<typeof mount>>, text: string | RegExp) {
  try {
    await host.frame.getByRole('status').filter({ hasText: text }).waitFor();
  } catch (error) {
    throw new Error(
      'Plugin status: ' +
        (await host.frame.locator('#status').innerText()) +
        '; Browser errors: ' +
        JSON.stringify(host.errors),
      { cause: error },
    );
  }
}

test('installed diagnostic fixtures request isolated owned content and clearly label their source', async () => {
  for (const verificationFixture of ['reference', 'features'] as const) {
    const requests: import('../../src/service/jobs.js').CaptureRequest[] = [];
    const app = await createLocalService({
      port: 0,
      runner: async (request) => {
        requests.push(request);
        return source(request);
      },
    });
    const host = await mount(app, { verificationFixture });
    try {
      await expectStatus(host, /تم نسخ التصميم/);
      assert.match(await host.frame.getByLabel('رابط الموقع').inputValue(), /^Forma —/);
      assert.equal(requests.length, 1);
      assert.equal(requests[0]!.demo, true);
      assert.equal(requests[0]!.url, undefined);
      assert.equal(
        requests[0]!.selector,
        verificationFixture === 'features' ? '#features' : undefined,
      );
      assert.deepEqual(host.errors, []);
    } finally {
      await host.browser.close();
      await app.close();
    }
  }
});
test('simple opaque-frame UI pastes a URL and automatically imports selected sizes, theme and website language', async () => {
  const requests: import('../../src/service/jobs.js').CaptureRequest[] = [];
  const app = await createLocalService({
    port: 0,
    runner: async (request) => {
      requests.push(request);
      return source(request);
    },
  });
  const host = await mount(app, { relay: 'synthetic' });
  try {
    assert.equal(await host.frame.locator('select').count(), 3);
    assert.equal(await host.frame.getByRole('button').count(), 1);
    assert.equal(
      await host.frame.getByRole('button', { name: 'نسخ إلى Figma', exact: true }).isVisible(),
      true,
    );
    assert.equal(await host.frame.locator('input').count(), 1);
    await host.frame.getByLabel('المقاس').selectOption('all');
    await host.frame.getByLabel('المظهر').selectOption('dark');
    await host.frame.getByLabel('لغة الموقع').selectOption('ar');
    await host.frame.getByLabel('رابط الموقع').fill('https://example.com');
    await host.frame.getByLabel('رابط الموقع').dispatchEvent('paste');
    await expectStatus(host, 'تم نسخ التصميم');
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0]!.widths, [1440, 768, 390]);
    assert.equal(requests[0]!.theme, 'dark');
    assert.equal(requests[0]!.language, 'ar');
    const imports = await host.page.evaluate(() => (window as any).imports);
    assert.equal(imports.length, 1);
    assert.equal(imports[0].allowSubstitution, false);
    assert.equal(imports[0].scene.screens.length, 3);
    // Font preparation sends only the font list, never the whole scene.
    const preflights = await host.page.evaluate(() => (window as any).preflights);
    assert.equal(preflights.length, 1);
    assert.equal(preflights[0].scene, undefined);
    assert.ok(Array.isArray(preflights[0].fonts));
    assert.ok(imports[0].scene.screens.every((screen: object) => !('screenshot' in screen)));
    assert.deepEqual(host.errors, []);
    await mkdir('output/playwright', { recursive: true });
    await host.page.screenshot({ path: 'output/playwright/plugin-simple.png' });
  } finally {
    await host.browser.close();
    await app.close();
  }
});
test('missing fonts pause automatic insertion until the user explicitly chooses a substitute', async () => {
  const app = await createLocalService({ port: 0, runner: async (request) => source(request) });
  const host = await mount(app, { missing: true, relay: 'self' });
  try {
    await host.frame.getByLabel('رابط الموقع').fill('https://example.com');
    await host.frame.getByRole('button', { name: 'نسخ إلى Figma', exact: true }).click();
    await expectStatus(host, 'بانتظار الخط');
    assert.equal(await host.page.evaluate(() => (window as any).imports.length), 0);
    await host.frame.getByRole('button', { name: 'متابعة بخط بديل' }).click();
    await host.frame.getByRole('status').filter({ hasText: 'تم النسخ باستخدام خط بديل' }).waitFor();
    assert.equal(
      await host.page.evaluate(() => (window as any).imports[0].allowSubstitution),
      true,
    );
    assert.equal(await host.frame.locator('#notes').isVisible(), true);
  } finally {
    await host.browser.close();
    await app.close();
  }
});
test('unsupported captured content shows a visible review state instead of unqualified success', async () => {
  const app = await createLocalService({
    port: 0,
    runner: async (request) => {
      const scene = source(request);
      scene.issues.push({
        code: 'unsupported-effect',
        severity: 'warning',
        message: 'Unsupported gradient',
      });
      return scene;
    },
  });
  const host = await mount(app);
  try {
    await host.frame.getByLabel('رابط الموقع').fill('https://example.com');
    await host.frame.getByRole('button', { name: 'نسخ إلى Figma', exact: true }).click();
    await expectStatus(host, 'توجد فروقات تحتاج مراجعة');
    assert.equal(
      await host.frame.locator('#notes').evaluate((node) => (node as HTMLDetailsElement).open),
      true,
    );
  } finally {
    await host.browser.close();
    await app.close();
  }
});
test('cancelling font preparation ignores a late reply and never inserts the abandoned capture', async () => {
  const app = await createLocalService({ port: 0, runner: async (request) => source(request) });
  const host = await mount(app, { delayFonts: 700 });
  try {
    await host.frame.getByLabel('رابط الموقع').fill('https://example.com');
    await host.frame.getByRole('button', { name: 'نسخ إلى Figma', exact: true }).click();
    await host.frame.getByRole('status').filter({ hasText: 'جارٍ تجهيز الخطوط' }).waitFor();
    await host.frame.getByRole('button', { name: 'إلغاء', exact: true }).click();
    await host.frame.getByRole('status').filter({ hasText: 'تم الإلغاء' }).waitFor();
    await host.page.waitForTimeout(850);
    assert.equal(await host.page.evaluate(() => (window as any).imports.length), 0);
    assert.equal(await host.frame.locator('#font-note').isHidden(), true);
  } finally {
    await host.browser.close();
    await app.close();
  }
});
test('unavailable local service keeps the simple form usable without exposing session controls', async () => {
  const app = await createLocalService({ port: 0 });
  const host = await mount(app, { offline: true });
  try {
    await host.frame.getByLabel('رابط الموقع').fill('https://example.com');
    await host.frame.getByRole('button', { name: 'نسخ إلى Figma', exact: true }).click();
    await expectStatus(host, /تعذر|fetch|Failed|fetching/i);
    assert.equal(await host.frame.locator('#settings').isDisabled(), false);
    assert.equal(await host.page.evaluate(() => (window as any).imports.length), 0);
  } finally {
    await host.browser.close();
    await app.close();
  }
});
