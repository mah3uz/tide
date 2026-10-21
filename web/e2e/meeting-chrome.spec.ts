import { expect, test, type Locator, type Page } from '@playwright/test';
import { defaultState, mockApi, type ApiState } from './mock-api';
import { fakeSfu, fakeSfuLaunchArgs } from './fake-sfu';

// The meeting's own chrome (ARCHITECTURE.md §9 "Meeting chrome"): the control
// bar's order and the stage's top-left cluster. The API is mocked and the SFU
// is fake-sfu.ts, so this runs against the Vite dev server alone.

test.use({
  launchOptions: { args: fakeSfuLaunchArgs },
  locale: 'en-GB',
  timezoneId: 'UTC',
  permissions: ['clipboard-read', 'clipboard-write']
});

const roomName = 'Weekly product sync';

type Box = { x: number; y: number; width: number; height: number };

function state(overrides: { signedIn?: boolean; name?: string; lobby?: boolean } = {}): ApiState {
  const base = defaultState();
  base.signedIn = overrides.signedIn ?? true;
  base.rooms[0] = {
    ...base.rooms[0],
    name: overrides.name ?? roomName,
    lobby_enabled: overrides.lobby ?? true
  };
  return base;
}

/** Pre-join with capture off (nothing is published to the fake SFU), then join. */
async function enter(page: Page, guestName?: string): Promise<void> {
  await page.goto('/m/standup');
  if (guestName) await page.locator('input[name="name"]').fill(guestName);
  for (const control of ['camera', 'microphone']) {
    const toggle = page.locator(`button[aria-pressed][aria-label*="${control}" i]`).first();
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  }
  await page.getByRole('button', { name: 'Join meeting' }).click();
  // The capsule, not Share screen: a phone has no screen share in it.
  await expect(page.getByRole('navigation', { name: 'Meeting controls' })).toBeVisible({
    timeout: 20_000
  });
}

function controlLabels(page: Page): Promise<string[]> {
  return page
    .getByRole('navigation', { name: 'Meeting controls' })
    .evaluate((bar) =>
      [...bar.querySelectorAll('button')].map((button) => button.getAttribute('aria-label') ?? '')
    );
}

test('a host has microphone and camera side by side, and record after screen share', async ({
  page
}) => {
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);

  expect(await controlLabels(page)).toEqual([
    'Unmute microphone',
    'Choose microphone',
    'Turn camera on',
    'Choose camera',
    'Share screen',
    'Start recording',
    'Grid view',
    'Open people',
    'Open chat',
    'Leave or end meeting'
  ]);

  // Record's confirm step still opens in its new place, after screen share.
  await page.getByRole('button', { name: 'Start recording' }).click();
  const labels = await controlLabels(page);
  expect(labels.indexOf('Record?')).toBe(labels.indexOf('Share screen') + 1);
  await expect(page.getByLabel('Also record video')).toBeVisible();
});

test('a guest has microphone and camera in the same place as a host, and no record', async ({
  page
}) => {
  await mockApi(page, state({ signedIn: false, lobby: false }));
  await fakeSfu(page);
  await enter(page, 'Grace Guest');

  expect(await controlLabels(page)).toEqual([
    'Unmute microphone',
    'Choose microphone',
    'Turn camera on',
    'Choose camera',
    'Share screen',
    'Grid view',
    'Open people',
    'Open chat',
    'Leave room'
  ]);
});

