import type { ByteStreamReader } from 'livekit-client';
import { checkReceivedImage, isImageType, maximumImageBytes, type ImageType } from './images';

// Images read at once, from one sender and in all; streams past either limit
// are drained unread.
const maximumPerSender = 1;
const maximumInFlight = 3;
/** A sender that trickles holds a slot no longer than this. */
const receiveTimeout = 60_000;

export interface ReceivedImage {
  /** Who sent it, as the media server says: the only attribution trusted. */
  identity: string;
  blob: Blob;
  mimeType: ImageType;
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
  private inFlight = 0;
  private generation = 0;

  constructor(private readonly deliver: (image: ReceivedImage) => void) {}

  /** The handler for Room.registerByteStreamHandler. */
  readonly handle = (reader: ByteStreamReader, sender: { identity: string }): void => {
    void this.receive(reader, sender.identity).catch(() => undefined);
  };

  /** Forgets every stream being read; none of them will be delivered. */
  reset(): void {
    this.generation += 1;
    this.perSender.clear();
    this.inFlight = 0;
  }

  private async receive(reader: ByteStreamReader, identity: string): Promise<void> {
    const { size, mimeType } = reader.info;
    if (
      typeof size !== 'number' ||
      size <= 0 ||
      size > maximumImageBytes ||
      !isImageType(mimeType) ||
      (this.perSender.get(identity) ?? 0) >= maximumPerSender ||
      this.inFlight >= maximumInFlight
    ) {
      await drain(reader);
      return;
    }
    const generation = this.generation;
    const current = () => generation === this.generation;
    const release = this.take(identity);
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    let wanted = true;
    const timer = setTimeout(() => {
      wanted = false;
      chunks.length = 0;
      release();
    }, receiveTimeout);
    try {
      // Read to the end even once the image is unwanted: a stream left
      // unread queues everything its sender sends in memory.
      for await (const chunk of reader) {
        if (!wanted) continue;
        received += chunk.byteLength;
        if (received > size || received > maximumImageBytes) {
          wanted = false;
          chunks.length = 0;
          release();
          continue;
        }
        chunks.push(chunk as Uint8Array<ArrayBuffer>);
      }
    } catch {
      wanted = false;
      drainUnderlying(reader);
    } finally {
      clearTimeout(timer);
    }
    try {
      if (!wanted || received !== size || !current()) return;
      const bytes = new Uint8Array(received);
      let offset = 0;
      for (const chunk of chunks) {
        bytes.set(chunk, offset);
        offset += chunk.byteLength;
      }
      chunks.length = 0;
      const checked = await checkReceivedImage(bytes, mimeType);
      if (!checked || !current()) return;
      this.deliver({ identity, mimeType, ...checked });
    } finally {
      release();
    }
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

async function drain(reader: ByteStreamReader): Promise<void> {
  try {
    for await (const _chunk of reader) {
      // Discarded as it arrives.
    }
  } catch {
    drainUnderlying(reader);
  }
}

// Once livekit-client's reader has thrown (a sender sending past the size it
// declared), it throws on every later chunk, yet its stream keeps queueing
// what arrives. Its readable stream is not public API, so this is a guarded
// reach into livekit-client 2.22: reading it to the end frees each chunk.
function drainUnderlying(reader: ByteStreamReader): void {
  const stream = (reader as unknown as { reader?: unknown }).reader;
  if (!(stream instanceof ReadableStream) || stream.locked) return;
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
