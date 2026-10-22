import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  initialState,
  presenceCaptureDrawingChanged,
  presenceReducer,
  presenceReset,
} from '../presence-slice';
import type { PresenceState } from '../presence-types';
import { watchCaptureDrawing, watchPresenceVisibility } from './presence-visibility-watcher';

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let visibility: DocumentVisibilityState = 'visible';

function setDocumentVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

/** A presence store driven by the production reducer, shared by both sagas. */
function createStore(presence: Partial<PresenceState> = {}) {
  const channel = stdChannel();
  let state = { presence: { ...initialState, ...presence } };
  const reported: boolean[] = [];
  const dispatch = (action: any) => {
    state = { presence: presenceReducer(state.presence, action) };
    if (action.type === 'presence/windowVisibilityChanged') reported.push(action.payload[0]);
    channel.put(action);
  };
  const run = (saga: () => Generator) =>
    runSaga({ channel, dispatch, getState: () => state }, saga);
  return { run, dispatch, reported, state: () => state };
}

/** Electron bridge stub that lets a test emit main's capture bracket. */
function installBridge() {
  const listeners = new Map<string, (data: unknown) => void>();
  window.electronAPI = {
    ...window.electronAPI,
    on: vi.fn((channel: string, next: (data: unknown) => void) => {
      listeners.set(channel, next);
      return `${channel}-listener`;
    }),
    offById: vi.fn(),
  } as any;
  return (active: boolean) => listeners.get('browser:capture-drawing')?.({ active });
}

describe('presence visibility watchers', () => {
  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });
  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
    vi.restoreAllMocks();
  });

  // Without an Electron bridge there is no capture bracket; visibility must
  // still be tracked rather than the watcher stopping.
  it('keeps reporting document visibility in a bridge-less renderer', async () => {
    delete (window as Partial<Window>).electronAPI;
    const store = createStore();
    const captures = store.run(watchCaptureDrawing);
    const visibilityTask = store.run(watchPresenceVisibility);
    await settle();
    setDocumentVisibility('hidden');
    await settle();
    setDocumentVisibility('visible');
    await settle();

    expect(captures.isRunning()).toBe(false);
    expect(store.reported).toEqual([true, false, true]);
    expect(visibilityTask.isRunning()).toBe(true);
    visibilityTask.cancel();
  });

  it('ignores the visibility an agent capture causes while the window is minimized', async () => {
    const capture = installBridge();
    visibility = 'hidden';
    const store = createStore();
    const captures = store.run(watchCaptureDrawing);
    const visibilityTask = store.run(watchPresenceVisibility);
    await settle();

    capture(true);
    await settle();
    setDocumentVisibility('visible');
    await settle();
    setDocumentVisibility('hidden');
    await settle();
    capture(false);
    await settle();
    // A real change afterwards is still reported.
    setDocumentVisibility('visible');
    await settle();

    expect(store.reported).toEqual([false, true]);
    captures.cancel();
    visibilityTask.cancel();
  });

  // Presence restarts its per-connection watcher (admission change); one
  // starting mid-capture must not publish the capture's visibility.
  it('keeps the user away when the watcher starts while a capture is in progress', async () => {
    const capture = installBridge();
    visibility = 'hidden';
    const store = createStore({ windowVisible: false });
    const captures = store.run(watchCaptureDrawing);
    await settle();
    capture(true);
    await settle();
    setDocumentVisibility('visible');
    store.dispatch(presenceReset());
    expect(store.state().presence.captureDrawingActive).toBe(true);

    const visibilityTask = store.run(watchPresenceVisibility);
    await settle();
    expect(store.reported).toEqual([]);
    expect(store.state().presence.windowVisible).toBe(false);

    setDocumentVisibility('hidden');
    capture(false);
    await settle();
    expect(store.reported).toEqual([]);
    expect(store.state().presence.captureDrawingActive).toBe(false);
    captures.cancel();
    visibilityTask.cancel();
  });

  it('mirrors main capture brackets into the presence store', async () => {
    const capture = installBridge();
    const store = createStore();
    const captures = store.run(watchCaptureDrawing);
    await settle();

    capture(true);
    await settle();
    expect(store.state().presence.captureDrawingActive).toBe(true);
    store.dispatch(presenceCaptureDrawingChanged(false));
    expect(store.state().presence.captureDrawingActive).toBe(false);
    captures.cancel();
  });
});