test('a long name stays on one line and keeps "(You)" inside a phone-width tile', async ({
  page
}) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await mockApi(page, state({ signedIn: false, lobby: false }));
  await fakeSfu(page);
  await enter(page, 'Filippos Taprantzis-Papadopoulos Konstantinopoulou');

  const tile = page.locator('[data-testid="participant-tile"]').first();
  const label = tile.locator('.name-label');
  const box = await tile.boundingBox();
  const name = await label.locator('.name').boundingBox();
  const you = await label.getByText('(You)').boundingBox();
  expect(box && name && you).toBeTruthy();
  // One line: "(You)" sits beside the name, not under it, and inside the tile.
  expect(Math.abs(you!.y - name!.y)).toBeLessThan(2);
  expect(you!.x + you!.width).toBeLessThanOrEqual(box!.x + box!.width - 8);
  expect(
    await label.locator('.name').evaluate((element) => element.scrollWidth > element.clientWidth)
  ).toBe(true);
  // The full name is a hover away.
  await expect(label).toHaveAttribute(
    'title',
    'Filippos Taprantzis-Papadopoulos Konstantinopoulou'
  );
});

test('the clock shows the time and turns over on the minute', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-10-04T23:58:00Z') });
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);

  const clock = page.getByTestId('stage-clock');
  await expect(clock).toHaveText('23:58');

  await page.clock.pauseAt(new Date('2026-10-04T23:59:59Z'));
  await expect(clock).toHaveText('23:59');
  // Still the old minute a millisecond before the boundary, the new one on it.
  await page.clock.runFor(999);
  await expect(clock).toHaveText('23:59');
  await page.clock.runFor(1);
  await expect(clock).toHaveText('00:00');
  await expect(clock).toHaveAttribute('datetime', '00:00');
  await page.clock.runFor(60_000);
  await expect(clock).toHaveText('00:01');
});

test.describe('in a 12-hour locale', () => {
  test.use({ locale: 'en-US' });

  test('the clock follows the viewer’s locale', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-04T23:58:00Z') });
    await mockApi(page, state());
    await fakeSfu(page);
    await enter(page);
    await expect(page.getByTestId('stage-clock')).toHaveText('11:58 PM');
  });
});

