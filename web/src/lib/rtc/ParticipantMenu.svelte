<script lang="ts">
  import { DotsThreeVertical, Eye, EyeSlash, MicrophoneSlash, UserMinus } from 'phosphor-svelte';
  import type { ParticipantView } from './media';

  let {
    participant,
    compact = false,
    side = 'left',
    open = false,
    videoHidden = false,
    canManage = false,
    onopenchange = () => undefined,
    ontogglevideo = () => undefined,
    onmute = () => undefined,
    onremove = () => undefined
  }: {
    participant: ParticipantView;
    /** A portal's small trigger; its menu opens upward. */
    compact?: boolean;
    /** Which way the menu reaches from its trigger, to stay on the stage. */
    side?: 'left' | 'right';
    open?: boolean;
    videoHidden?: boolean;
    canManage?: boolean;
    onopenchange?: (open: boolean) => void;
    ontogglevideo?: () => void | Promise<void>;
    onmute?: () => void | Promise<void>;
    onremove?: () => void | Promise<void>;
  } = $props();

  let trigger: HTMLButtonElement;
  let busyAction = $state<'video' | 'mute' | 'remove' | ''>('');
  let confirmRemove = $state(false);
  let error = $state('');

  $effect(() => {
    if (open) return;
    confirmRemove = false;
    error = '';
  });

  function close(focusTrigger = false): void {
    onopenchange(false);
    if (focusTrigger) trigger?.focus();
  }

  function toggleMenu(): void {
    onopenchange(!open);
  }

  async function run(
    action: 'video' | 'mute' | 'remove',
    callback: () => void | Promise<void>,
    fallback: string
  ): Promise<void> {
    if (busyAction) return;
    busyAction = action;
    error = '';
    try {
      await callback();
      close();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : fallback;
    } finally {
      busyAction = '';
    }
  }

  function remove(): void {
    if (!confirmRemove) {
      confirmRemove = true;
      return;
    }
    void run('remove', onremove, 'Could not remove this person.');
  }
</script>

<svelte:window
  onclick={() => {
    if (open) close();
  }}
  onkeydown={(event) => {
    if (open && event.key === 'Escape') close(true);
  }}
/>

<!-- The propagation shield keeps this menu open while its own controls run. -->
<!-- svelte-ignore a11y_no_static_element_interactions, a11y_click_events_have_key_events -->
<div class="participant-actions" class:compact onclick={(event) => event.stopPropagation()}>
  <button
    bind:this={trigger}
    class="menu-trigger"
    class:active={open}
    type="button"
    aria-label={`Actions for ${participant.name}`}
    aria-haspopup="menu"
    aria-expanded={open}
    title={`Actions for ${participant.name}`}
    onclick={toggleMenu}
  >
    <DotsThreeVertical size={compact ? 14 : 16} weight="bold" aria-hidden="true" />
  </button>

  {#if open}
    <div
      class="participant-menu"
      class:reach-right={side === 'right'}
      role="menu"
      aria-label={`${participant.name} actions`}
    >
      <button
        type="button"
        role="menuitem"
        disabled={Boolean(busyAction)}
        onclick={() =>
          void run(
            'video',
            ontogglevideo,
            videoHidden ? 'Could not show this video.' : 'Could not hide this video.'
          )}
      >
        {#if videoHidden}
          <Eye size={16} weight="regular" aria-hidden="true" />
          <span>Show video</span>
        {:else}
          <EyeSlash size={16} weight="regular" aria-hidden="true" />
          <span>Hide video</span>
        {/if}
      </button>

      {#if canManage}
        <div class="separator" aria-hidden="true"></div>
        <button
          type="button"
          role="menuitem"
          disabled={Boolean(busyAction) || participant.micMuted}
          onclick={() => void run('mute', onmute, 'Could not mute this person.')}
        >
          <MicrophoneSlash size={16} weight="regular" aria-hidden="true" />
          <span>{participant.micMuted ? 'Muted' : 'Mute'}</span>
        </button>
        <button
          class="danger"
          class:confirm={confirmRemove}
          type="button"
          role="menuitem"
          disabled={Boolean(busyAction)}
          onclick={remove}
        >
          <UserMinus size={16} weight="regular" aria-hidden="true" />
          <span>{confirmRemove ? 'Remove?' : 'Remove'}</span>
        </button>
      {/if}

      {#if error}<p class="error" role="alert">{error}</p>{/if}
    </div>
  {/if}
</div>

<style>
  .participant-actions {
    position: absolute;
    z-index: 4;
    top: 16px;
    right: 16px;
  }

  .participant-actions.compact {
    top: 0;
    right: 0;
  }

  button {
    color: var(--ink);
    background: transparent;
    border: 0;
  }

  button:disabled {
    cursor: default;
    opacity: 0.45;
  }

  .menu-trigger {
    display: grid;
    width: 36px;
    height: 36px;
    padding: 0;
    place-items: center;
    background: color-mix(in srgb, var(--surface) 72%, transparent);
    border-radius: 50%;
    transition:
      background-color var(--dur-1) var(--ease-out),
      opacity var(--dur-1) var(--ease-out);
  }

  .menu-trigger:hover,
  .menu-trigger.active {
    background: var(--surface);
  }

  .compact .menu-trigger {
    width: 26px;
    height: 26px;
    background: var(--surface);
    box-shadow: var(--shadow-float);
  }

  /* On a portal the trigger shows on hover or focus; a touch screen, with no
     hover, always shows it. */
  @media (hover: hover) {
    .compact .menu-trigger:not(.active, :focus-visible) {
      opacity: 0;
    }

    :global(.tile:hover) .compact .menu-trigger {
      opacity: 1;
    }
  }

  .participant-menu {
    position: absolute;
    top: calc(100% + 6px);
    right: 0;
    display: grid;
    width: 184px;
    padding: 6px;
    gap: 2px;
    color: var(--ink);
    background: var(--surface);
    border-radius: var(--r-md);
    box-shadow: var(--shadow-float);
    animation: menu-down var(--dur-2) var(--ease-out);
  }

  .participant-menu.reach-right {
    right: auto;
    left: 0;
  }

  .compact .participant-menu {
    top: auto;
    bottom: calc(100% + 6px);
    animation-name: menu-up;
  }

  .participant-menu button {
    display: flex;
    width: 100%;
    min-height: 34px;
    padding: 6px 10px;
    align-items: center;
    gap: 10px;
    color: var(--ink);
    font-size: 13px;
    text-align: left;
    border-radius: var(--r-sm);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .participant-menu button:hover:not(:disabled),
  .participant-menu button:focus-visible {
    background: var(--surface-2);
  }

  .participant-menu button.danger,
  .participant-menu button.confirm {
    color: var(--rec-ink);
  }

  .participant-menu button.confirm {
    background: var(--rec-soft);
  }

  .separator {
    height: 1px;
    margin: 3px 6px;
    background: var(--line);
  }

  .error {
    margin: 4px 8px 2px;
    color: var(--rec-ink);
    font-size: 12px;
    line-height: 16px;
  }

  @keyframes menu-down {
    from {
      opacity: 0;
      transform: translateY(-4px);
    }
  }

  @keyframes menu-up {
    from {
      opacity: 0;
      transform: translateY(4px);
    }
  }

  /* A phone's portals scroll in a strip that would clip the menu, so it
     opens as a bar above the strip instead. */
  @media (max-width: 639.98px) {
    .compact .participant-menu {
      position: fixed;
      z-index: 30;
      right: 16px;
      bottom: calc(var(--dock-h, 92px) + 104px);
      left: 16px;
      width: auto;
    }
  }
</style>
