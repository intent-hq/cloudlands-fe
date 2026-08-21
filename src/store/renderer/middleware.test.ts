import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

import { REDUX_DEBUG_LS_KEY, REDUX_DEBUG_LS_KEY_STATE_REFS_KEY } from './constants';

const mocks = vi.hoisted(() => {
  const passthrough = () =>
    vi.fn(() => (next: (action: unknown) => unknown) => (action: unknown) => next(action));
  const storeGuardMiddleware = passthrough();
  const batchingMiddleware = passthrough();
  const refCheckMiddleware = passthrough();
  const structuredCloneMiddleware = passthrough();

  return {
    createStoreGuardMiddleware: vi.fn(() => storeGuardMiddleware),
    createBatchingMiddleware: vi.fn(() => batchingMiddleware),
    createReferenceChangeDetectorMiddleware: vi.fn(() => refCheckMiddleware),
    createStructuredCloneCheckerMiddleware: vi.fn(() => structuredCloneMiddleware),
    storeGuardMiddleware,
    batchingMiddleware,
    refCheckMiddleware,
    structuredCloneMiddleware,
  };
});

vi.mock('../../store/utils/store-guard-middleware', () => ({
  createStoreGuardMiddleware: mocks.createStoreGuardMiddleware,
}));
vi.mock('./middlewares/batch', () => ({
  createBatchingMiddleware: mocks.createBatchingMiddleware,
}));
vi.mock('./middlewares/state-reference-checks', () => ({
  createReferenceChangeDetectorMiddleware: mocks.createReferenceChangeDetectorMiddleware,
}));
vi.mock('./middlewares/structured-clone-checker', () => ({
  createStructuredCloneCheckerMiddleware: mocks.createStructuredCloneCheckerMiddleware,
}));

const localStorageGetItem = window.localStorage.getItem as unknown as Mock;
const localStorageSetItem = window.localStorage.setItem as unknown as Mock;
const localStorageRemoveItem = window.localStorage.removeItem as unknown as Mock;

function setLocalStorageEntries(entries: Record<string, string | null | undefined>) {
  localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
}

async function initStoreForReduxLoggingTests() {
  const { initAppStore } = await import('./store');
  return initAppStore({
    init: vi.fn(() => vi.fn()),
    getReadableState: vi.fn(() => ({ subscribe: vi.fn(() => vi.fn()) })),
    dispatch: vi.fn((action: unknown) => action),
    state: {},
  } as any);
}

describe('renderer middleware ownership', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.clearAllMocks();
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: 'false' });
  });

  it('contains the guard, batching, and enabled diagnostics', async () => {
    const { middleware } = await import('./middleware');

    expect(mocks.createStoreGuardMiddleware).toHaveBeenCalledOnce();
    expect(mocks.createStoreGuardMiddleware).toHaveBeenCalledWith('renderer');
    expect(mocks.createBatchingMiddleware).toHaveBeenCalledOnce();
    expect(mocks.createBatchingMiddleware).toHaveBeenCalledWith([]);
    expect(mocks.createReferenceChangeDetectorMiddleware).not.toHaveBeenCalled();
    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });

  it('adds the reference diagnostic only when explicitly enabled', async () => {
    setLocalStorageEntries({
      [REDUX_DEBUG_LS_KEY]: 'false',
      [REDUX_DEBUG_LS_KEY_STATE_REFS_KEY]: 'true',
    });

    const { middleware } = await import('./middleware');

    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.refCheckMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });

  it('leaves action logging out of middleware when its Store preference is enabled', async () => {
    setLocalStorageEntries({ [REDUX_DEBUG_LS_KEY]: 'true' });

    const { middleware } = await import('./middleware');

    expect(middleware).toEqual([
      mocks.storeGuardMiddleware,
      mocks.batchingMiddleware,
      mocks.structuredCloneMiddleware,
    ]);
  });
});

describe('window.intent Redux logging interface', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    vi.clearAllMocks();
    setLocalStorageEntries({});
    delete (window as Window & { intent?: unknown }).intent;
  });

  it('registers logging controls', async () => {
    const storeContext = await initStoreForReduxLoggingTests();

    expect(window.intent?.enableReduxLogging).toBeTypeOf('function');
    expect(window.intent?.disableReduxLogging).toBeTypeOf('function');

    storeContext.dispose();
  });

  it('persists Redux logging toggles', async () => {
    const consoleLog = vi.spyOn(console, 'log').mockImplementation(() => {});
    const storeContext = await initStoreForReduxLoggingTests();

    window.intent?.enableReduxLogging?.();
    expect(localStorageSetItem).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY, 'true');
    window.intent?.disableReduxLogging?.();
    expect(localStorageSetItem).toHaveBeenCalledWith(REDUX_DEBUG_LS_KEY, 'false');

    storeContext.dispose();
    consoleLog.mockRestore();
  });

  it('toggles stored boolean values', async () => {
    const entries: Record<string, string | null> = { [REDUX_DEBUG_LS_KEY]: 'false' };
    localStorageGetItem.mockImplementation((key: string) => entries[key] ?? null);
    localStorageSetItem.mockImplementation((key: string, value: string) => {
      entries[key] = value;
    });
    localStorageRemoveItem.mockImplementation((key: string) => {
      entries[key] = null;
    });
    const storeContext = await initStoreForReduxLoggingTests();

    window.intent?.debug?.toggleReduxLogs?.();
    expect(entries[REDUX_DEBUG_LS_KEY]).toBe('true');
    window.intent?.debug?.toggleReduxLogs?.();
    expect(entries[REDUX_DEBUG_LS_KEY]).toBe('false');

    storeContext.dispose();
  });
});