test('the stage names the room, and its details give the meeting link to copy', async ({
  page
}) => {
  await mockApi(page, state());
  const sfu = await fakeSfu(page);
  await enter(page);

  const cluster = page.getByTestId('stage-cluster');
  await expect(cluster.getByRole('heading', { name: roomName })).toBeVisible();
  // The slug is kept out of the meeting UI; only the details' URL carries it.
  await expect(cluster).not.toContainText('standup');

  const url = `${new URL(page.url()).origin}/m/standup`;
  const trigger = page.getByRole('button', { name: 'Meeting details' });
  await trigger.click();
  const details = page.getByRole('dialog', { name: 'Meeting details' });
  await expect(details).toBeVisible();
  // It gives the link, whole: not the name again, and not cut off.
  await expect(details).not.toContainText(roomName);
  const link = details.getByText(url, { exact: true });
  await expect(link).toBeVisible();
  expect(await link.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const box = await details.boundingBox();
  const linkBox = await link.boundingBox();
  expect(linkBox!.x + linkBox!.width).toBeLessThanOrEqual(box!.x + box!.width);
  // Focus moves into the popover, onto its one control.
  const copy = details.getByRole('button', { name: 'Copy link' });
  await expect(copy).toBeFocused();

  // A click anywhere else closes it. bits-ui ignores outside clicks for a few
  // ms after opening, quicker than any person but not than Playwright, so the
  // click is repeated until the popover has settled.
  await expect(async () => {
    await page.mouse.click(1000, 400);
    await expect(details).toBeHidden({ timeout: 250 });
  }).toPass({ timeout: 5_000 });

  await trigger.click();
  await copy.click();
  await expect(details.getByRole('status')).toHaveText('Link copied');
  await expect(details.getByRole('button', { name: 'Copied' })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(url);

  // Escape closes it and hands focus back to (i).
  await page.keyboard.press('Escape');
  await expect(details).toBeHidden();
  await expect(trigger).toBeFocused();

  // The REC chip joins the cluster.
  sfu.setRoomMetadata('{"recording":true}');
  await expect(cluster.getByTestId('recording-chip')).toBeVisible();
});

const phone = { width: 320, height: 640 };

const sheets = [
  { name: 'People', open: 'Open people', close: 'Close people', other: 'Open chat' },
  { name: 'Chat', open: 'Open chat', close: 'Close chat', other: 'Open people' }
] as const;

/** Fails unless the element is drawn wholly inside the viewport, `slack` px in from the sides. */
async function expectInside(locator: Locator, slack = 0): Promise<void> {
  await expect(locator).toBeVisible();
  const box = await locator.boundingBox();
  expect(box, `${locator} has a box`).not.toBeNull();
  const { x, y, width, height } = box!;
  const where = `${locator} at x ${x}..${x + width}, y ${y}..${y + height}`;
  expect(x >= slack && x + width <= phone.width - slack, where).toBe(true);
  expect(y >= 0 && y + height <= phone.height, where).toBe(true);
}

/** Waits out a sheet's slide-in, so it is measured where it comes to rest. */
async function settled(locator: Locator): Promise<void> {
  await locator.evaluate((element) =>
    Promise.all(element.getAnimations().map((animation) => animation.finished))
  );
}

function overlaps(a: Box, b: Box): boolean {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

/**
 * Puts the stage in the states that crowd its header: the browser refusing
 * audio until a gesture, and the connection dropping.
 */
async function blockPlaybackAndReconnect(page: Page): Promise<void> {
  await page.evaluate(() => {
    type TestRoom = {
      canPlaybackAudio: boolean;
      startAudio: () => Promise<void>;
      emit: (event: string, ...args: unknown[]) => boolean;
    };
    const room = (window as Window & { __tideRoom?: TestRoom }).__tideRoom!;
    Object.defineProperty(room, 'canPlaybackAudio', { configurable: true, get: () => false });
    room.startAudio = () => Promise.reject(new Error('Playback needs a gesture.'));
    room.emit('audioPlaybackChanged', false);
    room.emit('connectionStateChanged', 'reconnecting');
  });
}

test('on a phone the header keeps every chip on screen and clears the panels', async ({ page }) => {
  await page.setViewportSize(phone);
  await mockApi(
    page,
    state({ name: 'Quarterly planning for the platform team and everyone who joins late' })
  );
  const sfu = await fakeSfu(page);
  await enter(page);
  sfu.setRoomMetadata('{"recording":true}');
  await expect(page.getByTestId('recording-chip')).toBeVisible();

  const name = page.getByTestId('stage-cluster').getByRole('heading');
  expect(await name.evaluate((element) => element.scrollWidth > element.clientWidth)).toBe(true);
  // The whole host bar fits, with room to spare.
  const bar = page.getByRole('navigation', { name: 'Meeting controls' });
  await expectInside(bar, 8);

  // All at once: REC, the autoplay unlock and the connection state.
  await blockPlaybackAndReconnect(page);
  const unlock = page.getByTestId('playback-blocked');
  const connection = page.locator('.stage-header').getByRole('status');
  await expect(unlock).toHaveText('Tap to hear audio');
  await expect(connection).toHaveText('Reconnecting…');
  const parts = [
    page.getByTestId('stage-clock'),
    page.getByRole('button', { name: 'Meeting details' }),
    page.getByTestId('recording-chip'),
    unlock,
    connection
  ];
  for (const part of parts) await expectInside(part);
  // The unlock is an instruction; it takes a second row rather than an ellipsis.
  expect(await unlock.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(true);
  const boxes = await Promise.all(parts.map(async (part) => (await part.boundingBox())!));
  for (const [i, a] of boxes.entries()) {
    for (const b of boxes.slice(i + 1)) expect(overlaps(a, b)).toBe(false);
  }
  // The header grew rather than spilling, and nothing in it reaches the media.
  const header = (await page.locator('.stage-header').boundingBox())!;
  const media = (await page.getByRole('region', { name: 'Meeting participants' }).boundingBox())!;
  expect(header.y + header.height).toBeLessThanOrEqual(media.y);

  // On a phone an open panel is a bottom sheet: it rises from the bottom edge,
  // full width, and leaves the top of the screen showing above it.
  for (const { name, open } of sheets) {
    const sheet = page.getByRole('complementary', { name });
    await page.getByRole('button', { name: open }).click();
    await settled(sheet);
    const panel = (await sheet.boundingBox())!;
    expect(panel.x, name).toBe(0);
    expect(panel.width, name).toBe(phone.width);
    expect(Math.round(panel.y + panel.height), name).toBe(phone.height);
    expect(panel.y, name).toBeGreaterThanOrEqual(phone.height * 0.15 - 1);
    // Its close button, and a tap on the dimmed stage, put it away again.
    await sheet.getByRole('button', { name: /^Close/ }).click();
    await expect(sheet, name).toBeHidden();
    await page.getByRole('button', { name: open }).click();
    await expect(sheet, name).toBeVisible();
    await page.mouse.click(phone.width / 2, 40);
    await expect(sheet, name).toBeHidden();
  }
});

test('on a phone the capsule keeps the everyday controls and More holds the rest', async ({
  page
}) => {
  await page.setViewportSize(phone);
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);
  const bar = page.getByRole('navigation', { name: 'Meeting controls' });

  // Six round controls across the width; record, the view and the device
  // lists are one tap further, in More.
  expect(await controlLabels(page)).toEqual([
    'Unmute microphone',
    'Turn camera on',
    'Open people',
    'Open chat',
    'More controls',
    'Leave or end meeting'
  ]);
  await expectInside(bar, 8);

  const more = page.getByRole('button', { name: 'More controls' });
  const sheet = page.getByRole('dialog', { name: 'More controls' });
  await more.click();
  await expect(sheet).toBeVisible();
  await settled(sheet);
  await expectInside(sheet);

  // Record? asks first, inside the sheet, with a confirm of its own.
  await sheet.getByRole('button', { name: 'Start recording' }).click();
  await expectInside(sheet.getByRole('button', { name: 'Record?' }));
  const recordNow = sheet.getByRole('button', { name: 'Record', exact: true });
  const withVideo = sheet.getByLabel('Also record video');
  await expectInside(recordNow);
  await expectInside(withVideo);
  await withVideo.check();
  const [start] = await Promise.all([
    page.waitForRequest((request) => request.url().endsWith('/api/rooms/standup/recording/start')),
    recordNow.click()
  ]);
  expect(start.postDataJSON()).toEqual({ video: true });
  await expect(withVideo).toBeHidden();

  // Both device lists are in the sheet, on screen, without a menu to open.
  for (const kind of ['microphone', 'camera']) {
    await expectInside(sheet.getByRole('menu', { name: `Choose ${kind}` }));
  }

  // Escape puts the sheet away; so does a tap on the dimmed stage.
  await page.keyboard.press('Escape');
  await expect(sheet).toBeHidden();
  await more.click();
  await expect(sheet).toBeVisible();
  await page.mouse.click(phone.width / 2, 40);
  await expect(sheet).toBeHidden();

  // Leave's choice opens above the capsule, on screen.
  await page.getByRole('button', { name: 'Leave or end meeting' }).click();
  await expectInside(page.getByRole('button', { name: 'Leave room' }));
  await expectInside(page.getByRole('button', { name: 'End meeting for all' }));
  await expectInside(bar, 8);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'End meeting for all' })).toBeHidden();
});

