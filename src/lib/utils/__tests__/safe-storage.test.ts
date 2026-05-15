import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { safeLocalStorage } from '../safe-storage';
import { installLocalStorageMock } from '$lib/store/utils/test-helpers/local-storage-mock';

const localStorageMock = installLocalStorageMock();

describe('safeLocalStorage JSON helpers', () => {
  beforeEach(() => {
    localStorageMock.reset();
    vi.clearAllMocks();
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