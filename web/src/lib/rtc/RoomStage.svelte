<script lang="ts">
  import { onDestroy } from 'svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import { ArrowSquareIn, ArrowSquareOut, Screencast } from 'phosphor-svelte';
  import { kick, muteParticipant } from '#lib/api/client.js';
  import type { LobbyRequestInfo } from '#lib/api/types.gen.js';
  import BrandMark from '#lib/ui/BrandMark.svelte';
  import ChatPanel from '#lib/ui/ChatPanel.svelte';
  import ChatPeek from '#lib/ui/ChatPeek.svelte';
  import ControlBar from '#lib/ui/ControlBar.svelte';
  import MeetingDetails from '#lib/ui/MeetingDetails.svelte';
  import ParticipantPanel from '#lib/ui/ParticipantPanel.svelte';
  import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
  import WallClock from '#lib/ui/WallClock.svelte';
  import StageTile from './StageTile.svelte';
  import RemoteAudioRenderer from './RemoteAudioRenderer.svelte';
  import { ConnectionState } from 'livekit-client';
  import { attachMediaTrack } from './mediaElement';
  import { popoutMethod, popOutVideo, popOutWindow, type Popout } from './sharePopout';
  import type { ChatMessage, RoomState } from './room.svelte';
  import { stageLayout, stripHeight, type Rect } from './stageLayout';

  let {
    rtc,
    roomSlug,
    roomName,
    onleave,
    canManage = false,
    canRecord = false,
    pending = [],
    peopleOpen = $bindable(false),
    lobbyError = '',
    onadmit = () => undefined,
    ondeny = () => undefined
  }: {
    rtc: RoomState;
    roomSlug: string;
    /** The room's human name; the slug only ever appears inside the meeting URL. */
    roomName: string;
    onleave: () => void;
    canManage?: boolean;
    /** A host on a deployment that records (ARCHITECTURE.md §8). */
    canRecord?: boolean;
    pending?: LobbyRequestInfo[];
    peopleOpen?: boolean;
    lobbyError?: string;
    onadmit?: (id: string) => void | Promise<void>;
    ondeny?: (id: string) => void | Promise<void>;
  } = $props();

  // LiveKit's states in plain words; a signal blip is a reconnect too.
  const connectionWords: Partial<Record<ConnectionState, string>> = {
    [ConnectionState.Connecting]: 'Connecting…',
    [ConnectionState.Reconnecting]: 'Reconnecting…',
    [ConnectionState.SignalReconnecting]: 'Reconnecting…',
    [ConnectionState.Disconnected]: 'Disconnected'
  };
  const peekDuration = 4_000;

  const phone = new MediaQuery('(max-width: 639.98px)');
  const meetingURL = $derived(`${location.origin}/m/${encodeURIComponent(roomSlug)}`);
  let focusParticipant = $derived(rtc.participants.find((participant) => participant.screenShare));
  // Orbit (speaker) view unless you pick the grid; your pick stays put as
  // people come and go.
  let chosenView = $state<'grid' | 'speaker'>();
  let view = $derived(chosenView ?? 'speaker');
  let lastSpeakerIdentity = $state<string>();
  let participantMenuIdentity = $state<string>();
  let areaWidth = $state(0);
  let areaHeight = $state(0);

  // The lens shows the most recent remote active speaker; sticky through
  // silence so it doesn't flicker between turns. You never take the lens
  // from someone else; alone, it shows you.
  $effect(() => {
    const speaking = rtc.activeSpeakerIdentities.find((identity) =>
      rtc.participants.some(
        (participant) => participant.identity === identity && !participant.isLocal
      )
    );
    if (speaking) lastSpeakerIdentity = speaking;
  });

  $effect(() => {
    if (
      participantMenuIdentity &&
      !rtc.participants.some((participant) => participant.identity === participantMenuIdentity)
    ) {
      participantMenuIdentity = undefined;
    }
  });

  let promoted = $derived(
    rtc.participants.find((participant) => participant.identity === lastSpeakerIdentity) ??
      rtc.participants.find((participant) => !participant.isLocal) ??
      rtc.participants.at(0)
  );
  let layoutMode = $derived<'share' | 'grid' | 'orbit'>(
    focusParticipant ? 'share' : view === 'grid' ? 'grid' : 'orbit'
  );
  let self = $derived(rtc.participants.find((participant) => participant.isLocal));
  let layout = $derived(
    stageLayout({
      mode: layoutMode,
      width: areaWidth,
      height: areaHeight,
      phone: phone.current,
      order: [
        ...rtc.participants.filter((participant) => !participant.isLocal),
        ...(self ? [self] : [])
      ].map((participant) => participant.identity),
      self: self?.identity,
      lensIdentity: promoted?.identity
    })
  );

  let previousPendingCount = 0;
  let chatOpen = $state(false);
  let unreadChat = $state(0);
  let seenChatRevision = 0;
  let peek = $state<ChatMessage>();
  let peekTimer: ReturnType<typeof setTimeout> | undefined;
  let sheetOpen = $derived(peopleOpen || chatOpen);

  $effect(() => {
    if (pending.length > 0 && previousPendingCount === 0) {
      peopleOpen = true;
      chatOpen = false;
    }
    previousPendingCount = pending.length;
  });

  $effect(() => {
    const revision = rtc.chatRevision;
    if (revision > seenChatRevision && !chatOpen) {
      const added = Math.min(revision - seenChatRevision, rtc.chat.length);
      const fresh = rtc.chat.slice(-added).filter((message) => !message.mine);
      unreadChat += fresh.length;
      const newest = fresh.at(-1);
      if (newest) showPeek(newest);
    }
    if (chatOpen) {
      unreadChat = 0;
      hidePeek();
    }
    seenChatRevision = revision;
  });

  onDestroy(() => {
    clearTimeout(peekTimer);
    bringBack();
  });

  const popout = popoutMethod();
  let shareVideo = $state<HTMLVideoElement>();
  let poppedOut = $state<Popout>();
  let poppingOut = false;

  // A share that ends takes its window with it.
  $effect(() => {
    if (!focusParticipant?.screenShare) bringBack();
  });

  async function popOut(): Promise<void> {
    if (!popout || poppingOut || poppedOut) return;
    poppingOut = true;
    try {
      if (popout !== 'document') {
        if (shareVideo) await popOutVideo(shareVideo, popout);
        return;
      }
      poppedOut = await popOutWindow(
        {
          rtc,
          get roomName() {
            return roomName;
          },
          get presenter() {
            return focusParticipant;
          },
          get speaker() {
            return promoted;
          },
          onback: bringBack
        },
        () => (poppedOut = undefined)
      );
    } catch {
      // The browser said no (no gesture, or blocked by policy): the share
      // simply stays where it is.
    } finally {
      poppingOut = false;
    }
  }

  function bringBack(): void {
    poppedOut?.close();
  }

  // One preview at a time: a newer message replaces the one showing.
  function showPeek(message: ChatMessage): void {
    clearTimeout(peekTimer);
    peek = message;
    peekTimer = setTimeout(hidePeek, peekDuration);
  }

  function hidePeek(): void {
    clearTimeout(peekTimer);
    peek = undefined;
  }

  function togglePeople(): void {
    peopleOpen = !peopleOpen;
    if (peopleOpen) chatOpen = false;
  }

  function openPeople(): void {
    if (!peopleOpen) togglePeople();
  }

  function toggleChat(): void {
    chatOpen = !chatOpen;
    if (chatOpen) {
      peopleOpen = false;
      unreadChat = 0;
    }
  }

  // Escape puts the open sheet away, unless a menu, popover or dialog is open
  // (that layer closes first) or it would throw away a chat draft. Checked in
  // the capture phase, before any of those layers has handled the key.
  function closeSheetOnEscape(event: KeyboardEvent): void {
    if (event.key !== 'Escape' || !sheetOpen) return;
    if (document.querySelector('[aria-expanded="true"], dialog[open], .record-confirm')) return;
    if (event.target instanceof HTMLTextAreaElement && event.target.value) return;
    peopleOpen = false;
    chatOpen = false;
  }

  function setParticipantMenu(identity: string, open: boolean): void {
    participantMenuIdentity = open ? identity : undefined;
  }

  async function muteRemoteParticipant(identity: string): Promise<void> {
    await muteParticipant(roomSlug, identity);
  }

  async function removeRemoteParticipant(identity: string): Promise<void> {
    await kick(roomSlug, identity);
  }

  function place(rect: Rect): string {
    return `width: ${rect.w}px; height: ${rect.h}px; transform: translate(${rect.x}px, ${rect.y}px)`;
  }
