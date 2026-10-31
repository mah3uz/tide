<script lang="ts">
  import { Screencast, StopCircle } from 'phosphor-svelte';
  import type { RoomState } from './room.svelte';

  // Stands in for the presenter's own share: shown back to them, a share of
  // the meeting's screen repeats itself without end and can hang the browser.
  let { rtc }: { rtc: RoomState } = $props();
</script>

<div class="presenting" data-testid="presenting-card">
  <span class="badge" aria-hidden="true">
    <Screencast size={16} weight="regular" />
  </span>
  <p class="title">You're presenting</p>
  <p class="detail">Everyone in the call sees your screen</p>
  <button
    type="button"
    class="stop"
    aria-busy={rtc.mediaBusy.screen}
    onclick={() => void rtc.toggleScreenShare()}
  >
    <StopCircle size={16} weight="regular" aria-hidden="true" />
    <span>Stop presenting</span>
  </button>
</div>

<style>
  .presenting {
    display: grid;
    grid-area: 1 / 1;
    min-width: 0;
    min-height: 0;
    place-content: center;
    justify-items: center;
    padding: 16px;
    text-align: center;
    background: var(--surface-2);
    container-type: size;
  }

  .badge {
    display: grid;
    width: 40px;
    height: 40px;
    margin-bottom: 14px;
    place-items: center;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    border-radius: 50%;
  }

  p {
    margin: 0;
  }

  .title {
    color: var(--ink);
    font-size: 17px;
    font-weight: 600;
    line-height: 24px;
    letter-spacing: -0.01em;
  }

  .detail {
    color: var(--ink-2);
    font-size: 13px;
    line-height: 20px;
  }

  .stop {
    display: inline-flex;
    height: 40px;
    margin-top: 18px;
    padding: 0 16px 0 14px;
    align-items: center;
    gap: 8px;
    color: var(--rec-ink);
    font-size: 14px;
    font-weight: 500;
    white-space: nowrap;
    background: var(--rec-soft);
    border: 0;
    border-radius: var(--r-pill);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .stop:hover {
    background: color-mix(in srgb, var(--rec) 14%, var(--rec-soft));
  }

  .stop[aria-busy='true'] {
    cursor: progress;
    opacity: 0.75;
  }

  /* A short frame (a phone's share, a small popout) keeps the title and the button. */
  @container (max-height: 199.98px) {
    .badge,
    .detail {
      display: none;
    }

    .stop {
      margin-top: 10px;
    }
  }

  @container (max-height: 99.98px) {
    .title {
      display: none;
    }

    .stop {
      margin-top: 0;
    }
  }
</style>
