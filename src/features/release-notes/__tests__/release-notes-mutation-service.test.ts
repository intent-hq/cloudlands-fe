/**
 * Tests for the release-notes mutation middleware — the renderer half of the
 * modal flow, driven through the mock IPC router.
 *
 * Asserts that:
 * - `initializeReleaseNotes` subscribes to the main → renderer show push once
 * - the startup push (notes attached) opens the modal with those notes
 * - startup notes parked before the listener existed are read over
 *   `release-notes:get-pending`, and a duplicate push does not re-open
 * - the Help-menu push (`notes: null`) opens the modal loading, fetches over
 *   `release-notes:get`, and resolves into content
 * - an unavailable fetch still opens the modal (fallback state)
 * - a user dismissal closes the modal and invokes `release-notes:dismiss` once
 * - the main-broadcast `release-notes:close` closes the modal without echoing
 *   a dismiss back to main
 * - a Help-menu fetch that settles after the modal was closed (locally or via
 *   the close broadcast) does not re-open it, and a later explicit open still
 *   fetches and opens
 * - a second open while a fetch is in flight supersedes it; the stale result
 *   never lands
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock backend transport so unrelated middlewares resolve quietly
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: () => Promise.resolve(undefined),
  backendSubscribe: () => Promise.resolve({ subscriptionId: 'sub-rn-1' }),
  backendUnsubscribe: () => Promise.resolve(),
  onBackendNotification: () => () => {},
  onBackendReconnected: () => () => {},
}));

import { RELEASE_NOTES_CHANNELS } from '$features/release-notes/types';
import { store as appStore } from '$store/renderer/store';
import { releaseNotesSaga } from '$store/renderer/slices/release-notes/sagas/release-notes-saga';
import {
  closeReleaseNotesModal,
  dismissReleaseNotes,
  initializeReleaseNotes,
} from '$store/renderer/slices/release-notes/release-notes-slice';
import {
  addMockIpcListener,
  emitMockIpcEvent,
  mockIpcListenerCount,
  registerMockIpcHandler,
  resetMockIpcRouter,
} from '$shared/ipc-mock-router';

const NOTES = {
  version: '2.1.0',
  notes: '## What changed\n\n- Everything',
  url: 'https://github.com/intent-hq/cloudlands-releases/releases/tag/v2.1.0',
};

const flush = async () => {
  for (let i = 0; i < 5; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
};

interface Deferred {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Register a `release-notes:get` handler whose settlement the test controls.
 * Each invocation parks a new deferred in `calls` (in call order); `resolve`
 * and `reject` settle the first one.
 */
function deferGet() {
  const calls: Deferred[] = [];
  const getSpy = vi.fn(
    () =>
      new Promise((resolve, reject) => {
        calls.push({ resolve, reject });
      }),
  );
  registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, getSpy);
  return {
    getSpy,
    calls,
    resolve: (value: unknown) => calls[0].resolve(value),
    reject: (reason: unknown) => calls[0].reject(reason),
  };
}

beforeAll(() => {
  let listenerIdCounter = 0;
  (window as any).electronAPI = {
    ...((window as any).electronAPI || {}),
    on: vi.fn((channel: string, handler: (data: any) => void) => {
      addMockIpcListener(channel, handler);
      return ++listenerIdCounter;
    }),
    offById: vi.fn(),
  };
});