</script>

<svelte:window onkeydowncapture={closeSheetOnEscape} />

<main
  class="stage"
  data-layout={layoutMode}
  data-sheet-open={sheetOpen ? '' : undefined}
  data-peek={peek && !chatOpen ? '' : undefined}
  style:--strip-h={`${stripHeight}px`}
>
  <header class="stage-header" class:wrapping={rtc.playbackBlocked}>
    <div class="room-status" data-testid="stage-cluster">
      <span class="mark"><BrandMark size={16} /></span>
      <h1 class="room-name" title={roomName}>{roomName}</h1>
      <MeetingDetails url={meetingURL} />
      {#if rtc.isRecording}
        <span class="rec-chip" data-testid="recording-chip"
          ><span class="rec-dot" aria-hidden="true"></span>REC</span
        >
      {/if}
    </div>
    <!-- Autoplay policy blocks playback until a gesture. Without this the
         participant gets silence and no explanation. On a phone it takes a
         row of its own rather than squeeze the room name away. -->
    {#if rtc.playbackBlocked || rtc.connectionState !== ConnectionState.Connected}
      <div class="status">
        {#if rtc.playbackBlocked}
          <button
            type="button"
            class="playback-unlock"
            data-testid="playback-blocked"
            title={rtc.canPlaybackAudio ? 'Tap to play video' : 'Tap to hear audio'}
            onclick={() => rtc.activateMediaPlayback()}
          >
            {rtc.canPlaybackAudio ? 'Tap to play video' : 'Tap to hear audio'}
          </button>
        {/if}
        {#if rtc.connectionState !== ConnectionState.Connected}
          <span class="connection" role="status">{connectionWords[rtc.connectionState]}</span>
        {/if}
      </div>
    {/if}
    <div class="header-end">
      <WallClock />
      <ThemeToggle />
    </div>
  </header>

  <section
    class="media-layout"
    aria-label="Meeting participants"
    data-layout={layoutMode}
    bind:clientWidth={areaWidth}
    bind:clientHeight={areaHeight}
  >
    {#if layout.orbit}<div class="orbit-ring" style={place(layout.orbit)}></div>{/if}
    {#if layout.lens}<div class="lens-frame" style={place(layout.lens)}></div>{/if}

    {#if focusParticipant?.screenShare && layout.share}
      <article class="focus-pane" data-testid="focus-pane" style={place(layout.share)}>
        <div class="share-screen">
          {#key focusParticipant.screenShare.publicationSid}
            <!-- Live screen share does not have a caption track. -->
            <video
              bind:this={shareVideo}
              use:attachMediaTrack={focusParticipant.screenShare}
              autoplay
              playsinline
              muted
              aria-label={`${focusParticipant.name}'s screen share`}
            ></video>
          {/key}
          {#if poppedOut}
            <div class="popped-out">
              <p>Screen share is in its own window</p>
              <button type="button" class="share-pill" onclick={bringBack}>
                <ArrowSquareIn size={16} weight="regular" aria-hidden="true" />
                <span>Bring it back</span>
              </button>
            </div>
          {/if}
        </div>
        <span class="focus-label">
          <Screencast size={16} weight="regular" aria-hidden="true" />
          <span class="focus-name">{focusParticipant.name} · Screen</span>
        </span>
        <div class="share-actions" data-slot="share-actions">
          {#if popout && !poppedOut}
            <button
              type="button"
              class="share-pill"
              aria-label="Pop out screen share"
              title="Pop out screen share"
              onclick={() => void popOut()}
            >
              <ArrowSquareOut size={16} weight="regular" aria-hidden="true" />
              <span>Pop out</span>
            </button>
          {/if}
        </div>
      </article>
    {/if}

    <div
      class="tiles"
      class:strip={layout.strip}
      aria-label="Participant cameras"
      data-count={rtc.participants.length}
      data-testid={layoutMode === 'orbit' ? 'speaker-pane' : undefined}
    >
      {#each rtc.participants as participant (participant.identity)}
        {@const slot = layout.slots[participant.identity] ?? { shape: 'hidden' }}
        <StageTile
          {participant}
          shape={slot.shape}
          rect={slot.rect}
          speaking={rtc.activeSpeakerIdentities.includes(participant.identity)}
          videoHidden={rtc.isParticipantCameraHidden(participant.identity)}
          menuOpen={participantMenuIdentity === participant.identity}
          menuSide={slot.rect && slot.rect.x + slot.rect.w / 2 < areaWidth / 2 ? 'right' : 'left'}
          {canManage}
          onmenuopenchange={(open) => setParticipantMenu(participant.identity, open)}
          ontogglevideo={() =>
            rtc.setParticipantCameraHidden(
              participant.identity,
              !rtc.isParticipantCameraHidden(participant.identity)
            )}
          onmute={() => muteRemoteParticipant(participant.identity)}
          onremove={() => removeRemoteParticipant(participant.identity)}
        />
      {/each}
      {#if layout.overflow?.rect}
        <button
          type="button"
          class="overflow-portal"
          style={place(layout.overflow.rect)}
          aria-label={`${layout.overflow.count} more in the call. Open people`}
          onclick={openPeople}
        >
          +{layout.overflow.count}
        </button>
      {/if}
    </div>
  </section>

  {#if peopleOpen}
    <ParticipantPanel
      {rtc}
      slug={roomSlug}
      {canManage}
      {pending}
      {lobbyError}
      {onadmit}
      {ondeny}
      onclose={() => (peopleOpen = false)}
    />
  {:else if chatOpen}
    <ChatPanel {rtc} onclose={() => (chatOpen = false)} />
  {/if}

  <RemoteAudioRenderer participants={rtc.participants} />

  <div class="dock">
    <ControlBar
      {rtc}
      {onleave}
      {peopleOpen}
      {chatOpen}
      {unreadChat}
      {canManage}
      {canRecord}
      {view}
      {roomSlug}
      ontogglepeople={togglePeople}
      ontogglechat={toggleChat}
      ontoggleview={() => (chosenView = view === 'grid' ? 'speaker' : 'grid')}
    />
    {#if peek && !chatOpen}
      {#key peek}
        <div class="peek-slot">
          <ChatPeek from={peek.from} text={peek.text} onopen={toggleChat} />
        </div>
      {/key}
    {/if}
  </div>
</main>

<style>
  .stage {
    --gutter: 32px;
    --dock-h: 114px;
    --sheet-room: 420px;

    display: grid;
    height: 100dvh;
    min-height: 0;
    grid-template-rows: auto minmax(0, 1fr);
    gap: 16px;
    padding: 20px var(--gutter) var(--dock-h);
    overflow: hidden;
    color: var(--ink);
  }

  .stage-header {
    display: flex;
    min-height: 36px;
    min-width: 0;
    align-items: center;
    gap: 8px 12px;
  }

  .stage-header.wrapping {
    flex-wrap: wrap;
  }

  /* Mark, name, (i), REC: the name is the only part that gives way. */
  .room-status {
    display: flex;
    min-width: 0;
    flex: 0 1 auto;
    align-items: center;
    gap: 12px;
  }

  .mark {
    display: flex;
    flex: none;
  }

  .room-name {
    min-width: 0;
    margin: 0;
    overflow: hidden;
    font-size: 17px;
    font-weight: 600;
    line-height: 24px;
    letter-spacing: -0.01em;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .rec-chip {
    display: inline-flex;
    flex: none;
    align-items: center;
    gap: 8px;
    padding: 6px 12px;
    color: var(--rec-ink);
    font-size: 12px;
    font-weight: 600;
    line-height: 16px;
    letter-spacing: 0.08em;
    background: var(--rec-soft);
    border-radius: var(--r-pill);
  }

  .rec-dot {
    width: 8px;
    height: 8px;
    background: var(--rec);
    border-radius: 50%;
    box-shadow: 0 0 0 4px color-mix(in srgb, var(--rec) 18%, transparent);
  }

  .status {
    display: flex;
    min-width: 0;
    flex: 0 1 auto;
    align-items: center;
    gap: 8px;
  }

  .playback-unlock {
    flex: none;
    height: 32px;
    padding: 0 14px;
    color: var(--on-accent);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    background: var(--accent);
    border: 0;
    border-radius: var(--r-pill);
  }

  .playback-unlock:hover {
    background: var(--accent-hover);
  }

  .connection {
    min-width: 0;
    overflow: hidden;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 20px;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .header-end {
    display: flex;
    flex: none;
    align-items: center;
    gap: 12px;
    margin-left: auto;
  }

  /* Every tile is placed by the layout's rects, from this corner. */
  .media-layout {
    position: relative;
    min-width: 0;
    min-height: 0;
  }

  .orbit-ring,
  .lens-frame,
  .focus-pane,
  .overflow-portal {
    position: absolute;
    top: 0;
    left: 0;
  }

  .orbit-ring {
    border: 1px dashed var(--line-strong);
    border-radius: 50%;
    opacity: 0.6;
    pointer-events: none;
  }

  .lens-frame {
    background: linear-gradient(160deg, var(--lens-from), var(--lens-to));
    border-radius: var(--r-xl);
    box-shadow: 0 0 0 1px var(--line);
  }

  .focus-pane {
    z-index: 1;
    display: grid;
    padding: 14px;
    background: var(--surface);
    border-radius: var(--r-xl);
    box-shadow:
      0 0 0 1px color-mix(in srgb, var(--accent) 35%, transparent),
      0 30px 120px var(--speak-glow);
  }

  .share-screen {
    display: grid;
    min-width: 0;
    min-height: 0;
    overflow: hidden;
    background: var(--bg);
    border-radius: var(--r-lg);
  }

  .share-screen video {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }

  .focus-label {
    position: absolute;
    bottom: 30px;
    left: 30px;
    display: inline-flex;
    max-width: calc(100% - 60px);
    height: 40px;
    padding: 0 16px 0 12px;
    align-items: center;
    gap: 10px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 500;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    border-radius: var(--r-pill);
  }

  .focus-label :global(svg) {
    flex: none;
    color: var(--accent);
  }

  .focus-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .share-actions {
    position: absolute;
    top: 30px;
    right: 30px;
    display: flex;
    gap: 8px;
  }

  .share-pill {
    display: inline-flex;
    height: 40px;
    padding: 0 16px 0 14px;
    align-items: center;
    gap: 8px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    background: color-mix(in srgb, var(--surface) 88%, transparent);
    border: 0;
    border-radius: var(--r-pill);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .share-pill:hover {
    background: var(--surface);
  }

  .share-pill :global(svg) {
    flex: none;
    color: var(--accent);
  }

  /* The share's frame while it plays in its own window: the video stays
     attached underneath, so bringing it back is instant. */
  .popped-out {
    display: grid;
    grid-area: 1 / 1;
    place-content: center;
    justify-items: center;
    gap: 16px;
    padding: 16px;
    color: var(--ink-2);
    font-size: 15px;
    text-align: center;
    background: var(--surface-2);
    animation: fade-in var(--dur-2) var(--ease-out);
  }

  .popped-out p {
    margin: 0;
  }

  .popped-out .share-pill {
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  .overflow-portal {
    z-index: 1;
    display: grid;
    padding: 0;
    place-items: center;
    color: var(--ink-2);
    font-size: 18px;
    font-weight: 600;
    background: var(--surface-2);
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    transition: transform var(--dur-3) var(--ease-out);
  }

  .overflow-portal:hover {
    color: var(--ink);
  }

  .dock {
    position: fixed;
    z-index: 20;
    right: 0;
    bottom: 24px;
    left: 0;
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
    align-items: center;
    pointer-events: none;
  }

  .dock > :global(.capsule) {
    grid-column: 2;
  }

  /* A new message peeks out beside the capsule, clear of the stage. */
  .peek-slot {
    display: flex;
    min-width: 0;
    margin-left: 16px;
    grid-column: 3;
    grid-row: 1;
    justify-self: start;
  }

  /* With a side sheet open the stage keeps to the space left of it. So does
     the dock: it is the capsule's container, and the capsule tightens to fit
     it (ControlBar), sliding over as the sheet comes in. The peek moves above
     the capsule. Narrower than this the stage beside a sheet is a sliver, so
     the sheet overlays it over a scrim instead (ChatPanel, ParticipantPanel). */
  @media (min-width: 900px) {
    .stage[data-sheet-open] {
      padding-right: var(--sheet-room);
    }

    .stage[data-sheet-open] .dock {
      right: calc(var(--sheet-room) - var(--gutter));
      padding-inline: 16px;
      grid-template-columns: minmax(0, 1fr);
      container: dock / inline-size;
      animation: dock-aside var(--dur-3) var(--ease-out);
    }

    .stage[data-sheet-open] .dock > :global(.capsule) {
      grid-column: 1;
      justify-self: center;
    }

    .stage[data-sheet-open] .peek-slot {
      position: absolute;
      right: 0;
      bottom: calc(100% + 12px);
      left: 0;
      justify-content: center;
      grid-column: 1 / -1;
      justify-self: stretch;
      margin: 0;
    }
  }

  @keyframes dock-aside {
    from {
      transform: translateX(calc((var(--sheet-room) - var(--gutter)) / 2));
    }
  }

  @media (max-width: 1099.98px) {
    .stage {
      --gutter: 24px;
      --dock-h: 92px;
    }

    .dock {
      bottom: 16px;
    }
  }

  /* Phone: the lens fills the width, the portals scroll in a strip under it,
     and sheets rise from the bottom over a scrim instead of reflowing. */
  @media (max-width: 639.98px) {
    .stage {
      --gutter: 16px;
      --dock-h: calc(92px + env(safe-area-inset-bottom));

      gap: 12px;
      padding-top: 16px;
    }

    .stage-header {
      flex-wrap: wrap;
    }

    .room-status {
      flex: 1 1 0;
      gap: 8px;
    }

    .mark {
      display: none;
    }

    .room-name {
      font-size: 16px;
    }

    .rec-chip {
      gap: 6px;
      padding: 3px 9px;
      font-size: 11px;
    }

    .rec-dot {
      width: 6px;
      height: 6px;
      box-shadow: none;
    }

    .status {
      order: 3;
      flex: 1 0 100%;
      flex-wrap: wrap;
    }

    .header-end {
      gap: 8px;
    }

    .media-layout {
      display: flex;
      flex-direction: column;
      justify-content: flex-end;
    }

    .lens-frame {
      border-radius: var(--r-lg);
    }

    .focus-pane {
      padding: 8px;
      border-radius: var(--r-lg);
    }

    .share-screen {
      border-radius: var(--r-md);
    }

    .focus-label {
      bottom: 16px;
      left: 16px;
      max-width: calc(100% - 32px);
      height: 34px;
      font-size: 13px;
    }

    .share-actions {
      top: 16px;
      right: 16px;
    }

    .share-pill {
      height: 34px;
      padding: 0 14px 0 12px;
      font-size: 13px;
    }

    /* Not positioned, so the absolutely placed lens is not scrolled or
       clipped with the strip. */
    .tiles.strip {
      display: flex;
      height: var(--strip-h);
      flex: none;
      gap: 14px;
      padding: 8px 8px 0;
      overflow-x: auto;
      overflow-y: hidden;
      scroll-padding-inline: 8px;
      scroll-snap-type: x mandatory;
      scrollbar-width: none;
    }

    .tiles.strip :global(.tile.self) {
      order: -1;
    }

    .dock {
      right: 12px;
      bottom: calc(12px + env(safe-area-inset-bottom));
      left: 12px;
      grid-template-columns: minmax(0, 1fr);
    }

    .dock > :global(.capsule) {
      grid-column: 1;
    }

    /* The peek takes the strip's name row while it shows, between the
       portraits and the capsule, so it never covers a face or a name. */
    .peek-slot {
      position: absolute;
      right: 0;
      bottom: calc(100% + 6px);
      left: 0;
      justify-content: center;
      grid-column: 1 / -1;
      justify-self: stretch;
      margin: 0;
    }

    .peek-slot :global(.peek) {
      padding-block: 6px;
    }

    .tiles.strip :global(.portal-label) {
      transition: opacity var(--dur-2) var(--ease-out);
    }

    .stage[data-peek] .tiles.strip :global(.portal-label) {
      opacity: 0;
    }
  }
</style>
