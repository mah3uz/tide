import { crc32, deflateRawSync, deflateSync } from 'node:zlib';
import { test, expect, type Page } from '@playwright/test';
import { defaultState, mockApi } from './mock-api';
import { fakeSfu, fakeSfuLaunchArgs, type FakeSfu } from './fake-sfu';

// Chat images (TIDE_CHAT_IMAGES) against the Vite dev server: the API is
// mocked and the SFU is fake-sfu.ts, which forwards nothing. A remote image
// is delivered the way the media server delivers one, as data-stream packets
// into livekit-client's own incoming stream manager, carrying the sender's
// identity as the server stamps it; what livekit-client does with them
// (no handler, sizes, ordering) is its real code.

test.use({ launchOptions: { args: fakeSfuLaunchArgs } });

const maximumImageBytes = 2 * 1024 * 1024;

interface StreamSpec {
  identity: string;
  mimeType: string;
  /** The size the header declares; the bytes' length unless set. */
  size?: number;
  attributes?: Record<string, string>;
  name?: string;
  /** Send the trailer that ends the stream; default true. */
  end?: boolean;
  /** Continue this stream, from chunk `firstChunk`, rather than open one. */
  streamId?: string;
  firstChunk?: number;
  /** 1 is deflate-raw: `bytes` are then compressed, and `size` is what they inflate to. */
  compression?: number;
  /** All of `bytes` in the header, as livekit-client sends a payload that fits one packet. */
  inline?: boolean;
}

type TestWindow = Window & {
  __revoked: string[];
  __sent: { bytes: Uint8Array; options: Record<string, unknown>; at: number }[];
  __releaseSend?: () => void;
  /** DecompressionStreams made, and the bytes read out of them. */
  __decompressors: number;
  __inflated: number;
  /** Gain nodes made: each sound played makes the same number. */
  __gains: number;
  __webp(width: number, height: number, type?: string): Promise<Uint8Array>;
  __bytes(base64: string): Uint8Array;
  __animatedWebp(): Promise<Uint8Array>;
  __largeWebp(): Promise<Uint8Array>;
  __large?: Uint8Array;
  __push(spec: StreamSpec, bytes: Uint8Array): string;
  __finish(identity: string, streamId: string): void;
  __tideRoom: {
    localParticipant: { sendBytes(...args: unknown[]): Promise<unknown> };
    remoteParticipants: Map<string, unknown>;
    incomingDataStreamManager: {
      byteStreamHandlers: Map<string, unknown>;
      byteStreamControllers: Map<string, { controller: ReadableStreamDefaultController }>;
      handleDataStreamPacket(packet: unknown, encryptionType: number): void;
    };
    emit(...args: unknown[]): boolean;
  };
};

