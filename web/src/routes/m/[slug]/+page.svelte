<script lang="ts">
  import { onDestroy, onMount } from 'svelte';
  import { page } from '$app/state';
  import {
    ApiError,
    AuthRequiredError,
    approveLobby,
    denyLobby,
    joinRoom,
    lobbyWait,
    logout,
    me,
    roomInfo,
    roomLobby
  } from '#lib/api/client.js';
  import {
    AuthLoginPath,
    type LobbyAdmittedSSE,
    type LobbyRequestInfo,
    type Me,
    type PublicRoomInfo
  } from '#lib/api/types.gen.js';
  import { SignIn, SignOut } from 'phosphor-svelte';
  import { ConnectionState, DisconnectReason } from 'livekit-client';
  import PreJoin from '#lib/rtc/PreJoin.svelte';
  import Button from '#lib/ui/Button.svelte';
  import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
  import Wordmark from '#lib/ui/Wordmark.svelte';
  import RoomStage from '#lib/rtc/RoomStage.svelte';
  import { setConnectionChrome } from '#lib/rtc/connection.svelte.js';
  import { RoomState, type PreJoinOptions } from '#lib/rtc/room.svelte.js';
  import { playLobbyKnockSound } from '#lib/sounds.js';

  type MeetingState =
    | 'loading'
    | 'missing'
    | 'load-error'
    | 'prejoin'
    | 'joining'
    | 'waiting'
    | 'denied'
    | 'expired'
    | 'connected'
    | 'removed'
    | 'disconnected'
    | 'ended'
    | 'left';

  const rtc = new RoomState();
  const slug = $derived(page.params.slug ?? '');
  let meetingState = $state<MeetingState>('loading');
  let details = $state<PublicRoomInfo>();
  let name = $state('');
  let error = $state('');
  let canManage = $state(false);
  let currentUser = $state<Me>();
  // Only a deployment with sign-in answers a browser without a session with
  // 401; without sign-in /api/me issues one (ARCHITECTURE.md §4.1).
  let canSignIn = $state(false);
  // The record control needs a host on a deployment that records (§8).
  const canRecord = $derived(canManage && currentUser?.recording === true);
  let pending = $state<LobbyRequestInfo[]>([]);
  let peopleOpen = $state(false);
  let lobbyError = $state('');
  let mediaOptions: PreJoinOptions | undefined;
  let closeWait: (() => void) | undefined;
  let closeHostLobby: (() => void) | undefined;
  const announcedLobbyRequestIDs = new Set<string>();
  let pageHidden = $state(false);

  $effect(() => {
    if (meetingState !== 'connected') return;
    if (rtc.wasRemoved) {
      handleRemoved();
      return;
    }
    // The host ended the meeting for everyone: a calm terminal state, not an
    // error, and no rejoin prompt.
    if (
      rtc.connectionState === ConnectionState.Disconnected &&
      rtc.disconnectReason === DisconnectReason.ROOM_DELETED
    ) {
      leaveMeetingChrome();
      meetingState = 'ended';
      return;
    }
    // Any other terminal disconnect (server shutdown, room closed, duplicate
    // identity…) must land somewhere recoverable instead of a dead stage.
    if (
      rtc.connectionState === ConnectionState.Disconnected &&
      rtc.disconnectReason !== DisconnectReason.CLIENT_INITIATED
    ) {
      leaveMeetingChrome();
      meetingState = 'disconnected';
    }
  });

  async function loadMeeting(): Promise<void> {
    meetingState = 'loading';
    error = '';
    try {
      details = await roomInfo(slug);
    } catch (cause) {
      if (cause instanceof ApiError && cause.status === 404) {
        meetingState = 'missing';
        return;
      }
      error = cause instanceof Error ? cause.message : 'Could not load the room. Reload the page.';
      meetingState = 'load-error';
      return;
    }

    canManage = details.can_manage;
    try {
      currentUser = await me();
      // An anonymous owner has no name either, and types one like a guest.
      name = currentUser.name;
      canSignIn = false;
    } catch (cause) {
      // Signed-out guests have no profile; they type a name in prejoin. A
      // refusal under the rate limit leaves them a guest too, and the server
      // decides at join regardless.
      currentUser = undefined;
      canSignIn = cause instanceof AuthRequiredError;
    }
    meetingState = 'prejoin';
  }

  const signInHref = $derived(
    `${AuthLoginPath}?next=${encodeURIComponent(`/m/${encodeURIComponent(slug)}`)}`
  );

  async function signOut(): Promise<void> {
    error = '';
    try {
      await logout();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not sign out. Try again.';
      return;
    }
    // Management rights come only from the session, so without one this
    // browser is a guest. The server re-checks at join regardless.
    currentUser = undefined;
    canManage = false;
    canSignIn = true;
  }

  async function connect(admission: LobbyAdmittedSSE, options: PreJoinOptions): Promise<void> {
    closeWait?.();
    closeWait = undefined;
    meetingState = 'joining';
    try {
      await rtc.connect(admission.ws_url, admission.token, options);
      meetingState = 'connected';
      if (canManage) subscribeToHostLobby();
    } catch {
      error = 'Could not connect to the meeting. Check your connection and try again.';
      setConnectionChrome('connected');
      meetingState = 'prejoin';
    }
  }

  async function join(options: PreJoinOptions): Promise<void> {
    error = '';
    mediaOptions = options;
    meetingState = 'joining';
    try {
      const response = await joinRoom(slug, options.name.trim());
      if (response.status === 'admitted' && response.token && response.ws_url) {
        await connect({ token: response.token, ws_url: response.ws_url }, options);
        return;
      }
      if (response.status === 'waiting' && response.request_id) {
        meetingState = 'waiting';
        closeWait = lobbyWait(response.request_id, {
          admitted: (admission) => {
            if (mediaOptions) void connect(admission, mediaOptions);
          },
          denied: () => {
            closeWait?.();
            closeWait = undefined;
            meetingState = 'denied';
          },
          expired: () => {
            closeWait?.();
            closeWait = undefined;
            meetingState = 'expired';
          },
          error: () => {
            // The wait stream died for good (request expired while the tab
            // was suspended); leave "waiting" so the guest can ask again.
            closeWait?.();
            closeWait = undefined;
            meetingState = 'expired';
          }
        });
        return;
      }
      throw new Error('The server returned an invalid join response. Try again.');
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'Could not join the room. Try again.';
      setConnectionChrome('connected');
      meetingState = 'prejoin';
    }
  }

  function subscribeToHostLobby(): void {
    closeHostLobby?.();
    closeHostLobby = roomLobby(slug, (event) => {
      for (const request of event.requests) {
        if (announcedLobbyRequestIDs.has(request.id)) continue;
        announcedLobbyRequestIDs.add(request.id);
        playLobbyKnockSound();
      }
      pending = event.requests;
    });
  }

  async function admit(id: string): Promise<void> {
    lobbyError = '';
    try {
      await approveLobby(id);
    } catch (cause) {
      lobbyError = cause instanceof Error ? cause.message : 'Could not admit the guest. Try again.';
    }
  }

  async function deny(id: string): Promise<void> {
    lobbyError = '';
    try {
      await denyLobby(id);
    } catch (cause) {
      lobbyError = cause instanceof Error ? cause.message : 'Could not deny the guest. Try again.';
    }
  }

  function leaveMeeting(): void {
    closeHostLobby?.();
    closeHostLobby = undefined;
    announcedLobbyRequestIDs.clear();
    pending = [];
    peopleOpen = false;
    setConnectionChrome('connected');
    meetingState = 'left';
  }

  function handleRemoved(): void {
    leaveMeetingChrome();
    meetingState = 'removed';
  }

  function leaveMeetingChrome(): void {
    closeHostLobby?.();
    closeHostLobby = undefined;
    announcedLobbyRequestIDs.clear();
    pending = [];
    peopleOpen = false;
    setConnectionChrome('connected');
  }

  function rejoin(): void {
    error = '';
    lobbyError = '';
    mediaOptions = undefined;
    setConnectionChrome('connected');
    meetingState = 'prejoin';
  }

  onMount(() => {
    void loadMeeting();
    const syncHidden = () => (pageHidden = document.hidden);
    syncHidden();
    document.addEventListener('visibilitychange', syncHidden);
    return () => document.removeEventListener('visibilitychange', syncHidden);
  });
  onDestroy(() => {
    closeWait?.();
    closeHostLobby?.();
    void rtc
      .disconnect()
      .catch(() => undefined)
      .finally(() => setConnectionChrome('connected'));
  });
