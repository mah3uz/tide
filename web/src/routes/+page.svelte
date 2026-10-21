<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { CalendarPlus, Check, Copy, Desktop, Plus, SignIn, User } from 'phosphor-svelte';
  import {
    AuthRequiredError,
    listRooms,
    logout,
    me,
    rateLimited,
    rateLimitedMessage
  } from '#lib/api/client.js';
  import { AuthLoginPath, type Me, type RoomInfo } from '#lib/api/types.gen.js';
  import AddToCalendarDialog from '#lib/ui/AddToCalendarDialog.svelte';
  import BrandMark from '#lib/ui/BrandMark.svelte';
  import Button from '#lib/ui/Button.svelte';
  import NewRoomDialog from '#lib/ui/NewRoomDialog.svelte';
  import { participantColor } from '#lib/ui/participantColor.js';
  import RoomStatus from '#lib/ui/RoomStatus.svelte';
  import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
  import Wordmark from '#lib/ui/Wordmark.svelte';

  type DashboardState = 'loading' | 'signed-out' | 'ready' | 'error';

  let dashboardState = $state<DashboardState>('loading');
  let currentUser = $state<Me>();
  let rooms = $state<RoomInfo[]>([]);
  let error = $state('');
  let newRoomOpen = $state(false);
  let calendarOpen = $state(false);
  let calendarRoom = $state<RoomInfo>();
  let copiedSlug = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;

  // How often the dashboard re-fetches live room state (participant counts,
  // recording, active). LiveKit's ListRooms lags a join by a few seconds, so a
  // short poll keeps the tiles current without a manual reload.
  const refreshIntervalMs = 5000;

  // Cards past this many appear at once; the first few settle in one by one.
  const staggeredCards = 6;

  const isLive = (room: RoomInfo) => room.active && room.num_participants > 0;
  const liveCount = $derived(rooms.filter(isLive).length);
  const initials = $derived(
    (currentUser?.name || currentUser?.email || '')
      .split(/[\s@._-]+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((word) => word[0].toUpperCase())
      .join('')
  );

  /** Up to three placeholder faces for a live room: tide only knows the head count. */
  function faces(room: RoomInfo): number[] {
    return Array.from({ length: Math.min(room.num_participants, 3) }, (_, index) =>
      participantColor(`${room.id}:${index}`)
    );
  }

  async function loadDashboard(): Promise<void> {
    dashboardState = 'loading';
    error = '';
    try {
      currentUser = await me();
      rooms = await listRooms();
      dashboardState = 'ready';
    } catch (cause) {
      if (cause instanceof AuthRequiredError) {
        dashboardState = 'signed-out';
        return;
      }
      // Without sign-in, /api/me issues this browser's session under the
      // login limit; a refusal there is the only way into this state.
      error = rateLimited(cause)
        ? rateLimitedMessage
        : cause instanceof Error
          ? cause.message
          : 'Could not load the dashboard. Reload the page.';
      dashboardState = 'error';
    }
  }

  function signIn(): void {
    window.location.href = `${AuthLoginPath}?next=/`;
  }

  async function signOut(): Promise<void> {
    error = '';
    try {
      await logout();
      window.location.reload();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not sign out. Try again.';
    }
  }

  function created(room: RoomInfo): void {
    rooms = [room, ...rooms.filter((item) => item.id !== room.id)];
  }

  function addToCalendar(room: RoomInfo): void {
    calendarRoom = room;
    calendarOpen = true;
  }

  async function copyLink(slug: string): Promise<void> {
    error = '';
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/m/${slug}`);
      copiedSlug = slug;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copiedSlug = ''), 1600);
    } catch {
      error = 'Could not copy the meeting link. Copy it from the address bar instead.';
    }
  }

  // Silent background refresh — updates the live state in place without ever
  // flipping the view back into a loading/error state, and keeps the last good
  // list on a transient failure.
  async function refreshRooms(): Promise<void> {
    if (refreshing || dashboardState !== 'ready') return;
    if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
    refreshing = true;
    try {
      rooms = await listRooms();
    } catch {
      // Keep the current list; the next tick retries.
    } finally {
      refreshing = false;
    }
  }

  onMount(() => {
    void loadDashboard();
    refreshTimer = setInterval(() => void refreshRooms(), refreshIntervalMs);
  });
  onDestroy(() => {
    if (copyTimer) clearTimeout(copyTimer);
    if (refreshTimer) clearInterval(refreshTimer);
  });
</script>

<svelte:head>
  <title>tide</title>
  <meta name="description" content="Lean self-hosted video meetings" />
</svelte:head>

{#snippet orbits()}
  <svg class="orbits" viewBox="-700 -340 1400 680" fill="none" aria-hidden="true">
    <ellipse class="ring-1" rx="650" ry="320" />
    <ellipse class="ring-2" rx="450" ry="220" />
    <ellipse class="ring-3" rx="260" ry="125" />
    <circle class="planet-1" cx="437" cy="-113" r="7" />
    <circle class="planet-2" cx="-635" cy="65" r="5" />
    <circle class="planet-3" cx="-176" cy="122" r="4" />
  </svg>
{/snippet}

{#if dashboardState === 'loading'}
  <main class="center-state" aria-live="polite"><p>Loading…</p></main>
{:else if dashboardState === 'signed-out' || dashboardState === 'error'}
  <main class="welcome">
    {@render orbits()}
    <div class="corner"><ThemeToggle /></div>
    <section class="hero">
      <span class="hero-mark"><BrandMark size={64} /></span>
      <h1 class="hero-title">tide</h1>
      {#if dashboardState === 'signed-out'}
        <p class="lede">Create a room and meet without the clutter.</p>
        <button class="sso" type="button" onclick={signIn}>
          <SignIn size={20} weight="regular" aria-hidden="true" /> Continue with SSO
        </button>
        <p class="footnote mono">Joining a meeting? Open its link. Guests need no account.</p>
      {:else}
        <p class="lede" role="alert">{error}</p>
        <Button type="button" class="h-11!" onclick={() => void loadDashboard()}>Try again</Button>
      {/if}
    </section>
  </main>
{:else}
  <div class="page">
    <header class="top">
      <a class="home" href="/"><Wordmark size={20} /></a>
      <div class="account">
        {#if currentUser?.transcripts}
          <a class="round" href="/machines" aria-label="Machines" title="Machines">
            <Desktop size={18} weight="regular" aria-hidden="true" />
          </a>
        {/if}
        <ThemeToggle />
        <!-- Without sign-in there is no account, and signing out would only
             orphan the rooms this browser created (ARCHITECTURE.md §4.1). -->
        {#if !currentUser?.anonymous}
          <span
            class="avatar"
            style:--avatar={`var(--p${participantColor(currentUser?.sub ?? '')}-bg)`}
            style:--avatar-ink={`var(--p${participantColor(currentUser?.sub ?? '')}-fg)`}
            aria-hidden="true">{initials}</span
          >
          <span class="name">{currentUser?.name}</span>
          <button class="sign-out" type="button" onclick={() => void signOut()}>Sign out</button>
        {/if}
      </div>
    </header>

    <main class="dashboard">
      <section aria-labelledby="rooms-heading">
        <div class="intro">
          <div class="titles">
            {#if rooms.length > 0}
              <span class="kicker mono">
                {#if liveCount > 0}{liveCount} live ·{' '}{/if}{rooms.length}
                {rooms.length === 1 ? 'room' : 'rooms'}
              </span>
            {/if}
            <h1 id="rooms-heading">Rooms</h1>
          </div>
          <Button
            variant="accent"
            class="h-13! gap-2.5! px-6! text-[16px]! shadow-[0_10px_40px_var(--speak-glow)] max-sm:hidden!"
            onclick={() => (newRoomOpen = true)}
          >
            <Plus size={18} weight="bold" aria-hidden="true" /> New
          </Button>
        </div>

        {#if rooms.length === 0}
          <div class="empty-state">
            <BrandMark size={28} />
            <p>Create your first room to get a reusable meeting link.</p>
          </div>
        {:else}
          <ul class="rooms">
            {#each rooms as room, index (room.id)}
              {@const live = isLive(room)}
              <li class="min-w-0">
                <article
                  data-testid="room-card"
                  data-slug={room.slug}
                  class="card"
                  class:live
                  class:enter={index < staggeredCards}
                  style:--i={index}
                >
                  <!-- Stretched link: the whole card opens the detail page, while
                       the controls sit above it and act on their own. -->
                  <a href={`/rooms/${room.slug}`} class="open" aria-label={`Open ${room.name}`}></a>

                  <div class="card-head">
                    <div class="min-w-0">
                      <h2 class="room-name">{room.name}</h2>
                      <span class="slug mono">/m/{room.slug}</span>
                    </div>
                    {#if live}
                      <span class="faces" aria-hidden="true">
                        {#each faces(room) as color, faceIndex (faceIndex)}
                          <span
                            class="face"
                            style:background={`var(--p${color}-bg)`}
                            style:color={`var(--p${color}-fg)`}
                          >
                            <User size={14} weight="regular" />
                          </span>
                        {/each}
                        {#if room.num_participants > 3}
                          <span class="face more mono">+{room.num_participants - 3}</span>
                        {/if}
                      </span>
                    {/if}
                  </div>

                  <RoomStatus {room} />

                  <div class="actions">
                    <Button
                      href={`/m/${room.slug}`}
                      variant={live ? 'accent' : 'default'}
                      class="h-11! flex-1 {live ? '' : 'bg-transparent!'}">Join meeting</Button
                    >
                    <Button
                      type="button"
                      class="h-11! bg-transparent! max-sm:w-11! max-sm:px-0!"
                      onclick={() => void copyLink(room.slug)}
                      aria-label={`Copy link for ${room.name}`}
                    >
                      {#if copiedSlug === room.slug}
                        <Check size={16} weight="regular" aria-hidden="true" />
                        <span class="max-sm:sr-only">Copied</span>
                      {:else}
                        <Copy size={16} weight="regular" aria-hidden="true" />
                        <span class="max-sm:sr-only">Copy link</span>
                      {/if}
                    </Button>
                    <button
                      type="button"
                      class="round"
                      onclick={() => addToCalendar(room)}
                      aria-label={`Add ${room.name} to calendar`}
                      title="Add to calendar…"
                    >
                      <CalendarPlus size={16} weight="regular" aria-hidden="true" />
                    </button>
                  </div>
                </article>
              </li>
            {/each}
          </ul>
        {/if}
        {#if error}<p class="error" role="alert">{error}</p>{/if}
      </section>
    </main>

    <button type="button" class="fab" aria-label="New room" onclick={() => (newRoomOpen = true)}>
      <Plus size={24} weight="bold" aria-hidden="true" />
    </button>
  </div>

  <NewRoomDialog bind:open={newRoomOpen} oncreated={created} />
  <AddToCalendarDialog bind:open={calendarOpen} room={calendarRoom} />
{/if}

<style>
  .center-state {
    display: grid;
    min-height: 100dvh;
    padding: 24px 16px;
    place-items: center;
    color: var(--ink-3);
  }

  .center-state > p {
    margin: 0;
    font-size: 13px;
  }

  /* Signed out, and the error before the dashboard loads. */
  .welcome {
    position: relative;
    display: grid;
    min-height: 100dvh;
    padding: 72px max(16px, env(safe-area-inset-right)) max(48px, env(safe-area-inset-bottom))
      max(16px, env(safe-area-inset-left));
    overflow: hidden;
    place-items: center;
  }

  .corner {
    position: absolute;
    top: max(20px, env(safe-area-inset-top));
    right: max(20px, env(safe-area-inset-right));
  }

  .orbits {
    position: absolute;
    top: 46%;
    left: 50%;
    width: 1400px;
    height: 680px;
    transform: translate(-50%, -50%);
    pointer-events: none;
  }

  .ring-1 {
    stroke: var(--line-strong);
    stroke-dasharray: 3 5;
  }

  .ring-2 {
    stroke: color-mix(in srgb, var(--accent) 10%, transparent);
  }

  .ring-3 {
    stroke: color-mix(in srgb, var(--accent) 16%, transparent);
  }

  .planet-1 {
    fill: var(--mark-from);
    filter: drop-shadow(0 0 10px var(--mark-from));
  }

  .planet-2 {
    fill: var(--mark-to);
    filter: drop-shadow(0 0 8px var(--mark-to));
  }

  .planet-3 {
    fill: var(--accent);
  }

  .hero {
    position: relative;
    display: flex;
    max-width: 560px;
    flex-direction: column;
    align-items: center;
    gap: 28px;
    text-align: center;
    animation: rise var(--dur-3) var(--ease-out) backwards;
  }

  .hero-mark {
    filter: drop-shadow(0 0 28px var(--speak-glow));
  }

  .hero-title {
    margin: 0;
    font-size: 96px;
    line-height: 0.9;
    font-weight: 500;
    letter-spacing: -0.05em;
  }

  .lede {
    margin: 0;
    color: var(--ink-2);
    font-size: 20px;
    line-height: 1.5;
  }

  .sso {
    display: inline-flex;
    height: 58px;
    align-items: center;
    gap: 12px;
    padding: 0 30px 0 24px;
    color: var(--on-accent);
    font-size: 17px;
    font-weight: 600;
    background: var(--accent);
    border: 0;
    border-radius: var(--r-pill);
    box-shadow:
      0 0 0 8px var(--speak-glow),
      0 16px 48px var(--speak-glow);
    transition:
      background-color var(--dur-1) var(--ease-out),
      transform var(--dur-1) var(--ease-out);
  }

  .sso:hover {
    background: var(--accent-hover);
  }

  .sso:active {
    transform: scale(0.98);
  }

  .footnote {
    margin: 0;
    color: var(--ink-3);
    font-size: 12px;
  }

  /* The dashboard. */
  .page {
    width: min(100%, 1212px);
    margin: 0 auto;
    padding: 0 max(16px, env(safe-area-inset-right)) 64px max(16px, env(safe-area-inset-left));
  }

  .top {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: max(28px, env(safe-area-inset-top)) 0 28px;
  }

  .home {
    display: inline-flex;
    min-height: 44px;
    align-items: center;
    text-decoration: none;
    border-radius: var(--r-sm);
  }

  .account {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 10px;
    color: var(--ink-2);
    font-size: 14px;
  }

  .avatar {
    display: grid;
    width: 32px;
    height: 32px;
    flex-shrink: 0;
    place-items: center;
    color: var(--avatar-ink);
    font-size: 12px;
    font-weight: 600;
    background: var(--avatar);
    border-radius: 50%;
  }

  .name {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .sign-out {
    height: 36px;
    flex-shrink: 0;
    padding: 0 14px;
    color: var(--ink);
    font-size: 13px;
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .round {
    display: grid;
    width: 44px;
    height: 44px;
    flex-shrink: 0;
    padding: 0;
    place-items: center;
    color: var(--ink-2);
    background: transparent;
    border: 1px solid var(--line-strong);
    border-radius: 50%;
    transition:
      color var(--dur-1) var(--ease-out),
      background-color var(--dur-1) var(--ease-out);
  }

  .sign-out:hover,
  .round:hover {
    color: var(--ink);
    background: var(--surface-2);
  }

  .account .round {
    width: 36px;
    height: 36px;
    border-color: var(--line);
  }

  .intro {
    display: flex;
    align-items: flex-end;
    justify-content: space-between;
    gap: 16px;
    padding: 40px 0 36px;
  }

  .titles {
    display: flex;
    flex-direction: column;
    gap: 10px;
  }

  .kicker {
    color: var(--accent);
    font-size: 12px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
  }

  h1 {
    margin: 0;
    font-size: 64px;
    line-height: 1;
    font-weight: 500;
    letter-spacing: -0.04em;
  }

  .rooms {
    display: grid;
    margin: 0;
    padding: 0;
    gap: 20px;
    grid-template-columns: repeat(auto-fill, minmax(min(320px, 100%), 1fr));
    list-style: none;
  }

  .card {
    position: relative;
    display: flex;
    height: 100%;
    flex-direction: column;
    gap: 18px;
    padding: 24px;
    background: color-mix(in srgb, var(--surface) 62%, transparent);
    border: 1px solid var(--line);
    border-radius: var(--r-lg);
    transition: transform var(--dur-2) var(--ease-out);
  }

  .card.live {
    background: var(--surface);
    border-color: var(--speak-ring);
    box-shadow:
      0 0 0 6px var(--speak-glow),
      0 20px 60px var(--speak-glow);
  }

  .card.enter {
    animation: rise var(--dur-3) var(--ease-out) backwards;
    animation-delay: calc(var(--i) * 40ms);
  }

  @media (hover: hover) {
    .card:hover {
      transform: translateY(-2px);
    }
  }

  .open {
    position: absolute;
    z-index: 0;
    inset: 0;
    border-radius: var(--r-lg);
  }

  .card-head {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 12px;
  }

  .room-name {
    margin: 0;
    overflow: hidden;
    font-size: 22px;
    line-height: 1.25;
    font-weight: 500;
    letter-spacing: -0.02em;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .slug {
    display: block;
    margin-top: 6px;
    overflow: hidden;
    color: var(--ink-3);
    font-size: 12px;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .faces {
    display: flex;
    flex-shrink: 0;
    padding-left: 8px;
  }

  .face {
    display: grid;
    width: 30px;
    height: 30px;
    margin-left: -8px;
    place-items: center;
    border: 2px solid var(--surface);
    border-radius: 50%;
  }

  .face.more {
    color: var(--ink-2);
    font-size: 11px;
    background: var(--surface-2);
  }

  .actions {
    position: relative;
    z-index: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    margin-top: auto;
  }

  .empty-state {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 14px;
    padding: 56px 24px;
    color: var(--ink-2);
    font-size: 15px;
    text-align: center;
    background: color-mix(in srgb, var(--surface) 62%, transparent);
    border: 1px dashed var(--line-strong);
    border-radius: var(--r-lg);
  }

  .empty-state p {
    margin: 0;
  }

  .error {
    margin: 16px 0 0;
    color: var(--rec-ink);
    font-size: 13px;
  }

  .fab {
    position: fixed;
    right: max(20px, env(safe-area-inset-right));
    bottom: max(24px, calc(env(safe-area-inset-bottom) + 12px));
    display: none;
    width: 62px;
    height: 62px;
    place-items: center;
    color: var(--on-accent);
    background: var(--accent);
    border: 0;
    border-radius: 50%;
    box-shadow:
      0 0 0 6px var(--speak-glow),
      0 14px 30px var(--speak-glow);
    transition: transform var(--dur-1) var(--ease-out);
  }

  .fab:active {
    transform: scale(0.96);
  }

  @keyframes rise {
    from {
      opacity: 0;
      transform: translateY(8px);
    }
  }

  @media (max-width: 639px) {
    .orbits {
      transform: translate(-50%, -50%) scale(0.55);
    }

    .hero {
      gap: 22px;
    }

    .hero-title {
      font-size: 64px;
    }

    .lede {
      font-size: 17px;
    }

    .top {
      padding: max(16px, env(safe-area-inset-top)) 0 8px;
    }

    .account {
      gap: 8px;
    }

    .account .round {
      width: 40px;
      height: 40px;
    }

    .avatar,
    .name {
      display: none;
    }

    .sign-out {
      height: 40px;
    }

    .intro {
      padding: 20px 0;
    }

    .titles {
      gap: 6px;
    }

    .kicker {
      font-size: 11px;
    }

    h1 {
      font-size: 44px;
    }

    .rooms {
      gap: 12px;
    }

    .card {
      gap: 14px;
      padding: 20px;
    }

    .room-name {
      font-size: 20px;
    }

    .dashboard {
      padding-bottom: 72px;
    }

    .fab {
      display: grid;
    }
  }
</style>