// Installed before the app: records every revoked object URL, what is
// inflated and what sounds play, and builds and pushes data streams as
// livekit-client receives them.
function installHarness(): void {
  const w = window as unknown as TestWindow;
  w.__revoked = [];
  w.__sent = [];
  const revoke = URL.revokeObjectURL.bind(URL);
  URL.revokeObjectURL = (url: string) => {
    w.__revoked.push(url);
    revoke(url);
  };
  w.__decompressors = 0;
  w.__inflated = 0;
  const NativeDecompressionStream = DecompressionStream;
  window.DecompressionStream = class extends NativeDecompressionStream {
    constructor(format: CompressionFormat) {
      super(format);
      w.__decompressors += 1;
      const counted = super.readable.pipeThrough(
        new TransformStream<Uint8Array, Uint8Array>({
          transform(chunk, controller) {
            w.__inflated += chunk.byteLength;
            controller.enqueue(chunk);
          }
        })
      );
      Object.defineProperty(this, 'readable', { value: counted });
    }
  };
  w.__gains = 0;
  const createGain = BaseAudioContext.prototype.createGain;
  BaseAudioContext.prototype.createGain = function (this: BaseAudioContext) {
    w.__gains += 1;
    return createGain.call(this);
  };
  w.__bytes = (base64) => Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
  // Two frames around a still one the browser encoded.
  w.__animatedWebp = async () => {
    const frame = Array.from((await w.__webp(64, 64)).subarray(12));
    const ascii = (text: string) => Array.from(text, (char) => char.charCodeAt(0));
    const u24 = (n: number) => [n & 255, (n >> 8) & 255, (n >> 16) & 255];
    const u32 = (n: number) => [...u24(n), (n >>> 24) & 255];
    const chunk = (type: string, payload: number[]) => [
      ...ascii(type),
      ...u32(payload.length),
      ...payload,
      ...(payload.length % 2 ? [0] : [])
    ];
    const anmf = [...u24(0), ...u24(0), ...u24(63), ...u24(63), ...u24(100), 0, ...frame];
    const body = [
      ...ascii('WEBP'),
      ...chunk('VP8X', [0x02, 0, 0, 0, ...u24(63), ...u24(63)]),
      ...chunk('ANIM', [0, 0, 0, 0, 0, 0]),
      ...chunk('ANMF', anmf),
      ...chunk('ANMF', anmf)
    ];
    return new Uint8Array([...ascii('RIFF'), ...u32(body.length), ...body]);
  };
  // Noise, as large as tide sends: about 2 MB.
  w.__largeWebp = async () => {
    for (let side = 1400; side >= 400; side -= 100) {
      const canvas = new OffscreenCanvas(side, side);
      const context = canvas.getContext('2d')!;
      const pixels = context.createImageData(side, side);
      for (let offset = 0; offset < pixels.data.length; offset += 65_536) {
        crypto.getRandomValues(pixels.data.subarray(offset, offset + 65_536));
      }
      for (let offset = 3; offset < pixels.data.length; offset += 4) pixels.data[offset] = 255;
      context.putImageData(pixels, 0, 0);
      const blob = await canvas.convertToBlob({ type: 'image/webp', quality: 1 });
      if (blob.size <= 2 * 1024 * 1024) return new Uint8Array(await blob.arrayBuffer());
    }
    throw new Error('No noisy WebP fits in 2 MB.');
  };
  w.__webp = async (width, height, type = 'image/webp') => {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext('2d')!;
    const gradient = context.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, '#2b6cb0');
    gradient.addColorStop(1, '#f6ad55');
    context.fillStyle = gradient;
    context.fillRect(0, 0, width, height);
    const blob = await canvas.convertToBlob({ type, quality: 0.8 });
    return new Uint8Array(await blob.arrayBuffer());
  };
  const packet = (identity: string, value: unknown) => ({ participantIdentity: identity, value });
  w.__push = (spec, bytes) => {
    const manager = w.__tideRoom.incomingDataStreamManager;
    const streamId = spec.streamId ?? crypto.randomUUID();
    if (!spec.streamId) {
      manager.handleDataStreamPacket(
        packet(spec.identity, {
          case: 'streamHeader',
          value: {
            streamId,
            topic: 'chat-image',
            mimeType: spec.mimeType,
            timestamp: BigInt(Date.now()),
            totalLength: BigInt(spec.size ?? bytes.length),
            attributes: spec.attributes ?? {},
            compression: spec.compression ?? 0,
            inlineContent: spec.inline ? bytes : undefined,
            contentHeader: { case: 'byteHeader', value: { name: spec.name ?? 'image' } }
          }
        }),
        0
      );
    }
    if (spec.inline) return streamId;
    let index = spec.firstChunk ?? 0;
    for (let offset = 0; offset < bytes.length; offset += 15_000, index++) {
      manager.handleDataStreamPacket(
        packet(spec.identity, {
          case: 'streamChunk',
          value: {
            streamId,
            chunkIndex: BigInt(index),
            content: bytes.subarray(offset, offset + 15_000),
            version: 0
          }
        }),
        0
      );
    }
    if (spec.end !== false) w.__finish(spec.identity, streamId);
    return streamId;
  };
  w.__finish = (identity, streamId) =>
    w.__tideRoom.incomingDataStreamManager.handleDataStreamPacket(
      packet(identity, { case: 'streamTrailer', value: { streamId, reason: '', attributes: {} } }),
      0
    );
}

async function openChat(page: Page, chatImages: boolean): Promise<FakeSfu> {
  await page.addInitScript(installHarness);
  await mockApi(page, { ...defaultState(), chatImages });
  const sfu = await fakeSfu(page);
  await page.goto('/m/standup');
  for (const control of ['camera', 'microphone']) {
    const toggle = page.locator(`button[aria-pressed][aria-label*="${control}" i]`).first();
    await expect(toggle).toBeVisible();
    if ((await toggle.getAttribute('aria-pressed')) === 'true') await toggle.click();
  }
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await page.getByRole('button', { name: 'Open chat' }).click();
  sfu.addParticipant('guest:mallory', 'Mallory Guest');
  await page.waitForFunction(() =>
    (window as unknown as TestWindow).__tideRoom.remoteParticipants.has('guest:mallory')
  );
  return sfu;
}

