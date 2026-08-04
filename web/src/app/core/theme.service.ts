import { Service, signal } from '@angular/core';

export type ThemeMode = 'light' | 'system' | 'dark';

const themeModeStorageKey = 'weiff.theme';

@Service()
export class ThemeService {
  readonly mode = signal<ThemeMode>(readThemeMode());

  constructor() {
    this.apply(this.mode());
  }

  setMode(value: unknown): void {
    const mode = normalizeThemeMode(value);
    this.mode.set(mode);
    this.apply(mode);

    try {
      window.localStorage.setItem(themeModeStorageKey, mode);
    } catch {
      // The selected mode still applies for this page when storage is unavailable.
    }
  }

  private apply(mode: ThemeMode): void {
    document.documentElement.dataset['theme'] = mode;
  }
}

function readThemeMode(): ThemeMode {
  try {
    const stored = window.localStorage.getItem(themeModeStorageKey);
    if (stored != null) {
      return normalizeThemeMode(stored);
    }
    return 'system';
  } catch {
    return 'system';
  }
}

export function normalizeThemeMode(value: unknown): ThemeMode {
  return value === 'light' || value === 'dark' ? value : 'system';
}
