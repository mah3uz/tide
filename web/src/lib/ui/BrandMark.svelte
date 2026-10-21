<script lang="ts">
  // The logo lives only here, so swapping it is a one-file change.
  let {
    size = 16
  }: {
    /** Height in px; the width follows the mark's proportions. */
    size?: number;
  } = $props();

  const id = $props.id();
  const gradientId = `${id}-mark`;
</script>

<svg
  class="block shrink-0"
  height={size}
  width={(size * 312) / 120}
  viewBox="100 196 312 120"
  fill="none"
  aria-hidden="true"
>
  <defs>
    <linearGradient
      id={gradientId}
      x1="116"
      y1="256"
      x2="396"
      y2="256"
      gradientUnits="userSpaceOnUse"
    >
      <stop offset="0" style="stop-color: var(--mark-from)" />
      <stop offset="1" style="stop-color: var(--mark-to)" />
    </linearGradient>
  </defs>
  <path
    d="M116 256 C139.4 231.8 160.8 210 186 210 C211.2 210 232.6 231.8 256 256 C279.4 280.2 300.8 302 326 302 C351.2 302 372.6 280.2 396 256"
    stroke={`url(#${gradientId})`}
    stroke-width="34"
    stroke-linecap="round"
    stroke-linejoin="round"
  />
</svg>