/** A valid WebP pushed from `identity`; returns nothing until it is all sent. */
function pushWebp(page: Page, spec: Omit<StreamSpec, 'mimeType'>, width = 640, height = 400) {
  return page.evaluate(
    async ({ spec, width, height }) => {
      const w = window as unknown as TestWindow;
      return w.__push({ mimeType: 'image/webp', ...spec }, await w.__webp(width, height));
    },
    { spec, width, height }
  );
}

function sendText(page: Page, text: string): Promise<void> {
  return page.evaluate((text) => {
    const payload = new TextEncoder().encode(JSON.stringify({ text, ts: Date.now() }));
    const sender = { identity: 'guest:mallory', name: 'Mallory Guest' };
    (window as unknown as TestWindow).__tideRoom.emit('dataReceived', payload, sender, 0, 'chat');
  }, text);
}

/** Records what the room sends, and holds the send at 40% until released. */
function holdSends(page: Page): Promise<void> {
  return page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const local = w.__tideRoom.localParticipant;
    const sendBytes = local.sendBytes.bind(local);
    local.sendBytes = async (...args: unknown[]) => {
      const [bytes, options] = args as [Uint8Array, Record<string, unknown>];
      w.__sent.push({ bytes, options, at: performance.now() });
      (options.onProgress as (progress: number) => void)(0.4);
      await new Promise<void>((resolve) => (w.__releaseSend = resolve));
      return sendBytes(...args);
    };
  });
}

function pngChunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

const secret = 'GPS 48.8584N 2.2945E SECRET-LOCATION';

// A photo as a phone saves one: big, full of detail that compresses badly,
// and carrying where it was taken, in EXIF and in a text chunk.
function photoWithLocation(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const description = Buffer.from(`${secret}\0`, 'latin1');
  const exif = Buffer.alloc(8 + 2 + 12 + 4);
  exif.write('MM\0*', 0, 'latin1');
  exif.writeUInt32BE(8, 4);
  exif.writeUInt16BE(1, 8);
  exif.writeUInt16BE(0x010e, 10); // ImageDescription
  exif.writeUInt16BE(2, 12); // ASCII
  exif.writeUInt32BE(description.length, 14);
  exif.writeUInt32BE(exif.length, 18);
  const rows = Buffer.alloc((width * 3 + 1) * height);
  let seed = 42;
  for (let index = 0; index < rows.length; index++) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    rows[index] = index % (width * 3 + 1) === 0 ? 0 : seed >>> 24;
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', header),
    pngChunk('eXIf', Buffer.concat([exif, description])),
    pngChunk('tEXt', Buffer.from(`Comment\0${secret}`, 'latin1')),
    pngChunk('IDAT', deflateSync(rows, { level: 1 })),
    pngChunk('IEND', Buffer.alloc(0))
  ]);
}

function chat(page: Page) {
  return page.getByRole('complementary', { name: 'Chat' });
}

test('with the switch off there is no attach control and arriving images are ignored', async ({
  page
}) => {
  await openChat(page, false);
  await expect(chat(page).getByRole('button', { name: 'Attach image' })).toHaveCount(0);
  await expect(chat(page).locator('input[type=file]')).toHaveCount(0);
  // No handler at all: livekit-client then drops the stream's packets
  // instead of queueing them for a reader that never comes.
  expect(
    await page.evaluate(() =>
      (window as unknown as TestWindow).__tideRoom.incomingDataStreamManager.byteStreamHandlers.has(
        'chat-image'
      )
    )
  ).toBe(false);

  await pushWebp(page, { identity: 'guest:mallory' });
  await sendText(page, 'after the image');
  await expect(chat(page).getByText('after the image')).toBeVisible();
  await expect(chat(page).locator('img')).toHaveCount(0);
  await expect(chat(page).getByRole('link', { name: 'Download image' })).toHaveCount(0);
});

