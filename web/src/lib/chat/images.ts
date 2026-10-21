// Chat images (TIDE_CHAT_IMAGES): what may be sent, how a picked image is
// made safe to send, and how a received one is checked before it is shown.

export const chatImageTopic = 'chat-image';
/** The most an image may be, sent or received. */
export const maximumImageBytes = 2 * 1024 * 1024;
/** A source larger than this is refused before it is decoded. */
export const maximumSourcePixels = 40_000_000;
/** Sent images are scaled so their long side is at most this; a received one past it is dropped. */
export const maximumLongSide = 2048;
/** One image per sender this often: the sender waits, and a receiver drops what comes sooner. */
export const imageSpacing = 5_000;

/** What may be picked to send; each is re-encoded as a SentImageType first. */
export const imageTypes = ['image/png', 'image/jpeg', 'image/webp', 'image/gif'] as const;
export type ImageType = (typeof imageTypes)[number];
/** What tide sends, and so all that a receiver accepts. */
export const sentImageTypes = ['image/webp', 'image/jpeg'] as const;
export type SentImageType = (typeof sentImageTypes)[number];

export interface ShownImage {
  kind: 'image';
  /** Empty once its memory has been given back. */
  url: string;
  width: number;
  height: number;
  mimeType: SentImageType;
  size: number;
}

/** Stands in the log for images a receiver dropped. */
export interface WithheldImages {
  kind: 'withheld';
}

export type ChatImage = ShownImage | WithheldImages;

export interface PreparedImage {
  blob: Blob;
  bytes: Uint8Array;
  mimeType: SentImageType;
  width: number;
  height: number;
}

/** A refusal whose message is fit to show the person who picked the image. */
export class ChatImageError extends Error {}

export function isSentImageType(value: string): value is SentImageType {
  return (sentImageTypes as readonly string[]).includes(value);
}

/** The type the bytes really are, from their magic number; a declared type is never trusted. */
export function sniffImageType(bytes: Uint8Array): ImageType | undefined {
  const starts = (offset: number, ...expected: number[]) =>
    expected.every((value, index) => bytes[offset + index] === value);
  const ascii = (offset: number, text: string) =>
    starts(offset, ...Array.from(text, (char) => char.charCodeAt(0)));
  if (starts(0, 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) return 'image/png';
  if (starts(0, 0xff, 0xd8, 0xff)) return 'image/jpeg';
  if (ascii(0, 'GIF87a') || ascii(0, 'GIF89a')) return 'image/gif';
  if (ascii(0, 'RIFF') && ascii(8, 'WEBP')) return 'image/webp';
  return undefined;
}

/**
 * The pixel size an image's header declares, read without decoding it, so a
 * small file that would decode to gigabytes is refused before it can.
 * Undefined when the header can't be read.
 */
export function headerDimensions(
  bytes: Uint8Array,
  type: ImageType
): { width: number; height: number } | undefined {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const fits = (end: number) => end <= bytes.length;
  const ascii = (offset: number, text: string) =>
    fits(offset + text.length) &&
    Array.from(text).every((char, index) => bytes[offset + index] === char.charCodeAt(0));
  switch (type) {
    case 'image/png':
      if (!ascii(12, 'IHDR') || !fits(24)) return undefined;
      return { width: view.getUint32(16), height: view.getUint32(20) };
    case 'image/gif':
      return gifDimensions(bytes, view);
    case 'image/webp':
      if (ascii(12, 'VP8X') && fits(30)) {
        const u24 = (offset: number) =>
          bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16);
        return { width: u24(24) + 1, height: u24(27) + 1 };
      }
      if (ascii(12, 'VP8L') && fits(25) && bytes[20] === 0x2f) {
        const bits = view.getUint32(21, true);
        return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
      }
      if (ascii(12, 'VP8 ') && fits(30) && bytes[23] === 0x9d && bytes[24] === 0x01) {
        return {
          width: view.getUint16(26, true) & 0x3fff,
          height: view.getUint16(28, true) & 0x3fff
        };
      }
      return undefined;
    case 'image/jpeg':
      return jpegDimensions(bytes, view);
  }
}

