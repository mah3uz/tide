<script lang="ts">
  import { chatMessagePreview } from '#lib/chat/images.js';
  import type { ChatMessage } from '#lib/rtc/room.svelte.js';
  import { isGuest } from './participantColor.js';

  let { message, onopen }: { message: ChatMessage; onopen: () => void } = $props();

  // A guest's bidi overrides would otherwise reverse what the preview shows,
  // e.g. a file name ending in "gnp.exe" read as "exe.png".
  const bidiControls = /[؜‎‏‪-‮⁦-⁩]/g;
  const plain = (text: string) => text.replace(bidiControls, '');

  // One line, as plain text: the chat sheet is where a message is read.
  const line = $derived.by(() => {
    const lines = plain(chatMessagePreview(message)).trim().split('\n');
    return lines.length > 1 ? `${lines[0]}…` : lines[0];
  });
</script>

<button type="button" class="peek" title="Open chat" data-testid="chat-peek" onclick={onopen}>
  {#if isGuest(message.identity)}<span class="guest-tag">Guest</span>{/if}
  <!-- An image's preview already names who sent it. -->
  {#if !message.image}<span class="from">{plain(message.from)}:</span>{/if}
  <span class="line">{line}</span>
</button>

<style>
  .peek {
    display: flex;
    max-width: min(420px, calc(100vw - 32px));
    min-width: 0;
    padding: 8px 16px;
    align-items: baseline;
    gap: 6px;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 20px;
    white-space: nowrap;
    pointer-events: auto;
    background: var(--surface);
    border: 0;
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-float);
    animation: peek-in var(--dur-2) var(--ease-out);
  }

  .peek:hover {
    color: var(--ink);
  }

  .from,
  .line {
    unicode-bidi: isolate;
  }

  .from {
    flex: none;
    color: var(--ink);
    font-weight: 600;
  }

  .guest-tag {
    flex: none;
    align-self: center;
    padding: 0 6px;
    color: var(--ink-2);
    font-size: 11px;
    line-height: 16px;
    font-weight: 500;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
  }

  .line {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes peek-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