test('a photo is re-encoded before it leaves: smaller, scaled, and without its location', async ({
  page
}) => {
  test.setTimeout(90_000);
  await openChat(page, true);
  await holdSends(page);
  await chat(page)
    .locator('input[type=file]')
    .setInputFiles({
      name: 'holiday.png',
      mimeType: 'image/png',
      buffer: photoWithLocation(3000, 1600)
    });

  // One image at a time, with its progress in the composer.
  await expect(chat(page).getByRole('status')).toHaveText('Sending image… 40%', {
    timeout: 30_000
  });
  await expect(chat(page).getByRole('button', { name: 'Attach image' })).toBeDisabled();

  const sent = await page.evaluate(async (secret) => {
    const [only, ...rest] = (window as unknown as TestWindow).__sent;
    const ascii = new TextDecoder('latin1').decode(only.bytes);
    const bitmap = await createImageBitmap(
      new Blob([only.bytes as Uint8Array<ArrayBuffer>], { type: String(only.options.mimeType) })
    );
    return {
      more: rest.length,
      size: only.bytes.length,
      magic: ascii.slice(0, 4) + ascii.slice(8, 12),
      leaks: ascii.includes(secret) || ascii.includes('Exif') || ascii.includes('eXIf'),
      options: { ...only.options, onProgress: undefined },
      decoded: { width: bitmap.width, height: bitmap.height }
    };
  }, secret);
  expect(sent.more).toBe(0);
  expect(sent.magic).toBe('RIFFWEBP');
  expect(sent.leaks).toBe(false);
  expect(sent.size).toBeLessThanOrEqual(maximumImageBytes);
  expect(Math.max(sent.decoded.width, sent.decoded.height)).toBeLessThanOrEqual(2048);
  // The same picture, scaled whole: its proportions survive.
  expect(sent.decoded.width / sent.decoded.height).toBeCloseTo(3000 / 1600, 1);
  expect(sent.options).toMatchObject({
    topic: 'chat-image',
    mimeType: 'image/webp',
    attributes: { width: String(sent.decoded.width), height: String(sent.decoded.height) }
  });

  await page.evaluate(() => (window as unknown as TestWindow).__releaseSend!());
  const mine = chat(page).locator('.group.mine');
  await expect(mine.locator('img')).toBeVisible();
  await expect(mine.getByRole('link', { name: 'Download image' })).toHaveAttribute(
    'download',
    /^tide-ada-host-\d{4}\.webp$/
  );
  await expect(chat(page).getByRole('status')).toHaveCount(0);
  await expect(chat(page).getByRole('button', { name: 'Attach image' })).toBeEnabled();
});

test('a pasted screenshot and an image dropped on the chat are sent; pasted text stays text', async ({
  page
}) => {
  await openChat(page, true);
  await holdSends(page);
  const deliver = (how: 'paste' | 'drop' | 'paste with text') =>
    page.evaluate(async (how) => {
      const w = window as unknown as TestWindow;
      const transfer = new DataTransfer();
      const bytes = await w.__webp(200, 120, 'image/png');
      transfer.items.add(
        new File([bytes as Uint8Array<ArrayBuffer>], 'shot.png', { type: 'image/png' })
      );
      if (how === 'paste with text') transfer.setData('text/plain', 'a spreadsheet cell');
      const box = document.querySelector('textarea[name="chat-message"]')!;
      const event =
        how === 'drop'
          ? new DragEvent('drop', { dataTransfer: transfer, bubbles: true, cancelable: true })
          : new ClipboardEvent('paste', {
              clipboardData: transfer,
              bubbles: true,
              cancelable: true
            });
      box.dispatchEvent(event);
      if (how !== 'paste with text') {
        while (!w.__releaseSend) await new Promise((resolve) => setTimeout(resolve, 20));
        w.__releaseSend();
        w.__releaseSend = undefined;
      }
      return w.__sent.length;
    }, how);

  expect(await deliver('paste')).toBe(1);
  await expect(chat(page).locator('.group.mine .picture img')).toHaveCount(1);
  expect(await deliver('drop')).toBe(2);
  await expect(chat(page).locator('.group.mine .picture img')).toHaveCount(2);
  // Receivers drop a sender's images that come closer together than tide
  // sends them, so the second waited for its turn.
  const [first, second] = await page.evaluate(() =>
    (window as unknown as TestWindow).__sent.map((sent) => sent.at)
  );
  expect(second - first).toBeGreaterThanOrEqual(4_900);
  await deliver('paste with text');
  // Preparing an image takes a moment; give a wrongly taken one time to show.
  await page.waitForTimeout(1_000);
  await expect(chat(page).getByRole('status')).toHaveCount(0);
  expect(await page.evaluate(() => (window as unknown as TestWindow).__sent.length)).toBe(2);
});

