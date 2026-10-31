import { expect, test, type Page } from '@playwright/test';
import { defaultState, mockApi } from './mock-api';
import { fakeSfu, fakeSfuLaunchArgs } from './fake-sfu';

// A screen share can leave the page: into a small window of its own where the
// browser has Document Picture-in-Picture, else the video alone into the
// system's picture-in-picture. Headless Chromium can't host either for real,
// so each spec installs the API it is about: Document PiP is a stand-in whose
// requestWindow hands back a real same-origin window from window.open, which
// is all the app uses of it.
//
// Your own share never plays back to you (sharing the meeting's screen would
// show itself inside itself without end), so the share that plays here is a
// remote one: a participant announced straight into livekit-client whose
// screen share is a canvas track handed over as if the SFU had sent it.

test.use({
  launchOptions: {
    args: [
      ...fakeSfuLaunchArgs,
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--auto-select-desktop-capture-source=Entire'
    ]
  },
  permissions: ['camera', 'microphone'],
  locale: 'en-GB',
  timezoneId: 'UTC'
});

type Methods = { documentPiP: boolean; videoPiP: boolean };

/** Leaves the browser with exactly the pop-out methods asked for. */
async function installMethods(page: Page, methods: Methods): Promise<void> {
  await page.addInitScript((methods: Methods) => {
    const scope = window as Window & { documentPictureInPicture?: unknown };
    delete scope.documentPictureInPicture;
    if (methods.documentPiP) {
      scope.documentPictureInPicture = {
        requestWindow: async ({ width, height }: { width: number; height: number }) =>
          window.open('', 'tide-popout', `popup,width=${width},height=${height}`)
      };
    }
    const video = HTMLVideoElement.prototype as Partial<HTMLVideoElement>;
    if (methods.videoPiP) {
      // Records the request instead of opening the system's window.
      video.requestPictureInPicture = async function (this: HTMLVideoElement) {
        (window as Window & { __pipVideo?: string }).__pipVideo =
          this.getAttribute('aria-label') ?? '';
        return {} as PictureInPictureWindow;
      };
      Object.defineProperty(document, 'pictureInPictureEnabled', { value: true });
    } else {
      delete video.requestPictureInPicture;
      Object.defineProperty(document, 'pictureInPictureEnabled', { value: false });
    }
  }, methods);
}

type TestRoom = {
  localParticipant: {
    setScreenShareEnabled(enabled: boolean): Promise<unknown>;
    getTrackPublication(source: string): { track?: { mediaStreamTrack: MediaStreamTrack } };
  };
  handleParticipantUpdates(infos: unknown[]): void;
  remoteParticipants: Map<
    string,
    {
      addSubscribedMediaTrack(
        track: MediaStreamTrack,
        sid: string,
        stream: MediaStream,
        receiver: undefined
      ): unknown;
    }
  >;
};

const presenterName = 'Grace Hopper';

async function join(page: Page, methods: Methods): Promise<void> {
  await installMethods(page, methods);
  await mockApi(page, defaultState());
  await fakeSfu(page, { metadata: '{"role":"host"}' });
  await page.goto('/m/standup');
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.getByRole('navigation', { name: 'Meeting controls' })).toBeVisible({
    timeout: 20_000
  });
}

/** Someone else shares their screen, and it plays on the stage. */
async function joinAndWatch(page: Page, methods: Methods): Promise<void> {
  await join(page, methods);
  await page.evaluate((name) => {
    const room = (window as unknown as { __tideRoom: TestRoom }).__tideRoom;
    room.handleParticipantUpdates([
      {
        sid: 'PA_grace',
        identity: 'grace',
        name,
        state: 2,
        metadata: '',
        attributes: {},
        kind: 0,
        version: 1,
        joinedAt: 0n,
        dataTracks: [],
        permission: { canSubscribe: true, canPublish: true, canPublishData: true },
        tracks: [{ sid: 'TR_grace_screen', type: 1, source: 3, name: 'screen', codecs: [] }]
      }
    ]);
    const canvas = Object.assign(document.createElement('canvas'), { width: 320, height: 180 });
    const context = canvas.getContext('2d')!;
    setInterval(() => context.fillRect(0, 0, Math.random() * 320, 180), 100);
    const stream = canvas.captureStream(10);
    room.remoteParticipants
      .get('grace')!
      .addSubscribedMediaTrack(stream.getVideoTracks()[0], 'TR_grace_screen', stream, undefined);
  }, presenterName);
  await expect(page.getByTestId('focus-pane').locator('video')).toBeVisible();
}

/** You share your screen. */
async function joinAndShare(page: Page, methods: Methods): Promise<void> {
  await join(page, methods);
  await setSharing(page, true);
}

