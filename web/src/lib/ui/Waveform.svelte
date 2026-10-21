<script lang="ts">
  import type { Track } from 'livekit-client';
  import { createMeter } from '#lib/rtc/audioLevel.js';

  let { track }: { track?: Track } = $props();

  // Uneven bar weights give the Apple-style silhouette; the rAF callback
  // writes transforms straight onto the elements — no Svelte state at 60fps.
  const weights = [0.55, 1, 0.8, 0.5];
  const idleScale = 0.18;

  const reduceMotion =
    typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  let bars = $state<HTMLSpanElement[]>([]);

  function apply(level: number): void {
    for (const [index, bar] of bars.entries()) {
      if (!bar) continue;
      const scale = idleScale + (1 - idleScale) * Math.min(1, level) * weights[index];
      bar.style.transform = `scaleY(${scale.toFixed(3)})`;
    }
  }

  $effect(() => {
    const mediaTrack = track?.mediaStreamTrack;
    if (!mediaTrack || reduceMotion) return;
    const dispose = createMeter(mediaTrack, apply);
    return () => {
      dispose();
      apply(0);
    };
  });
</script>

<div class="waveform" aria-hidden="true">
  {#each weights as weight, index (weight)}
    <span bind:this={bars[index]}></span>
  {/each}
</div>

<style>
  /* Bars run the brand mark's gradient, left to right; no box of its own, so
     it sits inside whatever chip carries the name. */
  .waveform {
    display: flex;
    flex: none;
    gap: 3px;
    align-items: center;
    height: 18px;
  }

  .waveform span {
    width: 3px;
    height: 16px;
    background: var(--mark-from);
    border-radius: 2px;
    transform: scaleY(0.18);
    transform-origin: center;
    will-change: transform;
  }

  .waveform span:nth-child(2) {
    background: color-mix(in srgb, var(--mark-from), var(--mark-to) 33%);
  }

  .waveform span:nth-child(3) {
    background: color-mix(in srgb, var(--mark-from), var(--mark-to) 66%);
  }

  .waveform span:nth-child(4) {
    background: var(--mark-to);
  }
</style>