test('an SVG and a file only named like an image are refused before anything is sent', async ({
  page
}) => {
  await openChat(page, true);
  await holdSends(page);
  const picker = chat(page).locator('input[type=file]');
  await expect(picker).toHaveAttribute('accept', 'image/png,image/jpeg,image/webp,image/gif');

  await picker.setInputFiles({
    name: 'logo.svg',
    mimeType: 'image/svg+xml',
    buffer: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>')
  });
  await expect(chat(page).getByRole('alert')).toHaveText(
    "SVG images can't be sent. Use PNG, JPEG, WebP or GIF."
  );
  await picker.setInputFiles({
    name: 'invoice.png',
    mimeType: 'image/png',
    buffer: Buffer.from('%PDF-1.7 not an image at all')
  });
  await expect(chat(page).getByRole('alert')).toHaveText(
    'Only PNG, JPEG, WebP and GIF images can be sent.'
  );
  expect(await page.evaluate(() => (window as unknown as TestWindow).__sent.length)).toBe(0);
  await expect(chat(page).locator('img')).toHaveCount(0);
});

test('images that are too big, lie about themselves, or crowd in are dropped', async ({ page }) => {
  await openChat(page, true);
  const dropped = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const webp = await w.__webp(320, 200);
    const from = (n: number) => `guest:sender-${n}`;
    // Declared over the limit: never read.
    w.__push({ identity: from(1), mimeType: 'image/webp', size: 2 * 1024 * 1024 + 1 }, webp);
    // Declared small, then more than declared and past the limit.
    const big = new Uint8Array(2 * 1024 * 1024 + 30_000);
    big.set(webp);
    w.__push({ identity: from(2), mimeType: 'image/webp', size: webp.length }, big);
    // A real PNG declared as WebP: the browser would decode it anyway, so
    // only the magic number says it is not what it claims.
    w.__push({ identity: from(3), mimeType: 'image/webp' }, await w.__webp(320, 200, 'image/png'));
    // Not an allowed type, however well formed.
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    w.__push({ identity: from(4), mimeType: 'image/svg+xml' }, svg);
    // A tiny PNG whose header says 20000×20000: gigabytes once decoded.
    const bomb = new Uint8Array([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0,
      0x4e, 0x20, 0, 0, 0x4e, 0x20, 8, 2, 0, 0, 0, 0, 0, 0, 0
    ]);
    w.__push({ identity: from(5), mimeType: 'image/png' }, bomb);
    return 5;
  });
  // The one honest image after them, from a sender who also tried above,
  // still arrives: dropping a stream gives back its slot.
  await pushWebp(page, { identity: 'guest:mallory' });
  await expect(chat(page).locator('img')).toHaveCount(1);
  expect(dropped).toBe(5);

  // One image read at a time per sender, three in all.
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const webp = await w.__webp(320, 200);
    const open = (identity: string) => ({
      identity,
      streamId: w.__push(
        { identity, mimeType: 'image/webp', size: webp.length, end: false },
        webp.subarray(0, 100)
      )
    });
    const held = [open('guest:dana')];
    w.__push({ identity: 'guest:dana', mimeType: 'image/webp' }, webp);
    held.push(open('guest:a'), open('guest:b'));
    w.__push({ identity: 'guest:c', mimeType: 'image/webp' }, webp);
    for (const { identity, streamId } of held) {
      w.__push({ identity, mimeType: 'image/webp', streamId, firstChunk: 1 }, webp.subarray(100));
    }
  });
  // 1 from before, plus the three held open; neither crowding stream.
  await expect(chat(page).locator('img')).toHaveCount(4);
});

