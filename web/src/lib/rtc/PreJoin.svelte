<script lang="ts">
  import { onDestroy, onMount, type Snippet } from 'svelte';
  import {
    CaretDown,
    Microphone,
    MicrophoneSlash,
    VideoCamera,
    VideoCameraSlash
  } from 'phosphor-svelte';
  import {
    Room,
    createLocalAudioTrack,
    createLocalVideoTrack,
    type LocalAudioTrack,
    type LocalVideoTrack
  } from 'livekit-client';
  import type { PreJoinOptions } from './room.svelte';
  import { clampAspect, observeAspect } from './aspect';
  import { attachMediaTrack } from './mediaElement';
  import Button from '#lib/ui/Button.svelte';
  import ThemeToggle from '#lib/ui/ThemeToggle.svelte';
  import Wordmark from '#lib/ui/Wordmark.svelte';

  let {
    room = $bindable(),
    name = $bindable(),
    error = '',
    showRoom = true,
    heading = 'Join a room',
    onactivateplayback = () => undefined,
    onjoin,
    account
  }: {
    room: string;
    name: string;
    error?: string;
    showRoom?: boolean;
    heading?: string;
    onactivateplayback?: () => void;
    onjoin: (options: PreJoinOptions) => void | Promise<void>;
    account?: Snippet;
  } = $props();

  let cameras = $state<MediaDeviceInfo[]>([]);
  let microphones = $state<MediaDeviceInfo[]>([]);
  let videoDeviceId = $state('');
  let audioDeviceId = $state('');
  let camEnabled = $state(true);
  let micEnabled = $state(true);
  let cameraTrack = $state<LocalVideoTrack>();
  let previewAspect = $state(clampAspect(0, 0));
  let audioTrack: LocalAudioTrack | undefined;
  let micLevel = $state(0);
  let previewBusy = $state(true);
  let previewError = $state('');

  let audioContext: AudioContext | undefined;
  let analyser: AnalyserNode | undefined;
  let audioSource: MediaStreamAudioSourceNode | undefined;
  let meterFrame = 0;
  let cameraRequest = 0;
  let audioRequest = 0;
  let disposed = false;

  async function refreshDevices(requestPermissions = false): Promise<void> {
    const devices = await Room.getLocalDevices(undefined, requestPermissions);
    cameras = devices.filter((device) => device.kind === 'videoinput');
    microphones = devices.filter((device) => device.kind === 'audioinput');

    if (!cameras.some((device) => device.deviceId === videoDeviceId)) {
      videoDeviceId = cameras[0]?.deviceId ?? '';
    }
    if (!microphones.some((device) => device.deviceId === audioDeviceId)) {
      audioDeviceId = microphones[0]?.deviceId ?? '';
    }
  }

  function stopCamera(invalidate = true): void {
    if (invalidate) cameraRequest += 1;
    cameraTrack?.detach();
    cameraTrack?.stop();
    cameraTrack = undefined;
    previewAspect = clampAspect(0, 0);
  }

  async function startCamera(): Promise<void> {
    const request = ++cameraRequest;
    stopCamera(false);
    if (!camEnabled || disposed) return;

    try {
      const track = await createLocalVideoTrack(
        videoDeviceId ? { deviceId: { exact: videoDeviceId } } : undefined
      );
      if (disposed || request !== cameraRequest || !camEnabled) {
        track.stop();
        return;
      }
      cameraTrack = track;
      previewError = '';
    } catch {
      if (request === cameraRequest) {
        camEnabled = false;
        previewError = 'Camera unavailable.';
      }
    }
  }

  function stopMeter(): void {
    audioRequest += 1;
    cancelAnimationFrame(meterFrame);
    meterFrame = 0;
    audioSource?.disconnect();
    analyser?.disconnect();
    audioSource = undefined;
    analyser = undefined;
    audioTrack?.stop();
    audioTrack = undefined;
    micLevel = 0;
    if (audioContext) {
      void audioContext.close().catch(() => undefined);
      audioContext = undefined;
    }
  }

  function sampleMicLevel(): void {
    if (!analyser) return;
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (const sample of samples) {
      const normalized = (sample - 128) / 128;
      sum += normalized * normalized;
    }
    const rms = Math.sqrt(sum / samples.length);
    micLevel = Math.min(1, micLevel * 0.72 + rms * 4 * 0.28);
    meterFrame = requestAnimationFrame(sampleMicLevel);
  }

  async function startMicrophone(): Promise<void> {
    stopMeter();
    const request = ++audioRequest;
    if (!micEnabled || disposed) return;

    try {
      const track = await createLocalAudioTrack(
        audioDeviceId ? { deviceId: { exact: audioDeviceId } } : undefined
      );
      if (disposed || request !== audioRequest || !micEnabled) {
        track.stop();
        return;
      }

      const context = new AudioContext();
      const nextAnalyser = context.createAnalyser();
      nextAnalyser.fftSize = 256;
      nextAnalyser.smoothingTimeConstant = 0.7;
      const source = context.createMediaStreamSource(new MediaStream([track.mediaStreamTrack]));
      source.connect(nextAnalyser);

      audioTrack = track;
      audioContext = context;
      analyser = nextAnalyser;
      audioSource = source;
      sampleMicLevel();
    } catch {
      if (request === audioRequest) micEnabled = false;
    }
  }

  async function initialize(): Promise<void> {
    previewBusy = true;
    try {
      await refreshDevices(true);
      await Promise.all([startCamera(), startMicrophone()]);
      await refreshDevices(false);
    } catch {
      previewError = 'Check camera and microphone access.';
      await Promise.all([startCamera(), startMicrophone()]);
    } finally {
      previewBusy = false;
    }
  }

  async function toggleCamera(): Promise<void> {
    camEnabled = !camEnabled;
    if (camEnabled) await startCamera();
    else stopCamera();
  }

  async function toggleMicrophone(): Promise<void> {
    micEnabled = !micEnabled;
    if (micEnabled) await startMicrophone();
    else stopMeter();
  }

  async function changeCamera(event: Event): Promise<void> {
    videoDeviceId = (event.currentTarget as HTMLSelectElement).value;
    if (camEnabled) await startCamera();
  }

  async function changeMicrophone(event: Event): Promise<void> {
    audioDeviceId = (event.currentTarget as HTMLSelectElement).value;
    if (micEnabled) await startMicrophone();
  }

  async function disposePreview(): Promise<void> {
    disposed = true;
    stopCamera();
    stopMeter();
  }

  async function submit(event: SubmitEvent): Promise<void> {
    event.preventDefault();
    room = room.trim();
    name = name.trim();
    if (!room || !name) return;

    // LiveKit's playback unlock must begin in the Join click stack, before
    // token fetches, lobby waits, or the WebSocket connection consume it.
    onactivateplayback();
    await disposePreview();
    await onjoin({ name, micEnabled, camEnabled, videoDeviceId, audioDeviceId });
  }

  onMount(() => {
    void initialize();
  });

  onDestroy(() => {
    void disposePreview();
  });
