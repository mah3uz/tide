import { expect, test, type Page } from '@playwright/test';
import { defaultState, mockApi } from './mock-api';
import { fakeSfu, fakeSfuLaunchArgs } from './fake-sfu';

// Pictures of the meeting stage for a person to look at, not assertions: a
// five-person call made from the fake SFU plus remote participants announced
// straight into livekit-client. They publish nothing that plays, so they show
// as initials. Runs only when TIDE_STAGE_SHOTS names an output folder.

const out = process.env.TIDE_STAGE_SHOTS ?? '';
test.skip(!out, 'Set TIDE_STAGE_SHOTS to a folder to take stage pictures.');

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

const viewports = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 1180, height: 820 },
  phone: { width: 390, height: 844 }
} as const;

const remotes = [
  { identity: 'aisha', name: 'Aisha Rahman', muted: false },
  { identity: 'tom', name: 'Tom Becker', muted: true },
  { identity: 'mei', name: 'Mei Lin', muted: false },
  { identity: 'diego', name: 'Diego Alvarez', muted: false }
];

type TestWindow = Window & {
  __tideRoom: {
    handleParticipantUpdates(infos: unknown[]): void;
    remoteParticipants: Map<string, unknown>;
    emit(event: string, ...args: unknown[]): boolean;
    localParticipant: { setScreenShareEnabled(enabled: boolean): Promise<unknown> };
  };
};

async function join(page: Page): Promise<void> {
  await page.goto('/m/standup');
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page.getByRole('button', { name: /microphone$/ }).first()).toBeVisible({
    timeout: 20_000
  });
  await page.evaluate((people) => {
    const room = (window as unknown as TestWindow).__tideRoom;
    room.handleParticipantUpdates(
      people.map((person, index) => ({
        sid: `PA_${person.identity}`,
        identity: person.identity,
        name: person.name,
        state: 2,
        metadata: '',
        attributes: {},
        kind: 0,
        version: 1,
        joinedAt: 0n,
        dataTracks: [],
        permission: { canSubscribe: true, canPublish: true, canPublishData: true },
        tracks: [
          {
            sid: `TR_mic_${index}`,
            type: 0,
            source: 2,
            name: 'microphone',
            muted: person.muted,
            mimeType: 'audio/opus',
            codecs: []
          }
        ]
      }))
    );
  }, remotes);
  await expect(page.getByTestId('participant-tile')).toHaveCount(remotes.length + 1);
}

async function speak(page: Page, identity: string): Promise<void> {
  await page.evaluate((who) => {
    const room = (window as unknown as TestWindow).__tideRoom;
    room.emit('activeSpeakersChanged', [room.remoteParticipants.get(who)]);
  }, identity);
}

async function chat(page: Page, identity: string, text: string): Promise<void> {
  await page.evaluate(
    ({ who, text }) => {
      const room = (window as unknown as TestWindow).__tideRoom;
      const payload = new TextEncoder().encode(JSON.stringify({ text, ts: Date.now() }));
      room.emit('dataReceived', payload, room.remoteParticipants.get(who), 0, 'chat');
    },
    { who: identity, text }
  );
}

async function shot(page: Page, name: string): Promise<void> {
  // Past the sheet slide and the lens cross-fade.
  await page.waitForTimeout(450);
  await page.screenshot({ path: `${out}/${name}.png` });
}

for (const theme of ['light', 'dark'] as const) {
  for (const [size, viewport] of Object.entries(viewports)) {
    test(`stage pictures, ${theme}, ${size}`, async ({ page }) => {
      test.setTimeout(120_000);
      await page.setViewportSize(viewport);
      await page.emulateMedia({ colorScheme: theme });
      await mockApi(page, defaultState());
      await fakeSfu(page, { metadata: '{"role":"host"}' });
      await join(page);
      await speak(page, 'aisha');
      await chat(page, 'mei', 'Can everyone see the Q4 roadmap now?');
      await chat(page, 'tom', 'Yes, loud and clear.\nNotes for later.');
      await shot(page, `${size}-${theme}-orbit`);

      const grid = page.getByRole('button', { name: 'Grid view' });
      const more = page.getByRole('button', { name: 'More controls' });
      if (size === 'phone' && (await more.count())) {
        await more.click();
        await shot(page, `${size}-${theme}-more`);
        await page.keyboard.press('Escape');
      }
      if (size === 'phone' && (await more.count())) await more.click();
      if (await grid.count()) {
        await grid.click();
        await shot(page, `${size}-${theme}-grid`);
        await page.getByRole('button', { name: 'Speaker view' }).click();
      }
      await page.keyboard.press('Escape');

      await page.getByRole('button', { name: 'Open people' }).click();
      await shot(page, `${size}-${theme}-people`);
      // A phone's sheet covers the capsule; its own close button is everywhere.
      await page
        .getByRole('complementary', { name: 'People' })
        .getByRole('button', { name: 'Close', exact: true })
        .click();

      await page.evaluate(() =>
        (window as unknown as TestWindow).__tideRoom.localParticipant.setScreenShareEnabled(true)
      );
      await expect(page.getByTestId('focus-pane')).toBeVisible();
      await shot(page, `${size}-${theme}-share`);
    });
  }
}
