import { test, expect, chromium, type BrowserContext, type Page } from '@playwright/test';
import { createRoomAndGetSlug, dexLogin, joinAsGuestThroughLobby } from './helpers';
import { defaultState, mockApi } from './mock-api';
import { fakeSfu, fakeSfuLaunchArgs } from './fake-sfu';

test('chat is bidirectional, counts unread messages, and has no rejoin history', async () => {
  test.setTimeout(150_000);
  const browser = await chromium.launch({
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required'
    ]
  });
  const contexts: BrowserContext[] = [];
  const newContext = async (): Promise<BrowserContext> => {
    const context = await browser.newContext({
      baseURL: 'http://localhost:5173',
      permissions: ['camera', 'microphone']
    });
    contexts.push(context);
    return context;
  };

  try {
    const host = await (await newContext()).newPage();
    await dexLogin(host);
    const slug = await createRoomAndGetSlug(host, `Chat e2e ${Date.now()}`);
    await host.goto(`/m/${slug}`);
    await host.getByRole('button', { name: 'Join meeting' }).click();
    await expect(host.getByRole('button', { name: 'Share screen' })).toBeVisible({
      timeout: 20_000
    });

    const guest = await (await newContext()).newPage();
    await joinAsGuestThroughLobby(guest, host, slug, 'Chat guest');

    await host.getByRole('button', { name: 'Open chat' }).click();
    const hostChat = host.getByRole('complementary', { name: 'Chat' });
    await hostChat.getByRole('textbox', { name: 'Chat message' }).fill('Hello from host');
    await hostChat.getByRole('textbox', { name: 'Chat message' }).press('Enter');

    const guestChatButton = guest.getByRole('button', { name: 'Open chat' });
    await expect(guestChatButton.locator('.badge')).toHaveText('1', { timeout: 20_000 });
    await guestChatButton.click();
    const guestChat = guest.getByRole('complementary', { name: 'Chat' });
    await expect(guestChat.getByText('Hello from host')).toBeVisible();
    await guestChat.getByRole('textbox', { name: 'Chat message' }).fill('Hello from guest');
    await guestChat.getByRole('textbox', { name: 'Chat message' }).press('Enter');
    await expect(hostChat.getByText('Hello from guest')).toBeVisible({ timeout: 20_000 });

    await guest.reload();
    await joinAsGuestThroughLobby(guest, host, slug, 'Chat guest');
    await guest.getByRole('button', { name: 'Open chat' }).click();
    const freshChat = guest.getByRole('complementary', { name: 'Chat' });
    await expect(freshChat.getByText('Messages appear here for this meeting only.')).toBeVisible();
    await expect(freshChat.getByText('Hello from host')).toHaveCount(0);
    await expect(freshChat.getByText('Hello from guest')).toHaveCount(0);
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
    await browser.close();
  }
});

// The rest of this file runs against the Vite dev server alone: the API is
// mocked and the SFU is fake-sfu.ts. A remote message is delivered the way
// livekit-client delivers one, as a DataReceived event on the page's Room.
// The test above launches its own browser, so this setting is theirs alone.
test.use({ launchOptions: { args: fakeSfuLaunchArgs } });

