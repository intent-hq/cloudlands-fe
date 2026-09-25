import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store as appStore } from '$store/renderer/store';
import { settingsFormSaga } from './settings-form-saga';
import {
  settingsFormOpened,
  settingsFormClosed,
  settingsFormLoadRequested,
  settingsFormSaveRequested,
  settingsFormDraftChanged,
} from '../settings-events-slice';
import {
  selectSettingsForm,
  selectSettingsFormEntry,
  selectSettingsFormOperation,
} from '../settings-events-selectors';
import type { SettingsFormIdentity } from '../settings-events-types';

const mocks = vi.hoisted(() => ({
  list: vi.fn(),
  update: vi.fn(),
  error: vi.fn(),
  success: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: { settings: { list: mocks.list, update: mocks.update } },
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.error, success: mocks.success },
}));

const identity = { formId: 'api-form', sessionId: 'mount-1' };
const path = 'workspaceApi.toonOutput';
const settle = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve();
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function open(session: SettingsFormIdentity = identity) {
  appStore.dispatch(settingsFormOpened(session, 'workspace-api'));
  appStore.dispatch(settingsFormLoadRequested({ ...session, resource: 'load', requestId: 'load' }));
}
function save(id: string, value: boolean, session: SettingsFormIdentity = identity) {
  appStore.dispatch(settingsFormDraftChanged(session, path, value));
  appStore.dispatch(
    settingsFormSaveRequested({ ...session, resource: path, requestId: id }, [{ path, value }]),
  );
}
const operation = () => selectSettingsFormOperation.select(appStore.state, identity, path);
let stop: () => void;

describe('settingsFormSaga with production reducer', () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.list.mockResolvedValue([{ path, value: true }]);
    mocks.update.mockImplementation(async (changes) => changes);
    appStore.init();
    stop = appStore.runSaga(settingsFormSaga);
  });
  afterEach(() => {
    stop();
    appStore.dispose();
  });

  it('coalesces an equal pending backend save and discards queued drafts after invalid acknowledgement', async () => {
    const path = 'agents.memoryBudgetMb';
    mocks.list.mockResolvedValue([{ path, value: 100 }]);
    appStore.dispatch(settingsFormOpened(identity, 'agent-backend'));
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, resource: 'load', requestId: 'load' }),
    );
    await settle();
    const first = deferred<{ path: string; value: number }[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    const write = (requestId: string, value: number) => {
      appStore.dispatch(settingsFormDraftChanged(identity, path, String(value)));
      appStore.dispatch(
        settingsFormSaveRequested({ ...identity, resource: path, requestId }, [{ path, value }]),
      );
    };
    write('first', 200);
    write('duplicate', 200);
    expect(selectSettingsFormOperation.select(appStore.state, identity, path)?.requestId).toBe(
      'first',
    );
    write('queued', 300);
    appStore.dispatch(settingsFormDraftChanged(identity, `${path}:slider`, 400));
    first.resolve([]);
    await settle();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith([{ path, value: 200 }]);
    expect(selectSettingsFormOperation.select(appStore.state, identity, path)?.status).toBe(
      'failed',
    );
    expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).toBe(100);
    expect(selectSettingsForm.select(appStore.state, identity)?.drafts).toEqual({});
    write('retry', 250);
    await settle();
    expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).toBe(250);
  });

  it('never saves unread defaults and permits retry after a failed load', async () => {
    mocks.list.mockRejectedValueOnce(new Error('offline'));
    open();
    await settle();
    save('unread', false);
    await settle();
    expect(mocks.update).not.toHaveBeenCalled();
    expect(operation()?.status).toBe('failed');
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, resource: 'load', requestId: 'retry' }),
    );
    await settle();
    save('save-after-retry', false);
    await settle();
    expect(mocks.update).toHaveBeenCalledExactlyOnceWith([{ path, value: false }]);
    expect(operation()?.status).toBe('succeeded');
  });

  it('uses latest-wins reads and ignores a response from the previous mount', async () => {
    const old = deferred<{ path: string; value: boolean }[]>();
    mocks.list.mockReturnValueOnce(old.promise);
    open();
    appStore.dispatch(
      settingsFormLoadRequested({ ...identity, resource: 'load', requestId: 'new' }),
    );
    await settle();
    old.resolve([{ path, value: false }]);
    await settle();
    expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).toBe(true);
    appStore.dispatch(settingsFormClosed(identity));
    expect(selectSettingsForm.select(appStore.state, identity)).toBeUndefined();
    open({ ...identity, sessionId: 'mount-2' });
    await settle();
    expect(selectSettingsForm.select(appStore.state, identity)).toBeUndefined();
  });

  it('orders same-resource writes, preserves newer intent, and suppresses obsolete failure', async () => {
    open();
    await settle();
    const first = deferred<{ path: string; value: boolean }[]>();
    const second = deferred<{ path: string; value: boolean }[]>();
    mocks.update.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
    save('first', false);
    save('second', true);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    first.reject(new Error('old failure'));
    await settle();
    expect(mocks.update.mock.calls).toEqual([
      [[{ path, value: false }]],
      [[{ path, value: true }]],
    ]);
    expect(operation()).toMatchObject({ requestId: 'second', status: 'pending', error: null });
    expect(mocks.error).not.toHaveBeenCalled();
    second.resolve([{ path, value: true }]);
    await settle();
    expect(operation()?.status).toBe('succeeded');
    expect(selectSettingsForm.select(appStore.state, identity)?.drafts).toEqual({});
  });

  it('keeps an active write ordered across mounts but drops queued closed-session writes', async () => {
    open();
    await settle();
    const first = deferred<{ path: string; value: boolean }[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    save('active', false);
    save('queued', true);
    appStore.dispatch(settingsFormClosed(identity));
    const next = { ...identity, sessionId: 'mount-2' };
    open(next);
    await settle();
    save('next', false, next);
    expect(mocks.update).toHaveBeenCalledTimes(1);
    first.resolve([{ path, value: false }]);
    await settle();
    expect(mocks.update).toHaveBeenCalledTimes(2);
    expect(selectSettingsFormOperation.select(appStore.state, next, path)?.status).toBe(
      'succeeded',
    );
  });

  it('settles queued requests on saga cancellation and ignores the transport completion', async () => {
    open();
    await settle();
    const first = deferred<{ path: string; value: boolean }[]>();
    mocks.update.mockReturnValueOnce(first.promise);
    save('active', false);
    save('queued', true);
    stop();
    expect(operation()?.status).toBe('cancelled');
    first.resolve([{ path, value: false }]);
    await settle();
    expect(operation()?.status).toBe('cancelled');
    expect(mocks.success).not.toHaveBeenCalled();
  });

  it('rolls back from daemon acknowledgement and retries a failed write', async () => {
    open();
    await settle();
    mocks.update.mockResolvedValueOnce([{ path, value: true }]);
    save('rollback', false);
    await settle();
    expect(operation()?.status).toBe('failed');
    expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).toBe(true);
    expect(selectSettingsForm.select(appStore.state, identity)?.drafts).toEqual({});
    save('retry', false);
    await settle();
    expect(operation()?.status).toBe('succeeded');
    expect(selectSettingsFormEntry.select(appStore.state, identity, path)?.value).toBe(false);
  });
});