/** The ids of every video track playing in a page. */
function playingTracks(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll('video')].flatMap((video) =>
      ((video.srcObject as MediaStream | null)?.getVideoTracks?.() ?? []).map((track) => track.id)
    )
  );
}

/** The id of the screen track you are publishing. */
function localScreenTrack(page: Page): Promise<string | undefined> {
  return page.evaluate(
    () =>
      (
        window as unknown as { __tideRoom: TestRoom }
      ).__tideRoom.localParticipant.getTrackPublication('screen_share')?.track?.mediaStreamTrack.id
  );
}

async function setSharing(page: Page, enabled: boolean): Promise<void> {
  await page.evaluate(
    (enabled) =>
      (window as unknown as { __tideRoom: TestRoom }).__tideRoom.localParticipant
        .setScreenShareEnabled(enabled)
        .then(() => undefined),
    enabled
  );
  if (enabled) await expect(page.getByTestId('focus-pane')).toBeVisible();
}

/** Pops the share out and returns its window, once the share plays there. */
async function popOut(page: Page): Promise<Page> {
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('button', { name: 'Pop out screen share' }).click()
  ]);
  await expect(popup.getByRole('button', { name: 'Back to meeting' })).toBeVisible();
  return popup;
}

/** The id of the MediaStreamTrack a <video> is playing. */
function playing(page: Page, selector: string): Promise<string | undefined> {
  // Not `instanceof MediaStream`: the popup's stream comes from the page's realm.
  return page
    .locator(selector)
    .evaluate(
      (video: HTMLVideoElement) =>
        (video.srcObject as MediaStream | null)?.getVideoTracks?.()[0]?.id ?? undefined
    );
}

const placeholder = (page: Page) => page.getByText('Screen share is in its own window');
const shareVideo = '[data-testid="focus-pane"] video';

test('Pop out is offered only where the browser has a way to pop a share out', async ({ page }) => {
  // Firefox today: neither API, so a button would do nothing.
  await joinAndWatch(page, { documentPiP: false, videoPiP: false });
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toHaveCount(0);
});

test('without Document PiP the share video itself goes into picture-in-picture', async ({
  page
}) => {
  await joinAndWatch(page, { documentPiP: false, videoPiP: true });
  await page.getByRole('button', { name: 'Pop out screen share' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __pipVideo?: string }).__pipVideo))
    .toBe(`${presenterName}'s screen share`);
  // The browser draws its own placeholder over the video; the page adds none.
  await expect(placeholder(page)).toHaveCount(0);
});

