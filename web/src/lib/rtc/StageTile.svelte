<script lang="ts">
  import { MicrophoneSlash } from 'phosphor-svelte';
  import { participantColor } from '#lib/ui/participantColor.js';
  import Waveform from '#lib/ui/Waveform.svelte';
  import type { ParticipantView } from './media';
  import { attachMediaTrack } from './mediaElement';
  import ParticipantMenu from './ParticipantMenu.svelte';
  import type { Rect, Shape } from './stageLayout';

  let {
    participant,
    shape,
    rect,
    speaking = false,
    videoHidden = false,
    menuOpen = false,
    menuSide = 'left',
    canManage = false,
    onmenuopenchange,
    ontogglevideo,
    onmute,
    onremove
  }: {
    participant: ParticipantView;
    shape: Shape;
    /** Absent for a portal in the phone's scrolling strip, which sits in flow. */
    rect?: Rect;
    speaking?: boolean;
    videoHidden?: boolean;
    menuOpen?: boolean;
    menuSide?: 'left' | 'right';
    canManage?: boolean;
    onmenuopenchange?: (open: boolean) => void;
    ontogglevideo?: () => void | Promise<void>;
    onmute?: () => void | Promise<void>;
    onremove?: () => void | Promise<void>;
  } = $props();

  // A tile that changes shape fades in where it lands instead of sliding
  // across the stage; only a portal moving among portals glides.
  let entering = $state(true);
  let shownShape: Shape | undefined;
  $effect.pre(() => {
    if (shownShape !== undefined && shape !== shownShape) entering = true;
    shownShape = shape;
  });

  const color = $derived(participantColor(participant.identity));
  const initials = $derived.by(() => {
    const words = participant.name.trim().split(/\s+/).filter(Boolean);
    const first = Array.from(words[0] ?? '')[0] ?? '';
    const last = words.length > 1 ? (Array.from(words.at(-1) ?? '')[0] ?? '') : '';
    return (first + last).toUpperCase() || '?';
  });
</script>

<article
  class="tile {shape}"
  class:entering
  class:speaking
  class:self={participant.isLocal}
  class:placed={Boolean(rect)}
  class:menu-open={menuOpen}
  style:--pbg={`var(--p${color}-bg)`}
  style:--pfg={`var(--p${color}-fg)`}
  style:width={rect ? `${rect.w}px` : undefined}
  style:height={rect ? `${rect.h}px` : undefined}
  style:transform={rect ? `translate(${rect.x}px, ${rect.y}px)` : undefined}
  data-testid="participant-tile"
  data-identity={participant.identity}
  data-shape={shape}
  data-video-hidden={videoHidden}
  onanimationend={(event) => {
    if (event.target === event.currentTarget) entering = false;
  }}
