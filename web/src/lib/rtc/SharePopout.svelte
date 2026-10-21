<script lang="ts">
  import {
    ArrowSquareIn,
    Microphone,
    MicrophoneSlash,
    VideoCamera,
    VideoCameraSlash
  } from 'phosphor-svelte';
  import BrandMark from '#lib/ui/BrandMark.svelte';
  import { initials, participantColor } from '#lib/ui/participantColor.js';
  import type { ParticipantView } from './media';
  import { attachMediaTrack } from './mediaElement';
  import type { RoomState } from './room.svelte';

  // Lives in its own window (Document Picture-in-Picture): no window-level
  // listeners or media queries here would see that window, so it has none.
  let {
    rtc,
    roomName,
    presenter,
    speaker,
    onback
  }: {
    rtc: RoomState;
    roomName: string;
    /** Whoever is sharing; gone for a moment as a share ends, before this closes. */
    presenter?: ParticipantView;
    /** The stage's lens: the most recent speaker. */
    speaker?: ParticipantView;
    onback: () => void;
  } = $props();

  const shownPortals = 3;

  // The speaker first, then the room in stage order (others, then you).
  const people = $derived.by(() => {
    const order = [
      ...rtc.participants.filter((participant) => !participant.isLocal),
      ...rtc.participants.filter((participant) => participant.isLocal)
    ];
    return speaker
      ? [speaker, ...order.filter((participant) => participant.identity !== speaker.identity)]
      : order;
  });
  const portals = $derived(people.slice(0, shownPortals));
  const more = $derived(people.length - portals.length);
</script>

