<script lang="ts">
  import { onMount, type Snippet } from 'svelte';
  import { page } from '$app/state';
  import { connectionChrome } from '#lib/rtc/connection.svelte.js';
  import { registerServiceWorker } from '#lib/pwa/register.js';
  import Hairline from '#lib/ui/Hairline.svelte';
  import { theme } from '#lib/ui/theme.svelte.js';
  import '@fontsource-variable/space-grotesk';
  import '@fontsource-variable/jetbrains-mono';
  import '../app.css';

  let { children }: { children: Snippet } = $props();
  let isEgressTemplate = $derived(page.url.pathname === '/egress-template');

  // Recordings are always dark, whatever the viewer chose.
  $effect(() => {
    const resolved = isEgressTemplate ? 'dark' : theme.resolved;
    document.documentElement.dataset.theme = resolved;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute('content', resolved === 'dark' ? '#070b0a' : '#e8ebe4');
  });

  onMount(registerServiceWorker);
</script>

<div class="app-shell">
  {#if !isEgressTemplate}<Hairline mode={connectionChrome.state} />{/if}
  {@render children()}
</div>
