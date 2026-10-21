import type { Room } from 'livekit-client';
import type { ChatMessage } from '#lib/rtc/room.svelte.js';
import { ChatImageReceiver, type ReceivedImage } from './imageReceiver';
import { ChatImageError, chatImageTopic, prepareImage, type ChatImage } from './images';

/**
 * Images in a meeting's chat, behind TIDE_CHAT_IMAGES. Every object URL a
 * message shows is made and revoked here: when the message falls out of the
 * chat (release), and when the session ends (stop).
 */
export class ChatImages {
  /** The deployment's switch, from the room's public info; set before connecting. */
  enabled = $state(false);
  sending = $state(false);
  /** 0–1 while the bytes go out; undefined while the image is prepared. */
  progress = $state<number>();
  error = $state('');

  private readonly urls = new Set<string>();
  private readonly receiver = new ChatImageReceiver((image) => this.received(image));
  private registered = false;
  private session = 0;

  constructor(
    private readonly room: Room,
    private readonly append: (message: ChatMessage) => void
  ) {}

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
    for (const url of this.urls) URL.revokeObjectURL(url);
    this.urls.clear();
    this.sending = false;
    this.progress = undefined;
    this.error = '';
  }

  /** A message leaving the chat gives back its image's memory. */
  release(message: ChatMessage): void {
    if (!message.image || !this.urls.delete(message.image.url)) return;
    URL.revokeObjectURL(message.image.url);
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
    const sender = this.room.getParticipantByIdentity(image.identity);
    this.append({
      from: sender?.name || image.identity || 'Guest',
      identity: image.identity,
      text: '',
      ts: Date.now(),
      mine: image.identity === this.room.localParticipant.identity,
      image: this.track(image.blob, image)
    });
  }

  private track(blob: Blob, image: Pick<ChatImage, 'width' | 'height' | 'mimeType'>): ChatImage {
    const url = URL.createObjectURL(blob);
    this.urls.add(url);
    return {
      url,
      width: image.width,
      height: image.height,
      mimeType: image.mimeType,
      size: blob.size
    };
  }
}
