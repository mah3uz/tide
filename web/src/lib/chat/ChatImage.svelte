<script lang="ts">
  import { DownloadSimple } from 'phosphor-svelte';
  import Button from '#lib/ui/Button.svelte';
  import Dialog from '#lib/ui/Dialog.svelte';
  import { downloadName, withheldNotice, type ChatImage } from './images';

  let { image, from, ts }: { image: ChatImage; from: string; ts: number } = $props();

  const maximumWidth = 260;
  const maximumHeight = 320;
  const minimumWidth = 48;
  const minimumHeight = 48;

  let viewing = $state(false);
  // Sized from the sender's dimensions before it decodes, so the log doesn't jump.
  const box = $derived.by(() => {
    if (image.kind !== 'image') return { width: 0, height: 0 };
    let width = Math.min(maximumWidth, image.width);
    let height = (width * image.height) / image.width;
    if (height > maximumHeight) {
      height = maximumHeight;
      width = Math.max(minimumWidth, (height * image.width) / image.height);
    }
    return { width: Math.round(width), height: Math.max(minimumHeight, Math.round(height)) };
  });
</script>

{#if image.kind === 'withheld'}
  <p class="notice">{withheldNotice(from)}</p>
{:else if !image.url}
  <div class="picture gone" style:width={`${box.width}px`} style:height={`${box.height}px`}>
    Image no longer available
  </div>
{:else}
  {@const filename = downloadName(from, ts, image.mimeType)}
  <div class="picture" style:width={`${box.width}px`} style:height={`${box.height}px`}>
    <button
      class="open"
      type="button"
      aria-label={`View image from ${from}`}
      onclick={() => (viewing = true)}
    >
      <img
        src={image.url}
        alt=""
        width={box.width}
        height={box.height}
        loading="lazy"
        decoding="async"
      />
    </button>
    <a class="download" href={image.url} download={filename} aria-label="Download image">
      <DownloadSimple size={16} weight="regular" aria-hidden="true" />
    </a>
  </div>

  <Dialog bind:open={viewing} title={`Image from ${from}`} width={Math.min(image.width + 40, 1040)}>
    <img
      class="full"
      src={image.url}
      alt={`Image from ${from}`}
      width={image.width}
      height={image.height}
      decoding="async"
    />
    <div class="actions">
      <Button variant="accent" href={image.url} download={filename}>
        <DownloadSimple size={16} weight="regular" aria-hidden="true" />
        Download
      </Button>
    </div>
  </Dialog>
{/if}

<style>
  .picture {
    position: relative;
    max-width: 100%;
  }

  .gone {
    display: grid;
    place-items: center;
    padding: 8px;
    color: var(--ink-3);
    font-size: 12px;
    text-align: center;
  }

  .notice {
    margin: 0;
    padding: 6px 10px;
    color: var(--ink-3);
    font-size: 12px;
  }

  .open {
    display: block;
    width: 100%;
    height: 100%;
    padding: 0;
    overflow: hidden;
    background: transparent;
    border: 0;
    cursor: zoom-in;
  }

  .open img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
  }

  .download {
    position: absolute;
    right: 6px;
    bottom: 6px;
    display: grid;
    width: 32px;
    height: 32px;
    place-items: center;
    color: var(--ink);
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    border-radius: var(--r-pill);
    box-shadow: 0 0 0 1px var(--line-strong);
    backdrop-filter: blur(8px);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .download:hover {
    background: var(--surface);
  }

  @media (pointer: coarse) {
    .download {
      width: 44px;
      height: 44px;
      right: 4px;
      bottom: 4px;
    }
  }

  .full {
    display: block;
    width: auto;
    max-width: 100%;
    height: auto;
    max-height: calc(100dvh - 190px);
    margin: 0 auto;
    object-fit: contain;
    border-radius: var(--r-sm);
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    margin-top: 16px;
  }
</style>