test('a popped-out share plays in its own window and comes back on request', async ({ page }) => {
  await joinAndWatch(page, { documentPiP: true, videoPiP: true });
  const mainTrack = await playing(page, shareVideo);
  expect(mainTrack).toBeTruthy();

  const popup = await popOut(page);
  // The same track, attached to the window's own <video>; the page keeps
  // its video attached underneath, so nothing is re-subscribed.
  await expect.poll(() => playing(popup, 'video.share')).toBe(mainTrack);
  expect(await playing(page, shareVideo)).toBe(mainTrack);
  await expect(popup.getByText(`${presenterName} · Screen`)).toBeVisible();
  await expect(placeholder(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toHaveCount(0);

  // The window's controls drive the meeting itself.
  await popup.getByRole('button', { name: 'Microphone', exact: true, pressed: true }).click();
  await expect(
    page
      .getByRole('navigation', { name: 'Meeting controls' })
      .getByRole('button', { name: 'Microphone', exact: true, pressed: false })
  ).toBeVisible();
  await expect(
    popup.getByRole('button', { name: 'Microphone', exact: true, pressed: false })
  ).toBeVisible();

  // Bring it back, from the page.
  await Promise.all([
    popup.waitForEvent('close'),
    page.getByRole('button', { name: 'Bring it back' }).click()
  ]);
  await expect(placeholder(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toBeVisible();

  // Back to meeting, from the window.
  const again = await popOut(page);
  await Promise.all([
    again.waitForEvent('close'),
    again.getByRole('button', { name: 'Back to meeting' }).click()
  ]);
  await expect(placeholder(page)).toHaveCount(0);

  // Closed by the browser's own control: the frame is restored all the same.
  const third = await popOut(page);
  await third.close();
  await expect(placeholder(page)).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toBeVisible();
});

test('the window closes when the share ends', async ({ page }) => {
  await joinAndShare(page, { documentPiP: true, videoPiP: true });
  const popup = await popOut(page);
  await Promise.all([popup.waitForEvent('close'), setSharing(page, false)]);
  await expect(page.getByTestId('focus-pane')).toHaveCount(0);
});

test('the window closes when you leave the meeting', async ({ page }) => {
  await joinAndShare(page, { documentPiP: true, videoPiP: true });
  const popup = await popOut(page);
  await page.getByRole('button', { name: 'Leave or end meeting' }).click();
  await Promise.all([
    popup.waitForEvent('close'),
    page.getByRole('button', { name: 'Leave room' }).click()
  ]);
});

test('your own share is never played back to you, on the stage or in the window', async ({
  page
}) => {
  await joinAndShare(page, { documentPiP: true, videoPiP: true });
  const screen = await localScreenTrack(page);
  expect(screen).toBeTruthy();

  const focus = page.getByTestId('focus-pane');
  await expect(focus.getByTestId('presenting-card')).toContainText("You're presenting");
  await expect(focus.locator('video')).toHaveCount(0);
  expect(await playingTracks(page)).not.toContain(screen);

  // The window is how a presenter keeps the room in view; it shows the card too.
  const popup = await popOut(page);
  await expect(popup.getByTestId('presenting-card')).toBeVisible();
  await expect(popup.locator('video.share')).toHaveCount(0);
  expect(await playingTracks(popup)).not.toContain(screen);

  // Stop presenting ends the share, and the window goes with it.
  await Promise.all([
    popup.waitForEvent('close'),
    popup.getByRole('button', { name: 'Stop presenting' }).click()
  ]);
  await expect(focus).toHaveCount(0);
  await expect.poll(() => localScreenTrack(page)).toBeUndefined();
});

test('your own share offers no video picture-in-picture, which would play it back', async ({
  page
}) => {
  await joinAndShare(page, { documentPiP: false, videoPiP: true });
  await expect(page.getByTestId('presenting-card')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toHaveCount(0);

  await page.getByRole('button', { name: 'Stop presenting' }).click();
  await expect(page.getByTestId('focus-pane')).toHaveCount(0);
});

/** Opens the share in a plain browser window and returns it once the share is mounted there. */
async function openWindow(page: Page): Promise<Page> {
  const [popup] = await Promise.all([
    page.context().waitForEvent('page'),
    page.getByRole('button', { name: 'Open screen share in a new window' }).click()
  ]);
  await expect(popup.getByRole('button', { name: 'Back to meeting' })).toBeVisible();
  return popup;
}

test('New window opens the share in an ordinary window and comes back on request', async ({
  page
}) => {
  await joinAndWatch(page, { documentPiP: false, videoPiP: false });
  const mainTrack = await playing(page, shareVideo);
  expect(mainTrack).toBeTruthy();

  const popup = await openWindow(page);
  expect(new URL(popup.url()).pathname).toBe('/share-window.html');
  await expect.poll(() => playing(popup, 'video.share')).toBe(mainTrack);
  await expect(popup.getByText(`${presenterName} · Screen`)).toBeVisible();
  // The page's stylesheets reached the window.
  await expect
    .poll(() =>
      popup.evaluate(
        () =>
          getComputedStyle(document.querySelector('.popout')!).backgroundColor !==
          'rgba(0, 0, 0, 0)'
      )
    )
    .toBe(true);
  await expect(placeholder(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open screen share in a new window' })).toHaveCount(
    0
  );

  await Promise.all([
    popup.waitForEvent('close'),
    page.getByRole('button', { name: 'Bring it back' }).click()
  ]);
  await expect(placeholder(page)).toHaveCount(0);

  // Closed with the window's own control: the stage is restored all the same.
  const again = await openWindow(page);
  await again.close();
  await expect(placeholder(page)).toHaveCount(0);
  await expect(
    page.getByRole('button', { name: 'Open screen share in a new window' })
  ).toBeVisible();
});

test('the presenter gets the card, not their own share, in a new window; ending the share closes it', async ({
  page
}) => {
  await joinAndShare(page, { documentPiP: true, videoPiP: true });
  const screen = await localScreenTrack(page);
  const popup = await openWindow(page);
  await expect(popup.getByTestId('presenting-card')).toBeVisible();
  await expect(popup.locator('video.share')).toHaveCount(0);
  expect(await playingTracks(popup)).not.toContain(screen);

  // At the smallest picture-in-picture size the card's button clears the cluster.
  await popup.setViewportSize({ width: 360, height: 263 });
  const stop = await popup.getByRole('button', { name: 'Stop presenting' }).boundingBox();
  const cluster = await popup.locator('.cluster').boundingBox();
  expect(
    stop && cluster && (stop.y + stop.height <= cluster.y || stop.x + stop.width <= cluster.x)
  ).toBe(true);

  await Promise.all([popup.waitForEvent('close'), setSharing(page, false)]);
  await expect(page.getByTestId('focus-pane')).toHaveCount(0);
});
