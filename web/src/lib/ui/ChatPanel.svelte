<script lang="ts">
  import { onMount, tick } from 'svelte';
  import { ArrowDown, ArrowRight, Paperclip, X } from 'phosphor-svelte';
  import { maximumChatLength, type ChatMessage, type RoomState } from '#lib/rtc/room.svelte.js';
  import { parseMessage, type Block } from '#lib/chat/markdown.js';
  import MessageText from '#lib/chat/MessageText.svelte';
  import ChatImage from '#lib/chat/ChatImage.svelte';
  import { imageTypes } from '#lib/chat/images.js';
  import { participantColor } from './participantColor.js';

  let { rtc, onclose }: { rtc: RoomState; onclose?: () => void } = $props();

  const groupWindow = 2 * 60_000;
  const nearBottomSlack = 48;
  const counterThreshold = maximumChatLength - 200;
  const maxComposerLines = 5;

  interface Group {
    first: ChatMessage;
    messages: ChatMessage[];
  }

  let draft = $state('');
  let error = $state('');
  let unseen = $state(0);
  let messageList: HTMLDivElement;
  let composer: HTMLTextAreaElement;
  let picker = $state<HTMLInputElement>();
  let dropping = $state(false);
  let seenRevision = 0;

  const parsed = new WeakMap<ChatMessage, Block[]>();
  function blocksOf(message: ChatMessage): Block[] {
    let blocks = parsed.get(message);
    if (!blocks) parsed.set(message, (blocks = parseMessage(message.text)));
    return blocks;
  }

  let groups = $derived.by(() => {
    const result: Group[] = [];
    let current: Group | undefined;
    let previous: ChatMessage | undefined;
    for (const message of rtc.chat) {
      const continues =
        current &&
        previous &&
        previous.mine === message.mine &&
        previous.identity === message.identity &&
        previous.from === message.from &&
        message.ts - previous.ts < groupWindow;
      if (continues) current!.messages.push(message);
      else result.push((current = { first: message, messages: [message] }));
      previous = message;
    }
    return result;
  });

  const clock = new Intl.DateTimeFormat(undefined, {
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  });
  const fullDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'full', timeStyle: 'short' });

  function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const letters = words.length > 1 ? [words[0], words.at(-1)!] : words;
    return (
      letters
        .map((word) => Array.from(word)[0] ?? '')
        .join('')
        .toUpperCase() || '?'
    );
  }

  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

  function enter(_node: Element) {
    return {
      duration: reducedMotion() ? 0 : 160,
      easing: (t: number) => 1 - (1 - t) ** 3,
      css: (t: number) => `opacity: ${t}; transform: translateY(${(1 - t) * 6}px)`
    };
  }

  function scrollToEnd(smooth = false): void {
    messageList?.scrollTo({
      top: messageList.scrollHeight,
      behavior: smooth && !reducedMotion() ? 'smooth' : 'auto'
    });
    unseen = 0;
  }

  function nearBottom(): boolean {
    return (
      messageList.scrollHeight - messageList.scrollTop - messageList.clientHeight < nearBottomSlack
    );
  }

  function onscroll(): void {
    if (nearBottom()) unseen = 0;
  }

  // Before the DOM update, so "near the bottom" is measured without the new message.
  $effect.pre(() => {
    const revision = rtc.chatRevision;
    const added = Math.min(Math.max(revision - seenRevision, 0), rtc.chat.length);
    seenRevision = revision;
    if (added === 0 || !messageList) return;
    const fresh = rtc.chat.slice(-added);
    if (nearBottom() || fresh.some((message) => message.mine)) {
      void tick().then(() => scrollToEnd());
    } else {
      unseen += fresh.length;
    }
  });

  $effect(() => {
    void draft;
    if (!composer) return;
    composer.style.height = 'auto';
    const style = getComputedStyle(composer);
    const lineHeight = parseFloat(style.lineHeight);
    const padding = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
    composer.style.height = `${Math.min(composer.scrollHeight, lineHeight * maxComposerLines + padding)}px`;
  });

  onMount(() => {
    seenRevision = rtc.chatRevision;
    scrollToEnd();
  });

  async function send(): Promise<void> {
    const text = draft.trim();
    if (!text) return;
    error = '';
    rtc.images.error = '';
    try {
      await rtc.sendChat(text);
      draft = '';
    } catch {
      error =
        text.length > maximumChatLength
          ? `Messages can be at most ${maximumChatLength} characters.`
          : 'Message not sent. Try again.';
    }
  }

  function keydown(event: KeyboardEvent): void {
    // keyCode 229 is the Enter that confirms an IME composition in Safari.
    if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) {
      return;
    }
    event.preventDefault();
    void send();
  }

  function attach(files: FileList | null | undefined): void {
    const file = files?.[0];
    if (!file || !rtc.images.enabled) return;
    error = '';
    void rtc.images.send(file);
  }

  function picked(): void {
    attach(picker?.files);
    if (picker) picker.value = '';
  }

  function paste(event: ClipboardEvent): void {
    const data = event.clipboardData;
    // Office apps copy text with a picture of it; the text is what was meant.
    if (!rtc.images.enabled || !data?.files.length || data.types.includes('text/plain')) return;
    event.preventDefault();
    attach(data.files);
  }

  const carriesFiles = (event: DragEvent) =>
    rtc.images.enabled && (event.dataTransfer?.types.includes('Files') ?? false);

  function dragover(event: DragEvent): void {
    if (!carriesFiles(event)) return;
    event.preventDefault();
    dropping = true;
  }

  function dragleave(event: DragEvent): void {
    const into = event.relatedTarget;
    if (!(into instanceof Node) || !(event.currentTarget as Node).contains(into)) dropping = false;
  }

  function drop(event: DragEvent): void {
    dropping = false;
    if (!carriesFiles(event)) return;
    event.preventDefault();
    attach(event.dataTransfer?.files);
  }

  function submit(event: SubmitEvent): void {
    event.preventDefault();
    void send();
  }
