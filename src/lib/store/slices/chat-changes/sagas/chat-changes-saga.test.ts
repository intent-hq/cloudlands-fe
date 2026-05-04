import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as sagaEffects from 'redux-saga/effects';
import { channel as createSagaChannel, type Task } from 'redux-saga';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  cancelled: function* () {
    return yield sagaEffects.cancelled();
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
}));

const { createElectronChannelMock } = vi.hoisted(() => ({
  createElectronChannelMock: vi.fn(),
}));

vi.mock('$lib/store/utils/ipc-channel', () => ({
  createElectronChannel: createElectronChannelMock,
  takeEveryFromElectronChannel: function* (eventName: string, handler: (data: any) => Generator) {
    const channel = createElectronChannelMock(eventName);
    try {
      while (true) {
        const data = yield sagaEffects.take(channel);
        yield sagaEffects.fork(handler, data);
      }
    } finally {
      channel.close();
    }
  },
}));

import { workspaceUnmounted } from '../../workspace-lifecycle/workspace-lifecycle-slice';
import { agentFileChangeReceived, agentFileRefreshTriggered } from '../chat-changes-slice';
import {
  AGENT_FILE_REFRESH_DEBOUNCE_MS,
  chatChangesSaga,
  handleAgentFileChangedEvent,
  queueAgentFileRefresh,
  watchAgentFileChangedGlobal,
} from './chat-changes-saga';

const WS_ID = 'ws-1';
const WS_ID_2 = 'ws-2';
const PATH = 'src/app.ts';
const ABS_PATH = '/repo/src/app.ts';
const ABS_PATH_2 = '/repo/src/other.ts';

beforeEach(() => {
  vi.clearAllMocks();
  createElectronChannelMock.mockImplementation(() => createSagaChannel());
});

function createTask(): Task {
  return {
    '@@redux-saga/TASK': true,
    cancel: vi.fn(),
    isRunning: vi.fn(() => true),
    isCancelled: vi.fn(() => false),
    isAborted: vi.fn(() => false),
    result: vi.fn(),
    error: vi.fn(),
    toPromise: vi.fn(() => Promise.resolve()),
    setContext: vi.fn(),
  } as unknown as Task;
}

function getSagaWorkers() {
  const iterator = chatChangesSaga();
  iterator.next();
  const debounceEffect = iterator.next().value as any;
  const unmountEffect = iterator.next().value as any;

  return {
    debounceWorker: debounceEffect.payload.args[1] as (
      action: ReturnType<typeof agentFileChangeReceived>,
    ) => Generator,
    unmountWorker: unmountEffect.payload.args[1] as (
      action: ReturnType<typeof workspaceUnmounted>,
    ) => Generator,
  };
}

function expectForkedWorker(effect: unknown) {
  expect((effect as any)?.type).toBe('FORK');
  return (effect as any).payload.fn as () => Generator;
}

function provideChannelEvents<T>(channel: unknown, events: T[]) {
  let index = 0;
  return {
    take(effect: any, next: () => unknown) {
      if (effect.channel === channel && index < events.length) {
        return events[index++];
      }
      return next();
    },
  };
}

