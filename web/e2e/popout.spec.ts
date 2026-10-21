import { expect, test, type Page } from '@playwright/test';
import { defaultState, mockApi } from './mock-api';
import { fakeSfu, fakeSfuLaunchArgs } from './fake-sfu';

// A screen share can leave the page: into a small window of its own where the
// browser has Document Picture-in-Picture, else the video alone into the
// system's picture-in-picture. Headless Chromium can't host either for real,
// so each spec installs the API it is about: Document PiP is a stand-in whose
// requestWindow hands back a real same-origin window from window.open, which
// is all the app uses of it.

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
  localParticipant: { setScreenShareEnabled(enabled: boolean): Promise<unknown> };
};

async function joinAndShare(page: Page, methods: Methods): Promise<void> {
  await installMethods(page, methods);
  await mockApi(page, defaultState());
  await fakeSfu(page, { metadata: '{"role":"host"}' });
  await page.goto('/m/standup');
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.getByRole('navigation', { name: 'Meeting controls' })).toBeVisible({
    timeout: 20_000
  });
  await setSharing(page, true);
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
  await joinAndShare(page, { documentPiP: false, videoPiP: false });
  await expect(page.getByTestId('focus-pane').locator('video')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toHaveCount(0);
});

test('without Document PiP the share video itself goes into picture-in-picture', async ({
  page
}) => {
  await joinAndShare(page, { documentPiP: false, videoPiP: true });
  await page.getByRole('button', { name: 'Pop out screen share' }).click();
  await expect
    .poll(() => page.evaluate(() => (window as Window & { __pipVideo?: string }).__pipVideo))
    .toBe("Ada Host's screen share");
  // The browser draws its own placeholder over the video; the page adds none.
  await expect(placeholder(page)).toHaveCount(0);
});

test('a popped-out share plays in its own window and comes back on request', async ({ page }) => {
  await joinAndShare(page, { documentPiP: true, videoPiP: true });
  const mainTrack = await playing(page, shareVideo);
  expect(mainTrack).toBeTruthy();

  const popup = await popOut(page);
  // The same track, attached to the window's own <video>; the page keeps
  // its video attached underneath, so nothing is re-subscribed.
  await expect.poll(() => playing(popup, 'video.share')).toBe(mainTrack);
  expect(await playing(page, shareVideo)).toBe(mainTrack);
  await expect(popup.getByText('Ada Host · Screen')).toBeVisible();
  await expect(placeholder(page)).toBeVisible();
  await expect(page.getByRole('button', { name: 'Pop out screen share' })).toHaveCount(0);

  // The window's controls drive the meeting itself.
  await popup.getByRole('button', { name: 'Mute microphone' }).click();
  await expect(
    page.getByRole('navigation', { name: 'Meeting controls' }).getByLabel('Unmute microphone')
  ).toBeVisible();
  await expect(popup.getByRole('button', { name: 'Unmute microphone' })).toBeVisible();

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
