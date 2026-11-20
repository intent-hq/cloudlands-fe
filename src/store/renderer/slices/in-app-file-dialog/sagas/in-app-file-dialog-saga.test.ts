import { runSaga, stdChannel } from 'redux-saga';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { inAppFileDialogAnswered } from '../in-app-file-dialog-slice';
import { inAppFileDialogSaga } from './in-app-file-dialog-saga';

const settle = async () => {
  for (let index = 0; index < 8; index += 1) await Promise.resolve();
};

function start(preferInAppPicker: boolean) {
  let listener: ((data: unknown) => void) | undefined;
  const invoke = vi.fn(async (_channel: string, _payload: unknown) => ({ ok: true }));
  const electronAPI = {
    preferInAppPicker,
    invoke,
    on: vi.fn((_channel: string, callback: (data: unknown) => void) => {
      listener = callback;
      return 'l1';
    }),
    offById: vi.fn(),
  };
  const win = Object.assign(new EventTarget(), { electronAPI });
  vi.stubGlobal('window', win);
  const channel = stdChannel();
  const dispatched: unknown[] = [];
  const task = runSaga(
    { channel, dispatch: (action) => dispatched.push(action), getState: () => ({}) },
    inAppFileDialogSaga,
  );
  return { task, channel, dispatched, invoke, electronAPI, push: (d: unknown) => listener?.(d) };
}

afterEach(() => vi.unstubAllGlobals());

describe('inAppFileDialogSaga', () => {
  it('does nothing when native choosers work', async () => {
    const { task, electronAPI } = start(false);
    await settle();
    expect(electronAPI.on).not.toHaveBeenCalled();
    expect(task.isRunning()).toBe(false);
  });

  it('queues main requests and sends answers back', async () => {
    const { task, channel, dispatched, invoke, push } = start(true);
    await settle();
    push({ id: 'r1', kind: 'save', defaultPath: 'a.zip' });
    await settle();
    expect(dispatched).toEqual([
      {
        type: 'inAppFileDialog/requested',
        payload: [{ id: 'r1', kind: 'save', defaultPath: 'a.zip' }],
      },
    ]);

    channel.put(inAppFileDialogAnswered('r1', ['/home/me/a.zip']));
    channel.put(inAppFileDialogAnswered('r2', []));
    await settle();
    expect(invoke.mock.calls).toEqual([
      ['in-app-file-dialog:respond', { id: 'r1', paths: ['/home/me/a.zip'] }],
      ['in-app-file-dialog:respond', { id: 'r2', paths: null }],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('sends a cloneable copy of a reactive paths array', async () => {
    const { task, channel, invoke } = start(true);
    await settle();
    const reactive = new Proxy(['/a.png', '/b.png'], {});
    expect(() => structuredClone(reactive)).toThrow();
    channel.put(inAppFileDialogAnswered('r3', reactive));
    await settle();
    const sent = invoke.mock.calls[0][1];
    expect(() => structuredClone(sent)).not.toThrow();
    expect(sent).toEqual({ id: 'r3', paths: ['/a.png', '/b.png'] });
    task.cancel();
    await task.toPromise();
  });
});