>
  <div class="media">
    {#if participant.camera && !videoHidden}
      <!-- Live meeting video does not have a caption track. -->
      <!-- Always muted: audio plays through the persistent remote renderer,
           and an unmuted <video> can be blocked from autoplaying. -->
      <video
        use:attachMediaTrack={participant.camera}
        autoplay
        playsinline
        muted
        class:mirrored={participant.isLocal}
        aria-label={`${participant.name}'s video`}
      ></video>
    {:else}
      <div class="initials" aria-hidden="true">{initials}</div>
    {/if}
  </div>

  {#if videoHidden && shape !== 'portal'}<span class="video-hidden mono">Video hidden</span>{/if}

  {#if !participant.isLocal && ontogglevideo && onmenuopenchange}
    <ParticipantMenu
      {participant}
      compact={shape === 'portal'}
      side={menuSide}
      open={menuOpen}
      {videoHidden}
      {canManage}
      onopenchange={onmenuopenchange}
      {ontogglevideo}
      {onmute}
      {onremove}
    />
  {/if}

  {#if shape === 'portal'}
    {#if participant.micMuted}
      <span class="muted-badge">
        <MicrophoneSlash size={14} weight="regular" aria-label="Microphone muted" />
      </span>
    {/if}
    <span class="portal-label" title={participant.name}>
      {#if participant.isLocal}<span class="you">You</span>{:else}{participant.name}{/if}
    </span>
  {:else}
    <!-- A long name ellipsizes on one line; "(You)" and the muted icon stay. -->
    <div class="name-label" title={participant.name}>
      {#if participant.microphone?.track && !participant.microphone.muted}
        <Waveform track={participant.microphone.track} />
      {/if}
      <span class="name">{participant.name}</span>
      {#if participant.isLocal}<span class="you">(You)</span>{/if}
      {#if participant.micMuted}
        <MicrophoneSlash size={16} weight="regular" aria-label="Microphone muted" />
      {/if}
    </div>
  {/if}
</article>

<style>
  .tile {
    position: relative;
    flex: none;
    min-width: 0;
    color: var(--ink);
  }

  .tile.placed {
    position: absolute;
    z-index: 1;
    top: 0;
    left: 0;
    transition: transform var(--dur-3) var(--ease-out);
  }

  /* The lens never glides: a new speaker cross-fades in over its frame. */
  .tile.placed.lens {
    transition: none;
  }

  .tile.entering {
    transition: none;
    animation: tile-in var(--dur-2) var(--ease-out);
  }

  .tile.hidden {
    display: none;
  }

  .tile:focus-within,
  .tile.menu-open {
    z-index: 5;
  }

  .media {
    display: grid;
    width: 100%;
    height: 100%;
    overflow: hidden;
    place-items: center;
    border-radius: inherit;
  }

  video {
    grid-area: 1 / 1;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  video.mirrored {
    transform: scaleX(-1);
  }

  .initials {
    display: grid;
    place-items: center;
    color: var(--pfg);
    font-weight: 500;
    letter-spacing: -0.02em;
    background: var(--pbg);
    border-radius: 50%;
  }

  /* The ring sits on its own layer so speaking only fades an opacity. */
  .tile::after {
    position: absolute;
    inset: 0;
    content: '';
    border-radius: inherit;
    opacity: 0;
    pointer-events: none;
    transition: opacity var(--dur-2) var(--ease-out);
  }

  .tile.speaking::after {
    opacity: 1;
  }

  /* The lens: the stage's big rounded frame (its gradient is drawn by the
     frame behind it, which stays while the speaker changes). */
  .lens {
    border-radius: var(--r-xl);
  }

  .lens::after,
  .cell::after {
    box-shadow:
      0 0 0 2px var(--speak-ring),
      0 0 0 12px var(--speak-glow),
      0 30px 120px var(--speak-glow);
  }

  /* Placed lens and cells have a definite size, so the initials disc can
     follow whichever side is short. */
  .tile.placed.lens,
  .tile.placed.cell {
    container-type: size;
  }

  .lens .initials,
  .cell .initials {
    width: clamp(44px, min(28cqw, 40cqh), 148px);
    aspect-ratio: 1;
    font-size: clamp(16px, min(10cqw, 14cqh), 54px);
  }

  .cell {
    border-radius: var(--r-lg);
  }

  .cell .media {
    background: linear-gradient(160deg, var(--lens-from), var(--lens-to));
  }

  .cell::after {
    box-shadow:
      0 0 0 2px var(--speak-ring),
      0 0 0 8px var(--speak-glow);
  }

  /* Portals: everyone else, as circles around the lens. */
  .portal {
    border-radius: 50%;
    container-type: inline-size;
  }

  .portal:not(.placed) {
    width: 58px;
    height: 58px;
    margin-bottom: 22px;
    scroll-snap-align: start;
  }

  .portal .media {
    background: linear-gradient(160deg, var(--pbg), color-mix(in srgb, var(--pbg) 55%, var(--bg)));
    box-shadow: inset 0 0 0 1px var(--line-strong);
  }

  .portal .initials {
    width: 100%;
    height: 100%;
    font-size: max(15px, 30cqi);
    background: transparent;
  }

  .portal.self .media {
    background: var(--surface);
    box-shadow: none;
  }

  .portal.self .initials {
    color: var(--accent);
  }

  /* Your own portal is marked by a dashed accent ring. */
  .portal.self::before {
    position: absolute;
    z-index: 1;
    inset: -1px;
    content: '';
    border: 2px dashed color-mix(in srgb, var(--accent) 60%, transparent);
    border-radius: 50%;
    pointer-events: none;
  }

  .portal::after {
    box-shadow:
      0 0 0 2px var(--speak-ring),
      0 0 22px var(--speak-glow),
      0 0 0 6px var(--speak-glow);
  }

  .portal-label {
    position: absolute;
    top: calc(100% + 6px);
    left: 50%;
    max-width: max(100% + 16px, 76px);
    overflow: hidden;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 18px;
    white-space: nowrap;
    text-overflow: ellipsis;
    transform: translateX(-50%);
  }

  .portal:not(.placed) .portal-label {
    top: calc(100% + 4px);
    font-size: 11px;
    line-height: 16px;
  }

  .portal-label .you {
    color: var(--ink-3);
  }

  .muted-badge {
    position: absolute;
    z-index: 2;
    right: 2%;
    bottom: 2%;
    display: grid;
    width: max(22px, 24%);
    aspect-ratio: 1;
    place-items: center;
    color: var(--rec-ink);
    background: linear-gradient(var(--rec-soft), var(--rec-soft)), var(--bg);
    border: 2px solid var(--bg);
    border-radius: 50%;
  }

  /* Name chip on the lens and grid cells. */
  .name-label {
    position: absolute;
    z-index: 2;
    bottom: 16px;
    left: 16px;
    display: flex;
    max-width: calc(100% - 32px);
    min-width: 0;
    align-items: center;
    gap: 8px;
    padding: 6px 14px 6px 10px;
    color: var(--ink);
    font-size: 14px;
    font-weight: 500;
    line-height: 20px;
    white-space: nowrap;
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    border-radius: var(--r-pill);
    pointer-events: auto;
  }

  .lens .name-label {
    bottom: 22px;
    left: 22px;
    max-width: calc(100% - 44px);
    font-size: 15px;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .you {
    flex: none;
    color: var(--ink-2);
  }

  .name-label :global(svg) {
    flex: none;
    color: var(--rec-ink);
  }

  .video-hidden {
    position: absolute;
    z-index: 2;
    top: 16px;
    left: 16px;
    padding: 4px 10px;
    color: var(--ink-2);
    font-size: 11px;
    line-height: 16px;
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    border-radius: var(--r-pill);
  }

  @keyframes tile-in {
    from {
      opacity: 0;
    }
  }

  @media (max-width: 639.98px) {
    .lens {
      border-radius: var(--r-lg);
    }

    .lens .name-label,
    .name-label {
      bottom: 12px;
      left: 12px;
      max-width: calc(100% - 24px);
      font-size: 14px;
    }

    .lens::after {
      box-shadow:
        0 0 0 2px var(--speak-ring),
        0 0 0 8px var(--speak-glow),
        0 20px 60px var(--speak-glow);
    }
  }
</style>
