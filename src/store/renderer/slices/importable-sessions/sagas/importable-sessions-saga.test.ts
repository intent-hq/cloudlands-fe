import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// FAKE seam: the daemon list call is stubbed; the saga runs against the real store.
vi.mock('$features/session-import/importable-sessions.client', () => ({
  listImportableSessions: vi.fn(),
}));

// The host capability is the gate; the rest of the principal selectors stay real.
const capabilities = vi.hoisted(() => ({ value: { sessionImport: 1 } as Record<string, unknown> }));
vi.mock('../../principal/principal-selectors', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../principal/principal-selectors')>();
  return {
    ...actual,
    selectPrincipalSnapshot: {
      ...actual.selectPrincipalSnapshot,
      select: () => ({ capabilities: capabilities.value }),
    },
  };
});

import { listImportableSessions } from '$features/session-import/importable-sessions.client';
import { store as appStore } from '$store/renderer/store';
import {
  importableSessionsLoaded,
  importableSessionsRequested,
  importableSessionsReset,
} from '../importable-sessions-slice';
import {
  selectImportableSessionProviders,
  selectImportableSessions,
  selectImportableSessionsStatus,
} from '../importable-sessions-selectors';
import {
  IMPORTABLE_SESSIONS_PAGE_SIZE,
  IMPORTABLE_SESSIONS_SEARCH_DEBOUNCE_MS,
  importableSessionsSaga,
} from './importable-sessions-saga';

const list = listImportableSessions as unknown as ReturnType<typeof vi.fn>;
const session = (sessionId: string, title = sessionId) => ({
  provider: 'claude-code',
  sessionId,
  title,
  cwd: '/repo',
  updatedAt: '2026-09-01T12:00:00.000Z',
});
const flush = () => vi.advanceTimersByTimeAsync(0);
const state = () => ({
  status: selectImportableSessionsStatus.select(appStore.state),
  ids: selectImportableSessions.select(appStore.state).map((row) => row.sessionId),
});

describe('importableSessionsSaga (fake seam, real store)', () => {
  let stopSaga: () => void;
  let disposeStore: () => void;

  beforeAll(() => {
    disposeStore = appStore.init();
    stopSaga = appStore.runSaga(importableSessionsSaga);
  });
  afterAll(() => {
    stopSaga();
    disposeStore();
  });
  beforeEach(() => {
    vi.useFakeTimers();
    capabilities.value = { sessionImport: 1 };
    appStore.dispatch(importableSessionsLoaded('', []));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('loads the first page at once', async () => {
    list.mockResolvedValueOnce({ ok: true, sessions: [session('a'), session('b')] });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();

    expect(list).toHaveBeenCalledWith({ limit: IMPORTABLE_SESSIONS_PAGE_SIZE });
    expect(state()).toEqual({ status: 'ready', ids: ['a', 'b'] });
  });

  it('keeps undated sessions in the daemon order', async () => {
    list.mockResolvedValueOnce({
      ok: true,
      sessions: [
        { ...session('a'), updatedAt: null },
        { ...session('b'), updatedAt: null },
      ],
      providers: [],
    });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();

    expect(state()).toEqual({ status: 'ready', ids: ['a', 'b'] });
  });

  it('loads an empty list when the daemon has no sessions', async () => {
    list.mockResolvedValueOnce({ ok: true, sessions: [] });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();

    expect(state()).toEqual({ status: 'ready', ids: [] });
  });

  it('keeps the provider status when one provider fails with no sessions', async () => {
    list.mockResolvedValueOnce({
      ok: true,
      sessions: [],
      providers: [{ id: 'codex', label: 'Codex', status: 'error', error: 'timed out' }],
    });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();

    expect(state()).toEqual({ status: 'ready', ids: [] });
    expect(selectImportableSessionProviders.select(appStore.state)).toEqual([
      { id: 'codex', label: 'Codex', status: 'error', error: 'timed out' },
    ]);
  });

  it('passes a provider filter and keeps the full provider list', async () => {
    list.mockResolvedValueOnce({
      ok: true,
      sessions: [session('a')],
      providers: [
        { id: 'claude-code', label: 'Claude Code', status: 'ok' },
        { id: 'codex', label: 'Codex', status: 'ok' },
      ],
    });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();
    list.mockResolvedValueOnce({
      ok: true,
      sessions: [],
      providers: [{ id: 'codex', label: 'Codex', status: 'ok' }],
    });
    appStore.dispatch(importableSessionsRequested('', 'codex'));
    await flush();

    expect(list).toHaveBeenLastCalledWith({
      provider: 'codex',
      limit: IMPORTABLE_SESSIONS_PAGE_SIZE,
    });
    expect(selectImportableSessionProviders.select(appStore.state).map((p) => p.id)).toEqual([
      'claude-code',
      'codex',
    ]);
  });

  it.each([{}, { sessionImport: 0 }, { sessionImport: true }, { sessionImport: 2 }])(
    'never lists without sessionImport: 1 (%j)',
    async (bag) => {
      capabilities.value = bag;
      appStore.dispatch(importableSessionsRequested(''));
      await flush();

      expect(list).not.toHaveBeenCalled();
    },
  );

  it('reports a failed first page for a retry', async () => {
    list.mockResolvedValueOnce({ ok: false, error: 'boom' });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();

    expect(state()).toMatchObject({ status: 'error' });
  });

  it('debounces typed queries', async () => {
    list.mockResolvedValueOnce({ ok: true, sessions: [session('a')] });
    appStore.dispatch(importableSessionsRequested(''));
    await flush();

    list.mockResolvedValue({ ok: true, sessions: [] });
    appStore.dispatch(importableSessionsRequested('cl'));
    appStore.dispatch(importableSessionsRequested('clou'));
    await vi.advanceTimersByTimeAsync(IMPORTABLE_SESSIONS_SEARCH_DEBOUNCE_MS - 1);
    expect(list).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(list).toHaveBeenCalledTimes(2);
    expect(list).toHaveBeenLastCalledWith({ query: 'clou', limit: IMPORTABLE_SESSIONS_PAGE_SIZE });
    expect(state()).toEqual({ status: 'ready', ids: [] });
  });

  it('drops the rows on reset and ignores a request still in flight', async () => {
    let resolve!: (value: { ok: true; sessions: ReturnType<typeof session>[] }) => void;
    list.mockReturnValueOnce(new Promise((done) => (resolve = done)));
    appStore.dispatch(importableSessionsRequested(''));
    await flush();
    appStore.dispatch(importableSessionsReset());
    resolve({ ok: true, sessions: [session('late')] });
    await flush();

    expect(state()).toEqual({ status: 'idle', ids: [] });
  });
});