test('a received image shows with its sender, a Download button, and a full-size viewer', async ({
  page
}) => {
  await openChat(page, true);
  // Attributes and the stream's name are the sender's to write: they name
  // no one. Only the identity the media server stamps does.
  await pushWebp(page, {
    identity: 'guest:mallory',
    name: 'Ada Host',
    attributes: { from: 'Ada Host', name: 'Ada Host', width: '9999', height: '1' }
  });
  const log = chat(page);
  await expect(log.locator('.group:not(.mine) img')).toBeVisible();
  await expect(log.locator('.group.mine')).toHaveCount(0);
  await expect(log.locator('.name')).toHaveText('Mallory Guest');
  await expect(log.getByText('Ada Host')).toHaveCount(0);

  const download = log.getByRole('link', { name: 'Download image' });
  await expect(download).toBeVisible();
  await expect(download).toHaveAttribute('download', /^tide-mallory-guest-\d{4}\.webp$/);
  await expect(download).toHaveAttribute('href', /^blob:/);
  // Sized from the decoded image, not the claimed 9999×1.
  const box = await log.locator('.picture').boundingBox();
  expect(box!.width).toBeCloseTo(260, 0);
  expect(Math.abs(box!.height - (260 * 400) / 640)).toBeLessThanOrEqual(1);

  await log.getByRole('button', { name: 'View image from Mallory Guest' }).click();
  const viewer = page.getByRole('dialog', { name: 'Image from Mallory Guest' });
  await expect(viewer.getByRole('img', { name: 'Image from Mallory Guest' })).toBeVisible();
  await expect(viewer.getByRole('link', { name: 'Download' })).toHaveAttribute(
    'download',
    /^tide-mallory-guest-\d{4}\.webp$/
  );
  await viewer.getByRole('button', { name: 'Close' }).click();
  await expect(viewer).toHaveCount(0);
});

test("an image's memory is given back when it leaves the chat, and when the meeting is left", async ({
  page
}) => {
  await openChat(page, true);
  const urls = () =>
    chat(page)
      .locator('.picture img')
      .evaluateAll((images) => images.map((image) => (image as HTMLImageElement).src));
  const revoked = () => page.evaluate(() => (window as unknown as TestWindow).__revoked);

  await pushWebp(page, { identity: 'guest:mallory' });
  await expect(chat(page).locator('.picture img')).toHaveCount(1);
  const [first] = await urls();
  // 200 messages later the first image is out of the chat's history.
  for (let index = 1; index <= 200; index++) await sendText(page, `filler ${index}`);
  await expect(chat(page).locator('.picture img')).toHaveCount(0);
  expect(await revoked()).toContain(first);

  await pushWebp(page, { identity: 'guest:ann' });
  await pushWebp(page, { identity: 'guest:ben' });
  await expect(chat(page).locator('.picture img')).toHaveCount(2);
  const kept = await urls();
  expect(await revoked()).not.toContain(kept[0]);

  await page.getByRole('button', { name: 'Leave or end meeting' }).click();
  await page.getByRole('button', { name: 'Leave room' }).click();
  await expect(page.getByRole('button', { name: 'Open chat' })).toHaveCount(0);
  const after = await revoked();
  for (const url of kept) expect(after).toContain(url);
});

const bomb = (inflated: number) => deflateRawSync(Buffer.alloc(inflated)).toString('base64');

// A guest's modified client can mark a stream deflate-raw. A 15 KB packet of
// it inflates to 15 MB, a few of them to more than a tab can hold, and on
// every receiver at once.
test('a compressed image stream is dropped at its header, before anything inflates it', async ({
  page
}) => {
  await openChat(page, true);
  const result = await page.evaluate(
    async ({ chunked, inline, maximumImageBytes }) => {
      const w = window as unknown as TestWindow;
      w.__decompressors = 0;
      w.__inflated = 0;
      const spec = { mimeType: 'image/webp', size: maximumImageBytes, compression: 1 };
      w.__push({ ...spec, identity: 'guest:bomb-1' }, w.__bytes(chunked));
      w.__push({ ...spec, identity: 'guest:bomb-2', inline: true }, w.__bytes(inline));
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      return { decompressors: w.__decompressors, inflated: w.__inflated };
    },
    { chunked: bomb(64 * 1024 * 1024), inline: bomb(15 * 1024 * 1024), maximumImageBytes }
  );
  expect(result).toEqual({ decompressors: 0, inflated: 0 });
  await pushWebp(page, { identity: 'guest:mallory' });
  await expect(chat(page).locator('.picture img')).toHaveCount(1);
});