</script>

{#snippet bubble(message: ChatMessage)}
  {#if message.image}
    <div class="bubble picture-bubble" in:enter>
      <ChatImage image={message.image} from={message.from} ts={message.ts} />
    </div>
  {:else}
    <div class="bubble" in:enter><MessageText blocks={blocksOf(message)} /></div>
  {/if}
{/snippet}

<button class="scrim" type="button" tabindex="-1" aria-hidden="true" onclick={onclose}></button>

<aside
  class="chat-sheet"
  class:dropping
  aria-label="Chat"
  ondragenter={dragover}
  ondragover={dragover}
  ondragleave={dragleave}
  ondrop={drop}
>
  <span class="handle" aria-hidden="true"></span>
  <header>
    <div class="heading">
      <h2>Chat</h2>
      <p>Messages disappear when the meeting ends.</p>
    </div>
    {#if onclose}
      <button
        class="close"
        type="button"
        aria-label="Close chat"
        title="Close chat"
        onclick={onclose}
      >
        <X size={16} weight="regular" aria-hidden="true" />
      </button>
    {/if}
  </header>

  <div class="log">
    <div class="messages" bind:this={messageList} {onscroll} aria-live="polite">
      {#if rtc.chat.length === 0}
        <p class="empty">Messages appear here for this meeting only.</p>
      {:else}
        {#each groups as group (group.first)}
          {@const time = clock.format(group.first.ts)}
          {@const title = fullDate.format(group.first.ts)}
          {#if group.first.mine}
            <div class="group mine" in:enter>
              <span class="meta"
                ><time {title} datetime={new Date(group.first.ts).toISOString()}>You · {time}</time
                ></span
              >
              {#each group.messages as message (message)}
                {@render bubble(message)}
              {/each}
            </div>
          {:else}
            <div class="group" in:enter>
              <span
                class="disc"
                style:--disc-bg={`var(--p${participantColor(group.first.identity || group.first.from)}-bg)`}
                style:--disc-fg={`var(--p${participantColor(group.first.identity || group.first.from)}-fg)`}
                aria-hidden="true">{initials(group.first.from)}</span
              >
              <div class="stack">
                <span class="meta">
                  <span class="name">{group.first.from}</span>
                  <time {title} datetime={new Date(group.first.ts).toISOString()}>{time}</time>
                </span>
                {#each group.messages as message (message)}
                  {@render bubble(message)}
                {/each}
              </div>
            </div>
          {/if}
        {/each}
      {/if}
    </div>

    {#if unseen > 0}
      <button class="new-pill" type="button" onclick={() => scrollToEnd(true)}>
        {unseen} new {unseen === 1 ? 'message' : 'messages'}
        <ArrowDown size={16} weight="regular" aria-hidden="true" />
      </button>
    {/if}
  </div>

  <form onsubmit={submit}>
    <div class="composer" class:attaching={rtc.images.enabled}>
      {#if rtc.images.enabled}
        <button
          class="attach"
          type="button"
          aria-label="Attach image"
          title="Attach image"
          disabled={rtc.images.sending}
          onclick={() => picker?.click()}
        >
          <Paperclip size={16} weight="regular" aria-hidden="true" />
        </button>
        <input
          bind:this={picker}
          class="picker"
          type="file"
          accept={imageTypes.join(',')}
          tabindex="-1"
          aria-hidden="true"
          onchange={picked}
        />
      {/if}
      <textarea
        bind:this={composer}
        bind:value={draft}
        name="chat-message"
        aria-label="Chat message"
        autocomplete="off"
        rows="1"
        maxlength={maximumChatLength}
        placeholder="Message everyone"
        onkeydown={keydown}
        onpaste={paste}
      ></textarea>
      <button class="send" type="submit" disabled={!draft.trim()} aria-label="Send message">
        <ArrowRight size={16} weight="regular" aria-hidden="true" />
      </button>
    </div>
    {#if rtc.images.sending}
      <p class="status" role="status">
        {rtc.images.progress === undefined
          ? 'Preparing image…'
          : `Sending image… ${Math.round(rtc.images.progress * 100)}%`}
      </p>
    {/if}
    {#if error || rtc.images.error}
      <p class="error" role="alert">{error || rtc.images.error}</p>
    {/if}
    <div class="footer">
      <span class="hint">
        <span>**bold** *italic* `code` ```block```</span>
        <span>Shift+Enter for a new line</span>
        {#if rtc.images.enabled}<span>Paste or drop an image · GIFs send one frame</span>{/if}
      </span>
      {#if draft.length >= counterThreshold}
        <span class="counter" class:full={draft.length >= maximumChatLength}>
          {draft.length} / {maximumChatLength}
        </span>
      {/if}
    </div>
  </form>
</aside>

<style>
  .chat-sheet {
    position: fixed;
    z-index: 25;
    top: 16px;
    right: 16px;
    bottom: 16px;
    display: flex;
    width: 380px;
    max-width: calc(100vw - 32px);
    flex-direction: column;
    overflow: hidden;
    color: var(--ink);
    background: color-mix(in srgb, var(--surface) 94%, transparent);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-float);
    backdrop-filter: blur(16px);
    animation: sheet-in var(--dur-2) var(--ease-out);
  }

  .scrim,
  .handle {
    display: none;
  }

  header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
    padding: 20px 20px 14px;
  }

  .heading {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 4px;
  }

  h2 {
    margin: 0;
    font-size: 18px;
    line-height: 1.2;
    font-weight: 600;
  }

  .heading p {
    margin: 0;
    color: var(--ink-3);
    font-size: 12px;
  }

  .close {
    display: grid;
    width: 34px;
    height: 34px;
    flex-shrink: 0;
    padding: 0;
    place-items: center;
    color: var(--ink-2);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
    transition:
      color var(--dur-1) var(--ease-out),
      background-color var(--dur-1) var(--ease-out);
  }

  .close:hover {
    color: var(--ink);
    background: var(--surface-2);
  }

  .log {
    position: relative;
    display: flex;
    min-height: 0;
    flex: 1;
  }

  .messages {
    display: flex;
    min-height: 0;
    flex: 1;
    flex-direction: column;
    gap: 16px;
    padding: 6px 20px 16px;
    overflow-y: auto;
    overscroll-behavior: contain;
  }

  .empty {
    margin: auto 0;
    padding: 12px;
    color: var(--ink-3);
    font-size: 13px;
    text-align: center;
  }

  .group {
    display: flex;
    gap: 10px;
  }

  .group.mine {
    flex-direction: column;
    align-items: flex-end;
    gap: 4px;
  }

  .disc {
    display: grid;
    width: 30px;
    height: 30px;
    flex-shrink: 0;
    place-items: center;
    color: var(--disc-fg);
    font-size: 11px;
    font-weight: 600;
    background: var(--disc-bg);
    border-radius: var(--r-pill);
  }

  .stack {
    display: flex;
    min-width: 0;
    flex-direction: column;
    align-items: flex-start;
    gap: 4px;
  }

  .meta {
    display: flex;
    min-width: 0;
    max-width: 100%;
    align-items: baseline;
    gap: 8px;
  }

  .name {
    overflow: hidden;
    font-size: 13px;
    font-weight: 600;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  time {
    flex-shrink: 0;
    color: var(--ink-3);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .bubble {
    max-width: 100%;
    padding: 8px 13px;
    overflow-wrap: anywhere;
    font-size: 14px;
    line-height: 1.45;
    background: var(--surface-2);
    border-radius: 6px 18px 18px 6px;
  }

  .stack > .meta + .bubble {
    border-top-left-radius: 4px;
  }

  .mine .bubble {
    --link-ink: currentColor;
    max-width: min(100%, 290px);
    color: var(--on-accent);
    background: var(--accent);
    border-radius: 18px 6px 6px 18px;
  }

  /* The picture is the bubble: clipped to its corners, so grouping shapes it like text. */
  .picture-bubble,
  .mine .picture-bubble {
    padding: 0;
    overflow: hidden;
    background: var(--surface-2);
  }

  .mine > .meta + .bubble {
    border-top-right-radius: 4px;
  }

  .group .bubble:last-child {
    border-bottom-left-radius: 18px;
  }

  .mine .bubble:last-child {
    border-bottom-left-radius: 18px;
    border-bottom-right-radius: 18px;
  }

  .new-pill {
    position: absolute;
    bottom: 12px;
    left: 50%;
    display: inline-flex;
    height: 32px;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    color: var(--bg);
    font-size: 12px;
    font-weight: 600;
    white-space: nowrap;
    background: var(--ink);
    border: 0;
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-float);
    transform: translateX(-50%);
    animation: pill-in var(--dur-2) var(--ease-out);
  }

  :global([data-theme='light']) .new-pill :global(svg) {
    color: var(--highlight);
  }

  form {
    display: flex;
    flex-direction: column;
    gap: 8px;
    padding: 12px 16px 14px;
    border-top: 1px solid var(--line);
  }

  .composer {
    display: flex;
    align-items: flex-end;
    gap: 8px;
    padding: 5px 5px 5px 16px;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 22px;
    transition: border-color var(--dur-1) var(--ease-out);
  }

  .composer.attaching {
    padding-left: 5px;
  }

  .attach {
    display: grid;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    place-items: center;
    color: var(--ink-2);
    background: transparent;
    border: 0;
    border-radius: var(--r-pill);
    transition:
      color var(--dur-1) var(--ease-out),
      background-color var(--dur-1) var(--ease-out);
  }

  .attach:hover:not(:disabled) {
    color: var(--ink);
    background: color-mix(in srgb, var(--ink) 7%, transparent);
  }

  .attach:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .picker {
    display: none;
  }

  .chat-sheet.dropping {
    outline: 2px dashed var(--accent);
    outline-offset: -8px;
  }

  .status {
    margin: 0;
    padding: 0 6px;
    color: var(--ink-2);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .composer:focus-within {
    border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  }

  textarea {
    min-width: 0;
    flex: 1;
    padding: 8px 0;
    color: var(--ink);
    font-size: 14px;
    line-height: 20px;
    background: transparent;
    border: 0;
    outline: none;
    resize: none;
  }

  textarea::placeholder {
    color: var(--ink-3);
  }

  .send {
    display: grid;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    place-items: center;
    color: var(--on-accent);
    background: var(--accent);
    border: 0;
    border-radius: var(--r-pill);
    transition:
      background-color var(--dur-1) var(--ease-out),
      transform var(--dur-1) var(--ease-out);
  }

  .send:hover:not(:disabled) {
    background: var(--accent-hover);
  }

  .send:active:not(:disabled) {
    transform: scale(0.94);
  }

  .send:disabled {
    cursor: default;
    opacity: 0.4;
  }

  .footer {
    display: flex;
    min-height: 16px;
    align-items: center;
    justify-content: space-between;
    gap: 8px;
    padding: 0 6px;
    color: var(--ink-3);
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .hint {
    display: flex;
    min-width: 0;
    flex-wrap: wrap;
    gap: 2px 12px;
  }

  .counter {
    flex-shrink: 0;
    margin-left: auto;
  }

  .counter.full {
    color: var(--rec-ink);
  }

  .error {
    margin: 0;
    padding: 0 6px;
    color: var(--rec-ink);
    font-size: 12px;
  }

  @media (max-width: 639px) {
    .scrim {
      position: fixed;
      z-index: 25;
      inset: 0;
      display: block;
      padding: 0;
      background: var(--scrim);
      border: 0;
      cursor: default;
      animation: fade-in var(--dur-2) var(--ease-out);
    }

    .chat-sheet {
      top: 15vh;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-width: none;
      background: var(--surface);
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      backdrop-filter: none;
      animation: sheet-up var(--dur-3) var(--ease-out);
    }

    .handle {
      display: block;
      width: 40px;
      height: 5px;
      margin: 10px auto 0;
      flex-shrink: 0;
      background: var(--line-strong);
      border-radius: var(--r-pill);
    }

    header {
      padding: 12px 18px 10px;
    }

    .close {
      width: 40px;
      height: 40px;
      background: var(--surface-2);
      border-color: transparent;
    }

    .messages {
      padding: 4px 16px 12px;
    }

    form {
      padding: 10px 12px calc(12px + env(safe-area-inset-bottom));
    }

    textarea {
      font-size: 16px;
    }

    .send,
    .attach {
      width: 40px;
      height: 40px;
    }

    .hint {
      display: none;
    }

    .footer:not(:has(.counter)) {
      display: none;
    }
  }

  @keyframes sheet-in {
    from {
      opacity: 0;
      transform: translateX(24px);
    }
  }

  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @keyframes pill-in {
    from {
      opacity: 0;
      transform: translate(-50%, 6px);
    }
  }
</style>
