export type Theme = 'light' | 'dark';
export type ThemePreference = Theme | 'system';

const storageKey = 'tide-theme';

function storedPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    // Storage blocked: follow the system.
  }
  return 'system';
}

// The inline script in app.html applies the same rule before first paint;
// the layout writes `resolved` to <html data-theme> after that.
class ThemeStore {
  preference = $state<ThemePreference>(storedPreference());
  system = $state<Theme>('light');
  resolved = $derived<Theme>(this.preference === 'system' ? this.system : this.preference);

  constructor() {
    const media = matchMedia('(prefers-color-scheme: dark)');
    this.system = media.matches ? 'dark' : 'light';
    media.addEventListener('change', (event) => {
      this.system = event.matches ? 'dark' : 'light';
    });
  }

  /** Choosing what the system already shows stores "system", so it keeps following it. */
  set(preference: ThemePreference): void {
    this.preference = preference === this.system ? 'system' : preference;
    try {
      localStorage.setItem(storageKey, this.preference);
    } catch {
      // Storage blocked: the choice lasts until reload.
    }
  }
}

export const theme = new ThemeStore();
