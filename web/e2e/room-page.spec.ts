import { expect, test } from '@playwright/test';
import { defaultState, mockApi, now, recording } from './mock-api';

// The dashboard and a room's page, against the Vite dev server with the API
// mocked in the browser.

test('the room link names its rules only once the link breaks them', async ({ page }) => {
  await mockApi(page);
  await page.goto('/rooms/standup');

  const link = page.getByRole('textbox', { name: /Custom room link/ });
  const status = page.locator('#room-slug-status');
  await expect(status).toHaveText('Meeting URL: /m/standup');

  await link.fill('ab');
  await link.blur();
  await expect(status).toHaveText('Use 3–64 lowercase letters, numbers, and single hyphens.');
  await expect(link).toHaveAttribute('aria-invalid', 'true');

  // Following the rules again brings the address back as it's typed.
  await link.fill('weekly-sync');
  await expect(status).toHaveText('Meeting URL: /m/weekly-sync');
  await expect(link).toHaveAttribute('aria-invalid', 'false');

  // Saving a broken link says why in the row, not in the browser's bubble.
  await link.fill('two--hyphens');
  await page.getByRole('button', { name: 'Save link' }).click();
  await expect(status).toHaveText('Use 3–64 lowercase letters, numbers, and single hyphens.');
});

test('the dashboard keeps a margin on a phone', async ({ page }) => {
  await mockApi(page);
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto('/');

  const card = page.getByTestId('room-card').first();
  await expect(card).toBeVisible();
  const box = await card.boundingBox();
  expect(box?.x).toBeGreaterThanOrEqual(16);
  expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(375 - 16);
  expect(await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth)).toBe(
    false
  );
});

// The list is read down its columns (when, how long, how big): a row with an
// extra status pill or one fewer action must not push its columns sideways.
for (const width of [390, 768, 1440]) {
  test(`recording rows keep their columns in line at ${width}px`, async ({ page }) => {
    const state = defaultState();
    state.recordings = [
      recording('rec-live', undefined, { status: 'recording', audio_only: false }),
      recording('rec-done', undefined, { audio_only: false }),
      recording('rec-audio', undefined, { started_at: now - 86_400 * 3 }),
      recording('rec-failed', undefined, { status: 'failed', started_at: now - 86_400 * 5 })
    ];
    await mockApi(page, state);
    await page.setViewportSize({ width, height: 900 });
    await page.goto('/rooms/standup');
    await expect(page.locator('[data-recording-id]')).toHaveCount(4);

    // Each row's visible cells after the pills: when, length, size, actions.
    const columns = await page.evaluate(() =>
      [...document.querySelectorAll('[data-recording-id]')].map((row) =>
        [...row.children]
          .map((cell) => cell.getBoundingClientRect())
          .filter((box) => box.width > 1)
          .slice(1, 5)
          .map((box) => [Math.round(box.left), Math.round(box.right)])
      )
    );
    for (const row of columns.slice(1)) expect(row).toEqual(columns[0]);
  });
}

// The orbit planets are decoration: one over a word reads as a stray mark in
// the text, so at every size each stays clear of the hero's words and buttons.
for (const size of [
  { width: 375, height: 667 },
  { width: 390, height: 844 },
  { width: 430, height: 932 },
  { width: 768, height: 1024 },
  { width: 1024, height: 1366 },
  { width: 1440, height: 900 }
]) {
  test(`the signed-out home keeps its planets off the text at ${size.width}×${size.height}`, async ({
    page
  }) => {
    const state = defaultState();
    state.signedIn = false;
    await mockApi(page, state);
    await page.setViewportSize(size);
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.goto('/');
    await expect(page.getByRole('button', { name: /Continue with SSO/ })).toBeVisible();

    const crossings = await page.evaluate(() => {
      const clearance = 8;
      const boxes = (selector: string) =>
        [...document.querySelectorAll(selector)].map((node) => node.getBoundingClientRect());
      const words = boxes('.hero > *, .corner');
      return boxes('.orbits circle').filter((planet) =>
        words.some(
          (word) =>
            planet.right + clearance > word.left &&
            planet.left - clearance < word.right &&
            planet.bottom + clearance > word.top &&
            planet.top - clearance < word.bottom
        )
      ).length;
    });
    expect(crossings).toBe(0);
  });
}
