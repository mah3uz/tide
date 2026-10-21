<script lang="ts">
  let {
    from,
    text,
    onopen
  }: {
    from: string;
    text: string;
    onopen: () => void;
  } = $props();

  // One line, as plain text: the chat sheet is where a message is read.
  const line = $derived.by(() => {
    const lines = text.trim().split('\n');
    return lines.length > 1 ? `${lines[0]}…` : lines[0];
  });
</script>

<button type="button" class="peek" title="Open chat" data-testid="chat-peek" onclick={onopen}>
  <span class="from">{from}:</span>
  <span class="line">{line}</span>
</button>

<style>
  .peek {
    display: flex;
    max-width: min(420px, calc(100vw - 32px));
    min-width: 0;
    padding: 8px 16px;
    align-items: baseline;
    gap: 6px;
    color: var(--ink-2);
    font-size: 13px;
    line-height: 20px;
    white-space: nowrap;
    pointer-events: auto;
    background: var(--surface);
    border: 0;
    border-radius: var(--r-pill);
    box-shadow: var(--shadow-float);
    animation: peek-in var(--dur-2) var(--ease-out);
  }

  .peek:hover {
    color: var(--ink);
  }

  .from {
    flex: none;
    color: var(--ink);
    font-weight: 600;
  }

  .line {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  @keyframes peek-in {
    from {
      opacity: 0;
      transform: translateY(6px);
    }
  }
</style>