// The decoder sizes a GIF by its logical screen, but a frame may reach past
// it, so the first frame's extent counts too.
function gifDimensions(
  bytes: Uint8Array,
  view: DataView
): { width: number; height: number } | undefined {
  if (bytes.length < 13) return undefined;
  let width = view.getUint16(6, true);
  let height = view.getUint16(8, true);
  const packed = bytes[10];
  let offset = 13 + (packed & 0x80 ? 3 * 2 ** ((packed & 0x07) + 1) : 0);
  while (offset < bytes.length) {
    const block = bytes[offset];
    if (block === 0x2c) {
      if (offset + 9 > bytes.length) return undefined;
      width = Math.max(width, view.getUint16(offset + 1, true) + view.getUint16(offset + 5, true));
      height = Math.max(
        height,
        view.getUint16(offset + 3, true) + view.getUint16(offset + 7, true)
      );
      return { width, height };
    }
    if (block !== 0x21) return undefined;
    offset += 2;
    while (offset < bytes.length && bytes[offset] !== 0) offset += bytes[offset] + 1;
    offset += 1;
  }
  return undefined;
}

function jpegDimensions(
  bytes: Uint8Array,
  view: DataView
): { width: number; height: number } | undefined {
  let offset = 2;
  while (offset + 4 <= bytes.length) {
    if (bytes[offset] !== 0xff) return undefined;
    const marker = bytes[offset + 1];
    if (marker === 0xff) {
      offset += 1;
      continue;
    }
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd8)) {
      offset += 2;
      continue;
    }
    if (marker === 0xd9 || marker === 0xda) return undefined;
    const length = view.getUint16(offset + 2);
    const frame =
      marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (frame) {
      if (offset + 9 > bytes.length) return undefined;
      return { width: view.getUint16(offset + 7), height: view.getUint16(offset + 5) };
    }
    offset += 2 + length;
  }
  return undefined;
}

/**
 * Turns a picked, pasted or dropped file into an image fit to send: its real
 * type checked, decoded, and drawn afresh, which leaves behind its metadata
 * (EXIF, GPS position) and every frame after an animated GIF's first.
 * Throws ChatImageError when it can't.
 */
export async function prepareImage(file: Blob): Promise<PreparedImage> {
  const head = new Uint8Array(await file.slice(0, 512 * 1024).arrayBuffer());
  const type = sniffImageType(head);
  if (!type) {
    const svg =
      file.type === 'image/svg+xml' ||
      /^\s*(<\?xml|<svg|<!doctype svg)/i.test(new TextDecoder().decode(head.slice(0, 256)));
    throw new ChatImageError(
      svg
        ? "SVG images can't be sent. Use PNG, JPEG, WebP or GIF."
        : 'Only PNG, JPEG, WebP and GIF images can be sent.'
    );
  }
  const declared = headerDimensions(head, type);
  if (!declared) throw new ChatImageError("That image couldn't be read.");
  if (declared.width * declared.height > maximumSourcePixels) {
    throw new ChatImageError('That image is over 40 megapixels. Send a smaller one.');
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ChatImageError("That image couldn't be read.");
  }
  try {
    if (bitmap.width * bitmap.height > maximumSourcePixels) {
      throw new ChatImageError('That image is over 40 megapixels. Send a smaller one.');
    }
    return await reencode(bitmap);
  } finally {
    bitmap.close();
  }
}

async function reencode(bitmap: ImageBitmap): Promise<PreparedImage> {
  let scale = Math.min(1, maximumLongSide / Math.max(bitmap.width, bitmap.height));
  let quality = 0.82;
  let type: 'image/webp' | 'image/jpeg' = 'image/webp';
  for (let attempt = 0; attempt < 10; attempt++) {
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    let blob = await draw(bitmap, width, height, type, quality);
    // Safari has no WebP encoder and quietly answers with PNG.
    if (blob.type !== type && type === 'image/webp') {
      type = 'image/jpeg';
      blob = await draw(bitmap, width, height, type, quality);
    }
    if (blob.type !== type) throw new ChatImageError("This browser can't prepare images to send.");
    if (blob.size <= maximumImageBytes) {
      const bytes = new Uint8Array(await blob.arrayBuffer());
      if (sniffImageType(bytes) !== type) {
        throw new ChatImageError("This browser can't prepare images to send.");
      }
      return { blob, bytes, mimeType: type, width, height };
    }
    if (quality > 0.6) quality -= 0.1;
    else scale *= 0.75;
  }
  throw new ChatImageError("That image couldn't be made small enough to send.");
}

