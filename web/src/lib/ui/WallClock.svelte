<script lang="ts">
  import { onMount } from 'svelte';

  // HH:MM, with the viewer's locale deciding the hour cycle (23:03 or
  // 11:03 PM). 'numeric' hours would show midnight as 0:00 in en-GB.
  const format = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
  const pad = (value: number) => String(value).padStart(2, '0');

  let now = $state(new Date());

  onMount(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    // One wake-up per minute, on the boundary. The delay is measured afresh
    // each time, so a late or early timer corrects itself on the next tick.
    const tick = () => {
      clearTimeout(timer);
      now = new Date();
      timer = setTimeout(tick, 60_000 - (now.getTime() % 60_000));
    };
    // Background tabs may hold timers back; catch up when the tab returns.
    const onVisibility = () => {
      if (document.visibilityState === 'visible') tick();
    };
    tick();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisibility);
    };
  });
</script>

<time
  class="clock"
  data-testid="stage-clock"
  datetime={`${pad(now.getHours())}:${pad(now.getMinutes())}`}>{format.format(now)}</time
>

<style>
  .clock {
    flex: none;
    padding: 6px 12px;
    color: var(--ink);
    font-family: var(--font-mono);
    font-size: 15px;
    line-height: 22px;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
  }

  @media (max-width: 639.98px) {
    .clock {
      padding: 0;
      color: var(--ink-2);
      font-size: 13px;
      border: 0;
    }
  }
</style>