test("without tide's header filter, the room's payload cap still bounds what a compressed stream inflates to", async ({
  page
}) => {
  await openChat(page, true);
  const compressed = bomb(64 * 1024 * 1024);
  const inflatedBy = (identity: string, inline: boolean) =>
    page.evaluate(
      async ({ identity, compressed, inline, maximumImageBytes }) => {
        const w = window as unknown as TestWindow;
        // As if a livekit-client upgrade had moved the entry point tide wraps.
        const manager = w.__tideRoom.incomingDataStreamManager as Partial<{
          handleDataStreamPacket: unknown;
        }>;
        delete manager.handleDataStreamPacket;
        w.__inflated = 0;
        w.__push(
          { identity, mimeType: 'image/webp', size: maximumImageBytes, compression: 1, inline },
          w.__bytes(compressed)
        );
        let last = -1;
        while (last !== w.__inflated) {
          last = w.__inflated;
          await new Promise((resolve) => setTimeout(resolve, 500));
        }
        return w.__inflated;
      },
      { identity, compressed, inline, maximumImageBytes }
    );
  const chunked = await inflatedBy('guest:bomb-1', false);
  const inline = await inflatedBy('guest:bomb-2', true);
  // A little past the cap: livekit-client stops at the first piece over it.
  for (const inflated of [chunked, inline]) {
    expect(inflated).toBeGreaterThan(0);
    expect(inflated).toBeLessThanOrEqual(maximumImageBytes + 1024 * 1024);
  }
  await expect(chat(page).locator('.picture img')).toHaveCount(0);
});

// What tide sends is a still WebP or JPEG no more than 2048 px on its long
// side. Anything else came from a modified client: a GIF or animated WebP
// keeps decoding frames for everyone while it is on screen, and the PNG and
// GIF decoders are attack surface tide has no need to expose.
test('a remote image tide could not have sent is dropped: PNG, GIF, animated WebP, past 2048 px', async ({
  page
}) => {
  await openChat(page, true);
  const refused = ['guest:png', 'guest:gif', 'guest:animated', 'guest:wide', 'guest:tall'];
  await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const gif = w.__bytes('R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==');
    const streams: [string, string, Uint8Array][] = [
      ['guest:png', 'image/png', await w.__webp(64, 64, 'image/png')],
      ['guest:gif', 'image/gif', gif],
      ['guest:animated', 'image/webp', await w.__animatedWebp()],
      ['guest:wide', 'image/webp', await w.__webp(2049, 64)],
      ['guest:tall', 'image/jpeg', await w.__webp(64, 2049, 'image/jpeg')]
    ];
    for (const [identity, mimeType, bytes] of streams) {
      w.__push({ identity, mimeType }, bytes);
      await new Promise((resolve) => setTimeout(resolve, 300));
    }
  });
  // The limits themselves are fine to send: a 2048 px strip arrives, in a
  // box tall enough to see and to click.
  await pushWebp(page, { identity: 'guest:mallory' }, 2048, 8);
  await expect(chat(page).locator('.picture img')).toHaveCount(1);
  const box = await chat(page).locator('.picture').boundingBox();
  expect(box!.width).toBeCloseTo(260, 0);
  expect(box!.height).toBeGreaterThanOrEqual(48);
  for (const identity of refused) {
    await expect(chat(page).getByText(`Some images from ${identity} weren't shown`)).toHaveCount(1);
  }
});

// One guest looping images would otherwise fill every receiver's memory and
// sound the new-message chime with each.
test('images a sender sends faster than tide does are dropped, with one quiet line and one sound', async ({
  page
}) => {
  await openChat(page, true);
  const gains = () => page.evaluate(() => (window as unknown as TestWindow).__gains);
  const before = await gains();
  await sendText(page, 'hello');
  await expect(chat(page).getByText('hello')).toBeVisible();
  await page.waitForTimeout(300);
  const perSound = (await gains()) - before;
  expect(perSound).toBeGreaterThan(0);

  const start = await gains();
  for (let index = 0; index < 5; index++) {
    await pushWebp(page, { identity: 'guest:mallory' });
    await page.waitForTimeout(150);
  }
  await expect(chat(page).locator('.picture img')).toHaveCount(1);
  await expect(chat(page).getByText("Some images from Mallory Guest weren't shown")).toHaveCount(1);
  await page.waitForTimeout(300);
  expect((await gains()) - start).toBe(perSound);

  // The limit is the sender's alone.
  await pushWebp(page, { identity: 'guest:other' });
  await expect(chat(page).locator('.picture img')).toHaveCount(2);

  // Past its limit of streams a minute, even a good image from a sender is dropped unread.
  await page.evaluate(() => {
    const w = window as unknown as TestWindow;
    const junk = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    for (let index = 0; index < 20; index++) {
      w.__push({ identity: 'guest:spammer', mimeType: 'image/svg+xml' }, junk);
    }
  });
  await pushWebp(page, { identity: 'guest:spammer' });
  await page.waitForTimeout(500);
  await expect(chat(page).locator('.picture img')).toHaveCount(2);
  await expect(chat(page).getByText("Some images from guest:spammer weren't shown")).toHaveCount(1);
});