</script>

<svelte:head>
  <title>{details ? `${details.name} · tide` : 'tide'}</title>
  <meta name="description" content="Join a tide meeting" />
</svelte:head>

{#snippet account()}
  {#if currentUser?.anonymous}
    <!-- No account to show or leave (§4.1); only the room's owner learns
         they join as its host. -->
    {#if canManage}
      <div class="account"><span class="account-role">Host</span></div>
    {/if}
  {:else if currentUser}
    <div class="account">
      <span class="account-name" title={currentUser.email}>{currentUser.name}</span>
      {#if canManage}<span class="account-role">· Host</span>{/if}
      <button
        class="account-action"
        type="button"
        aria-label="Sign out"
        title="Sign out"
        onclick={() => void signOut()}
      >
        <SignOut size={16} weight="regular" aria-hidden="true" />
      </button>
    </div>
  {:else if canSignIn}
    <a class="account-link" href={signInHref} data-sveltekit-reload>
      <SignIn size={16} weight="regular" aria-hidden="true" />
      Sign in
    </a>
  {/if}
{/snippet}

{#if meetingState === 'connected' && details}
  <RoomStage
    {rtc}
    roomSlug={slug}
    roomName={details.name}
    onleave={leaveMeeting}
    {canManage}
    {canRecord}
    {pending}
    bind:peopleOpen
    {lobbyError}
    onadmit={admit}
    ondeny={deny}
  />
{:else if meetingState === 'prejoin' && details}
  <PreJoin
    room={slug}
    bind:name
    {error}
    showRoom={false}
    heading={details.name}
    onactivateplayback={() => rtc.activateMediaPlayback()}
    onjoin={join}
    {account}
  />
{:else}
  <main class="meeting-state">
    <header class="topbar">
      <Wordmark size={18} />
      <ThemeToggle />
    </header>
    <div class="orbits" aria-hidden="true"><span></span><span></span><span></span></div>
    <div class="state-body" aria-live="polite">
      {#if meetingState === 'loading'}
        <p class="state-note">Loading room…</p>
      {:else if meetingState === 'missing'}
        <p class="state-message">This room does not exist.</p>
        <Button variant="accent" href="/">Go to dashboard</Button>
      {:else if meetingState === 'load-error'}
        <p class="state-message" role="alert">{error}</p>
        <Button variant="accent" onclick={() => void loadMeeting()}>Try again</Button>
      {:else if meetingState === 'joining'}
        <span class="room-name">{details?.name ?? 'Room'}</span>
        <p class="state-note">Joining…</p>
      {:else if meetingState === 'waiting'}
        <span class="waiting-orb" class:paused={pageHidden} aria-hidden="true"></span>
        <h1 class="state-message">Waiting for the host to let you in.</h1>
        <span class="room-name">{details?.name ?? 'Room'}</span>
      {:else if meetingState === 'denied'}
        <p class="state-message">The host did not let you in.</p>
        <Button variant="accent" href="/">Go to dashboard</Button>
      {:else if meetingState === 'expired'}
        <p class="state-message">Your lobby request expired.</p>
        <Button variant="accent" onclick={rejoin}>Try again</Button>
      {:else if meetingState === 'left'}
        <p class="state-message">You left the meeting.</p>
        <Button variant="accent" onclick={rejoin}>Rejoin</Button>
      {:else if meetingState === 'ended'}
        <p class="state-message">The meeting ended.</p>
        <Button variant="accent" href="/">Go to dashboard</Button>
      {:else if meetingState === 'removed'}
        <p class="state-message">You were removed from the meeting.</p>
        <Button variant="accent" onclick={rejoin}>Request to rejoin</Button>
      {:else if meetingState === 'disconnected'}
        <p class="state-message">
          {rtc.disconnectReason === DisconnectReason.DUPLICATE_IDENTITY
            ? 'This meeting was opened from another tab or device.'
            : 'The connection to the meeting was lost.'}
        </p>
        <Button variant="accent" onclick={rejoin}>Rejoin</Button>
      {/if}
    </div>
  </main>
{/if}

<style>
  .meeting-state {
    position: relative;
    display: flex;
    min-height: 100dvh;
    flex-direction: column;
    padding: 0 32px calc(32px + env(safe-area-inset-bottom));
    overflow: hidden;
  }

  .topbar {
    position: relative;
    z-index: 1;
    display: flex;
    min-height: 84px;
    align-items: center;
    justify-content: space-between;
  }

  .orbits span {
    position: absolute;
    top: 50%;
    left: 50%;
    border: 1px solid color-mix(in srgb, var(--accent) 12%, transparent);
    border-radius: 50%;
    pointer-events: none;
    translate: -50% -50%;
  }

  .orbits span:nth-child(1) {
    width: 1300px;
    height: 640px;
    border: 1px dashed var(--line);
  }

  .orbits span:nth-child(2) {
    width: 900px;
    height: 440px;
    border-color: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .orbits span:nth-child(3) {
    width: 520px;
    height: 250px;
  }

  .state-body {
    position: relative;
    display: flex;
    margin: auto;
    padding-bottom: 84px;
    flex-direction: column;
    align-items: center;
    gap: 20px;
    text-align: center;
  }

  .state-message {
    max-width: 560px;
    margin: 0;
    color: var(--ink);
    font-size: 32px;
    line-height: 1.15;
    font-weight: 500;
    letter-spacing: -0.025em;
    text-wrap: balance;
  }

  .state-note {
    margin: 0;
    color: var(--ink-3);
    font-family: var(--font-mono);
    font-size: 13px;
  }

  .room-name {
    max-width: min(560px, 100%);
    padding: 6px 14px;
    overflow: hidden;
    color: var(--ink-2);
    font-family: var(--font-mono);
    font-size: 13px;
    text-overflow: ellipsis;
    white-space: nowrap;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
  }

  /* Loops only while the wait is live, and pauses while the tab is hidden. */
  .waiting-orb {
    width: 16px;
    height: 16px;
    margin-bottom: 12px;
    background: var(--accent);
    border-radius: var(--r-pill);
    box-shadow:
      0 0 0 10px color-mix(in srgb, var(--accent) 12%, transparent),
      0 0 0 22px color-mix(in srgb, var(--accent) 6%, transparent);
    animation: waiting-pulse 2.4s var(--ease-in-out) infinite;
  }

  .waiting-orb.paused {
    animation-play-state: paused;
  }

  @keyframes waiting-pulse {
    50% {
      opacity: 0.55;
      transform: scale(0.82);
    }
  }

  .account {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 6px;
    color: var(--ink-3);
    font-size: 13px;
  }

  .account-name {
    overflow: hidden;
    color: var(--ink);
    font-weight: 500;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .account-role {
    flex-shrink: 0;
  }

  .account-action {
    display: grid;
    width: 36px;
    height: 36px;
    flex-shrink: 0;
    padding: 0;
    place-items: center;
    color: var(--ink-2);
    background: transparent;
    border: 1px solid transparent;
    border-radius: var(--r-pill);
    transition:
      color var(--dur-1) var(--ease-out),
      background-color var(--dur-1) var(--ease-out);
  }

  .account-action:hover {
    color: var(--ink);
    background: var(--surface-2);
  }

  .account-link {
    display: inline-flex;
    height: 36px;
    align-items: center;
    gap: 6px;
    padding: 0 14px;
    color: var(--ink);
    font-size: 13px;
    font-weight: 500;
    text-decoration: none;
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
    transition: background-color var(--dur-1) var(--ease-out);
  }

  .account-link:hover {
    background: var(--surface-2);
  }

  @media (max-width: 639px) {
    .meeting-state {
      padding: 0 16px calc(20px + env(safe-area-inset-bottom));
    }

    .topbar {
      min-height: 64px;
    }

    .state-body {
      padding-bottom: 64px;
    }

    .state-message {
      font-size: 26px;
    }
  }
</style>
