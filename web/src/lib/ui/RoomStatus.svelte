<script lang="ts">
  import type { RoomInfo } from '#lib/api/types.gen.js';
  import { compactAgo } from '#lib/format.js';

  let { room }: { room: RoomInfo } = $props();

  // A room someone is in gets a highlighted chip, which turns red while it
  // records.
  // An empty room only needs to say when it was last used.
  const live = $derived(room.active && room.num_participants > 0);
</script>

{#if live}
  <span class="inline-flex min-w-0 flex-wrap items-center gap-x-2.5 gap-y-1 text-[14px] text-ink-2">
    <span
      class="inline-flex shrink-0 items-center gap-1.5 rounded-pill px-2.5 py-1 text-[12px] font-semibold leading-none {room.recording
        ? 'bg-rec-soft text-rec-ink'
        : 'bg-highlight text-on-highlight'}"
      data-testid="room-live"
    >
      <span
        class="size-[7px] rounded-pill {room.recording ? 'bg-rec' : 'bg-current'}"
        aria-hidden="true"
      ></span>
      {room.recording ? 'Recording' : 'Live'}
    </span>
    <span>
      {room.num_participants}
      {room.num_participants === 1 ? 'person' : 'people'} in the room now
    </span>
  </span>
{:else}
  <span class="text-[14px] text-ink-2">
    {room.last_active_at != null
      ? `Last active ${compactAgo(room.last_active_at)}`
      : 'Not used yet'}
  </span>
{/if}
