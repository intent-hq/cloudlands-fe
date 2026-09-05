import { beforeEach, describe, expect, it, vi } from 'vitest';

import { REDUX_DEBUG_LS_KEY } from './constants';

const mocks = vi.hoisted(() => ({
  middleware: [vi.fn()],
  reducers: { example: vi.fn() },
  safeLocalStorageGetItemWithStatus: vi.fn(),
  storeConstructor: vi.fn(),
}));

vi.mock('@augmentcode/themis/svelte-store', () => ({
  Store: class {
    constructor(...args: unknown[]) {
      mocks.storeConstructor(...args);
    }
  },
}));

vi.mock('./middleware', () => ({ middleware: mocks.middleware }));
vi.mock('./reducer', () => ({ reducers: mocks.reducers }));
vi.mock('$lib/utils/safe-storage', () => ({
  safeLocalStorage: { getItemWithStatus: mocks.safeLocalStorageGetItemWithStatus },
}));

describe('configured renderer Store action logging', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
    mocks.safeLocalStorageGetItemWithStatus.mockReturnValue({ value: null, hadError: false });
  });

  it.each([
    ['missing', null, false, false],
    ['enabled', 'true', false, true],
    ['disabled', 'false', false, false],
    ['undefined text', 'undefined', false, false],
    ['malformed', 'invalid', false, false],
    ['truthy JSON', '1', false, false],
    ['quoted true', '"true"', false, false],
    ['storage error', 'true', true, false],
  ])('maps the %s preference to the Store option', async (_case, value, hadError, expected) => {
    mocks.safeLocalStorageGetItemWithStatus.mockReturnValue({ value, hadError });

    await import('./configured-store');

    expect(mocks.safeLocalStorageGetItemWithStatus).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY);
    expect(mocks.storeConstructor).toHaveBeenCalledWith(
      { example: expect.any(Function) },
      mocks.middleware,
      { logReduxActions: expected },
    );
  });
});
