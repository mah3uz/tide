import type { ByteStreamReader, Room } from 'livekit-client';
import {
  chatImageTopic,
  checkReceivedImage,
  imageSpacing,
  isSentImageType,
  maximumImageBytes,
  type SentImageType
} from './images';

// Images read at once, from one sender and in all; streams past either limit
// are discarded unread.
const maximumPerSender = 1;
const maximumInFlight = 3;
/** A sender that trickles holds a slot no longer than this. */
const receiveTimeout = 60_000;
// A second under the sender's own spacing, so network jitter can't drop an
// honest image.
const minimumInterval = imageSpacing - 1_000;
/** Streams of any kind one sender may open in a minute. */
const maximumStreamsPerMinute = 20;
const uncompressed = 0;

export interface ReceivedImage {
  /** Who sent it, as the media server says: the only attribution trusted. */
  identity: string;
  blob: Blob;
  mimeType: SentImageType;
  width: number;
  height: number;
}

/**
 * Reads incoming `chat-image` byte streams into checked images. Everything
 * about a stream except the sender's identity comes from the sender, so the
 * declared size and type only decide whether to read it at all, and the
 * bytes are counted, and checked, as they are.
 */
export class ChatImageReceiver {
  private readonly perSender = new Map<string, number>();
  private readonly lastImage = new Map<string, number>();
  private readonly opened = new Map<string, number[]>();
  private inFlight = 0;
  private generation = 0;

  constructor(
    private readonly deliver: (image: ReceivedImage) => void,
    /** A stream from this sender was not shown. */
    private readonly dropped: (identity: string) => void
  ) {}

  /** The handler for Room.registerByteStreamHandler. */
  readonly handle = (reader: ByteStreamReader, sender: { identity: string }): void => {
    void this.receive(reader, sender.identity).catch(() => undefined);
  };

  /** Forgets every stream being read; none of them will be delivered. */
  reset(): void {
    this.generation += 1;
    this.perSender.clear();
    this.lastImage.clear();
    this.opened.clear();
    this.inFlight = 0;
  }

  private async receive(reader: ByteStreamReader, identity: string): Promise<void> {
    const now = performance.now();
    const { size, mimeType } = reader.info;
    if (
      !this.open(identity, now) ||
      typeof size !== 'number' ||
      size <= 0 ||
      size > maximumImageBytes ||
      !isSentImageType(mimeType) ||
      (this.perSender.get(identity) ?? 0) >= maximumPerSender ||
      this.inFlight >= maximumInFlight ||
      now - (this.lastImage.get(identity) ?? -Infinity) < minimumInterval
    ) {
      discard(reader);
      this.dropped(identity);
      return;
    }
    this.lastImage.set(identity, now);
    const generation = this.generation;
    const current = () => generation === this.generation;
    const release = this.take(identity);
    let delivered = false;
    try {
      const bytes = await read(reader, size);
      const checked = bytes && current() ? await checkReceivedImage(bytes, mimeType) : undefined;
      if (checked && current()) {
        this.deliver({ identity, mimeType, ...checked });
        delivered = true;
      }
    } finally {
      release();
      if (!delivered && current()) this.dropped(identity);
    }
  }

  /** Counts a stream against its sender's limit per minute; false past it. */
  private open(identity: string, now: number): boolean {
    const recent = (this.opened.get(identity) ?? []).filter((at) => now - at < 60_000);
    const allowed = recent.length < maximumStreamsPerMinute;
    if (allowed) recent.push(now);
    this.opened.set(identity, recent);
    return allowed;
  }

  private take(identity: string): () => void {
    const generation = this.generation;
    this.perSender.set(identity, (this.perSender.get(identity) ?? 0) + 1);
    this.inFlight += 1;
    let held = true;
    const release = () => {
      if (!held) return;
      held = false;
      if (generation !== this.generation) return;
      this.inFlight -= 1;
      const left = (this.perSender.get(identity) ?? 1) - 1;
      if (left > 0) this.perSender.set(identity, left);
      else this.perSender.delete(identity);
    };
    return release;
  }
}

/** The stream's bytes when exactly `size` arrive in time; otherwise it is discarded. */
async function read(
  reader: ByteStreamReader,
  size: number
): Promise<Uint8Array<ArrayBuffer> | undefined> {
  const timeout = new AbortController();
  const timer = setTimeout(() => timeout.abort(), receiveTimeout);
  const bytes = new Uint8Array(size);
  let received = 0;
  let failed = false;
  try {
    for await (const chunk of reader.withAbortSignal(timeout.signal)) {
      if (received + chunk.byteLength > size) {
        failed = true;
        break;
      }
      bytes.set(chunk, received);
      received += chunk.byteLength;
    }
  } catch {
    failed = true;
  } finally {
    clearTimeout(timer);
  }
  if (!failed && received === size) return bytes;
  discard(reader);
  return undefined;
}

const warned = new Set<string>();
function internalsChanged(what: string): void {
  if (warned.has(what)) return;
  warned.add(what);
  console.warn(
    `[tide] livekit-client no longer has ${what}; chat images are less well guarded (see imageReceiver.ts).`
  );
}

// A stream nobody reads keeps queueing what its sender sends, and once
// livekit-client's reader has thrown (more bytes than declared) it throws on
// every later chunk. Cancelling isn't an option: livekit-client enqueues each
// later chunk anyway, and that throws out of its data-channel handler. So the
// readable stream under the reader, not public API in livekit-client 2.22, is
// read to the end, freeing each chunk. Compressed streams never reach this
// (refuseCompressedImages), so nothing read here is inflated.
function discard(reader: ByteStreamReader): void {
  const stream = (reader as unknown as { reader?: unknown }).reader;
  if (!(stream instanceof ReadableStream)) {
    internalsChanged('ByteStreamReader.reader');
    void (async () => {
      try {
        for await (const _chunk of reader) {
          // Discarded as it arrives.
        }
      } catch {
        // Its reader has thrown; what follows queues unread.
      }
    })();
    return;
  }
  if (stream.locked) return;
  const underlying = stream.getReader();
  void (async () => {
    try {
      while (!(await underlying.read()).done) {
        // Discarded as it arrives.
      }
    } catch {
      // An errored stream holds nothing.
    }
  })();
}

interface StreamPacket {
  value?: { case?: string; value?: { topic?: string; compression?: number } };
}

/**
 * Drops compressed `chat-image` streams at their header. tide never
 * compresses an image, and livekit-client inflates each compressed packet
 * whole, before any handler sees it, so a small packet could otherwise
 * become megabytes on every receiver. The packet entry point is not public
 * API in livekit-client 2.22; without it the room's payload cap still bounds
 * what one stream may inflate to.
 */
export function refuseCompressedImages(room: Room): void {
  const manager = (
    room as unknown as {
      incomingDataStreamManager?: {
        handleDataStreamPacket?: (packet: StreamPacket, encryptionType: unknown) => void;
      };
    }
  ).incomingDataStreamManager;
  const handle = manager?.handleDataStreamPacket;
  if (!manager || typeof handle !== 'function') {
    internalsChanged('Room.incomingDataStreamManager.handleDataStreamPacket');
    return;
  }
  manager.handleDataStreamPacket = (packet, encryptionType) => {
    const header = packet.value?.case === 'streamHeader' ? packet.value.value : undefined;
    if (header?.topic === chatImageTopic && header.compression !== uncompressed) return;
    handle.call(manager, packet, encryptionType);
  };
}