async function draw(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality: number
): Promise<Blob> {
  const offscreen = typeof OffscreenCanvas !== 'undefined';
  const canvas = offscreen
    ? new OffscreenCanvas(width, height)
    : Object.assign(document.createElement('canvas'), { width, height });
  const context = canvas.getContext('2d') as
    OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!context) throw new ChatImageError("This browser can't prepare images to send.");
  // JPEG has no transparency: without a backdrop it would turn black.
  if (type === 'image/jpeg') {
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, width, height);
  }
  context.imageSmoothingQuality = 'high';
  context.drawImage(bitmap, 0, 0, width, height);
  if (canvas instanceof HTMLCanvasElement) {
    return new Promise((resolve, reject) =>
      canvas.toBlob(
        (blob) =>
          blob ? resolve(blob) : reject(new ChatImageError("That image couldn't be read.")),
        type,
        quality
      )
    );
  }
  return canvas.convertToBlob({ type, quality });
}

/**
 * Whether received bytes are an image tide could have sent: the magic number
 * must match the declared type, the header's size must fit before anything
 * decodes it, a WebP must be a still, and the browser must decode it.
 */
export async function checkReceivedImage(
  bytes: Uint8Array<ArrayBuffer>,
  declaredType: SentImageType
): Promise<{ blob: Blob; width: number; height: number } | undefined> {
  if (bytes.length === 0 || bytes.length > maximumImageBytes) return undefined;
  if (sniffImageType(bytes) !== declaredType) return undefined;
  const declared = headerDimensions(bytes, declaredType);
  if (
    !declared ||
    declared.width < 1 ||
    declared.height < 1 ||
    declared.width > maximumLongSide ||
    declared.height > maximumLongSide
  ) {
    return undefined;
  }
  // An <img> plays every frame of an animated WebP, though the check below decodes only the first.
  if (declaredType === 'image/webp' && isAnimatedWebp(bytes)) return undefined;
  const blob = new Blob([bytes], { type: declaredType });
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(blob);
  } catch {
    return undefined;
  }
  const { width, height } = bitmap;
  bitmap.close();
  if (width > maximumLongSide || height > maximumLongSide) return undefined;
  return { blob, width, height };
}

// Only the extended (VP8X) format can animate; its flags byte says whether it does.
function isAnimatedWebp(bytes: Uint8Array): boolean {
  const vp8x = [0x56, 0x50, 0x38, 0x58].every((value, index) => bytes[12 + index] === value);
  return vp8x && (bytes[20] & 0x02) !== 0;
}

const extensions: Record<ImageType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif'
};

/** `tide-<sender>-<HHMM>.<ext>`, with the sender reduced to characters safe in any file system. */
export function downloadName(sender: string, ts: number, type: ImageType): string {
  const who =
    sender
      .normalize('NFKD')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 40)
      .replace(/-+$/, '') || 'guest';
  const time = new Date(ts);
  const hhmm = [time.getHours(), time.getMinutes()]
    .map((part) => String(part).padStart(2, '0'))
    .join('');
  return `tide-${who}-${hhmm}.${extensions[type]}`;
}

/** What a notification or peek says of a message: an image message has no text. */
export function chatMessagePreview(message: {
  from: string;
  text: string;
  image?: ChatImage;
}): string {
  if (message.image?.kind === 'withheld') return withheldNotice(message.from);
  return message.image ? `${message.from} sent an image` : message.text;
}

export function withheldNotice(from: string): string {
  return `Some images from ${from} weren't shown`;
}
