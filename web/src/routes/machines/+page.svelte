<script lang="ts">
  import { onDestroy, onMount, tick, untrack } from 'svelte';
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import {
    ArrowLeft,
    Check,
    CheckCircle,
    Copy,
    Info,
    LinkBreak,
    Plus,
    SignIn
  } from 'phosphor-svelte';
  import {
    ApiError,
    AuthRequiredError,
    confirmPairing,
    denyPairing,
    errorMessage,
    listMachines,
    me,
    pairing,
    removeMachine
  } from '#lib/api/client.js';
  import {
    AuthLoginPath,
    MachineBusy,
    MachineIdle,
    MachinePaused,
    type MachineInfo,
    type MachinesResponse,
    type PairingInfo
  } from '#lib/api/types.gen.js';
  import { compactAgo, osLabel, shortHash, systemLabel } from '#lib/format.js';
  import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
  import Wordmark from '#lib/ui/Wordmark.svelte';

  // One route, two jobs (ARCHITECTURE.md §8.1): with ?code= the moil app sent
  // the host here to confirm a pairing; without one it lists their machines.
  // 'off': this server doesn't run transcripts (TIDE_TRANSCRIPTS), so it
  // has no machines to show and nothing to pair with.
  type View =
    'loading' | 'signed-out' | 'error' | 'off' | 'confirm' | 'expired' | 'denied' | 'list';

  // Machines come online, go offline and get approved in the moil app while
  // this page is open, so the list refreshes itself quietly.
  const refreshIntervalMs = 10_000;

  const control =
    'inline-flex h-10 shrink-0 items-center justify-center gap-2 rounded-pill border px-4 text-[14px] no-underline transition-colors duration-(--dur-1) disabled:opacity-50 pointer-coarse:h-11';
  const accentButton = `${control} border-accent bg-accent font-semibold text-on-accent hover:border-accent-hover hover:bg-accent-hover`;
  const plainButton = `${control} border-line-strong bg-surface-2 font-medium text-ink hover:bg-[color-mix(in_srgb,var(--ink)_7%,var(--surface-2))]`;
  const textButton =
    'border-0 bg-transparent p-0 text-[14px] text-accent underline-offset-4 hover:underline pointer-coarse:min-h-11';
  const field =
    'mono h-10 min-w-0 flex-1 rounded-sm border border-line-strong bg-surface-2 px-3.5 text-[13px] text-ink outline-none focus:border-accent pointer-coarse:h-11';
  const card = 'mx-auto mt-10 w-[min(100%,440px)] rounded-lg border border-line bg-surface p-6';
  const cardTitle = 'm-0 text-[22px] leading-7 font-medium tracking-[-0.02em] text-ink';
  const cardText = 'm-0 mt-2 text-[14px] text-ink-2';
  const step =
    'mono grid size-7 shrink-0 place-items-center rounded-pill bg-surface-2 text-[12px] text-ink-2';

  let view = $state<View>('loading');
  let pending = $state<PairingInfo>();
  // The signed-in host's email, so the confirm card can say whose machine it becomes.
  let account = $state<string>();
  let data = $state<MachinesResponse>();
  // The machine this visit paired. The banner follows it in the live list.
  let paired = $state<Pick<MachineInfo, 'id' | 'name'>>();
  let deniedName = $state('');
  let error = $state('');
  // Read out by screen readers when an action removes what had focus.
  let announcement = $state('');
  let busy = $state(false);
  let unpairID = $state('');
  let copied = $state(false);
  let codeDraft = $state('');
  let copyTimer: ReturnType<typeof setTimeout> | undefined;
  let refreshTimer: ReturnType<typeof setInterval> | undefined;
  let refreshing = false;
  let destroyed = false;
  // Bumped whenever this page changes the list itself, so a background
  // refresh already in flight can't bring back a machine just unpaired.
  let generation = 0;
  // The code the current view was loaded for; plain, so writing it never
  // re-runs the effect below.
  let shownCode: string | undefined;
  // Set when the host typed a code, so the view it loads takes focus.
  let focusNextLoad = false;

  const code = $derived(page.url.searchParams.get('code')?.trim() ?? '');
  const signInHref = $derived(
    `${AuthLoginPath}?next=${encodeURIComponent(page.url.pathname + page.url.search)}`
  );
  const pairHref = $derived(data ? `moil://pair?url=${encodeURIComponent(data.moil_url)}` : '');
  const pairedMachine = $derived.by(() => {
    const id = paired?.id;
    return id ? data?.machines.find((machine) => machine.id === id) : undefined;
  });

  /** Moves focus to an element that replaced the control the host used. */
  async function focusOn(id: string): Promise<void> {
    await tick();
    document.getElementById(id)?.focus();
  }

  async function show(next: View): Promise<void> {
    view = next;
    await focusOn('view-focus');
  }

  async function load(current: string, focus = false): Promise<void> {
    view = 'loading';
    error = '';
    unpairID = '';
    if (current) paired = undefined;
    const stale = () => destroyed || current !== shownCode;
    let next: View;
    try {
      // Without transcripts the server has no machine or pairing routes, so
      // whether it runs them comes first.
      const host = await me();
      if (stale()) return;
      if (!host.transcripts) {
        next = 'off';
      } else if (current) {
        const waiting = await pairing(current);
        if (stale()) return;
        pending = waiting;
        account = host.email;
        next = 'confirm';
      } else {
        const list = await listMachines();
        if (stale()) return;
        generation += 1;
        data = list;
        next = 'list';
      }
    } catch (cause) {
      if (stale()) return;
      if (cause instanceof AuthRequiredError) {
        next = 'signed-out';
      } else if (current && cause instanceof ApiError && cause.status === 404) {
        next = 'expired';
      } else {
        error = errorMessage(
          cause,
          current
            ? 'Could not look up the code. Check your connection, then try again.'
            : 'Could not load your machines. Check your connection, then try again.'
        );
        next = 'error';
      }
    }
    if (focus) await show(next);
    else view = next;
  }

  $effect(() => {
    const current = code;
    if (current === shownCode) return;
    shownCode = current;
    const focus = focusNextLoad;
    focusNextLoad = false;
    untrack(() => void load(current, focus));
  });

  function retry(): void {
    shownCode = code;
    void load(code, true);
  }

  /** Drops a spent code from the address, so a reload shows the list. */
  function leaveCode(): void {
    shownCode = '';
    void goto('/machines', { replace: true, reset: false });
  }

  function showList(): void {
    if (code) leaveCode();
    shownCode = '';
    void load('', true);
  }

  function enterCode(event: SubmitEvent): void {
    event.preventDefault();
    const entered = codeDraft.trim();
    if (!entered) return;
    codeDraft = '';
    if (entered === code) {
      // The address already has it (a retyped code): look it up again.
      void load(code, true);
      return;
    }
    focusNextLoad = true;
    void goto(`/machines?${new URLSearchParams({ code: entered })}`);
  }

  async function confirm(): Promise<void> {
    if (!pending || busy) return;
    const current = pending;
    busy = true;
    error = '';
    try {
      const machine = await confirmPairing(current.code);
      if (destroyed) return;
      paired = { id: machine.id, name: machine.name };
      pending = undefined;
      leaveCode();
      const list = await listMachines();
      if (destroyed) return;
      generation += 1;
      data = list;
      view = 'list';
      await focusOn('paired-banner');
    } catch (cause) {
      if (destroyed) return;
      if (cause instanceof AuthRequiredError) {
        await show('signed-out');
      } else if (paired) {
        // Paired, but the list didn't load: the error view says both, and
        // trying again loads the list under the paired banner.
        error = errorMessage(
          cause,
          "Your machines didn't load. Check your connection, then try again."
        );
        await show('error');
      } else if (cause instanceof ApiError && cause.status === 404) {
        await show('expired');
      } else {
        error = errorMessage(
          cause,
          'Could not pair the machine. Check your connection, then try again.'
        );
      }
    } finally {
      busy = false;
    }
  }

  async function deny(): Promise<void> {
    if (!pending || busy) return;
    const current = pending;
    busy = true;
    error = '';
    try {
      await denyPairing(current.code);
      if (destroyed) return;
      deniedName = current.name;
      pending = undefined;
      leaveCode();
      await show('denied');
    } catch (cause) {
      if (destroyed) return;
      if (cause instanceof AuthRequiredError) {
        await show('signed-out');
      } else if (cause instanceof ApiError && cause.status === 404) {
        await show('expired');
      } else {
        error = errorMessage(
          cause,
          'Could not deny the machine. Check your connection, then try again.'
        );
      }
    } finally {
      busy = false;
    }
  }

  async function unpair(machine: MachineInfo): Promise<void> {
    if (!data || busy) return;
    if (unpairID !== machine.id) {
      unpairID = machine.id;
      return;
    }
    busy = true;
    error = '';
    try {
      await removeMachine(machine.id).catch((cause: unknown) => {
        // Already gone (unpaired in another tab, say) is what the host asked for.
        if (!(cause instanceof ApiError && cause.status === 404)) throw cause;
      });
      if (destroyed) return;
      generation += 1;
      data.machines = data.machines.filter((item) => item.id !== machine.id);
      unpairID = '';
      announcement = `Unpaired ${machine.name}.`;
      await focusOn('view-focus');
    } catch (cause) {
      if (destroyed) return;
      if (cause instanceof AuthRequiredError) {
        await show('signed-out');
      } else {
        error = errorMessage(
          cause,
          'Could not unpair the machine. Check your connection, then try again.'
        );
      }
    } finally {
      busy = false;
    }
  }

  async function copyAddress(): Promise<void> {
    if (!data) return;
    error = '';
    try {
      await navigator.clipboard.writeText(data.moil_url);
      copied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => (copied = false), 1600);
    } catch {
      error = 'Could not copy the address. Select it and copy it instead.';
    }
  }

  // Silent background refresh: keeps the last good list on a failure and
  // never flips the view back to loading.
  async function refresh(): Promise<void> {
    if (refreshing || view !== 'list' || document.hidden) return;
    refreshing = true;
    const started = generation;
    try {
      const list = await listMachines();
      if (!destroyed && view === 'list' && started === generation) data = list;
    } catch (cause) {
      // A session that expired meanwhile needs a sign-in; anything else, the
      // next tick retries.
      if (!destroyed && view === 'list' && cause instanceof AuthRequiredError) view = 'signed-out';
    } finally {
      refreshing = false;
    }
  }

  function onVisibilityChange(): void {
    if (!document.hidden) void refresh();
  }

  function stateLabel(machine: MachineInfo): string {
    switch (machine.state) {
      case MachineIdle:
        return 'Online';
      case MachineBusy:
        return 'Busy';
      case MachinePaused:
        return 'Paused in moil';
    }
    const seen = machine.last_seen_at;
    return seen != null ? `Offline · last seen ${compactAgo(seen)}` : 'Never connected';
  }

  function stateDot(machine: MachineInfo): string {
    if (machine.state === MachineIdle || machine.state === MachineBusy) return 'bg-ok';
    if (machine.state === MachinePaused) return 'bg-warn';
    return 'border border-ink-3 bg-transparent';
  }

  onMount(() => {
    refreshTimer = setInterval(() => void refresh(), refreshIntervalMs);
    document.addEventListener('visibilitychange', onVisibilityChange);
  });
  onDestroy(() => {
    destroyed = true;
    if (copyTimer) clearTimeout(copyTimer);
    if (refreshTimer) clearInterval(refreshTimer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
  });
</script>

<svelte:head>
  <title>Machines · tide</title>
</svelte:head>

{#snippet codeForm(label: string)}
  <form class="text-[13px] text-ink-2" onsubmit={enterCode}>
    <label for="pairing-code-input">{label}</label>
    <div class="mt-2 flex items-center gap-2">
      <input
        id="pairing-code-input"
        class="{field} uppercase placeholder:text-ink-3"
        bind:value={codeDraft}
        placeholder="XXXX-XXXX"
        maxlength="16"
        autocomplete="off"
        autocapitalize="characters"
        spellcheck="false"
        required
      />
      <button type="submit" class={plainButton}>Continue</button>
    </div>
  </form>
{/snippet}

<header
  class="mx-auto flex w-[min(100%,1212px)] items-center justify-between gap-3 pt-[max(28px,env(safe-area-inset-top))] pr-[max(16px,env(safe-area-inset-right))] pb-7 pl-[max(16px,env(safe-area-inset-left))] max-sm:pt-[max(16px,env(safe-area-inset-top))] max-sm:pb-2"
>
  <a class="inline-flex min-h-11 items-center rounded-sm no-underline" href="/"
    ><Wordmark size={20} /></a
  >
  <div class="flex items-center gap-2">
    <ThemeToggle />
    <a
      class="inline-flex h-9 items-center gap-1.5 rounded-pill border border-line-strong px-3.5 text-[13px] text-ink no-underline transition-colors duration-(--dur-1) hover:bg-surface-2 pointer-coarse:h-11"
      href="/"
    >
      <ArrowLeft size={16} weight="regular" aria-hidden="true" /> All rooms
    </a>
  </div>
</header>

<main
  class="mx-auto w-[min(100%,1212px)] pr-[max(16px,env(safe-area-inset-right))] pb-16 pl-[max(16px,env(safe-area-inset-left))]"
>
  <p class="sr-only" role="status">{announcement}</p>

  {#if view === 'loading'}
    <p class="m-0 pt-10 text-[13px] text-ink-3" aria-live="polite">Loading…</p>
  {:else if view === 'signed-out'}
    <section class={card}>
      <h1 id="view-focus" tabindex="-1" class={cardTitle}>
        {code ? 'Sign in to pair this machine' : 'Sign in to see your machines'}
      </h1>
      <p class={cardText}>
        {code
          ? 'The machine will belong to the account you sign in with.'
          : 'Machines you pair with tide transcribe your recordings.'}
      </p>
      <a class="{accentButton} mt-5" href={signInHref} data-sveltekit-reload>
        <SignIn size={16} weight="regular" aria-hidden="true" /> Sign in
      </a>
    </section>
  {:else if view === 'off'}
    <section class={card}>
      <h1 id="view-focus" tabindex="-1" class={cardTitle}>
        Transcripts aren't enabled on this server
      </h1>
      <p class={cardText}>
        Machines can't be paired here. Ask your tide administrator if you need transcripts.
      </p>
    </section>
  {:else if view === 'error'}
    <div
      class="mt-10 rounded-lg border border-dashed border-line-strong px-6 py-10 text-center text-[15px]"
    >
      {#if paired}
        <p class="m-0 mb-1 text-ink">Paired <bdi>{paired.name}</bdi>.</p>
      {/if}
      <p class="m-0 text-rec-ink" role="alert">{error}</p>
      <button id="view-focus" class="{plainButton} mt-4" type="button" onclick={retry}>
        Try again
      </button>
    </div>
  {:else if view === 'confirm' && pending}
    <section
      class="mx-auto mt-10 w-[min(100%,440px)] rounded-lg border border-line bg-surface"
      aria-labelledby="view-focus"
    >
      <div class="p-6">
        <h1 id="view-focus" tabindex="-1" class={cardTitle}>Pair this machine?</h1>
        <!-- One check, before anything else: the code alone proves nothing. -->
        <p class="m-0 mt-2 text-[14px] text-ink" data-testid="moil-address-check">
          Pair only if you just started pairing in the moil app on your own computer, and it shows
          this code and says it is pairing with
          <span class="mono [overflow-wrap:anywhere]">{pending.moil_url}</span>. Otherwise, choose
          Deny.
        </p>
        <div
          class="mono mt-4 rounded-sm border border-line-strong bg-surface-2 py-3 text-center text-[24px] leading-8 tracking-[0.16em] text-ink"
          data-testid="pairing-code"
        >
          {pending.code}
        </div>
        <p id="machine-reported" class="m-0 mt-4 text-[12px] text-ink-3">Reported by the machine</p>
        <dl
          class="m-0 mt-1.5 grid grid-cols-[max-content_minmax(0,1fr)] gap-x-4 gap-y-1 text-[13px]"
          aria-describedby="machine-reported"
        >
          <dt class="text-ink-2">Name</dt>
          <dd class="m-0 text-ink [overflow-wrap:anywhere]"><bdi>{pending.name}</bdi></dd>
          <dt class="text-ink-2">System</dt>
          <dd class="m-0 text-ink [overflow-wrap:anywhere]">
            <bdi>{systemLabel(pending.os, pending.arch)}</bdi>
          </dd>
          <dt class="text-ink-2">moil app</dt>
          <dd class="mono m-0 text-ink [overflow-wrap:anywhere]">
            <bdi>{pending.app_version}</bdi>
          </dd>
        </dl>
      </div>
      <div class="border-t border-line p-6">
        <p class="m-0 text-[13px] text-ink">
          Once paired, it downloads and transcribes every new recording of rooms you own, until you
          unpair it here.
        </p>
        {#if account}
          <p class={cardText}>
            Pairs with your account <span class="text-ink [overflow-wrap:anywhere]">{account}</span
            >.
          </p>
        {/if}
        {#if error}<p class="m-0 mt-2 text-[13px] text-rec-ink" role="alert">{error}</p>{/if}
        <div class="mt-5 flex justify-end gap-2">
          <button type="button" disabled={busy} class={plainButton} onclick={() => void deny()}>
            Deny
          </button>
          <button
            type="button"
            disabled={busy}
            class="{accentButton} px-6!"
            onclick={() => void confirm()}
          >
            Pair
          </button>
        </div>
      </div>
    </section>
  {:else if view === 'expired'}
    <section class={card}>
      <h1 id="view-focus" tabindex="-1" class={cardTitle}>This code doesn't work</h1>
      <p class={cardText}>
        It expired, was already used, or was mistyped. Enter it again, or start pairing again in the
        moil app.
      </p>
      <div class="mt-5">{@render codeForm('Pairing code')}</div>
      <button type="button" class="{textButton} mt-4" onclick={showList}>Your machines</button>
    </section>
  {:else if view === 'denied'}
    <section class={card}>
      <h1 id="view-focus" tabindex="-1" class={cardTitle}>Machine not paired</h1>
      <p class={cardText}>
        You denied <bdi class="text-ink">{deniedName}</bdi>. Nothing was shared with it, and its
        code no longer works.
      </p>
      <button type="button" class="{textButton} mt-4" onclick={showList}>Your machines</button>
    </section>
  {:else if view === 'list' && data}
    <div class="flex flex-wrap items-end justify-between gap-x-4 gap-y-5 pt-10 max-sm:pt-5">
      <div class="min-w-0">
        <h1
          id="view-focus"
          tabindex="-1"
          class="m-0 text-[64px] leading-none font-medium tracking-[-0.04em] text-ink max-sm:text-[44px]"
        >
          Machines
        </h1>
        <p class="m-0 mt-4 max-w-[560px] text-[15px] text-ink-2">
          Machines you pair transcribe your recordings on your own hardware. Your recordings only
          ever go to your own machines.
        </p>
      </div>
      <a
        class="{accentButton} h-13! px-6! text-[16px]!"
        href={pairHref}
        title="Opens the moil app on this computer"
      >
        <Plus size={16} weight="regular" aria-hidden="true" /> Add a machine
      </a>
    </div>

    {#if pairedMachine}
      <div
        id="paired-banner"
        tabindex="-1"
        class="mt-6 flex items-start gap-2.5 rounded-md border border-ok/30 bg-ok/10 px-5 py-3.5 text-[14px] text-ink"
        role="status"
      >
        <CheckCircle
          class="mt-0.5 shrink-0 text-ok"
          size={16}
          weight="regular"
          aria-hidden="true"
        />
        <p class="m-0">
          Paired <strong class="font-[550]"><bdi>{pairedMachine.name}</bdi></strong>.
          {pairedMachine.approved
            ? 'It will transcribe every new recording of rooms you own.'
            : `To start transcribing, review and approve the ${data.bundle.name} bundle in its moil app.`}
        </p>
      </div>
    {/if}

    {#if error}<p class="m-0 mt-4 text-[13px] text-rec-ink" role="alert">{error}</p>{/if}

    <section class="mt-10" aria-labelledby="view-focus">
      {#if data.machines.length === 0}
        <!-- Onboarding: most hosts have never heard of moil. -->
        <div
          class="rounded-lg border border-line bg-surface p-6 text-[14px] text-ink max-sm:p-5"
          data-testid="onboarding"
        >
          <p class="m-0 text-[18px] font-medium tracking-[-0.01em]">
            Transcribe on a computer of your own
          </p>
          <ol class="m-0 mt-4 grid list-none gap-3 p-0">
            <li class="flex items-baseline gap-3">
              <span class={step} aria-hidden="true">1</span>
              <span>
                Get the moil app on the computer that will transcribe.
                <a class="text-accent" href={data.app_url} target="_blank" rel="noreferrer"
                  >Download moil</a
                >
              </span>
            </li>
            <li class="flex items-baseline gap-3">
              <span class={step} aria-hidden="true">2</span>
              <span>
                Pair it with tide: choose <strong class="font-[550]">Add a machine</strong> on that computer,
                or paste the address below into its moil app.
              </span>
            </li>
            <li class="flex items-baseline gap-3">
              <span class={step} aria-hidden="true">3</span>
              <span>
                In moil, review and approve the {data.bundle.name} bundle, version
                <span class="mono">{data.bundle.version}</span>
                (<span class="mono" title={data.bundle.hash}>{shortHash(data.bundle.hash)}</span>).
              </span>
            </li>
          </ol>
        </div>
      {:else}
        <ul class="m-0 list-none overflow-hidden rounded-lg border border-line bg-surface p-0">
          {#each data.machines as machine (machine.id)}
            <li
              class="flex items-start gap-3 border-b border-line px-5 py-4 last:border-b-0 max-sm:px-4"
              data-machine-id={machine.id}
            >
              <span
                class="mt-[8px] size-2 shrink-0 rounded-pill {stateDot(machine)}"
                aria-hidden="true"
              ></span>
              <div class="min-w-0 flex-1">
                <div class="text-[15px] font-medium text-ink [overflow-wrap:anywhere]">
                  <bdi>{machine.name}</bdi>
                </div>
                <div class="mt-1 flex flex-wrap items-center gap-x-1.5 text-[12px] text-ink-2">
                  <span data-testid="machine-state">{stateLabel(machine)}</span>
                  <span aria-hidden="true">·</span>
                  <span><bdi>{osLabel(machine.os)}</bdi></span>
                  <span aria-hidden="true">·</span>
                  <span>moil <bdi class="mono">{machine.app_version}</bdi></span>
                </div>
                {#if !machine.approved}
                  <p
                    class="m-0 mt-3 flex items-start gap-2 rounded-sm bg-surface-2 px-3 py-2.5 text-[13px] text-ink"
                    data-testid="approve-hint"
                  >
                    <Info
                      class="mt-0.5 shrink-0 text-warn"
                      size={16}
                      weight="regular"
                      aria-hidden="true"
                    />
                    <span>
                      Not transcribing yet. In the moil app on this machine, review and approve the
                      {data.bundle.name} bundle, version
                      <span class="mono">{data.bundle.version}</span>
                      (<span class="mono" title={data.bundle.hash}
                        >{shortHash(data.bundle.hash)}</span
                      >).
                    </span>
                  </p>
                {/if}
              </div>
              <button
                type="button"
                disabled={busy}
                class="inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-pill border px-3 text-[12px] font-medium transition-colors duration-(--dur-1) disabled:opacity-50 pointer-coarse:h-11 pointer-coarse:min-w-11 {unpairID ===
                machine.id
                  ? 'border-danger bg-danger text-on-danger'
                  : 'border-line-strong bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink'}"
                aria-label={unpairID === machine.id
                  ? `Confirm unpair ${machine.name}`
                  : `Unpair ${machine.name}`}
                title={unpairID === machine.id ? undefined : 'Unpair'}
                onclick={() => void unpair(machine)}
              >
                {#if unpairID === machine.id}
                  Unpair?
                {:else}
                  <LinkBreak size={16} weight="regular" aria-hidden="true" />
                {/if}
              </button>
            </li>
          {/each}
        </ul>
      {/if}
    </section>

    <!-- A computer that isn't this one: the deep link above can't reach it,
         so its moil app starts the pairing and shows the code. -->
    <section class="mt-14 max-sm:mt-10" aria-labelledby="pair-another-heading">
      <div class="flex flex-wrap items-baseline justify-between gap-x-4">
        <h2
          id="pair-another-heading"
          class="m-0 text-[22px] font-medium tracking-[-0.02em] text-ink"
        >
          Pair another computer
        </h2>
        {#if data.machines.length > 0}
          <!-- Without a machine yet, the steps above link it. -->
          <a class="text-[14px] text-accent" href={data.app_url} target="_blank" rel="noreferrer"
            >Get moil</a
          >
        {/if}
      </div>
      <ol class="m-0 mt-4 grid list-none gap-3 p-0 sm:grid-cols-2">
        <li
          class="flex min-w-0 gap-3 rounded-lg border border-line bg-surface p-5 text-[13px] max-sm:p-4"
        >
          <span class={step} aria-hidden="true">1</span>
          <div class="min-w-0 flex-1 text-ink-2">
            <label for="moil-address">Paste this address into its moil app</label>
            <div class="mt-2 flex items-center gap-2">
              <input
                id="moil-address"
                class={field}
                value={data.moil_url}
                readonly
                onfocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                class="grid size-10 shrink-0 place-items-center rounded-pill border border-line-strong bg-transparent p-0 text-ink-2 transition-colors duration-(--dur-1) hover:bg-surface-2 hover:text-ink pointer-coarse:size-11"
                aria-label={copied ? 'Address copied' : 'Copy address'}
                title={copied ? 'Copied' : 'Copy address'}
                onclick={() => void copyAddress()}
              >
                {#if copied}
                  <Check size={16} weight="regular" aria-hidden="true" />
                {:else}
                  <Copy size={16} weight="regular" aria-hidden="true" />
                {/if}
              </button>
            </div>
          </div>
        </li>
        <li
          class="flex min-w-0 gap-3 rounded-lg border border-line bg-surface p-5 text-[13px] max-sm:p-4"
        >
          <span class={step} aria-hidden="true">2</span>
          <div class="min-w-0 flex-1">{@render codeForm('Enter the code it shows')}</div>
        </li>
      </ol>
    </section>
  {/if}
</main>
