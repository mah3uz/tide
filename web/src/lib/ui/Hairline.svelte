<script lang="ts">
  import type { HairlineState } from '#lib/rtc/connection.svelte.js';

  let { mode }: { mode: HairlineState } = $props();
</script>

<div class="hairline {mode}" data-testid="hairline" data-state={mode} aria-hidden="true"></div>

<style>
  .hairline {
    position: fixed;
    z-index: 100;
    inset: 0 0 auto;
    height: 2px;
    background: linear-gradient(90deg, var(--mark-from), var(--mark-to));
  }

  .reconnecting {
    background: var(--warn);
  }

  .offline {
    background: var(--ink-3);
  }

  .recording {
    background: var(--rec);
    animation: recording-pulse 2s var(--ease-in-out) infinite;
  }

  @keyframes recording-pulse {
    50% {
      opacity: 0.45;
    }
  }

  @media (prefers-reduced-motion: reduce) {
    .recording {
      animation: none;
    }
  }
</style>