describe('chatChangesSaga', () => {
  it('registers the global agent-file listener, debounce watcher, and unmount cleanup', () => {
    const iterator = chatChangesSaga();

    const globalAgentEffect = iterator.next();
    expect((globalAgentEffect.value as any)?.type).toBe('FORK');
    expect((globalAgentEffect.value as any)?.payload?.fn).toBe(watchAgentFileChangedGlobal);

    const debounceEffect = iterator.next();
    expect((debounceEffect.value as any)?.type).toBe('FORK');
    expect((debounceEffect.value as any)?.payload?.args?.[0]).toBe(agentFileChangeReceived);

    const unmountEffect = iterator.next();
    expect((unmountEffect.value as any)?.type).toBe('FORK');
    expect((unmountEffect.value as any)?.payload?.args?.[0]).toBe(workspaceUnmounted);
  });

  it('subscribes to the global agent-file channel and routes by payload workspace id', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);
    const ws1Event = { workspaceId: WS_ID, filePath: ABS_PATH };
    const ws2Event = { workspaceId: WS_ID_2, filePath: ABS_PATH_2 };

    await expectSaga(watchAgentFileChangedGlobal)
      .provide([provideChannelEvents(channel, [ws1Event, ws2Event])])
      .put(agentFileChangeReceived(WS_ID, ABS_PATH))
      .put(agentFileChangeReceived(WS_ID_2, ABS_PATH_2))
      .silentRun(50);

    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('file-tracking:agent-file-changed');
  });

  it('drops global agent-file events without a workspace id', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);

    const result = await expectSaga(watchAgentFileChangedGlobal)
      .provide([provideChannelEvents(channel, [{ filePath: ABS_PATH }])])
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('file-tracking:agent-file-changed');
  });

  it('cancels pending debounced refreshes on workspace unmount', () => {
    const { debounceWorker, unmountWorker } = getSagaWorkers();
    const refreshTask = createTask();

    const debounce = debounceWorker(agentFileChangeReceived(WS_ID, PATH));
    expectForkedWorker(debounce.next().value);
    expect(debounce.next(refreshTask)).toEqual({ value: undefined, done: true });

    const unmount = unmountWorker(workspaceUnmounted(WS_ID));
    expect(unmount.next()).toEqual({ value: sagaEffects.cancel(refreshTask), done: false });
    expect(unmount.next()).toEqual({ value: undefined, done: true });
  });

  it('dispatches agentFileChangeReceived for matching IPC events', async () => {
    await expectSaga(handleAgentFileChangedEvent, { workspaceId: WS_ID, filePath: ABS_PATH })
      .put(agentFileChangeReceived(WS_ID, ABS_PATH))
      .silentRun(50);
  });

  it('ignores IPC events with missing workspace ids or paths', async () => {
    const missingWorkspace = await expectSaga(handleAgentFileChangedEvent, {
      filePath: ABS_PATH,
    }).silentRun(50);
    const missingPath = await expectSaga(handleAgentFileChangedEvent, {
      workspaceId: WS_ID,
    }).silentRun(50);

    expect(missingWorkspace.effects.put ?? []).toEqual([]);
    expect(missingPath.effects.put ?? []).toEqual([]);
  });

  it('debounces refresh triggers per workspace and path', () => {
    const existingTask = createTask();
    const refreshTask = createTask();
    const key = `${WS_ID}:${PATH}`;
    const refreshTasksByKey = new Map<string, Task>([[key, existingTask]]);
    const iterator = queueAgentFileRefresh(refreshTasksByKey, agentFileChangeReceived(WS_ID, PATH));

    expect(iterator.next()).toEqual({ value: sagaEffects.cancel(existingTask), done: false });
    const worker = expectForkedWorker(iterator.next().value);
    expect(iterator.next(refreshTask)).toEqual({ value: undefined, done: true });
    expect(refreshTasksByKey.get(key)).toBe(refreshTask);

    const workerIterator = worker();
    expect(workerIterator.next()).toEqual({
      value: sagaEffects.delay(AGENT_FILE_REFRESH_DEBOUNCE_MS),
      done: false,
    });
    expect(workerIterator.next()).toEqual({
      value: sagaEffects.put(agentFileRefreshTriggered(WS_ID, PATH)),
      done: false,
    });
    expect(workerIterator.next()).toEqual({ value: undefined, done: true });
    expect(refreshTasksByKey.has(key)).toBe(false);
  });

  it('keeps pending debounced refreshes independent per workspace and path', () => {
    const firstTask = createTask();
    const secondTask = createTask();
    const firstPath = 'src/a.ts';
    const secondPath = 'src/b.ts';
    const firstKey = `${WS_ID}:${firstPath}`;
    const secondKey = `${WS_ID}:${secondPath}`;
    const refreshTasksByKey = new Map<string, Task>();

    const firstDebounce = queueAgentFileRefresh(
      refreshTasksByKey,
      agentFileChangeReceived(WS_ID, firstPath),
    );
    const firstWorker = expectForkedWorker(firstDebounce.next().value);
    expect(firstDebounce.next(firstTask)).toEqual({ value: undefined, done: true });

    const secondDebounce = queueAgentFileRefresh(
      refreshTasksByKey,
      agentFileChangeReceived(WS_ID, secondPath),
    );
    const secondFork = secondDebounce.next().value;
    expect((secondFork as any)?.type).toBe('FORK');
    const secondWorker = expectForkedWorker(secondFork);
    expect(secondDebounce.next(secondTask)).toEqual({ value: undefined, done: true });

    expect(refreshTasksByKey.get(firstKey)).toBe(firstTask);
    expect(refreshTasksByKey.get(secondKey)).toBe(secondTask);

    const firstWorkerIterator = firstWorker();
    expect(firstWorkerIterator.next()).toEqual({
      value: sagaEffects.delay(AGENT_FILE_REFRESH_DEBOUNCE_MS),
      done: false,
    });
    expect(firstWorkerIterator.next()).toEqual({
      value: sagaEffects.put(agentFileRefreshTriggered(WS_ID, firstPath)),
      done: false,
    });
    expect(firstWorkerIterator.next()).toEqual({ value: undefined, done: true });
    expect(refreshTasksByKey.has(firstKey)).toBe(false);
    expect(refreshTasksByKey.get(secondKey)).toBe(secondTask);

    const secondWorkerIterator = secondWorker();
    expect(secondWorkerIterator.next()).toEqual({
      value: sagaEffects.delay(AGENT_FILE_REFRESH_DEBOUNCE_MS),
      done: false,
    });
    expect(secondWorkerIterator.next()).toEqual({
      value: sagaEffects.put(agentFileRefreshTriggered(WS_ID, secondPath)),
      done: false,
    });
    expect(secondWorkerIterator.next()).toEqual({ value: undefined, done: true });
    expect(refreshTasksByKey.has(secondKey)).toBe(false);
  });
});
