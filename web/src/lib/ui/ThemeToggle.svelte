<script lang="ts">
  import { Moon, Sun } from 'phosphor-svelte';
  import { theme, type Theme } from './theme.svelte.js';

  let next = $derived<Theme>(theme.resolved === 'dark' ? 'light' : 'dark');
</script>

<button
  type="button"
  class="inline-grid size-9 shrink-0 place-items-center rounded-pill border border-line bg-transparent p-0 text-ink-2 transition-colors duration-(--dur-1) ease-out hover:bg-surface-2 hover:text-ink pointer-coarse:size-11"
  aria-label={`Switch to ${next} theme`}
  onclick={() => theme.set(next)}
>
  {#if next === 'dark'}
    <Moon size={18} weight="regular" aria-hidden="true" />
  {:else}
    <Sun size={18} weight="regular" aria-hidden="true" />
  {/if}
</button>