test('names are in the UI font and the clock in mono, and roles are words, not badges', async ({
  page
}) => {
  await mockApi(page, state());
  await fakeSfu(page, { metadata: '{"role":"host"}' });
  await enter(page);

  const family = (locator: Locator) =>
    locator.evaluate((element) => getComputedStyle(element).fontFamily.split(',')[0].trim());
  expect(await family(page.getByTestId('stage-clock'))).toMatch(/JetBrains Mono/);

  const tile = page.locator('[data-testid="participant-tile"]').first();
  await expect(tile).toContainText('Ada Host (You)');
  expect(await family(tile.getByText('(You)'))).toMatch(/Space Grotesk/);
  await expect(tile).not.toContainText('YOU');

  await page.getByRole('button', { name: /people/i }).click();
  const row = page.locator('.participant-row').first();
  await expect(row).toContainText('Ada Host (You)');
  expect(await family(row.getByText('Ada Host', { exact: true }))).toMatch(/Space Grotesk/);
  const role = row.getByText('Meeting host', { exact: true });
  await expect(role).toBeVisible();
  // Secondary text, with no pill around it.
  expect(
    await role.evaluate((element) => {
      const style = getComputedStyle(element);
      return style.borderStyle === 'none' && style.borderRadius === '0px';
    })
  ).toBe(true);
});

