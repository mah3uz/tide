<script lang="ts">
  import { DownloadSimple, Export, PlusSquare } from 'phosphor-svelte';
  import { pwaInstall } from '#lib/pwa/install.svelte.js';
  import Dialog from './Dialog.svelte';

  // Safari on iPhone and iPad never offers an install prompt: there the
  // button explains the Share sheet route instead.
  const shown = $derived(!pwaInstall.isStandalone && (pwaInstall.canInstall || pwaInstall.isIOS));
  let hintOpen = $state(false);

  function install(): void {
    if (pwaInstall.canInstall) void pwaInstall.install();
    else hintOpen = true;
  }
</script>

{#if shown}
  <button
    type="button"
    class="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-pill border border-line bg-transparent p-0 text-[13px] text-ink-2 transition-colors duration-(--dur-1) ease-out hover:bg-surface-2 hover:text-ink max-sm:w-9 sm:px-3.5 pointer-coarse:h-11 pointer-coarse:max-sm:w-11"
    aria-label="Install app"
    onclick={install}
  >
    <DownloadSimple size={18} weight="regular" aria-hidden="true" />
    <span class="max-sm:hidden">Install app</span>
  </button>
{/if}

{#if pwaInstall.isIOS}
  <Dialog bind:open={hintOpen} title="Install tide" width={340}>
    <ol class="m-0 flex list-none flex-col gap-3 p-0 text-[14px] text-ink-2">
      <li class="flex items-center gap-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-ink">
          <Export size={18} weight="regular" aria-hidden="true" />
        </span>
        <span>Tap <strong class="font-medium text-ink">Share</strong> in Safari's toolbar.</span>
      </li>
      <li class="flex items-center gap-3">
        <span class="grid size-8 shrink-0 place-items-center rounded-sm bg-surface-2 text-ink">
          <PlusSquare size={18} weight="regular" aria-hidden="true" />
        </span>
        <span>Choose <strong class="font-medium text-ink">Add to Home Screen</strong>.</span>
      </li>
    </ol>
  </Dialog>
{/if}