describe('release-notes-mutation-service', () => {
  let cancelSaga: (() => void) | undefined;
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    await flush();
    resetMockIpcRouter();
    // Nothing parked by default; individual tests override this.
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET_PENDING, async () => ({
      success: true,
      data: null,
    }));
    appStore.dispatch(closeReleaseNotesModal());
    cancelSaga = appStore.runSaga(releaseNotesSaga);
  });

  afterEach(() => cancelSaga?.());

  it('subscribes to the show and close pushes exactly once', async () => {
    appStore.dispatch(initializeReleaseNotes());
    appStore.dispatch(initializeReleaseNotes());
    await flush();

    expect(mockIpcListenerCount(RELEASE_NOTES_CHANNELS.SHOW)).toBe(1);
    expect(mockIpcListenerCount(RELEASE_NOTES_CHANNELS.CLOSE)).toBe(1);
    expect(appStore.state.releaseNotes.initialized).toBe(true);
  });

  it('opens the modal with the notes carried by the startup push', async () => {
    appStore.dispatch(initializeReleaseNotes());
    await flush();

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: NOTES });
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
    expect(appStore.state.releaseNotes.loading).toBe(false);
  });

  it('claims startup notes parked before the listener existed', async () => {
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET_PENDING, async () => ({
      success: true,
      data: NOTES,
    }));

    appStore.dispatch(initializeReleaseNotes());
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
  });

  it('does not re-open the modal when the push and the pending claim overlap', async () => {
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET_PENDING, async () => ({
      success: true,
      data: NOTES,
    }));

    appStore.dispatch(initializeReleaseNotes());
    await flush();
    appStore.dispatch(closeReleaseNotesModal());

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: NOTES });
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(false);
  });

  it('fetches over release-notes:get when the menu push carries no notes', async () => {
    const getSpy = vi.fn(async () => ({ success: true, data: NOTES }));
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, getSpy);

    appStore.dispatch(initializeReleaseNotes());
    await flush();

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
    await flush();

    expect(getSpy).toHaveBeenCalledTimes(1);
    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
    expect(appStore.state.releaseNotes.loading).toBe(false);
  });

  it('still opens the modal (fallback state) when no notes are available', async () => {
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, async () => ({
      success: false,
      error: { message: 'Release notes are not available in this build' },
    }));

    appStore.dispatch(initializeReleaseNotes());
    await flush();

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(true);
    expect(appStore.state.releaseNotes.releaseNotes).toBeNull();
    expect(appStore.state.releaseNotes.loading).toBe(false);
  });

  it('closes the modal and invokes release-notes:dismiss once on user dismissal', async () => {
    const dismissSpy = vi.fn(async () => ({ success: true }));
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.DISMISS, dismissSpy);

    appStore.dispatch(initializeReleaseNotes());
    await flush();
    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: NOTES });
    await flush();
    expect(appStore.state.releaseNotes.showModal).toBe(true);

    appStore.dispatch(dismissReleaseNotes());
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(false);
    expect(dismissSpy).toHaveBeenCalledTimes(1);
  });

  it('still closes the modal locally when release-notes:dismiss fails', async () => {
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.DISMISS, async () => {
      throw new Error('bridge unavailable');
    });

    appStore.dispatch(initializeReleaseNotes());
    await flush();
    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: NOTES });
    await flush();

    appStore.dispatch(dismissReleaseNotes());
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(false);
  });

  it('closes an open modal on the main-broadcast close without echoing a dismiss', async () => {
    const dismissSpy = vi.fn(async () => ({ success: true }));
    registerMockIpcHandler(RELEASE_NOTES_CHANNELS.DISMISS, dismissSpy);

    appStore.dispatch(initializeReleaseNotes());
    await flush();
    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: NOTES });
    await flush();
    expect(appStore.state.releaseNotes.showModal).toBe(true);

    emitMockIpcEvent(RELEASE_NOTES_CHANNELS.CLOSE, undefined);
    await flush();

    expect(appStore.state.releaseNotes.showModal).toBe(false);
    expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
    expect(dismissSpy).not.toHaveBeenCalled();
  });

  describe('a Help-menu fetch that settles after the modal was closed', () => {
    beforeEach(() => {
      registerMockIpcHandler(RELEASE_NOTES_CHANNELS.DISMISS, async () => ({ success: true }));
    });

    it('does not re-open the modal when the fetch resolves after a user dismissal', async () => {
      const deferred = deferGet();

      appStore.dispatch(initializeReleaseNotes());
      await flush();
      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(true);
      expect(deferred.getSpy).toHaveBeenCalledTimes(1);

      appStore.dispatch(dismissReleaseNotes());
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(false);

      deferred.resolve({ success: true, data: NOTES });
      await flush();

      expect(appStore.state.releaseNotes.showModal).toBe(false);
    });

    it('does not re-open the modal when the fetch resolves after the close broadcast', async () => {
      const deferred = deferGet();

      appStore.dispatch(initializeReleaseNotes());
      await flush();
      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(true);

      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.CLOSE, undefined);
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(false);

      deferred.resolve({ success: true, data: NOTES });
      await flush();

      expect(appStore.state.releaseNotes.showModal).toBe(false);
    });

    it('does not re-open the modal when the fetch rejects after the modal was closed', async () => {
      const deferred = deferGet();

      appStore.dispatch(initializeReleaseNotes());
      await flush();
      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(true);

      appStore.dispatch(dismissReleaseNotes());
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(false);

      deferred.reject(new Error('bridge unavailable'));
      await flush();

      expect(appStore.state.releaseNotes.showModal).toBe(false);
    });

    it('still opens and fetches on a later explicit Help-menu open', async () => {
      const deferred = deferGet();

      appStore.dispatch(initializeReleaseNotes());
      await flush();
      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();
      appStore.dispatch(dismissReleaseNotes());
      await flush();
      deferred.resolve({ success: true, data: NOTES });
      await flush();
      expect(appStore.state.releaseNotes.showModal).toBe(false);

      const getSpy = vi.fn(async () => ({ success: true, data: NOTES }));
      registerMockIpcHandler(RELEASE_NOTES_CHANNELS.GET, getSpy);

      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();

      expect(getSpy).toHaveBeenCalledTimes(1);
      expect(appStore.state.releaseNotes.showModal).toBe(true);
      expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
      expect(appStore.state.releaseNotes.loading).toBe(false);
    });

    it('ignores the superseded fetch when a second open overlaps the first', async () => {
      const deferred = deferGet();
      const STALE_NOTES = { ...NOTES, version: '2.0.0', notes: '## Stale' };

      appStore.dispatch(initializeReleaseNotes());
      await flush();
      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();
      emitMockIpcEvent(RELEASE_NOTES_CHANNELS.SHOW, { notes: null });
      await flush();
      expect(deferred.calls).toHaveLength(2);
      expect(appStore.state.releaseNotes.loading).toBe(true);

      deferred.calls[0].resolve({ success: true, data: STALE_NOTES });
      await flush();

      expect(appStore.state.releaseNotes.showModal).toBe(true);
      expect(appStore.state.releaseNotes.loading).toBe(true);
      expect(appStore.state.releaseNotes.releaseNotes).toBeNull();

      deferred.calls[1].resolve({ success: true, data: NOTES });
      await flush();

      expect(appStore.state.releaseNotes.showModal).toBe(true);
      expect(appStore.state.releaseNotes.loading).toBe(false);
      expect(appStore.state.releaseNotes.releaseNotes).toEqual(NOTES);
    });
  });
});
