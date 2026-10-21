import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { watchPresenceVisibility } from './presence-visibility-watcher';

const settle = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};

let visibility: DocumentVisibilityState = 'visible';

function setDocumentVisibility(next: DocumentVisibilityState) {
  visibility = next;
  document.dispatchEvent(new Event('visibilitychange'));
}

function start() {
  const reported: boolean[] = [];
  const task = runSaga(
    {
      dispatch: (action: any) => {
        if (action.type === 'presence/windowVisibilityChanged') reported.push(action.payload[0]);
      },
      getState: () => ({}),
    },
    watchPresenceVisibility,
  );
  return { reported, task };
}

describe('watchPresenceVisibility', () => {
  beforeEach(() => {
    visibility = 'visible';
    vi.spyOn(document, 'visibilityState', 'get').mockImplementation(() => visibility);
  });
  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
    vi.restoreAllMocks();
  });

  // Without an Electron bridge the capture channel closes at once; the
  // watcher must keep tracking document visibility instead of stopping.
  it('keeps reporting document visibility in a bridge-less renderer', async () => {
    delete (window as Partial<Window>).electronAPI;
    const { reported, task } = start();
    await settle();
    setDocumentVisibility('hidden');
    await settle();
    setDocumentVisibility('visible');
    await settle();

    expect(reported).toEqual([true, false, true]);
    expect(task.isRunning()).toBe(true);
    task.cancel();
  });

  it('ignores the visibility an agent capture causes while the window is minimized', async () => {
    const listeners = new Map<string, (data: unknown) => void>();
    window.electronAPI = {
      ...window.electronAPI,
      on: vi.fn((channel: string, next: (data: unknown) => void) => {
        listeners.set(channel, next);
        return `${channel}-listener`;
      }),
      offById: vi.fn(),
    } as any;
    visibility = 'hidden';
    const { reported, task } = start();
    await settle();
    const capture = (active: boolean) => listeners.get('browser:capture-drawing')?.({ active });

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

    expect(reported).toEqual([false, true]);
    task.cancel();
  });
});
