<script lang="ts">
  import BrandMark from './BrandMark.svelte';

  let {
    size = 18,
    class: className = ''
  }: {
    /** Font size of "tide" in px; the mark scales with it. */
    size?: number;
    class?: string;
  } = $props();
</script>

<span
  class="inline-flex items-center gap-[0.4em] font-semibold leading-none tracking-[-0.02em] text-ink {className}"
  style:font-size={`${size}px`}
>
  <BrandMark size={Math.round(size * 0.62)} />tide
</span>