test('past 40 MB of images, the oldest give their memory back and say they are no longer available', async ({
  page
}) => {
  test.setTimeout(120_000);
  await openChat(page, true);
  const size = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    w.__large = await w.__largeWebp();
    return w.__large.length;
  });
  expect(size).toBeGreaterThan(1024 * 1024);
  const kept = Math.floor((40 * 1024 * 1024) / size);
  const shown: string[] = [];
  for (let index = 0; index < kept + 3; index++) {
    await page.evaluate((index) => {
      const w = window as unknown as TestWindow;
      w.__push({ identity: `guest:p${index}`, mimeType: 'image/webp' }, w.__large!);
    }, index);
    await expect(chat(page).locator('.picture')).toHaveCount(index + 1);
    shown.push((await chat(page).locator('.picture img').last().getAttribute('src'))!);
  }

  await expect(chat(page).getByText('Image no longer available')).toHaveCount(3);
  await expect(chat(page).locator('.picture img')).toHaveCount(kept);
  const revoked = await page.evaluate(() => (window as unknown as TestWindow).__revoked);
  expect(revoked).toEqual(shown.slice(0, 3));
  // The log keeps its shape where an image was.
  const box = await chat(page).locator('.picture').first().boundingBox();
  expect(box!.width).toBeCloseTo(260, 0);
  expect(box!.height).toBeCloseTo(260, 0);
});

// Two guards reach into livekit-client: the readable stream under a
// ByteStreamReader (discarding a stream) and the room's packet entry point
// (refusing compressed images). An upgrade that moves either must fail here,
// not quietly let a stream queue without limit.
test("tide's reaches into livekit-client internals still find what they need", async ({ page }) => {
  const warnings: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'warning') warnings.push(message.text());
  });
  await openChat(page, true);
  const found = await page.evaluate(async () => {
    const w = window as unknown as TestWindow;
    const manager = w.__tideRoom.incomingDataStreamManager;
    // Declares 100 bytes, then keeps sending: livekit-client's reader throws,
    // and only reading the stream under it keeps what follows from queueing.
    const streamId = w.__push(
      { identity: 'guest:liar', mimeType: 'image/webp', size: 100, end: false },
      new Uint8Array(30_000)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    w.__push(
      { identity: 'guest:liar', mimeType: 'image/webp', streamId, firstChunk: 2, end: false },
      new Uint8Array(40 * 15_000)
    );
    await new Promise((resolve) => setTimeout(resolve, 200));
    return {
      queueRoom: manager.byteStreamControllers.get(streamId)!.controller.desiredSize,
      filtering: Object.hasOwn(manager, 'handleDataStreamPacket')
    };
  });
  expect(found.queueRoom).toBeGreaterThanOrEqual(0);
  expect(found.filtering).toBe(true);
  expect(warnings.filter((text) => text.includes('[tide] livekit-client'))).toEqual([]);

  // And when the reader's stream is gone, it says so, once.
  const said = await page.evaluate(async () => {
    const path = '/src/lib/chat/imageReceiver.ts';
    const { ChatImageReceiver } = (await import(/* @vite-ignore */ path)) as {
      ChatImageReceiver: new (
        deliver: () => void,
        dropped: () => void
      ) => { handle(reader: unknown, sender: { identity: string }): void };
    };
    const seen: string[] = [];
    const warn = console.warn;
    console.warn = (...args: unknown[]) => seen.push(String(args[0]));
    const receiver = new ChatImageReceiver(
      () => undefined,
      () => undefined
    );
    const moved = () => ({
      info: { size: 10, mimeType: 'image/svg+xml' },
      async *[Symbol.asyncIterator]() {}
    });
    receiver.handle(moved(), { identity: 'guest:a' });
    receiver.handle(moved(), { identity: 'guest:b' });
    await new Promise((resolve) => setTimeout(resolve, 50));
    console.warn = warn;
    return seen;
  });
  expect(said).toEqual([expect.stringContaining('ByteStreamReader.reader')]);
});
