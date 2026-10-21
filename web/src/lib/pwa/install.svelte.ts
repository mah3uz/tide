interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

function detectStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

function detectIOS(): boolean {
  if (typeof navigator === 'undefined') return false;
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return true;
  return navigator.userAgent.includes('Macintosh') && navigator.maxTouchPoints > 1;
}

class InstallStore {
  #event: BeforeInstallPromptEvent | null = $state(null);
  isStandalone = $state(detectStandalone());
  isIOS = detectIOS();
  canInstall = $derived(this.#event !== null);

  constructor() {
    if (typeof window === 'undefined') return;
    window.addEventListener('beforeinstallprompt', (e) => {
      e.preventDefault();
      this.#event = e as BeforeInstallPromptEvent;
    });
    window.addEventListener('appinstalled', () => {
      this.#event = null;
      this.isStandalone = true;
    });
  }

  async install(): Promise<void> {
    const event = this.#event;
    if (!event) return;
    this.#event = null;
    await event.prompt();
    await event.userChoice;
  }
}

export const pwaInstall = new InstallStore();
