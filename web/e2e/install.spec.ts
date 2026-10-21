import { expect, test, type Page } from '@playwright/test';
import { defaultState, mockApi } from './mock-api';

// The "Install app" button offers tide as an installed app only where the
// browser can actually install it, and only while it isn't installed: a
// button that does nothing, or that offers what is already on the home
// screen, is noise in a header this small. Against the Vite dev server with
// the API mocked in the browser.

const iphone =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1';

/** Fires Chromium's install offer once the app is listening, as Chrome does after load. */
async function offerInstall(page: Page): Promise<void> {
  await page.evaluate(() => {
    const offer = new Event('beforeinstallprompt', { cancelable: true }) as Event & {
      prompt: () => Promise<void>;
      userChoice: Promise<{ outcome: string }>;
    };
    const prompted = window as unknown as { prompted: number };
    prompted.prompted = 0;
    offer.prompt = async () => {
      prompted.prompted += 1;
    };
    offer.userChoice = Promise.resolve({ outcome: 'accepted' });
    window.dispatchEvent(offer);
  });
}

test('a browser that offers install gets the button, which opens its prompt', async ({ page }) => {
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByTestId('room-card').first()).toBeVisible();

  const install = page.getByRole('button', { name: 'Install app' });
  // Without the browser's offer there is nothing to install with.
  await expect(install).toHaveCount(0);

  await offerInstall(page);
  await expect(install).toBeVisible();
  await install.click();
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { prompted: number }).prompted))
    .toBe(1);
});

test('an offer made on another page still reaches the dashboard, and goes once installed', async ({
  page
}) => {
  // Chrome makes its offer once per page load, on whichever page is open.
  await mockApi(page);
  await page.goto('/rooms/standup');
  await expect(page.getByRole('heading', { name: 'Standup' })).toBeVisible();
  await offerInstall(page);
  await page.getByRole('link', { name: 'All rooms' }).click();
  const install = page.getByRole('button', { name: 'Install app' });
  await expect(install).toBeVisible();

  await page.evaluate(() => window.dispatchEvent(new Event('appinstalled')));
  await expect(install).toHaveCount(0);
});

test.describe('on an iPhone', () => {
  test.use({ userAgent: iphone, viewport: { width: 390, height: 844 }, hasTouch: true });

  test('Safari has no prompt, so the button explains Add to Home Screen', async ({ page }) => {
    await mockApi(page);
    await page.goto('/');
    await expect(page.getByTestId('room-card').first()).toBeVisible();

    await page.getByRole('button', { name: 'Install app' }).click();
    const hint = page.getByRole('dialog', { name: 'Install tide' });
    await expect(hint).toBeVisible();
    await expect(hint).toContainText('Share');
    await expect(hint).toContainText('Add to Home Screen');

    await hint.getByRole('button', { name: 'Close' }).click();
    await expect(hint).toBeHidden();
  });
});

test('an app already running installed shows no button', async ({ page }) => {
  // Playwright can't emulate display-mode, so the query answers as an
  // installed app's would.
  await page.addInitScript(() => {
    const matchMedia = window.matchMedia.bind(window);
    window.matchMedia = (query: string) =>
      query.includes('display-mode: standalone')
        ? ({ ...matchMedia(query), matches: true, media: query } as MediaQueryList)
        : matchMedia(query);
  });
  await mockApi(page);
  await page.goto('/');
  await expect(page.getByTestId('room-card').first()).toBeVisible();
  await offerInstall(page);
  await expect(page.getByRole('button', { name: /Switch to/ })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
});

test('the signed-out home offers install too, but a meeting never does', async ({ page }) => {
  await mockApi(page, { ...defaultState(), signedIn: false });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /Continue with SSO/ })).toBeVisible();
  await offerInstall(page);
  await expect(page.getByRole('button', { name: 'Install app' })).toBeVisible();

  await page.goto('/m/standup');
  await offerInstall(page);
  await expect(page.getByRole('heading', { name: 'Standup' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Install app' })).toHaveCount(0);
});