test.describe('chat messages from other participants', () => {
  type RoomWindow = Window & {
    __tideRoom: {
      emit(...args: unknown[]): boolean;
      localParticipant: { publishData(...args: unknown[]): Promise<void> };
    };
    __published?: number;
  };

  async function openChat(page: Page): Promise<void> {
    await mockApi(page);
    await fakeSfu(page);
    await page.goto('/m/standup');
    for (const control of ['camera', 'microphone']) {
      const toggle = page.locator(`button[aria-pressed][aria-label*="${control}" i]`).first();
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
    }
    await page.getByRole('button', { name: 'Join meeting' }).click();
    await page.getByRole('button', { name: 'Open chat' }).click();
  }

  function receive(
    page: Page,
    text: string,
    from = 'Mallory Guest',
    identity = `guest:${from}`
  ): Promise<void> {
    return page.evaluate(
      ({ text, from, identity }) => {
        const payload = new TextEncoder().encode(JSON.stringify({ text, ts: Date.now() }));
        const sender = { identity, name: from };
        (window as unknown as RoomWindow).__tideRoom.emit(
          'dataReceived',
          payload,
          sender,
          0,
          'chat'
        );
      },
      { text, from, identity }
    );
  }

  test('two people with the same name are never merged into one sender', async ({ page }) => {
    await openChat(page);
    await receive(page, 'from the first Sam', 'Sam', 'guest:sam-1');
    await receive(page, 'from the second Sam', 'Sam', 'guest:sam-2');
    await receive(page, 'the second Sam again', 'Sam', 'guest:sam-2');

    // Grouping by display name would show these as one person's three messages,
    // letting a guest pass their words off as someone else's.
    const chat = page.getByRole('complementary', { name: 'Chat' });
    await expect(chat.getByText('the second Sam again')).toBeVisible();
    await expect(chat.getByText('Sam', { exact: true })).toHaveCount(2);
  });

  test('markdown renders as formatting, and a bare URL becomes a link to itself', async ({
    page
  }) => {
    await openChat(page);
    await receive(
      page,
      '**ship** it *today* or _never_, ~~maybe~~ run `make up`, see https://example.com/a_(b)).\n```\nmake deploy\n```'
    );
    const chat = page.getByRole('complementary', { name: 'Chat' });
    await expect(chat.locator('strong')).toHaveText('ship');
    await expect(chat.locator('em')).toHaveText(['today', 'never']);
    await expect(chat.locator('s')).toHaveText('maybe');
    await expect(chat.locator('p code')).toHaveText('make up');
    await expect(chat.locator('pre')).toHaveText('make deploy');
    // The link names exactly where it goes, minus the sentence's punctuation,
    // and opens away from the meeting without handing it a window.opener.
    const link = chat.getByRole('link');
    await expect(link).toHaveText('https://example.com/a_(b)');
    await expect(link).toHaveAttribute('href', 'https://example.com/a_(b)');
    await expect(link).toHaveAttribute('target', '_blank');
    await expect(link).toHaveAttribute('rel', 'noopener noreferrer nofollow');
  });

  test('markup and disguised links from a guest arrive as plain text', async ({ page }) => {
    let dialogs = 0;
    page.on('dialog', (dialog) => {
      dialogs += 1;
      void dialog.dismiss();
    });
    await openChat(page);
    const attacks = [
      '<img src=x onerror=alert(1)>',
      '<script>alert(1)</script>',
      '[click](https://evil.example)',
      'javascript:alert(1)'
    ];
    for (const attack of attacks) await receive(page, attack);

    const chat = page.getByRole('complementary', { name: 'Chat' });
    for (const attack of attacks)
      await expect(chat.getByText(attack, { exact: true })).toBeVisible();
    await expect(chat.locator('img, script')).toHaveCount(0);
    // A masked link would let a guest show one address and open another.
    await expect(chat.getByRole('link')).toHaveCount(0);
    expect(dialogs).toBe(0);
  });

  test('a message over the length limit from another participant is dropped', async ({ page }) => {
    await openChat(page);
    await receive(page, 'x'.repeat(2001));
    await receive(page, 'y'.repeat(2000));
    await receive(page, 'after the long ones');

    const chat = page.getByRole('complementary', { name: 'Chat' });
    await expect(chat.getByText('after the long ones')).toBeVisible();
    await expect(chat.getByText('y'.repeat(2000), { exact: true })).toBeVisible();
    await expect(chat.getByText('x'.repeat(2001))).toHaveCount(0);
  });

  test('an over-long message is refused before it reaches anyone', async ({ page }) => {
    await openChat(page);
    await page.evaluate(() => {
      const roomWindow = window as unknown as RoomWindow;
      const local = roomWindow.__tideRoom.localParticipant;
      const publish = local.publishData.bind(local);
      roomWindow.__published = 0;
      local.publishData = (...args: unknown[]) => {
        roomWindow.__published! += 1;
        return publish(...args);
      };
    });
    const published = () => page.evaluate(() => (window as unknown as RoomWindow).__published);

    const chat = page.getByRole('complementary', { name: 'Chat' });
    const box = chat.getByRole('textbox', { name: 'Chat message' });
    await expect(box).toHaveAttribute('maxlength', '2000');
    // maxlength stops typing, not a paste through script; the room refuses too,
    // or receivers would drop a message the sender believes was delivered.
    await box.evaluate((element: HTMLTextAreaElement) => {
      element.value = 'z'.repeat(2001);
      element.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await expect(chat.getByText('2001 / 2000')).toBeVisible();
    await box.press('Enter');
    await expect(chat.getByRole('alert')).toHaveText('Messages can be at most 2000 characters.');
    expect(await published()).toBe(0);
    await expect(chat.getByText('z'.repeat(2001))).toHaveCount(0);

    await box.fill('short and sweet');
    await box.press('Enter');
    await expect(chat.getByText('short and sweet')).toBeVisible();
    expect(await published()).toBe(1);
  });

  test('a message that arrives while reading back waits behind a pill', async ({ page }) => {
    await openChat(page);
    for (let i = 1; i <= 30; i++) await receive(page, `backlog ${i}`);
    const chat = page.getByRole('complementary', { name: 'Chat' });
    await expect(chat.getByText('backlog 30')).toBeInViewport();

    await chat.getByText('backlog 1', { exact: true }).scrollIntoViewIfNeeded();
    await receive(page, 'fresh news');
    await receive(page, 'more news');
    // Reading back is not interrupted; the pill says what came in.
    await expect(chat.getByText('backlog 1', { exact: true })).toBeInViewport();
    const pill = chat.getByRole('button', { name: '2 new messages' });
    await expect(pill).toBeVisible();
    await pill.click();
    await expect(chat.getByText('more news')).toBeInViewport();
    await expect(pill).toHaveCount(0);
  });

  test('a link shows the address it really opens, whatever its letters or direction marks', async ({
    page
  }) => {
    await openChat(page);
    // A Cyrillic "а" passes for "example.com", and U+202E flips "gnp.exe" so
    // it reads "exe.png": shown as typed, the link would lie about itself.
    await receive(page, 'roadmap: https://exаmple.com/‮gnp.exe');
    const link = page.getByRole('complementary', { name: 'Chat' }).getByRole('link');
    await expect(link).toHaveText('https://xn--exmple-4nf.com/%E2%80%AEgnp.exe');
    await expect(link).toHaveAttribute('href', 'https://xn--exmple-4nf.com/%E2%80%AEgnp.exe');
    await expect(link).toHaveAttribute('dir', 'ltr');
    await expect(link).toHaveCSS('unicode-bidi', 'isolate');
  });

  test('a guest is marked as one beside their name, so they cannot pass as the host', async ({
    page
  }) => {
    await openChat(page);
    await receive(page, 'from the real host', 'Ada Host', 'host:0001');
    await receive(page, 'from someone using her name', 'Ada Host', 'guest:ada');
    const chat = page.getByRole('complementary', { name: 'Chat' });
    const group = (text: string) => chat.locator('.group').filter({ hasText: text });
    await expect(group('from the real host').locator('.guest-tag')).toHaveCount(0);
    await expect(group('from someone using her name').locator('.guest-tag')).toHaveText('Guest');

    // The peek is read without the sheet, so it carries the mark too.
    await chat.getByRole('button', { name: 'Close chat' }).click();
    await receive(page, 'quick one', 'Ada Host', 'guest:ada');
    await expect(page.getByTestId('chat-peek')).toContainText('Guest');
    await receive(page, 'and another', 'Ada Host', 'host:0001');
    await expect(page.getByTestId('chat-peek')).toContainText('and another');
    await expect(page.getByTestId('chat-peek').locator('.guest-tag')).toHaveCount(0);
  });

  test('groups the cap leaves in the log stay where they are as old messages go', async ({
    page
  }) => {
    await openChat(page);
    await receive(page, 'the oldest group', 'Bo', 'guest:bo');
    for (let i = 1; i < 200; i++) await receive(page, `still Bo ${i}`, 'Bo', 'guest:bo');
    const chat = page.getByRole('complementary', { name: 'Chat' });
    const bo = chat.locator('.group').filter({ hasText: 'still Bo 199' });
    await bo.evaluate((element) => element.setAttribute('data-seen', ''));

    // The 201st message evicts Bo's first; his group must not be rebuilt
    // (and animate in again) under everyone reading it.
    await receive(page, 'a new voice', 'Cy', 'guest:cy');
    await expect(chat.getByText('a new voice')).toBeVisible();
    await expect(chat.getByText('the oldest group')).toHaveCount(0);
    await expect(bo).toHaveAttribute('data-seen', '');
  });

  test("an image's peek says who sent an image", async ({ page }) => {
    await mockApi(page, { ...defaultState(), chatImages: true });
    const sfu = await fakeSfu(page);
    await page.goto('/m/standup');
    for (const control of ['camera', 'microphone']) {
      const toggle = page.locator(`button[aria-pressed][aria-label*="${control}" i]`).first();
      await expect(toggle).toBeVisible();
      if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
    }
    await page.getByRole('button', { name: 'Join meeting' }).click();
    await expect(page.getByRole('button', { name: 'Open chat' })).toBeVisible();
    sfu.addParticipant('guest:pat', 'Pat Lee');
    await page.waitForFunction(() =>
      (window as unknown as ImageWindow).__tideRoom.remoteParticipants.has('guest:pat')
    );

    // Delivered as the media server delivers a chat image: one data stream.
    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(64, 40);
      canvas.getContext('2d')!.fillRect(0, 0, 64, 40);
      const bytes = new Uint8Array(
        await (await canvas.convertToBlob({ type: 'image/webp' })).arrayBuffer()
      );
      const manager = (window as unknown as ImageWindow).__tideRoom.incomingDataStreamManager;
      const streamId = crypto.randomUUID();
      const send = (value: unknown) =>
        manager.handleDataStreamPacket({ participantIdentity: 'guest:pat', value }, 0);
      send({
        case: 'streamHeader',
        value: {
          streamId,
          topic: 'chat-image',
          mimeType: 'image/webp',
          timestamp: BigInt(Date.now()),
          totalLength: BigInt(bytes.length),
          attributes: {},
          compression: 0,
          contentHeader: { case: 'byteHeader', value: { name: 'image' } }
        }
      });
      send({
        case: 'streamChunk',
        value: { streamId, chunkIndex: 0n, content: bytes, version: 0 }
      });
      send({ case: 'streamTrailer', value: { streamId, reason: '', attributes: {} } });
    });

    // An image has no text: a peek of its text alone would be an empty bubble.
    await expect(page.getByTestId('chat-peek')).toContainText('Pat Lee sent an image');
  });
});

type ImageWindow = Window & {
  __tideRoom: {
    remoteParticipants: Map<string, unknown>;
    incomingDataStreamManager: {
      handleDataStreamPacket(packet: unknown, encryptionType: number): void;
    };
  };
};
