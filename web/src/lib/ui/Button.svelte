<script lang="ts">
  import { Button } from 'bits-ui';

  // The shell's standard button: a 40px pill. Renders an <a> when `href` is
  // set, otherwise a <button> — bits-ui Button handles the anchor/button +
  // disabled semantics.
  //   variant="default"  quiet well, hairline border (Copy link, secondary actions)
  //   variant="accent"   solid accent (Join meeting — the primary action)
  // Pass `class` to extend (e.g. `w-full` for a block button).
  type Variant = 'default' | 'accent';

  let {
    variant = 'default',
    class: className = '',
    children,
    ...rest
  }: Button.RootProps & { variant?: Variant } = $props();

  // `border` also neutralizes the native <button> UA outset border (Preflight
  // is intentionally off — see app.css).
  const base =
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 whitespace-nowrap rounded-pill border px-4 text-[14px] leading-none no-underline transition-[color,background-color,border-color,transform] duration-(--dur-1) ease-out active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none';

  const variants: Record<Variant, string> = {
    default:
      'border-line-strong bg-surface-2 font-medium text-ink hover:bg-[color-mix(in_srgb,var(--ink)_7%,var(--surface-2))]',
    accent:
      'border-accent bg-accent font-semibold text-on-accent hover:border-accent-hover hover:bg-accent-hover'
  };
</script>

<Button.Root class={`${base} ${variants[variant]} ${className}`.trim()} {...rest}>
  {@render children?.()}
</Button.Root>
