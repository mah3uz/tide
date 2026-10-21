<script lang="ts">
  import type { Block, Inline } from './markdown';

  let { blocks }: { blocks: Block[] } = $props();
</script>

<!-- One line: whitespace between these tags would show inside the message. -->
<!-- prettier-ignore -->
{#snippet inline(nodes: Inline[])}{#each nodes as node, index (index)}{#if node.type === 'text'}{node.text}{:else if node.type === 'break'}<br />{:else if node.type === 'code'}<code>{node.text}</code>{:else if node.type === 'link'}<a href={node.href} dir="ltr" target="_blank" rel="noopener noreferrer nofollow">{node.href}</a>{:else if node.type === 'strong'}<strong>{@render inline(node.children)}</strong>{:else if node.type === 'em'}<em>{@render inline(node.children)}</em>{:else}<s>{@render inline(node.children)}</s>{/if}{/each}{/snippet}

{#each blocks as block, index (index)}
  {#if block.type === 'codeblock'}
    <pre><code>{block.text}</code></pre>
  {:else}
    <!-- prettier-ignore -->
    <p>{@render inline(block.children)}</p>
  {/if}
{/each}

<style>
  p,
  pre {
    margin: 0;
  }

  p + p,
  p + pre,
  pre + p,
  pre + pre {
    margin-top: 6px;
  }

  /* The UI face has no italic; let the browser slant it. */
  em {
    font-synthesis: style;
  }

  code {
    padding: 1px 5px;
    font-family: var(--font-mono);
    font-size: 0.89em;
    background: color-mix(in srgb, currentColor 12%, transparent);
    border-radius: 5px;
  }

  pre {
    max-width: 100%;
    padding: 9px 11px;
    overflow-x: auto;
    color: var(--highlight);
    font-family: var(--font-mono);
    font-size: 12.5px;
    line-height: 1.5;
    white-space: pre;
    background: var(--bg);
    border: 1px solid var(--line);
    border-radius: var(--r-sm);
  }

  /* The light ground is too close to a light bubble; the block goes ink. */
  :global([data-theme='light']) pre {
    background: var(--ink);
  }

  pre code {
    padding: 0;
    font-size: inherit;
    background: none;
    border-radius: 0;
  }

  a {
    color: var(--link-ink, var(--accent));
    text-decoration-color: color-mix(in srgb, currentColor 45%, transparent);
    text-decoration-thickness: 1.5px;
    text-underline-offset: 2px;
    overflow-wrap: anywhere;
    unicode-bidi: isolate;
  }

  a:hover {
    text-decoration-color: currentColor;
  }
</style>
