import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel, type Task } from 'redux-saga';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/client', async () => {
  const { LiveSettingsClient } = await import('$lib/client/live/live-settings-client');
  return { appClient: { settings: new LiveSettingsClient() } };
});

import { backendRequest } from '$lib/client/live/backend-transport';
import { __resetSettingsReadCacheForTests } from '$lib/client/live/live-settings-client';
import { persistHardwareConsoleEnabled } from '$features/hardware-console/integration-toggle-service';
import {
  hardwareConsoleReducer,
  initialState,
  setHardwareConsoleEnabled,
  setHardwareConsoleEncoderBehavior,
} from '../hardware-console-slice';
import { encoderPreferenceSaga } from './encoder-preference-saga';

const request = vi.mocked(backendRequest);
const tasks: Task[] = [];
let bag: Record<string, unknown>;

function setting(value: Record<string, unknown>) {
  return {
    path: 'hardwareConsole.state',
    value,
    definition: {
      path: 'hardwareConsole.state',
      label: 'Hardware console state',
      description: 'Persisted hardware preferences',
      category: 'hardwareConsole',
      type: 'object',
      defaultValue: {},
    },
    revision: 1,
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function start() {
  let state = initialState;
  const channel = stdChannel();
  const dispatch = (action: Parameters<typeof hardwareConsoleReducer>[1]) => {
    state = hardwareConsoleReducer(state, action);
    channel.put(action);
    return action;
  };
  const task = runSaga({ channel, dispatch }, encoderPreferenceSaga);
  tasks.push(task);
  return { dispatch, task, getState: () => state };
}

async function hydrated(harness: ReturnType<typeof start>) {
  await vi.waitFor(() => expect(harness.getState().encoderBehaviorHydrated).toBe(true));
}

beforeEach(() => {
  vi.resetAllMocks();
  __resetSettingsReadCacheForTests();
  bag = { keyPins: ['ws-1'], enabled: true, futurePreference: { keep: true } };
  request.mockImplementation(async (method, params) => {
    if (method === 'settings.get') return setting({ ...bag });
    if (method === 'settings.update') {
      const { changes } = params as { changes: { path: string; value: Record<string, unknown> }[] };
      bag = changes[0].value;
      return { applied: changes, revision: 2 };
    }
    throw new Error(`Unexpected method: ${method}`);
  });
});

afterEach(async () => {
  for (const task of tasks.splice(0)) {
    task.cancel();
    await task.toPromise();
  }
  vi.useRealTimers();
});

describe('encoder preference lifecycle and settings wire contract', () => {
  it.each([{}, { enabled: false, keyPins: ['existing-install'] }, { encoderBehavior: 'invalid' }])(
    'defaults new and existing installations to effort adjustment: %j',
    async (savedBag) => {
      bag = savedBag;
      const harness = start();
      await hydrated(harness);
      expect(harness.getState().encoderBehavior).toBe('agent-effort');
      expect(request).toHaveBeenCalledExactlyOnceWith('settings.get', {
        path: 'hardwareConsole.state',
      });
    },
  );

  it.each(['agent-effort', 'workspace-switch'])(
    'hydrates the explicit %s choice',
    async (choice) => {
      bag.encoderBehavior = choice;
      const harness = start();
      await hydrated(harness);
      expect(harness.getState().encoderBehavior).toBe(choice);
    },
  );

  it('persists the opt-out with sibling fields and restores it in a fresh session', async () => {
    const harness = start();
    await hydrated(harness);
    harness.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
    expect(harness.getState().encoderBehavior).toBe('workspace-switch');
    await vi.waitFor(() => expect(bag.encoderBehavior).toBe('workspace-switch'));
    expect(request).toHaveBeenCalledWith('settings.update', {
      changes: [
        {
          path: 'hardwareConsole.state',
          value: {
            keyPins: ['ws-1'],
            enabled: true,
            futurePreference: { keep: true },
            encoderBehavior: 'workspace-switch',
          },
        },
      ],
    });
    harness.task.cancel();
    await harness.task.toPromise();
    __resetSettingsReadCacheForTests();
    const restarted = start();
    await hydrated(restarted);
    expect(restarted.getState().encoderBehavior).toBe('workspace-switch');
  });

  it('keeps an explicit default chosen during hydration and preserves a concurrent sibling save', async () => {
    bag.encoderBehavior = 'workspace-switch';
    const read = deferred<ReturnType<typeof setting>>();
    request.mockImplementationOnce(() => read.promise);
    const harness = start();
    harness.dispatch(setHardwareConsoleEncoderBehavior('agent-effort'));
    harness.dispatch(setHardwareConsoleEnabled(false));
    const siblingSave = persistHardwareConsoleEnabled(false);
    expect(request.mock.calls.filter(([method]) => method === 'settings.update')).toHaveLength(0);
    read.resolve(setting({ ...bag }));
    await siblingSave;
    await hydrated(harness);
    await vi.waitFor(() => expect(bag.encoderBehavior).toBe('agent-effort'));
    expect(harness.getState().encoderBehavior).toBe('agent-effort');
    expect(harness.getState().enabled).toBe(false);
    expect(bag).toEqual({
      keyPins: ['ws-1'],
      enabled: false,
      futurePreference: { keep: true },
      encoderBehavior: 'agent-effort',
    });
  });

  it('recovers a saved opt-out after a failed boot read without a new user choice', async () => {
    vi.useFakeTimers();
    bag.encoderBehavior = 'workspace-switch';
    request.mockRejectedValueOnce(new Error('daemon unavailable'));
    const harness = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.getState().encoderBehaviorHydrated).toBe(false);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.getState().encoderBehaviorHydrated).toBe(true);
    expect(harness.getState().encoderBehavior).toBe('workspace-switch');
    expect(request.mock.calls.filter(([method]) => method === 'settings.get')).toHaveLength(2);
    expect(request.mock.calls.filter(([method]) => method === 'settings.update')).toHaveLength(0);
  });

  it('keeps an explicit default chosen while waiting for a failed boot read to recover', async () => {
    vi.useFakeTimers();
    bag.encoderBehavior = 'workspace-switch';
    request.mockRejectedValueOnce(new Error('daemon unavailable'));
    const harness = start();
    await vi.advanceTimersByTimeAsync(0);
    harness.dispatch(setHardwareConsoleEncoderBehavior('agent-effort'));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.getState().encoderBehaviorHydrated).toBe(true);
    expect(harness.getState().encoderBehavior).toBe('agent-effort');
    expect(bag.encoderBehavior).toBe('agent-effort');
    expect(bag.keyPins).toEqual(['ws-1']);
  });

  it('backs off repeated failed reads and defaults only after a successful empty preference read', async () => {
    vi.useFakeTimers();
    request.mockRejectedValueOnce(new Error('daemon unavailable'));
    request.mockRejectedValueOnce(new Error('daemon still unavailable'));
    const harness = start();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(harness.getState().encoderBehaviorHydrated).toBe(false);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(4_999);
    expect(request).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(harness.getState().encoderBehaviorHydrated).toBe(true);
    expect(harness.getState().encoderBehavior).toBe('agent-effort');
    expect(request).toHaveBeenCalledTimes(3);
  });

  it('stops retrying the boot read when the saga is cancelled', async () => {
    vi.useFakeTimers();
    request.mockRejectedValue(new Error('daemon unavailable'));
    const harness = start();
    await vi.advanceTimersByTimeAsync(0);
    expect(harness.getState().encoderBehaviorHydrated).toBe(false);
    harness.task.cancel();
    await harness.task.toPromise();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('rolls back a failed save and clears the error when the user retries', async () => {
    const harness = start();
    await hydrated(harness);
    request.mockRejectedValueOnce(new Error('write failed'));
    harness.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
    await vi.waitFor(() => expect(harness.getState().encoderBehaviorSaveFailed).toBe(true));
    expect(harness.getState().encoderBehavior).toBe('agent-effort');
    expect(bag.encoderBehavior).toBeUndefined();
    harness.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
    await vi.waitFor(() => expect(bag.encoderBehavior).toBe('workspace-switch'));
    expect(harness.getState().encoderBehaviorSaveFailed).toBe(false);
  });

  it.each([false, true])(
    'coalesces rapid choices while the first save is pending (failure: %s)',
    async (fails) => {
      const harness = start();
      await hydrated(harness);
      const write = deferred<{ applied: unknown[]; revision: number }>();
      const respond = request.getMockImplementation()!;
      request.mockImplementationOnce(async (method, params) => {
        await write.promise;
        return respond(method, params);
      });
      harness.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
      await vi.waitFor(() =>
        expect(request).toHaveBeenCalledWith('settings.update', expect.anything()),
      );
      harness.dispatch(setHardwareConsoleEncoderBehavior('agent-effort'));
      harness.dispatch(setHardwareConsoleEncoderBehavior('workspace-switch'));
      harness.dispatch(setHardwareConsoleEncoderBehavior('agent-effort'));
      expect(harness.getState().encoderBehavior).toBe('agent-effort');
      if (fails) write.reject(new Error('write failed'));
      else write.resolve({ applied: [], revision: 2 });
      await vi.waitFor(() => expect(bag.encoderBehavior).toBe('agent-effort'));
      expect(request.mock.calls.filter(([method]) => method === 'settings.update')).toHaveLength(2);
      expect(harness.getState().encoderBehavior).toBe('agent-effort');
      expect(harness.getState().encoderBehaviorSaveFailed).toBe(false);
    },
  );
});
