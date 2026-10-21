import type { Room } from 'livekit-client';
import type { ChatMessage } from '#lib/rtc/room.svelte.js';
import { ChatImageReceiver, refuseCompressedImages, type ReceivedImage } from './imageReceiver';
import {
  ChatImageError,
  chatImageTopic,
  imageSpacing,
  prepareImage,
  type SentImageType,
  type ShownImage
} from './images';

/** Past this, the oldest images give back their memory and show as no longer available. */
const maximumRetainedBytes = 40 * 1024 * 1024;
/** At most one "weren't shown" line per sender this often. */
const noticeInterval = 60_000;

class HeldImage implements ShownImage {
  readonly kind = 'image';
  url = $state('');

  constructor(
    url: string,
    readonly width: number,
    readonly height: number,
    readonly mimeType: SentImageType,
    readonly size: number
  ) {
    this.url = url;
  }
}

/**
 * Images in a meeting's chat, behind TIDE_CHAT_IMAGES. Every object URL a
 * message shows is made and revoked here: when the message falls out of the
 * chat (release), when the images held pass maximumRetainedBytes, and when
 * the session ends (stop).
 */
export class ChatImages {
  /** The deployment's switch, from the room's public info; set before connecting. */
  enabled = $state(false);
  sending = $state(false);
  /** 0–1 while the bytes go out; undefined while the image is prepared. */
  progress = $state<number>();
  error = $state('');

  private readonly held: HeldImage[] = [];
  private retained = 0;
  private readonly noticed = new Map<string, number>();
  private lastSent = -Infinity;
  private readonly receiver = new ChatImageReceiver(
    (image) => this.received(image),
    (identity) => this.withheld(identity)
  );
  private registered = false;
  private session = 0;

  constructor(
    private readonly room: Room,
    /** A quiet message plays no sound and counts as nothing new. */
    private readonly append: (message: ChatMessage, quiet?: boolean) => void
  ) {
    refuseCompressedImages(room);
  }

  /**
   * Starts a session. Off, no handler is registered, and livekit-client then
   * ignores incoming image streams without buffering them.
   */
  start(): void {
    this.stop();
    if (!this.enabled) return;
    this.room.registerByteStreamHandler(chatImageTopic, this.receiver.handle);
    this.registered = true;
  }

  /** Ends the session: nothing more arrives, and every image URL is revoked. */
  stop(): void {
    this.session += 1;
    if (this.registered) this.room.unregisterByteStreamHandler(chatImageTopic);
    this.registered = false;
    this.receiver.reset();
    while (this.held.length > 0) this.forget(this.held[0]);
    this.noticed.clear();
    this.sending = false;
    this.progress = undefined;
    this.error = '';
  }

  /** A message leaving the chat gives back its image's memory. */
  release(message: ChatMessage): void {
    if (message.image instanceof HeldImage) this.forget(message.image);
  }

  async send(file: Blob): Promise<void> {
    if (!this.enabled || this.sending) return;
    const session = this.session;
    this.sending = true;
    this.progress = undefined;
    this.error = '';
    try {
      const prepared = await prepareImage(file);
      if (session !== this.session) return;
      // Receivers drop a sender's images that come closer together.
      const wait = this.lastSent + imageSpacing - performance.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      if (session !== this.session) return;
      this.lastSent = performance.now();
      this.progress = 0;
      await this.room.localParticipant.sendBytes(prepared.bytes, {
        topic: chatImageTopic,
        mimeType: prepared.mimeType,
        name: 'image',
        attributes: { width: String(prepared.width), height: String(prepared.height) },
        // WebP and JPEG are compressed already.
        compress: false,
        onProgress: (progress) => {
          if (session === this.session) this.progress = progress;
        }
      });
      if (session !== this.session) return;
      const local = this.room.localParticipant;
      this.append({
        from: local.name || local.identity,
        identity: local.identity,
        text: '',
        ts: Date.now(),
        mine: true,
        image: this.track(prepared.blob, prepared)
      });
    } catch (cause) {
      if (session !== this.session) return;
      this.error = cause instanceof ChatImageError ? cause.message : 'Image not sent. Try again.';
    } finally {
      if (session === this.session) {
        this.sending = false;
        this.progress = undefined;
      }
    }
  }

  private received(image: ReceivedImage): void {
    this.append({
      from: this.nameOf(image.identity),
      identity: image.identity,
      text: '',
      ts: Date.now(),
      mine: image.identity === this.room.localParticipant.identity,
      image: this.track(image.blob, image)
    });
  }

  private withheld(identity: string): void {
    const now = performance.now();
    if (now - (this.noticed.get(identity) ?? -Infinity) < noticeInterval) return;
    this.noticed.set(identity, now);
    this.append(
      {
        from: this.nameOf(identity),
        identity,
        text: '',
        ts: Date.now(),
        mine: false,
        image: { kind: 'withheld' }
      },
      true
    );
  }

  private nameOf(identity: string): string {
    return this.room.getParticipantByIdentity(identity)?.name || identity || 'Guest';
  }

  private track(blob: Blob, image: Pick<ShownImage, 'width' | 'height' | 'mimeType'>): HeldImage {
    const held = new HeldImage(
      URL.createObjectURL(blob),
      image.width,
      image.height,
      image.mimeType,
      blob.size
    );
    this.held.push(held);
    this.retained += held.size;
    while (this.retained > maximumRetainedBytes) this.forget(this.held[0]);
    return held;
  }

  private forget(image: HeldImage): void {
    const index = this.held.indexOf(image);
    if (index < 0) return;
    this.held.splice(index, 1);
    this.retained -= image.size;
    URL.revokeObjectURL(image.url);
    image.url = '';
  }
}
