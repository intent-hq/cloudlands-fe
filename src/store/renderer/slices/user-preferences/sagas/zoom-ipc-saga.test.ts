import { runSaga } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ isElectron: vi.fn(() => true) }));

vi.mock('$lib/electron-bridge', () => ({ isElectron: mocks.isElectron }));

import { resolveIpcChannelBufferPolicy } from '../../../utils/ipc-channel';
import { zoomIpcSaga } from './zoom-ipc-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
};

describe('zoomIpcSaga', () => {
  let handlers: Array<(payload: unknown) => void>;
  let on: ReturnType<typeof vi.fn>;
  let offById: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    handlers = [];
    on = vi.fn((_channel: string, handler: (payload: unknown) => void) => {
      handlers.push(handler);
      return 'zoom-listener';
    });
    offById = vi.fn();
    window.electronAPI = { ...window.electronAPI, on, offById };
    mocks.isElectron.mockReturnValue(true);
  });

  afterEach(() => {
    delete (window as Partial<Window>).electronAPI;
    vi.clearAllMocks();
  });

  it('uses latest-only buffering and maps only valid zoom payloads exactly', async () => {
    expect(resolveIpcChannelBufferPolicy('window:zoom-changed')).toEqual({
      kind: 'sliding',
      limit: 1,
      rationale: 'Only the latest status or progress event is actionable.',
    });
    const actions: unknown[] = [];
    const task = runSaga({ dispatch: (action) => actions.push(action) }, zoomIpcSaga);

    handlers[0]({ zoomFactor: 1.5, zoom_factor: 9 });
    handlers[0]({ zoomFactor: -1 });
    handlers[0]({ zoomFactor: 0 });
    handlers[0]({ zoomFactor: '2' });
    handlers[0]({ zoomFactor: Number.NaN });
    await settle();

    expect(actions).toEqual([{ type: 'userPreferences/setZoomFactor', payload: [1.5] }]);
    task.cancel();
    await task.toPromise();
  });

  it('prevents duplicate starts, removes its listener on cancellation, and can restart', async () => {
    const first = runSaga({ dispatch: vi.fn() }, zoomIpcSaga);
    const duplicate = runSaga({ dispatch: vi.fn() }, zoomIpcSaga);
    await duplicate.toPromise();
    expect(on.mock.calls).toEqual([['window:zoom-changed', handlers[0]]]);

    first.cancel();
    await first.toPromise();
    expect(offById.mock.calls).toEqual([['window:zoom-changed', 'zoom-listener']]);

    const restarted = runSaga({ dispatch: vi.fn() }, zoomIpcSaga);
    expect(on).toHaveBeenCalledTimes(2);
    restarted.cancel();
    await restarted.toPromise();
  });

  it('does not subscribe outside Electron', async () => {
    mocks.isElectron.mockReturnValue(false);
    await runSaga({ dispatch: vi.fn() }, zoomIpcSaga).toPromise();
    expect(on.mock.calls).toEqual([]);
  });
});