<div class="popout">
  <header>
    <span class="title">
      <BrandMark size={12} />
      <span class="who">{presenter?.name ?? ''} · Screen</span>
      <span class="room">{roomName}</span>
    </span>
    <button type="button" class="back" aria-label="Back to meeting" onclick={onback}>
      <ArrowSquareIn size={16} weight="regular" aria-hidden="true" />
      <span class="back-text">Back to meeting</span>
    </button>
  </header>

  <div class="frame">
    {#if presenter?.screenShare}
      {#key presenter.screenShare.publicationSid}
        <!-- Live screen share does not have a caption track. -->
        <video
          class="share"
          use:attachMediaTrack={presenter.screenShare}
          autoplay
          playsinline
          muted
          aria-label={`${presenter.name}'s screen share`}
        ></video>
      {/key}
    {/if}

    <div class="cluster">
      <div class="portals" role="group" aria-label="In the call">
        {#each portals as person, index (person.identity)}
          {@const color = participantColor(person.identity)}
          {@const speaking = rtc.activeSpeakerIdentities.includes(person.identity)}
          <span
            class="portal"
            class:lead={index === 0}
            class:speaking
            style:--pbg={`var(--p${color}-bg)`}
            style:--pfg={`var(--p${color}-fg)`}
            role="img"
            aria-label={speaking ? `${person.name}, speaking` : person.name}
            title={person.name}
          >
            {#if person.camera && !rtc.isParticipantCameraHidden(person.identity)}
              <video
                use:attachMediaTrack={person.camera}
                autoplay
                playsinline
                muted
                class:mirrored={person.isLocal}
              ></video>
            {:else}
              {initials(person.name)}
            {/if}
          </span>
        {/each}
        {#if more > 0}
          <span class="portal more" role="img" aria-label={`${more} more`}>+{more}</span>
        {/if}
      </div>
      <span class="separator" aria-hidden="true"></span>
      <button
        type="button"
        class="toggle"
        class:on={rtc.micEnabled}
        class:off={!rtc.micEnabled}
        aria-label={rtc.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        aria-pressed={rtc.micEnabled}
        aria-busy={rtc.mediaBusy.microphone}
        title={rtc.micEnabled ? 'Mute microphone' : 'Unmute microphone'}
        onclick={() => void rtc.toggleMic()}
      >
        {#if rtc.micEnabled}
          <Microphone size={16} weight="regular" aria-hidden="true" />
        {:else}
          <MicrophoneSlash size={16} weight="regular" aria-hidden="true" />
        {/if}
      </button>
      <button
        type="button"
        class="toggle"
        class:off={!rtc.camEnabled}
        aria-label={rtc.camEnabled ? 'Turn camera off' : 'Turn camera on'}
        aria-pressed={rtc.camEnabled}
        aria-busy={rtc.mediaBusy.camera}
        title={rtc.camEnabled ? 'Turn camera off' : 'Turn camera on'}
        onclick={() => void rtc.toggleCam()}
      >
        {#if rtc.camEnabled}
          <VideoCamera size={16} weight="regular" aria-hidden="true" />
        {:else}
          <VideoCameraSlash size={16} weight="regular" aria-hidden="true" />
        {/if}
      </button>
    </div>
  </div>
</div>

<style>
  .popout {
    display: flex;
    height: 100dvh;
    flex-direction: column;
    gap: 10px;
    padding: 10px;
    color: var(--ink);
    background: var(--bg);
  }

  header {
    display: flex;
    min-height: 30px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding-left: 8px;
  }

  .title {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
  }

  .who,
  .room {
    overflow: hidden;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .who {
    flex: 0 1 auto;
    font-size: 13px;
    font-weight: 600;
  }

  .room {
    flex: 0 2 auto;
    min-width: 0;
    color: var(--ink-3);
    font-size: 12px;
  }

  button {
    padding: 0;
    border: 0;
    transition:
      color var(--dur-1) var(--ease-out),
      background-color var(--dur-1) var(--ease-out);
  }

  .back {
    display: inline-flex;
    flex: none;
    height: 30px;
    padding: 0 12px 0 10px;
    align-items: center;
    gap: 6px;
    color: var(--ink);
    font-size: 12px;
    font-weight: 500;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
  }

  .back:hover {
    background: var(--surface-2);
  }

  .frame {
    position: relative;
    display: grid;
    min-height: 0;
    flex: 1;
    grid-template: minmax(0, 1fr) / minmax(0, 1fr);
    overflow: hidden;
    background: var(--surface);
    border-radius: var(--r-md);
  }

  .share {
    width: 100%;
    height: 100%;
    min-height: 0;
    object-fit: contain;
  }

  .cluster {
    position: absolute;
    right: 12px;
    bottom: 12px;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px;
    background: color-mix(in srgb, var(--surface) 92%, transparent);
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-float);
  }

  .portals {
    display: flex;
    align-items: center;
    gap: 8px;
  }

  .portal {
    position: relative;
    display: grid;
    width: 32px;
    height: 32px;
    flex: none;
    place-items: center;
    color: var(--pfg);
    font-size: 11px;
    font-weight: 600;
    background: var(--pbg);
    border-radius: 50%;
  }

  .portal.lead {
    width: 40px;
    height: 40px;
    font-size: 13px;
  }

  .portal video {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 50%;
  }

  video.mirrored {
    transform: scaleX(-1);
  }

  /* The ring is its own layer, so speaking only fades an opacity. */
  .portal::after {
    position: absolute;
    inset: 0;
    content: '';
    border-radius: 50%;
    box-shadow:
      0 0 0 2px var(--speak-ring),
      0 0 0 6px var(--speak-glow);
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-2) var(--ease-out);
  }

  .portal.speaking::after {
    opacity: 1;
  }

  .portal.more {
    color: var(--ink-2);
    background: var(--surface-2);
  }

  .separator {
    width: 1px;
    height: 22px;
    flex: none;
    background: var(--line-strong);
  }

  .toggle {
    display: grid;
    width: 36px;
    height: 36px;
    flex: none;
    place-items: center;
    color: var(--ink);
    background: var(--surface-2);
    border-radius: 50%;
  }

  .toggle:hover {
    background: color-mix(in srgb, var(--ink) 7%, var(--surface-2));
  }

  .toggle.on {
    color: var(--on-accent);
    background: var(--accent);
  }

  .toggle.on:hover {
    background: var(--accent-hover);
  }

  .toggle.off {
    color: var(--rec-ink);
    background: var(--rec-soft);
  }

  .toggle[aria-busy='true'] {
    cursor: progress;
    opacity: 0.75;
  }

  /* A window shrunk small keeps the share: the room name, the extra
     portals and the button's words give way first. */
  @media (max-width: 479.98px) {
    .room,
    .portal:not(.lead) {
      display: none;
    }
  }

  @media (max-width: 359.98px) {
    .back {
      width: 30px;
      padding: 0;
      justify-content: center;
    }

    .back-text {
      display: none;
    }
  }
</style>