</script>

<main class="prejoin-shell">
  <header class="topbar">
    <Wordmark size={18} />
    <div class="topbar-end">
      {@render account?.()}
      <ThemeToggle />
    </div>
  </header>

  <form class="prejoin" onsubmit={submit}>
    <div class="preview-well" class:live={cameraTrack && camEnabled}>
      {#if cameraTrack && camEnabled}
        <!-- The preview box takes the broadcast frame's clamped aspect, so
             what you see here is exactly what remote tiles render. -->
        <div class="video-box" style:--va={previewAspect}>
          <!-- Local preview video does not have a caption track. -->
          <video
            use:attachMediaTrack={cameraTrack}
            use:observeAspect={(next) => (previewAspect = next)}
            autoplay
            playsinline
            muted
            aria-label="Camera preview"
          ></video>
        </div>
      {:else}
        <div class="preview-placeholder" aria-label="Camera off">
          <span class="placeholder-disc">
            <VideoCameraSlash size={28} weight="regular" aria-hidden="true" />
          </span>
        </div>
      {/if}

      <button
        class:off={!camEnabled}
        class="round-toggle preview-toggle"
        type="button"
        aria-label={camEnabled ? 'Turn camera off' : 'Turn camera on'}
        aria-pressed={camEnabled}
        title={camEnabled ? 'Turn camera off' : 'Turn camera on'}
        onclick={() => void toggleCamera()}
      >
        {#if camEnabled}
          <VideoCamera size={20} weight="regular" aria-hidden="true" />
        {:else}
          <VideoCameraSlash size={20} weight="regular" aria-hidden="true" />
        {/if}
      </button>
    </div>

    <div class="details">
      <h1 class:room-heading={!showRoom}>{heading}</h1>

      {#if showRoom}
        <label class="field">
          <span>Room</span>
          <input class="mono" bind:value={room} name="room" autocomplete="off" required />
        </label>
      {/if}

      <label class="field">
        <span>Name</span>
        <input bind:value={name} name="name" autocomplete="name" required />
      </label>

      <div class="device-row">
        <label class="field">
          <span>Camera</span>
          <span class="select">
            <select
              bind:value={videoDeviceId}
              onchange={changeCamera}
              disabled={cameras.length === 0}
            >
              {#each cameras as device, index (device.deviceId)}
                <option value={device.deviceId}>{device.label || `Camera ${index + 1}`}</option>
              {/each}
            </select>
            <CaretDown size={14} weight="regular" aria-hidden="true" />
          </span>
        </label>

        <label class="field">
          <span>Microphone</span>
          <span class="select">
            <select
              bind:value={audioDeviceId}
              onchange={changeMicrophone}
              disabled={microphones.length === 0}
            >
              {#each microphones as device, index (device.deviceId)}
                <option value={device.deviceId}>{device.label || `Microphone ${index + 1}`}</option>
              {/each}
            </select>
            <CaretDown size={14} weight="regular" aria-hidden="true" />
          </span>
        </label>
      </div>

      <div class="mic-control">
        <button
          class:off={!micEnabled}
          class="round-toggle mic-toggle"
          type="button"
          aria-label={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          aria-pressed={micEnabled}
          title={micEnabled ? 'Mute microphone' : 'Unmute microphone'}
          onclick={() => void toggleMicrophone()}
        >
          {#if micEnabled}
            <Microphone size={20} weight="regular" aria-hidden="true" />
          {:else}
            <MicrophoneSlash size={20} weight="regular" aria-hidden="true" />
          {/if}
        </button>
        <div
          class="meter"
          role="meter"
          aria-label="Microphone level"
          aria-valuemin="0"
          aria-valuemax="100"
          aria-valuenow={Math.round(micLevel * 100)}
        >
          <span style:transform={`scaleX(${micLevel})`}></span>
        </div>
      </div>

      {#if error || previewError}
        <p class="error" role="alert">{error || previewError}</p>
      {/if}

      <Button type="submit" variant="accent" class="join" disabled={previewBusy}>
        <VideoCamera size={18} weight="regular" aria-hidden="true" />
        {previewBusy ? 'Preparing…' : 'Join meeting'}
      </Button>
    </div>
  </form>
</main>

<style>
  .prejoin-shell {
    display: flex;
    min-height: 100dvh;
    flex-direction: column;
    padding: 0 32px 32px;
  }

  .topbar {
    display: flex;
    min-height: 84px;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
  }

  .topbar-end {
    display: flex;
    min-width: 0;
    align-items: center;
    gap: 12px;
  }

  .prejoin {
    display: grid;
    width: min(100%, 1040px);
    margin: auto;
    grid-template-columns: minmax(0, 1.35fr) minmax(300px, 0.85fr);
    align-items: center;
    gap: 56px;
  }

  .preview-well {
    position: relative;
    display: grid;
    aspect-ratio: 16 / 10;
    place-items: center;
    overflow: hidden;
    background: linear-gradient(160deg, var(--lens-from), var(--lens-to));
    border-radius: var(--r-xl);
    box-shadow: var(--shadow-float);
    /* Size containment gives the video box exact cqh units to contain-fit
       its clamped aspect (same mechanism as in-room tiles). */
    container-type: size;
  }

  .video-box {
    overflow: hidden;
    aspect-ratio: var(--va);
    width: clamp(min(140px, 100%), calc(100cqh * var(--va)), 100%);
    max-height: 100%;
  }

  video,
  .preview-placeholder {
    width: 100%;
    height: 100%;
  }

  video {
    display: block;
    object-fit: cover;
    transform: scaleX(-1);
  }

  .preview-placeholder {
    display: grid;
    place-items: center;
  }

  .placeholder-disc {
    display: grid;
    width: 112px;
    height: 112px;
    place-items: center;
    color: var(--ink-2);
    background: color-mix(in srgb, var(--surface) 55%, transparent);
    border-radius: var(--r-pill);
  }

  .round-toggle {
    display: grid;
    width: 48px;
    height: 48px;
    flex-shrink: 0;
    padding: 0;
    place-items: center;
    color: var(--on-accent);
    background: var(--accent);
    border: 0;
    border-radius: var(--r-pill);
    transition:
      background-color var(--dur-1) var(--ease-out),
      transform var(--dur-1) var(--ease-out);
  }

  .round-toggle:hover {
    background: var(--accent-hover);
  }

  .round-toggle:active {
    transform: scale(0.94);
  }

  .round-toggle.off {
    color: var(--rec-ink);
    background: var(--rec-soft);
  }

  .preview-toggle {
    position: absolute;
    bottom: 20px;
    left: 50%;
    translate: -50% 0;
  }

  .preview-toggle.off {
    background: color-mix(in srgb, var(--surface) 82%, transparent);
    box-shadow: var(--shadow-float);
  }

  .details {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 16px;
  }

  h1 {
    margin: 0 0 4px;
    overflow-wrap: anywhere;
    font-size: 28px;
    line-height: 1.1;
    font-weight: 500;
    letter-spacing: -0.02em;
  }

  h1.room-heading {
    font-size: 40px;
    letter-spacing: -0.035em;
  }

  .field {
    display: flex;
    min-width: 0;
    flex-direction: column;
    gap: 6px;
  }

  .field > span:first-child {
    padding-left: 4px;
    color: var(--ink-3);
    font-size: 12px;
  }

  input,
  select {
    width: 100%;
    height: 44px;
    min-width: 0;
    padding: 0 16px;
    color: var(--ink);
    background: var(--surface);
    border: 1px solid var(--line-strong);
    border-radius: var(--r-pill);
    transition: border-color var(--dur-1) var(--ease-out);
  }

  input:hover,
  select:hover:not(:disabled) {
    border-color: var(--ink-3);
  }

  .select {
    position: relative;
    display: block;
    min-width: 0;
  }

  select {
    padding-right: 36px;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    appearance: none;
  }

  select:disabled {
    color: var(--ink-3);
  }

  .select :global(svg) {
    position: absolute;
    top: 50%;
    right: 14px;
    color: var(--ink-3);
    pointer-events: none;
    translate: 0 -50%;
  }

  .device-row {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 12px;
  }

  .mic-control {
    display: flex;
    align-items: center;
    gap: 14px;
    padding: 4px 0;
  }

  .meter {
    height: 6px;
    flex: 1;
    overflow: hidden;
    background: var(--line-strong);
    border-radius: var(--r-pill);
  }

  .meter span {
    display: block;
    height: 100%;
    background: var(--accent);
    border-radius: inherit;
    transform-origin: left;
    transition: transform 60ms linear;
  }

  .error {
    margin: 0;
    padding-left: 4px;
    color: var(--rec-ink);
    font-size: 13px;
  }

  .details :global(.join) {
    width: 100%;
    height: 52px;
    margin-top: 4px;
    font-size: 15px;
  }

  @media (max-width: 860px) {
    .prejoin {
      grid-template-columns: minmax(0, 1fr) minmax(280px, 0.9fr);
      gap: 32px;
    }
  }

  @media (max-width: 639px) {
    .prejoin-shell {
      padding: 0 16px calc(20px + env(safe-area-inset-bottom));
    }

    .topbar {
      min-height: 64px;
    }

    .prejoin {
      margin: 0 auto;
      grid-template-columns: minmax(0, 1fr);
      gap: 24px;
    }

    .preview-well {
      aspect-ratio: auto;
      border-radius: var(--r-lg);
      container-type: normal;
    }

    /* Camera off: keep a landscape well for the placeholder. Live video is
       width-driven at its own clamped aspect (portrait phones stay portrait). */
    .preview-well:not(.live) {
      aspect-ratio: 4 / 3;
    }

    .video-box {
      width: 100%;
      max-height: 55dvh;
    }

    .preview-toggle {
      bottom: 14px;
    }

    .placeholder-disc {
      width: 88px;
      height: 88px;
    }

    h1,
    h1.room-heading {
      font-size: 28px;
    }
  }
</style>