test('from 900px the stage and capsule make room for an open sheet, never under it', async ({
  page
}) => {
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);
  const bar = page.getByRole('navigation', { name: 'Meeting controls' });
  const media = page.getByRole('region', { name: 'Meeting participants' });

  // The host's full capsule is wider than the room a small laptop leaves
  // beside the sheet; it tightens, then drops to the everyday controls.
  for (const { name, open, close, other } of sheets) {
    const sheet = page.getByRole('complementary', { name });
    for (const width of [900, 1000, 1100, 1180]) {
      await page.setViewportSize({ width, height: 800 });
      if (!(await sheet.count())) await page.getByRole('button', { name: open }).click();
      await settled(sheet);
      await settled(bar.locator('..'));
      const capsule = (await bar.boundingBox())!;
      const panel = (await sheet.boundingBox())!;
      const stage = (await media.boundingBox())!;
      const where = `${name} at ${width}px: capsule x ${capsule.x}..${capsule.x + capsule.width}, stage to ${stage.x + stage.width}, sheet from ${panel.x}`;
      expect(capsule.x, where).toBeGreaterThanOrEqual(0);
      expect(capsule.x + capsule.width, where).toBeLessThanOrEqual(panel.x);
      // Beside the sheet, not behind it: nothing of the call is hidden and
      // nothing is dimmed, so both can be used at once.
      expect(stage.x + stage.width, where).toBeLessThanOrEqual(panel.x);
      await expect(page.locator('.scrim'), where).toBeHidden();
      // Microphone, camera, people, chat and leave are always there.
      for (const label of ['Unmute microphone', 'Turn camera on', close, other]) {
        await expect(bar.getByRole('button', { name: label, exact: true }), where).toBeVisible();
      }
      await expect(bar.getByRole('button', { name: 'Leave or end meeting' }), where).toBeVisible();
    }
    await bar.getByRole('button', { name: close }).click();
    await expect(sheet).toBeHidden();
  }
});

test('below 900px an open sheet lies over the stage instead of squeezing it', async ({ page }) => {
  const tablet = { width: 760, height: 900 };
  await page.setViewportSize(tablet);
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);
  const bar = page.getByRole('navigation', { name: 'Meeting controls' });
  const media = page.getByRole('region', { name: 'Meeting participants' });
  const scrim = page.locator('.scrim');
  await settled(bar.locator('..'));
  const stageAlone = (await media.boundingBox())!;
  const capsuleAlone = (await bar.boundingBox())!;

  for (const { name, open } of sheets) {
    const sheet = page.getByRole('complementary', { name });
    await page.getByRole('button', { name: open }).click();
    await settled(sheet);
    await settled(bar.locator('..'));

    // Making room would leave the call a sliver beside a 380px sheet: the
    // stage and capsule stay as they were and the sheet lies over them.
    expect(await media.boundingBox(), name).toEqual(stageAlone);
    expect(await bar.boundingBox(), name).toEqual(capsuleAlone);
    const panel = (await sheet.boundingBox())!;
    expect(panel.width, name).toBe(380);
    expect(panel.x + panel.width, name).toBe(tablet.width - 16);

    // A scrim dims the whole stage, so it reads as a layer on top, and a tap
    // on it (here, on the stage left of the sheet) puts the sheet away.
    await settled(scrim);
    expect(await scrim.boundingBox(), name).toEqual({ x: 0, y: 0, ...tablet });
    await page.mouse.click(40, tablet.height / 2);
    await expect(sheet, name).toBeHidden();
    await expect(scrim, name).toBeHidden();

    // Escape puts it away too: with the capsule covered, it is the keyboard's
    // way out besides the sheet's own close button.
    await page.getByRole('button', { name: open }).click();
    await expect(sheet).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(sheet, name).toBeHidden();
  }
});

