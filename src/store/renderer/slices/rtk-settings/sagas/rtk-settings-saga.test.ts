import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import { rtkSettingsSaga } from './rtk-settings-saga';
import { rtkSettingsRequested } from '../rtk-settings-slice';
import {
  settingsFormClosed,
  settingsFormOpened,
} from '../../settings-events/settings-events-slice';
import { selectSettingsFormOperation } from '../../settings-events/settings-events-selectors';
import { ROOT_WORKSPACE_ID } from '$shared/types/branded-ids';
import { SYSTEM_CHANNELS } from '$shared/ipc/channels';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  update: vi.fn(),
  create: vi.fn(),
  write: vi.fn(),
  probe: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    settings: { get: mocks.get, update: mocks.update },
    terminals: { create: mocks.create, write: mocks.write },
  },
}));
vi.mock('$shared/generated/ipc-client', () => ({ invoke: mocks.probe }));
vi.mock('$lib/components/patterns/notify', () => ({ notify: { error: vi.fn() } }));
vi.mock('$store/renderer/store', async () => ({
  store: (await import('../../../../../test/settings-form-store')).createSettingsFormTestStore(),
}));

const identity = { formId: 'rtk', sessionId: 'first' };
const request = (requestId: string, resource = 'save') => ({ ...identity, requestId, resource });

describe('RTK request lifetime', () => {
  let stop: () => void;
  beforeEach(() => {
    vi.resetAllMocks();
    store.init();
    stop = store.runSaga(rtkSettingsSaga);
    store.dispatch(settingsFormOpened(identity, 'rtk'));
    mocks.create.mockResolvedValue({ success: true, id: 'daemon-pty' });
    mocks.probe.mockResolvedValue({ data: { available: true } });
  });
  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('probes at 10/20/30 seconds independently of a slow terminal write', async () => {
    vi.useFakeTimers();
    mocks.write.mockReturnValue(new Promise(() => {}));
    store.dispatch(rtkSettingsRequested(request('install', 'install'), { kind: 'install' }));
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.create).toHaveBeenCalledExactlyOnceWith({
      workspaceId: ROOT_WORKSPACE_ID,
      cols: 80,
      rows: 24,
    });
    await vi.advanceTimersByTimeAsync(999);
    expect(mocks.write).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mocks.write).toHaveBeenCalledExactlyOnceWith('daemon-pty', 'brew install rtk\n');
    await vi.advanceTimersByTimeAsync(9000);
    expect(mocks.probe).toHaveBeenCalledExactlyOnceWith(SYSTEM_CHANNELS.CHECK_RTK, undefined);
    await vi.advanceTimersByTimeAsync(20000);
    expect(mocks.probe).toHaveBeenCalledTimes(3);
  });

  it.each(['close', 'teardown'])(
    'cancels delayed terminal writes and probes on %s',
    async (mode) => {
      vi.useFakeTimers();
      store.dispatch(rtkSettingsRequested(request('install', 'install'), { kind: 'install' }));
      await vi.advanceTimersByTimeAsync(0);
      if (mode === 'close') store.dispatch(settingsFormClosed(identity));
      else stop();
      await vi.advanceTimersByTimeAsync(31000);
      expect(mocks.write).not.toHaveBeenCalled();
      expect(mocks.probe).not.toHaveBeenCalled();
    },
  );

  it('settles active and queued work on teardown and ignores late outcomes', async () => {
    let finish!: (value: unknown[]) => void;
    mocks.update.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    store.dispatch(rtkSettingsRequested(request('first'), { kind: 'toggle', enabled: true }));
    store.dispatch(rtkSettingsRequested(request('queued'), { kind: 'toggle', enabled: false }));
    stop();
    expect(selectSettingsFormOperation.select(store.state, identity, 'save')?.status).toBe(
      'cancelled',
    );
    finish([{ path: 'rtk.enabled', value: true }]);
    await Promise.resolve();
    await Promise.resolve();
    expect(mocks.update).toHaveBeenCalledTimes(1);
    expect(selectSettingsFormOperation.select(store.state, identity, 'save')?.status).toBe(
      'cancelled',
    );
  });
});
