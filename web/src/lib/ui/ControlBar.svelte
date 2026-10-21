<script lang="ts">
  import {
    CaretUp,
    ChatTeardropText,
    Check,
    DotsThree,
    GridFour,
    Microphone,
    MicrophoneSlash,
    PhoneDisconnect,
    Power,
    Record,
    Screencast,
    SignOut,
    UserRectangle,
    UsersThree,
    VideoCamera,
    VideoCameraSlash,
    X
  } from 'phosphor-svelte';
  import { MediaQuery } from 'svelte/reactivity';
  import type { RoomState } from '#lib/rtc/room.svelte.js';
  import { endMeeting, startRecording, stopRecording } from '#lib/api/client.js';
  import { sheetFocus } from './sheetFocus.js';

  let {
    rtc,
    onleave,
    peopleOpen = false,
    chatOpen = false,
    unreadChat = 0,
    canManage = false,
    canRecord = false,
    roomSlug = '',
    view = 'grid',
    moreOpen = $bindable(false),
    ontogglepeople = () => undefined,
    ontogglechat = () => undefined,
    ontoggleview = () => undefined
  }: {
    rtc: RoomState;
    onleave: () => void;
    peopleOpen?: boolean;
    chatOpen?: boolean;
    unreadChat?: number;
    canManage?: boolean;
    /** Shows record: a host, on a deployment that records (ARCHITECTURE.md §8). */
    canRecord?: boolean;
    roomSlug?: string;
    view?: 'grid' | 'speaker';
    /** The phone's More sheet; bound so the stage behind it can go inert. */
    moreOpen?: boolean;
    ontogglepeople?: () => void;
    ontogglechat?: () => void;
    ontoggleview?: () => void;
  } = $props();

  type DeviceMenuKind = 'audioinput' | 'videoinput';

  // A phone's capsule keeps the everyday controls; record, the view and the
  // device lists move to the More sheet.
  const phone = new MediaQuery('(max-width: 639.98px)');
  // Phones and iPads have no screen capture to offer: no button at all.
  const canShareScreen =
    typeof navigator !== 'undefined' &&
    typeof navigator.mediaDevices?.getDisplayMedia === 'function';

  let recordingConfirm = $state(false);
  let recordingBusy = $state(false);
  let recordingError = $state('');
  let recordVideo = $state(false);
  let leaveConfirm = $state(false);
  let endBusy = $state(false);
  let endError = $state('');
  let deviceMenu = $state<DeviceMenuKind | ''>('');

  $effect(() => {
    if (!phone.current) moreOpen = false;
  });

  function closeAll(): void {
    deviceMenu = '';
    recordingConfirm = false;
    leaveConfirm = false;
    moreOpen = false;
  }

  async function toggleDeviceMenu(kind: DeviceMenuKind): Promise<void> {
    if (deviceMenu === kind) {
      deviceMenu = '';
      return;
    }
    await rtc.refreshDevices().catch(() => undefined);
    // Every menu and confirm step is a popover over the capsule, so opening
    // one closes the others.
    recordingConfirm = false;
    leaveConfirm = false;
    deviceMenu = kind;
  }

  function toggleMore(): void {
    const open = !moreOpen;
    closeAll();
    moreOpen = open;
    if (open) void rtc.refreshDevices().catch(() => undefined);
  }

  function toggleLeave(): void {
    const open = !leaveConfirm;
    closeAll();
    leaveConfirm = open;
  }

  function pickDevice(kind: DeviceMenuKind, deviceId: string): void {
    deviceMenu = '';
    // The media controls report their own failures as rtc.mediaError.
    void rtc.switchDevice(kind, deviceId);
  }

  async function leave(): Promise<void> {
    await rtc.leave().catch(() => undefined);
    onleave();
  }

  // One notice at a time above the capsule. What the user just did here
  // (recording, ending) outranks a device problem, which stays until fixed.
  const notice = $derived(recordingError || endError || rtc.mediaError?.message || '');

  function dismissNotice(): void {
    if (recordingError) recordingError = '';
    else if (endError) endError = '';
    else rtc.dismissMediaError();
  }

  async function toggleRecording(): Promise<void> {
    if (recordingBusy || !roomSlug) return;
    if (!rtc.isRecording && !recordingConfirm) {
      recordingConfirm = true;
      recordVideo = false;
      recordingError = '';
      deviceMenu = '';
      leaveConfirm = false;
      return;
    }
    recordingBusy = true;
    recordingConfirm = false;
    recordingError = '';
    try {
      if (rtc.isRecording) {
        await stopRecording(roomSlug);
      } else {
        await startRecording(roomSlug, { video: recordVideo });
      }
    } catch (cause) {
      recordingError = cause instanceof Error ? cause.message : 'Could not change recording.';
    } finally {
      recordingBusy = false;
    }
  }

  async function endForAll(): Promise<void> {
    if (endBusy || !roomSlug) return;
    endBusy = true;
    endError = '';
    try {
      await endMeeting(roomSlug);
      leaveConfirm = false;
      // No local teardown: the server disconnects this client too, and the
      // meeting page renders the shared "meeting ended" state for everyone.
    } catch (cause) {
      endError = cause instanceof Error ? cause.message : 'Could not end the meeting.';
    } finally {
      endBusy = false;
    }
  }