test('Escape closes a menu over an open sheet first, and keeps a chat draft', async ({ page }) => {
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);
  const chat = page.getByRole('complementary', { name: 'Chat' });
  await page.getByRole('button', { name: 'Open chat' }).click();

  // One Escape, one layer: the device menu goes, the sheet stays.
  await page.getByRole('button', { name: 'Choose microphone' }).click();
  await expect(page.getByRole('button', { name: 'Choose microphone' })).toHaveAttribute(
    'aria-expanded',
    'true'
  );
  await page.keyboard.press('Escape');
  await expect(page.getByRole('button', { name: 'Choose microphone' })).toHaveAttribute(
    'aria-expanded',
    'false'
  );
  await expect(chat).toBeVisible();

  // Closing the sheet throws the draft away, so Escape in a written message
  // does not; an empty composer lets it through.
  const composer = chat.getByRole('textbox');
  await composer.fill('Half a thought');
  await page.keyboard.press('Escape');
  await expect(chat).toBeVisible();
  await expect(composer).toHaveValue('Half a thought');
  await composer.fill('');
  await page.keyboard.press('Escape');
  await expect(chat).toBeHidden();
});

test('on a phone a chat peek never covers the strip’s faces or names', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await mockApi(page, state());
  await fakeSfu(page);
  await enter(page);
  await page.evaluate(() => {
    type TestRoom = {
      handleParticipantUpdates(infos: unknown[]): void;
      remoteParticipants: Map<string, unknown>;
      emit(event: string, ...args: unknown[]): boolean;
    };
    const room = (window as Window & { __tideRoom?: TestRoom }).__tideRoom!;
    room.handleParticipantUpdates(
      ['Aisha Rahman', 'Tom Becker', 'Mei Lin'].map((name, index) => ({
        sid: `PA_${index}`,
        identity: `remote-${index}`,
        name,
        state: 2,
        metadata: '',
        attributes: {},
        kind: 0,
        version: 1,
        joinedAt: 0n,
        dataTracks: [],
        permission: { canSubscribe: true, canPublish: true, canPublishData: true },
        tracks: []
      }))
    );
    const payload = new TextEncoder().encode(
      JSON.stringify({ text: 'Can everyone see the roadmap?', ts: Date.now() })
    );
    room.emit('dataReceived', payload, room.remoteParticipants.get('remote-2'), 0, 'chat');
  });

  const peek = page.getByTestId('chat-peek');
  await settled(peek);
  const peekBox = (await peek.boundingBox())!;
  const capsule = (await page.getByRole('navigation', { name: 'Meeting controls' }).boundingBox())!;
  expect(peekBox.y + peekBox.height).toBeLessThanOrEqual(capsule.y);
  const portals = page.locator('[data-testid="participant-tile"][data-shape="portal"]');
  await expect(portals).toHaveCount(3);
  for (const portal of await portals.all()) {
    expect(overlaps(peekBox, (await portal.boundingBox())!)).toBe(false);
    // A name under the peek is put away while it shows, not covered.
    const label = portal.locator('.portal-label');
    if (overlaps(peekBox, (await label.boundingBox())!)) {
      await expect(label).toHaveCSS('opacity', '0');
    }
  }
});
