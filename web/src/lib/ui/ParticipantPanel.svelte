<script lang="ts">
  import { MicrophoneSlash, VideoCameraSlash, X } from 'phosphor-svelte';
  import { kick, muteParticipant } from '#lib/api/client.js';
  import type { LobbyRequestInfo } from '#lib/api/types.gen.js';
  import type { ParticipantView, RoomState } from '#lib/rtc/room.svelte.js';
  import { participantColor } from './participantColor';

  let {
    rtc,
    slug,
    canManage = false,
    pending = [],
    lobbyError = '',
    onadmit = () => undefined,
    ondeny = () => undefined,
    onclose = () => undefined
  }: {
    rtc: RoomState;
    slug: string;
    canManage?: boolean;
    pending?: LobbyRequestInfo[];
    lobbyError?: string;
    onadmit?: (id: string) => void | Promise<void>;
    ondeny?: (id: string) => void | Promise<void>;
    onclose?: () => void;
  } = $props();

  let moderationError = $state('');
  let busyIdentity = $state('');
  let confirmIdentity = $state('');

  function initials(name: string): string {
    const words = name.trim().split(/\s+/).filter(Boolean);
    const first = Array.from(words[0] ?? '')[0] ?? '';
    const last = words.length > 1 ? (Array.from(words.at(-1) ?? '')[0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
  }

  async function mute(participant: ParticipantView): Promise<void> {
    moderationError = '';
    busyIdentity = participant.identity;
    try {
      await muteParticipant(slug, participant.identity);
    } catch (cause) {
      moderationError = cause instanceof Error ? cause.message : 'Could not mute this person.';
    } finally {
      busyIdentity = '';
    }
  }

  async function remove(participant: ParticipantView): Promise<void> {
    if (confirmIdentity !== participant.identity) {
      confirmIdentity = participant.identity;
      return;
    }
    moderationError = '';
    busyIdentity = participant.identity;
    try {
      await kick(slug, participant.identity);
      confirmIdentity = '';
    } catch (cause) {
      moderationError = cause instanceof Error ? cause.message : 'Could not remove this person.';
    } finally {
      busyIdentity = '';
    }
  }
</script>

<!-- On a phone the sheet rises over a scrim; a tap on it closes the sheet. -->
<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
<div class="scrim" onclick={onclose}></div>
<aside class="people-panel" aria-label="People">
  <span class="handle" aria-hidden="true"></span>
  <header>
    <h2>People</h2>
    <span class="count">{rtc.participants.length}</span>
    <button type="button" class="close" aria-label="Close" title="Close" onclick={onclose}>
      <X size={16} weight="regular" aria-hidden="true" />
    </button>
  </header>

  <div class="body">
    {#if canManage && pending.length > 0}
      <section class="waiting" aria-label="Lobby">
        <div class="section-heading">
          <h3>Waiting</h3>
          <span class="count">{pending.length}</span>
        </div>
        {#each pending as request (request.id)}
          <div class="row waiting-row">
            <span class="avatar" style:--pc={`var(--p${participantColor(request.id)}-bg)`}>
              {initials(request.name)}
            </span>
            <span class="participant-name">{request.name}</span>
            <div class="row-actions">
              <button type="button" class="deny" onclick={() => void ondeny(request.id)}>
                Deny
              </button>
              <button class="admit" type="button" onclick={() => void onadmit(request.id)}>
                Admit
              </button>
            </div>
          </div>
        {/each}
        {#if lobbyError}<p class="error" role="alert">{lobbyError}</p>{/if}
      </section>
    {/if}

    <section class="in-call" aria-label="In the call">
      {#if canManage && pending.length > 0}
        <div class="section-heading"><h3>In the call</h3></div>
      {/if}
      {#each rtc.participants as participant (participant.identity)}
        {@const color = participantColor(participant.identity)}
        <div class="row participant-row" data-identity={participant.identity}>
          <span
            class="avatar"
            class:self={participant.isLocal}
            style:--pc={`var(--p${color}-bg)`}
            style:--pf={`var(--p${color}-fg)`}
            aria-hidden="true">{initials(participant.name)}</span
          >
          <div class="who">
            <div class="name-line">
              <span class="participant-name">{participant.name}</span>
              {#if participant.isLocal}<span class="you">(You)</span>{/if}
            </div>
            {#if rtc.isHostParticipant(participant)}<span class="role">Meeting host</span>{/if}
          </div>
          <div class="media-state">
            {#if participant.micMuted}
              <MicrophoneSlash size={16} weight="regular" aria-label="Microphone off" />
            {/if}
            {#if participant.camMuted}
              <VideoCameraSlash size={16} weight="regular" aria-label="Camera off" />
            {/if}
          </div>

          {#if canManage && !participant.isLocal}
            <div class="moderation-actions">
              <button
                type="button"
                disabled={busyIdentity === participant.identity || participant.micMuted}
                onclick={() => void mute(participant)}
              >
                Mute
              </button>
              <button
                class:confirm={confirmIdentity === participant.identity}
                type="button"
                disabled={busyIdentity === participant.identity}
                onclick={() => void remove(participant)}
              >
                {confirmIdentity === participant.identity ? 'Remove?' : 'Remove'}
              </button>
            </div>
          {/if}
        </div>
      {/each}
    </section>

    {#if moderationError}<p class="error" role="alert">{moderationError}</p>{/if}
  </div>
</aside>

<style>
  /* The side-sheet contract shared with the chat sheet: fixed 16px in from
     the top, right and bottom, 380px wide; a bottom sheet on a phone. */
  .people-panel {
    position: fixed;
    z-index: 15;
    top: 16px;
    right: 16px;
    bottom: 16px;
    display: flex;
    width: 380px;
    max-width: calc(100vw - 32px);
    flex-direction: column;
    color: var(--ink);
    background: var(--surface);
    border-radius: var(--r-lg);
    box-shadow: var(--shadow-float);
    animation: sheet-in var(--dur-3) var(--ease-out);
  }

  .handle,
  .scrim {
    display: none;
  }

  header {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 18px 16px 12px 20px;
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 17px;
    font-weight: 600;
    letter-spacing: -0.01em;
  }

  .count {
    color: var(--ink-3);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .close {
    display: grid;
    width: 32px;
    height: 32px;
    margin-left: auto;
    padding: 0;
    place-items: center;
    color: var(--ink-2);
    border: 1px solid var(--line-strong);
    border-radius: 50%;
  }

  .close:hover {
    color: var(--ink);
    background: var(--surface-2);
  }

  .body {
    display: grid;
    min-height: 0;
    flex: 1;
    align-content: start;
    gap: 16px;
    padding: 0 12px 16px;
    overflow-y: auto;
  }

  section {
    display: grid;
    gap: 2px;
  }

  .section-heading {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px 6px;
  }

  h3 {
    color: var(--ink-3);
    font-size: 12px;
    font-weight: 500;
  }

  .waiting {
    padding-bottom: 14px;
    border-bottom: 1px solid var(--line);
  }

  .row {
    display: flex;
    min-height: 52px;
    align-items: center;
    gap: 12px;
    padding: 6px 8px;
    border-radius: var(--r-sm);
  }

  .participant-row:hover,
  .participant-row:focus-within {
    background: var(--surface-2);
  }

  .avatar {
    display: grid;
    flex: none;
    width: 36px;
    height: 36px;
    place-items: center;
    color: var(--pf, var(--ink));
    font-size: 13px;
    font-weight: 500;
    background: var(--pc);
    border-radius: 50%;
  }

  .avatar.self {
    color: var(--accent);
    background: var(--surface);
    box-shadow: inset 0 0 0 1.5px color-mix(in srgb, var(--accent) 60%, transparent);
  }

  .who {
    display: grid;
    min-width: 0;
    flex: 1;
  }

  .name-line {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 4px;
  }

  .participant-name {
    min-width: 0;
    overflow: hidden;
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .waiting-row .participant-name {
    flex: 1;
  }

  .you {
    flex: none;
    color: var(--ink-3);
    font-size: 14px;
  }

  .role {
    color: var(--ink-3);
    font-size: 12px;
    line-height: 16px;
  }

  .media-state {
    display: flex;
    flex: none;
    gap: 6px;
    color: var(--ink-3);
  }

  .row-actions,
  .moderation-actions {
    display: flex;
    flex: none;
    gap: 6px;
  }

  button {
    height: 30px;
    padding: 0 12px;
    color: var(--ink);
    font-size: 13px;
    font-weight: 500;
    background: var(--surface-2);
    border: 0;
    border-radius: var(--r-pill);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  button:hover:not(:disabled) {
    background: color-mix(in srgb, var(--ink) 8%, var(--surface-2));
  }

  .participant-row:hover button:not(.confirm),
  .participant-row:focus-within button:not(.confirm) {
    background: var(--surface);
  }

  button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  button.admit {
    color: var(--on-accent);
    background: var(--accent);
  }

  button.admit:hover {
    background: var(--accent-hover);
  }

  button.deny {
    color: var(--ink-2);
    background: transparent;
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  button.confirm {
    color: var(--rec-ink);
    background: var(--rec-soft);
  }

  .moderation-actions {
    opacity: 0;
    transition: opacity var(--dur-1) var(--ease-out);
  }

  .participant-row:hover .moderation-actions,
  .participant-row:focus-within .moderation-actions {
    opacity: 1;
  }

  .error {
    padding: 0 8px;
    color: var(--rec-ink);
    font-size: 12px;
  }

  @keyframes sheet-in {
    from {
      transform: translateX(calc(100% + 16px));
    }
  }

  @media (hover: none) {
    .moderation-actions {
      opacity: 1;
    }
  }

  @media (max-width: 639.98px) {
    .people-panel {
      z-index: 31;
      top: 15vh;
      right: 0;
      bottom: 0;
      left: 0;
      width: auto;
      max-width: none;
      border-radius: var(--r-lg) var(--r-lg) 0 0;
      padding-bottom: env(safe-area-inset-bottom);
      animation-name: sheet-up;
    }

    .scrim {
      position: fixed;
      z-index: 30;
      inset: 0;
      display: block;
      background: var(--scrim);
      animation: fade-in var(--dur-2) var(--ease-out);
    }

    .handle {
      display: block;
      align-self: center;
      width: 36px;
      height: 4px;
      margin-top: 8px;
      background: var(--line-strong);
      border-radius: var(--r-pill);
    }

    header {
      padding-top: 10px;
    }
  }

  @keyframes fade-in {
    from {
      opacity: 0;
    }
  }

  @keyframes sheet-up {
    from {
      transform: translateY(100%);
    }
  }
</style>