</script>

{#snippet deviceMenuList(kind: DeviceMenuKind, fallbackLabel: string, inline: boolean)}
  <!-- The stopPropagation shield keeps the window click-away handler from
       closing the menu; keyboard interaction lives on the options. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events, a11y_interactive_supports_focus -->
  <div
    class="device-menu"
    class:inline
    role="menu"
    aria-label={`Choose ${fallbackLabel.toLowerCase()}`}
    onclick={(event) => event.stopPropagation()}
  >
    {#each rtc.devices[kind] as device, index (device.deviceId)}
      <button
        type="button"
        class="device-option"
        role="menuitemradio"
        aria-checked={rtc.activeDeviceIds[kind] === device.deviceId}
        onclick={() => pickDevice(kind, device.deviceId)}
      >
        <span class="device-name">{device.label || `${fallbackLabel} ${index + 1}`}</span>
        {#if rtc.activeDeviceIds[kind] === device.deviceId}
          <Check size={16} weight="regular" aria-hidden="true" />
        {/if}
      </button>
    {:else}
      <span class="device-empty">No devices found</span>
    {/each}
  </div>
{/snippet}

{#snippet shareButton(labelled: boolean)}
  <button
    type="button"
    class="round well share-control"
    class:labelled
    class:active={rtc.screenShareEnabled}
    aria-label={rtc.screenShareEnabled ? 'Stop sharing' : 'Share screen'}
    aria-pressed={rtc.screenShareEnabled}
    aria-busy={rtc.mediaBusy.screen}
    title={rtc.screenShareEnabled ? 'Stop sharing' : 'Share screen'}
    onclick={() => void rtc.toggleScreenShare()}
  >
    <Screencast size={20} weight="regular" aria-hidden="true" />
    {#if labelled}<span>{rtc.screenShareEnabled ? 'Stop sharing' : 'Share screen'}</span>{/if}
  </button>
{/snippet}

{#snippet recordGroup(labelled: boolean)}
  <!-- The stopPropagation shield keeps the window click-away handler from
       collapsing the confirm step; interaction lives on the controls. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="record-group" class:labelled onclick={(event) => event.stopPropagation()}>
    <button
      type="button"
      class="round well record-control"
      class:labelled
      class:recording={rtc.isRecording}
      class:confirm={recordingConfirm}
      disabled={recordingBusy}
      aria-label={rtc.isRecording
        ? 'Stop recording'
        : recordingConfirm
          ? 'Record?'
          : 'Start recording'}
      aria-pressed={rtc.isRecording}
      title={rtc.isRecording ? 'Stop recording' : 'Start recording'}
      onclick={() => void toggleRecording()}
    >
      <Record size={20} weight={rtc.isRecording ? 'fill' : 'regular'} aria-hidden="true" />
      {#if labelled}
        <span>{rtc.isRecording ? 'Stop recording' : recordingConfirm ? 'Record?' : 'Record'}</span>
      {/if}
    </button>
    {#if recordingConfirm}
      <div class="record-confirm" class:popover={!labelled}>
        <label class="record-video">
          <input type="checkbox" bind:checked={recordVideo} />
          Also record video
        </label>
        <button
          type="button"
          class="record-now"
          disabled={recordingBusy}
          onclick={() => void toggleRecording()}
        >
          <Record size={16} weight="fill" aria-hidden="true" />
          <span>Record</span>
        </button>
      </div>
    {/if}
  </div>
{/snippet}

{#snippet viewButton(labelled: boolean)}
  <button
    type="button"
    class="round view-control"
    class:labelled
    aria-label={view === 'grid' ? 'Speaker view' : 'Grid view'}
    aria-pressed={view === 'speaker'}
    title={view === 'grid' ? 'Speaker view' : 'Grid view'}
    onclick={ontoggleview}
  >
    {#if view === 'grid'}
      <UserRectangle size={20} weight="regular" aria-hidden="true" />
    {:else}
      <GridFour size={20} weight="regular" aria-hidden="true" />
    {/if}
    {#if labelled}<span>{view === 'grid' ? 'Speaker view' : 'Grid view'}</span>{/if}
  </button>
{/snippet}

<svelte:window
  onclick={closeAll}
  onkeydown={(event) => {
    if (event.key === 'Escape') closeAll();
  }}
/>

<nav class="capsule" aria-label="Meeting controls" inert={phone.current && moreOpen}>
  <div class="split" class:primary={rtc.micEnabled} class:off={!rtc.micEnabled}>
    <button
      type="button"
      class="round"
      aria-label={rtc.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
      aria-pressed={rtc.micEnabled}
      aria-busy={rtc.mediaBusy.microphone}
      title={rtc.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
      onclick={() => void rtc.toggleMic()}
    >
      {#if rtc.micEnabled}
        <Microphone size={20} weight="regular" aria-hidden="true" />
      {:else}
        <MicrophoneSlash size={20} weight="regular" aria-hidden="true" />
      {/if}
    </button>
    {#if !phone.current}
      <button
        type="button"
        class="caret"
        aria-label="Choose microphone"
        aria-haspopup="menu"
        aria-expanded={deviceMenu === 'audioinput'}
        title="Choose microphone"
        onclick={(event) => {
          event.stopPropagation();
          void toggleDeviceMenu('audioinput');
        }}
      >
        <CaretUp size={14} weight="bold" aria-hidden="true" />
      </button>
      {#if deviceMenu === 'audioinput'}
        {@render deviceMenuList('audioinput', 'Microphone', false)}
      {/if}
    {/if}
  </div>

  <div class="split well" class:off={!rtc.camEnabled}>
    <button
      type="button"
      class="round"
      aria-label={rtc.camEnabled ? 'Turn camera off' : 'Turn camera on'}
      aria-pressed={rtc.camEnabled}
      aria-busy={rtc.mediaBusy.camera}
      title={rtc.camEnabled ? 'Turn camera off' : 'Turn camera on'}
      onclick={() => void rtc.toggleCam()}
    >
      {#if rtc.camEnabled}
        <VideoCamera size={20} weight="regular" aria-hidden="true" />
      {:else}
        <VideoCameraSlash size={20} weight="regular" aria-hidden="true" />
      {/if}
    </button>
    {#if !phone.current}
      <button
        type="button"
        class="caret"
        aria-label="Choose camera"
        aria-haspopup="menu"
        aria-expanded={deviceMenu === 'videoinput'}
        title="Choose camera"
        onclick={(event) => {
          event.stopPropagation();
          void toggleDeviceMenu('videoinput');
        }}
      >
        <CaretUp size={14} weight="bold" aria-hidden="true" />
      </button>
      {#if deviceMenu === 'videoinput'}
        {@render deviceMenuList('videoinput', 'Camera', false)}
      {/if}
    {/if}
  </div>

  {#if !phone.current}
    {#if canShareScreen}{@render shareButton(false)}{/if}
    {#if canRecord}{@render recordGroup(false)}{/if}
    <span class="separator" aria-hidden="true"></span>
    {@render viewButton(false)}
  {/if}

  <button
    type="button"
    class="round"
    class:active={peopleOpen}
    aria-label={peopleOpen ? 'Close people' : 'Open people'}
    aria-pressed={peopleOpen}
    title={peopleOpen ? 'Close people' : 'Open people'}
    onclick={ontogglepeople}
  >
    <UsersThree size={20} weight="regular" aria-hidden="true" />
    <span class="badge">{rtc.participants.length}</span>
  </button>

  <button
    type="button"
    class="round"
    class:active={chatOpen}
    aria-label={chatOpen ? 'Close chat' : 'Open chat'}
    aria-pressed={chatOpen}
    title={chatOpen ? 'Close chat' : 'Open chat'}
    onclick={ontogglechat}
  >
    <ChatTeardropText size={20} weight="regular" aria-hidden="true" />
    {#if unreadChat > 0}<span class="badge unread">{unreadChat}</span>{/if}
  </button>

  {#if phone.current}
    <button
      type="button"
      class="round"
      class:active={moreOpen}
      aria-label="More controls"
      aria-haspopup="dialog"
      aria-expanded={moreOpen}
      title="More controls"
      onclick={(event) => {
        event.stopPropagation();
        toggleMore();
      }}
    >
      <DotsThree size={20} weight="regular" aria-hidden="true" />
    </button>
  {:else}
    <span class="separator" aria-hidden="true"></span>
  {/if}

  {#if notice}
    <div class="bar-notice" class:raised={leaveConfirm || recordingConfirm}>
      <span role="alert">{notice}</span>
      <button
        type="button"
        class="notice-dismiss"
        aria-label="Dismiss"
        title="Dismiss"
        onclick={dismissNotice}
      >
        <X size={16} weight="regular" aria-hidden="true" />
      </button>
    </div>
  {/if}

  {#if canManage}
    <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
    <div class="leave-group" onclick={(event) => event.stopPropagation()}>
      <button
        type="button"
        class="leave"
        aria-label="Leave or end meeting"
        aria-expanded={leaveConfirm}
        title="Leave"
        onclick={toggleLeave}
      >
        <PhoneDisconnect size={20} weight="regular" aria-hidden="true" />
        <span class="leave-text">Leave</span>
      </button>
      {#if leaveConfirm}
        <div class="leave-choices">
          <button
            type="button"
            class="choice"
            aria-label="Leave room"
            title="Leave room"
            onclick={() => void leave()}
          >
            <SignOut size={16} weight="regular" aria-hidden="true" />
            <span>Leave</span>
          </button>
          <button
            type="button"
            class="choice end-all"
            disabled={endBusy}
            aria-label="End meeting for all"
            title="End meeting for all"
            onclick={() => void endForAll()}
          >
            <Power size={16} weight="regular" aria-hidden="true" />
            <span>End for all</span>
          </button>
        </div>
      {/if}
    </div>
  {:else}
    <button
      type="button"
      class="leave"
      aria-label="Leave room"
      title="Leave room"
      onclick={() => void leave()}
    >
      <PhoneDisconnect size={20} weight="regular" aria-hidden="true" />
      <span class="leave-text">Leave</span>
    </button>
  {/if}
</nav>

{#if phone.current && moreOpen}
  <!-- iOS Safari never bubbles a tap on a plain div up to the window, so the
       scrim closes the sheet itself. -->
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div class="scrim" aria-hidden="true" onclick={closeAll}></div>
  <!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
  <div
    class="more-sheet"
    role="dialog"
    tabindex="-1"
    aria-label="More controls"
    use:sheetFocus={'button'}
    onclick={(event) => event.stopPropagation()}
  >
    <span class="handle" aria-hidden="true"></span>
    <header class="sheet-header">
      <h2>More controls</h2>
      <button type="button" class="sheet-close" aria-label="Close" title="Close" onclick={closeAll}>
        <X size={16} weight="regular" aria-hidden="true" />
      </button>
    </header>
    <div class="sheet-actions">
      {#if canShareScreen}{@render shareButton(true)}{/if}
      {#if canRecord}{@render recordGroup(true)}{/if}
      {@render viewButton(true)}
    </div>
    <section class="sheet-devices">
      <h3>Microphone</h3>
      {@render deviceMenuList('audioinput', 'Microphone', true)}
    </section>
    <section class="sheet-devices">
      <h3>Camera</h3>
      {@render deviceMenuList('videoinput', 'Camera', true)}
    </section>
  </div>
{/if}

<style>
  .capsule {
    --btn: 52px;

    position: relative;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 10px;
    pointer-events: auto;
    background: color-mix(in srgb, var(--surface) 90%, transparent);
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-float);
  }

  button {
    position: relative;
    display: inline-grid;
    flex: none;
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

  button:hover {
    color: var(--ink);
  }

  button:disabled {
    cursor: wait;
    opacity: 0.6;
  }

  /* Still clickable (a click while busy sets the next request), but visibly
     waiting — on the permission prompt, usually. */
  button[aria-busy='true'] {
    cursor: progress;
    opacity: 0.75;
  }

  .round {
    width: var(--btn);
    height: var(--btn);
  }

  .round:hover,
  .round.active {
    background: var(--surface-2);
  }

  .round.active {
    color: var(--ink);
  }

  /* A filled well: camera, share, record. */
  .well,
  .round.well {
    color: var(--ink);
    background: var(--surface-2);
  }

  .round.well:hover {
    background: color-mix(in srgb, var(--ink) 7%, var(--surface-2));
  }

  .round.well.active {
    color: var(--on-accent);
    background: var(--accent);
  }

  /* Microphone and camera, each with its device caret, as one pill. */
  .split {
    position: relative;
    display: flex;
    flex: none;
    align-items: center;
    border-radius: var(--r-pill);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .split .round,
  .split .round:hover {
    color: inherit;
    background: transparent;
  }

  .split.primary {
    color: var(--on-accent);
    background: var(--accent);
  }

  .split.primary:hover {
    background: var(--accent-hover);
  }

  .split.off,
  .split.well.off {
    color: var(--rec-ink);
    background: var(--rec-soft);
  }

  .split.well {
    color: var(--ink);
  }

  .caret {
    width: 30px;
    height: var(--btn);
    padding-right: 6px;
    color: inherit;
    opacity: 0.75;
  }

  .caret:hover,
  .caret[aria-expanded='true'] {
    color: inherit;
    opacity: 1;
  }

  .record-control.recording,
  .round.well.record-control.recording {
    color: var(--rec-ink);
    background: var(--rec-soft);
  }

  .record-control.confirm {
    color: var(--rec-ink);
    box-shadow: inset 0 0 0 1.5px var(--rec);
  }

  .separator {
    flex: none;
    width: 1px;
    height: 28px;
    margin: 0 6px;
    background: var(--line-strong);
  }

  .badge {
    position: absolute;
    top: 6px;
    right: 4px;
    min-width: 18px;
    height: 18px;
    padding: 0 5px;
    color: var(--bg);
    font-size: 11px;
    font-weight: 600;
    line-height: 18px;
    text-align: center;
    background: var(--ink);
    border-radius: var(--r-pill);
  }

  .badge.unread {
    color: var(--on-highlight);
    background: var(--highlight);
  }

  .leave-group {
    position: relative;
    display: flex;
  }

  button.leave {
    display: inline-flex;
    height: var(--btn);
    padding: 0 22px 0 18px;
    align-items: center;
    gap: 10px;
    color: var(--on-danger);
    font-size: 15px;
    font-weight: 600;
    background: var(--danger);
  }

  button.leave:hover,
  button.leave[aria-expanded='true'] {
    color: var(--on-danger);
    background: color-mix(in srgb, var(--danger) 88%, var(--ink));
  }

  /* Popovers over the capsule: device lists, record's confirm, leave's choice. */
  .device-menu,
  .record-confirm.popover,
  .leave-choices {
    position: absolute;
    z-index: 2;
    bottom: calc(100% + 16px);
    padding: 6px;
    color: var(--ink);
    background: var(--surface);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-float);
    animation: pop-in var(--dur-2) var(--ease-out);
  }

  .device-menu {
    left: 0;
    display: grid;
    gap: 2px;
    min-width: 220px;
    max-width: 300px;
  }

  .device-option {
    display: flex;
    width: 100%;
    min-height: 36px;
    padding: 6px 10px;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    color: var(--ink);
    font-size: 13px;
    text-align: left;
    border-radius: var(--r-sm);
  }

  .device-option:hover {
    background: var(--surface-2);
  }

  .device-option :global(svg) {
    flex: none;
    color: var(--accent);
  }

  .device-name {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .device-empty {
    padding: 6px 10px;
    color: var(--ink-3);
    font-size: 13px;
  }

  .record-group {
    position: relative;
    display: flex;
  }

  .record-confirm {
    display: flex;
    align-items: center;
    gap: 12px;
    white-space: nowrap;
  }

  .record-confirm.popover {
    left: 50%;
    padding: 6px 6px 6px 14px;
    transform: translateX(-50%);
  }

  .record-video {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    font-size: 13px;
  }

  .record-video input {
    margin: 0;
    accent-color: var(--accent);
  }

  .record-now,
  .choice {
    display: inline-flex;
    height: 36px;
    padding: 0 14px;
    align-items: center;
    gap: 8px;
    color: var(--ink);
    font-size: 13px;
    font-weight: 500;
    white-space: nowrap;
    border-radius: var(--r-pill);
  }

  .record-now {
    color: var(--on-danger);
    background: var(--danger);
  }

  .record-now:hover {
    color: var(--on-danger);
    background: color-mix(in srgb, var(--danger) 88%, var(--ink));
  }

  .leave-choices {
    right: 0;
    display: grid;
    gap: 2px;
    min-width: 180px;
  }

  .choice {
    justify-content: flex-start;
    border-radius: var(--r-sm);
  }

  .choice:hover {
    background: var(--surface-2);
  }

  .choice.end-all {
    color: var(--rec-ink);
  }

  .choice.end-all:hover {
    background: var(--rec-soft);
  }

  .bar-notice {
    position: absolute;
    bottom: calc(100% + 12px);
    left: 50%;
    display: flex;
    width: max-content;
    max-width: min(360px, calc(100vw - 32px));
    padding: 8px 6px 8px 14px;
    align-items: flex-start;
    gap: 6px;
    color: var(--ink);
    font-size: 13px;
    line-height: 20px;
    background: var(--surface);
    border-radius: var(--r-md);
    box-shadow:
      inset 0 0 0 1px color-mix(in srgb, var(--rec) 55%, transparent),
      var(--shadow-float);
    transform: translateX(-50%);
  }

  .bar-notice.raised {
    bottom: calc(100% + 76px);
  }

  .notice-dismiss {
    width: 20px;
    height: 20px;
    color: var(--ink-2);
  }

  @keyframes pop-in {
    from {
      opacity: 0;
    }
  }

  /* Tablet: the same capsule, a size down. */
  @media (max-width: 1099.98px) {
    .capsule {
      --btn: 44px;

      gap: 6px;
      padding: 8px;
    }

    .separator {
      margin: 0 2px;
    }

    button.leave {
      padding: 0 18px 0 14px;
      font-size: 14px;
    }

    .caret {
      width: 26px;
    }
  }

  /* Beside an open side sheet the stage's dock is a container as wide as the
     room left of the sheet. The capsule tightens to fit it, then keeps the
     everyday controls; share and record stay while they are on. */
  @container dock (max-width: 560px) {
    .capsule {
      gap: 4px;
      padding: 6px;
    }

    .separator,
    .leave-text {
      display: none;
    }

    .caret {
      width: 22px;
    }

    button.leave {
      width: var(--btn);
      padding: 0;
      justify-content: center;
    }
  }

  @container dock (max-width: 435px) {
    .capsule {
      --btn: 40px;
    }

    .caret,
    .view-control,
    .share-control:not(.active),
    .record-group:not(:has(.recording)) {
      display: none;
    }
  }

  @container dock (max-width: 271px) {
    .capsule {
      --btn: 36px;

      gap: 2px;
    }
  }

  /* Phone: the capsule spans the width; six round controls share it. */
  @media (max-width: 639.98px) {
    .capsule {
      --btn: clamp(40px, calc((100vw - 64px) / 6), 50px);

      justify-content: space-between;
      width: 100%;
      gap: 4px;
      padding: 8px;
    }

    button.leave {
      width: var(--btn);
      padding: 0;
      justify-content: center;
    }

    .leave-text {
      display: none;
    }

    .scrim,
    .more-sheet {
      pointer-events: auto;
    }

    .scrim {
      position: fixed;
      z-index: 30;
      inset: 0;
      background: var(--scrim);
      animation: pop-in var(--dur-2) var(--ease-out);
    }

    .more-sheet {
      position: fixed;
      z-index: 31;
      right: 0;
      bottom: 0;
      left: 0;
      display: grid;
      max-height: min(85dvh, calc(100dvh - 16px - env(safe-area-inset-top)));
      padding: 8px 16px calc(20px + env(safe-area-inset-bottom));
      gap: 16px;
      overflow-y: auto;
      color: var(--ink);
      background: var(--surface);
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      box-shadow: var(--shadow-float);
      animation: sheet-up var(--dur-3) var(--ease-out);
    }

    .handle {
      justify-self: center;
      width: 36px;
      height: 4px;
      background: var(--line-strong);
      border-radius: var(--r-pill);
    }

    .sheet-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    .sheet-header h2 {
      margin: 0;
      font-size: 18px;
      line-height: 1.2;
      font-weight: 600;
    }

    .sheet-close {
      display: grid;
      width: 40px;
      height: 40px;
      flex-shrink: 0;
      place-items: center;
      color: var(--ink-2);
      background: transparent;
      border: 1px solid var(--line-strong);
      border-radius: var(--r-pill);
    }

    .sheet-actions {
      display: grid;
      gap: 8px;
    }

    .round.labelled {
      display: flex;
      width: 100%;
      height: 52px;
      padding: 0 16px;
      justify-content: flex-start;
      gap: 12px;
      color: var(--ink);
      font-size: 16px;
      background: var(--surface-2);
      border-radius: var(--r-md);
    }

    .record-group.labelled {
      display: grid;
      gap: 8px;
    }

    .record-confirm:not(.popover) {
      justify-content: space-between;
      padding: 0 4px 0 16px;
    }

    .sheet-devices {
      display: grid;
      gap: 6px;
    }

    .sheet-devices h3 {
      margin: 0;
      color: var(--ink-3);
      font-size: 14px;
      font-weight: 500;
    }

    .device-menu.inline {
      position: static;
      max-width: none;
      padding: 4px;
      background: var(--surface-2);
      box-shadow: none;
      animation: none;
    }

    .device-menu.inline .device-option {
      min-height: 48px;
      padding: 8px 12px;
      font-size: 16px;
    }

    .bar-notice.raised {
      bottom: calc(100% + 140px);
    }
  }

  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }
</style>
