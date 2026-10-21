import { expect, test, type Page } from '@playwright/test';

// The worker only exists in the production build, so this runs against the
// built binary: TIDE_SW_BASE_URL=http://127.0.0.1:18081 npm run e2e:sw.
// Skipped otherwise (the dev server registers no worker).
test.skip(!process.env.TIDE_SW_BASE_URL, 'needs the built server (TIDE_SW_BASE_URL)');

const isCached = (page: Page, path: string) =>
  page.evaluate(async (p) => {
    for (const name of await caches.keys()) {
      if (await (await caches.open(name)).match(p)) return true;
    }
    return false;
  }, path);

async function controlled(page: Page) {
  await page.goto('/');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
}

test('the worker activates and precaches the app', async ({ page }) => {
  await controlled(page);
  const asset = await page.evaluate(() => {
    const el = document.querySelector('link[rel=modulepreload], script[src*="/_app/immutable/"]');
    const url = (el as HTMLLinkElement | null)?.href || (el as HTMLScriptElement | null)?.src;
    return url ? new URL(url).pathname : null;
  });
  expect(asset).toContain('/_app/immutable/');
  expect(await isCached(page, asset!)).toBe(true);
});

test('api and rtc requests are not answered by the worker', async ({ page }) => {
  await controlled(page);
  for (const path of ['/api/config', '/rtc']) {
    const [res] = await Promise.all([
      page.waitForResponse((r) => new URL(r.url()).pathname === path),
      page.evaluate((p) => fetch(p).catch(() => null), path)
    ]);
    expect(res.fromServiceWorker(), path).toBe(false);
  }
});

test('a missing immutable asset answered with index.html is not cached', async ({ page }) => {
  await controlled(page);
  const missing = '/_app/immutable/x.js';
  const type = await page.evaluate(
    async (p) => (await fetch(p)).headers.get('content-type'),
    missing
  );
  expect(type).toContain('text/html');
  expect(await isCached(page, missing)).toBe(false);
});
