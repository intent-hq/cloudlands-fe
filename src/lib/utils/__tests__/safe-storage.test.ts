import { beforeEach, describe, expect, it, vi } from 'vitest';

import { safeLocalStorage } from '../safe-storage';

const storage = new Map<string, string>();
const localStorageMock = {
  getItem: vi.fn((key: string) => storage.get(key) ?? null),
  setItem: vi.fn((key: string, value: string) => {
    storage.set(key, value);
  }),
  removeItem: vi.fn((key: string) => {
    storage.delete(key);
  }),
  clear: vi.fn(() => {
    storage.clear();
  }),
};

describe('safeLocalStorage JSON helpers', () => {
  beforeEach(() => {
    storage.clear();
    vi.clearAllMocks();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: localStorageMock,
    });
    window.localStorage.clear();
  });

  it('allows getJSON to be called without binding', () => {
    window.localStorage.setItem('prefs', JSON.stringify({ theme: 'dark' }));

    const { getJSON } = safeLocalStorage;

    expect(getJSON<{ theme: string }>('prefs')).toEqual({ theme: 'dark' });
  });

  it('allows setJSON to be called without binding', () => {
    const { setJSON } = safeLocalStorage;

    setJSON('prefs', { theme: 'dark' });

    expect(window.localStorage.getItem('prefs')).toBe('{"theme":"dark"}');
  });
});