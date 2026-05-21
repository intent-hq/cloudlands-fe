import { beforeEach, describe, expect, it, vi } from 'vitest';
import { expectSaga } from 'redux-saga-test-plan';
import * as matchers from 'redux-saga-test-plan/matchers';
import * as sagaEffects from 'redux-saga/effects';
import { channel as createSagaChannel } from 'redux-saga';

vi.mock('typed-redux-saga', () => ({
  call: function* (fnOrDescriptor: any, ...args: any[]) {
    return yield Array.isArray(fnOrDescriptor)
      ? sagaEffects.call(fnOrDescriptor as [any, any], ...args)
      : sagaEffects.call(fnOrDescriptor, ...args);
  },
  delay: function* (ms: number) {
    return yield sagaEffects.delay(ms);
  },
  put: function* (action: any) {
    return yield sagaEffects.put(action);
  },
  select: function* (selector: any, ...args: any[]) {
    return yield sagaEffects.select(selector, ...args);
  },
  takeEvery: function* (pattern: any, worker: any) {
    return yield sagaEffects.takeEvery(pattern, worker);
  },
  fork: function* (fn: any, ...args: any[]) {
    return yield sagaEffects.fork(fn, ...args);
  },
  take: function* (pattern: any) {
    return yield sagaEffects.take(pattern);
  },
  cancel: function* (task: any) {
    return yield sagaEffects.cancel(task);
  },
  cancelled: function* () {
    return yield sagaEffects.cancelled();
  },
}));

const { invokeMock, dispatchWindowEventMock, createElectronChannelMock } = vi.hoisted(() => ({
  invokeMock: vi.fn(),
  dispatchWindowEventMock: vi.fn(),
  createElectronChannelMock: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({
  invoke: invokeMock,
}));

vi.mock('$lib/utils/window-events', () => ({
  dispatchWindowEvent: dispatchWindowEventMock,
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

import { invoke } from '$lib/electron-bridge';
import {
  applyExternalFileContent,
  emptyFilesWorkspaceState,
  filesReducer,
  loadFileContentFailed,
  loadFileContentRequested,
  loadFileContentSucceeded,
  refreshOpenFileContentForPathsRequested,
  refreshFileContentRequested,
  saveFileContentFailed,
  saveFileContentRequested,
  saveFileContentSucceeded,
} from '../files-slice';
import {
  filesSaga,
  handleAgentFileChangedEvent,
  handleFileChangedEvent,
  handleFileContentChangedEvent,
  handleLoadFileContentRequested,
  handleRefreshOpenFileContentForPathsRequested,
  handleRefreshFileContentRequested,
  handleSaveFileContentRequested,
  watchAgentFileChangedGlobal,
  watchFileChangedGlobal,
  watchGlobalFileContentChanged,
	watchWatcherFileChanged,
} from './files-saga';

const WS_ID = 'ws-1';
const WS_ID_2 = 'ws-2';
const PATH = 'src/app.ts';
const ABS_PATH = '/repo/src/app.ts';
const PATH_2 = 'src/other.ts';
const ABS_PATH_2 = '/repo/src/other.ts';

beforeEach(() => {
  vi.clearAllMocks();
  createElectronChannelMock.mockImplementation(() => createSagaChannel());
});

function createFileEntry(path: string, absolutePath: string, content = 'old') {
  return {
    path,
    absolutePath,
    originalContent: content,
    localContent: content,
    lastUpdated: 1,
    loading: false,
    saving: false,
    error: null,
    isBinary: false,
    truncated: false,
  };
}

function stateWithFiles(
  entries: Array<{ workspaceId: string; path: string; absolutePath: string; content?: string }> = [
    { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH },
  ],
) {
  const byWorkspaceId: Record<string, unknown> = {};
  for (const entry of entries) {
    const workspaceState = (byWorkspaceId[entry.workspaceId] ?? {
      ...emptyFilesWorkspaceState,
      files: {
        idField: 'path',
        ids: [],
        map: {},
        refsCount: {},
      },
    }) as any;
    workspaceState.files.ids.push(entry.path);
    workspaceState.files.map[entry.path] = createFileEntry(
      entry.path,
      entry.absolutePath,
      entry.content,
    );
    byWorkspaceId[entry.workspaceId] = workspaceState;
  }

  return {
    files: {
      byWorkspaceId,
    },
  } as any;
}

function filesRootReducer(
  state: { files: ReturnType<typeof filesReducer> } | undefined,
  action: any,
) {
  return {
    files: filesReducer(state?.files, action),
  };
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

describe('filesSaga', () => {
  it('registers global file listeners plus request watchers', () => {
    const iterator = filesSaga();

    const globalContentEffect = iterator.next();
    expect((globalContentEffect.value as any)?.type).toBe('FORK');
    expect((globalContentEffect.value as any)?.payload?.fn).toBe(watchGlobalFileContentChanged);

    const globalAgentEffect = iterator.next();
    expect((globalAgentEffect.value as any)?.type).toBe('FORK');
    expect((globalAgentEffect.value as any)?.payload?.fn).toBe(watchAgentFileChangedGlobal);

    const fileChangedEffect = iterator.next();
    expect((fileChangedEffect.value as any)?.type).toBe('FORK');
    expect((fileChangedEffect.value as any)?.payload?.fn).toBe(watchFileChangedGlobal);

    const watcherFileChangedEffect = iterator.next();
    expect((watcherFileChangedEffect.value as any)?.type).toBe('FORK');
    expect((watcherFileChangedEffect.value as any)?.payload?.fn).toBe(watchWatcherFileChanged);

    const loadEffect = iterator.next();
    expect((loadEffect.value as any)?.type).toBe('FORK');
    expect((loadEffect.value as any)?.payload?.args?.[0]).toBe(loadFileContentRequested);
    expect((loadEffect.value as any)?.payload?.args?.[1]).toBe(handleLoadFileContentRequested);

    const refreshEffect = iterator.next();
    expect((refreshEffect.value as any)?.type).toBe('FORK');
    expect((refreshEffect.value as any)?.payload?.args?.[0]).toBe(refreshFileContentRequested);
    expect((refreshEffect.value as any)?.payload?.args?.[1]).toBe(
      handleRefreshFileContentRequested,
    );

    const refreshPathsEffect = iterator.next();
    expect((refreshPathsEffect.value as any)?.type).toBe('FORK');
    expect((refreshPathsEffect.value as any)?.payload?.args?.[0]).toBe(
      refreshOpenFileContentForPathsRequested,
    );
    expect((refreshPathsEffect.value as any)?.payload?.args?.[1]).toBe(
      handleRefreshOpenFileContentForPathsRequested,
    );

    const saveEffect = iterator.next();
    expect((saveEffect.value as any)?.type).toBe('FORK');
    expect((saveEffect.value as any)?.payload?.args?.[0]).toBe(saveFileContentRequested);
    expect((saveEffect.value as any)?.payload?.args?.[1]).toBe(handleSaveFileContentRequested);

    expect(iterator.next()).toEqual({ value: undefined, done: true });
  });

  it('subscribes to the static content channel and routes by payload workspace id', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);
    const ws1Event = { workspaceId: WS_ID, path: ABS_PATH, content: 'external-1' };
    const ws2Event = { workspaceId: WS_ID_2, path: ABS_PATH_2, content: 'external-2' };

    await expectSaga(watchGlobalFileContentChanged)
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH },
          { workspaceId: WS_ID_2, path: PATH_2, absolutePath: ABS_PATH_2 },
        ]),
      )
      .provide([provideChannelEvents(channel, [ws1Event, ws2Event])])
      .put(applyExternalFileContent(WS_ID, PATH, 'external-1', false))
      .put(applyExternalFileContent(WS_ID_2, PATH_2, 'external-2', false))
      .silentRun(50);

    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('file:content-changed');
  });

  it('drops static content events without a workspace id', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);

    const result = await expectSaga(watchGlobalFileContentChanged)
      .withState(stateWithFiles())
      .provide([provideChannelEvents(channel, [{ path: ABS_PATH, content: 'dropped' }])])
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('file:content-changed');
  });

  it('subscribes to the global agent-file channel and routes by payload workspace id', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);
    const ws1Event = { workspaceId: WS_ID, filePath: ABS_PATH };
    const ws2Event = { workspaceId: WS_ID_2, filePath: ABS_PATH_2 };

    await expectSaga(watchAgentFileChangedGlobal)
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH },
          { workspaceId: WS_ID_2, path: PATH_2, absolutePath: ABS_PATH_2 },
        ]),
      )
      .provide([provideChannelEvents(channel, [ws1Event, ws2Event])])
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .put(refreshFileContentRequested(WS_ID_2, PATH_2, ABS_PATH_2))
      .silentRun(50);

    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('file-tracking:agent-file-changed');
  });

  it('drops global agent-file events without a workspace id', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);

    const result = await expectSaga(watchAgentFileChangedGlobal)
      .withState(stateWithFiles())
      .provide([provideChannelEvents(channel, [{ filePath: ABS_PATH }])])
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('subscribes to file:changed workspace events and refreshes matching open files', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);

    await expectSaga(watchFileChangedGlobal)
      .withState(stateWithFiles())
      .provide([
        provideChannelEvents(channel, [
          { workspaceId: WS_ID, data: { path: PATH, relativePath: PATH, action: 'modify' } },
        ]),
      ])
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .silentRun(50);

    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('file:changed');
  });

  it('subscribes to watcher:file-changed and refreshes matching open files', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);

    await expectSaga(watchWatcherFileChanged)
      .withState(stateWithFiles())
      .provide([
        provideChannelEvents(channel, [
          { workspaceId: WS_ID, path: ABS_PATH, relativePath: PATH, type: 'change' },
        ]),
      ])
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .silentRun(150);

    expect(createElectronChannelMock).toHaveBeenCalledTimes(1);
    expect(createElectronChannelMock).toHaveBeenCalledWith('watcher:file-changed');
  });

  it('ignores watcher:file-changed events for files that are not open', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);

    const result = await expectSaga(watchWatcherFileChanged)
      .withState(stateWithFiles())
      .provide([
        provideChannelEvents(channel, [
          {
            workspaceId: WS_ID,
            path: '/repo/src/unopened.ts',
            relativePath: 'src/unopened.ts',
            type: 'change',
          },
        ]),
      ])
      .silentRun(150);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('skips watcher:file-changed refreshes while the open entry is saving', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);
    const state = stateWithFiles();
    state.files.byWorkspaceId[WS_ID].files.map[PATH].saving = true;

    const result = await expectSaga(watchWatcherFileChanged)
      .withState(state)
      .provide([
        provideChannelEvents(channel, [
          { workspaceId: WS_ID, path: ABS_PATH, relativePath: PATH, type: 'change' },
        ]),
      ])
      .silentRun(150);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('skips watcher:file-changed refreshes when the open entry has pending edits', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);
    const state = stateWithFiles();
    state.files.byWorkspaceId[WS_ID].files.map[PATH].localContent = 'local edit';

    const result = await expectSaga(watchWatcherFileChanged)
      .withState(state)
      .provide([
        provideChannelEvents(channel, [
          { workspaceId: WS_ID, path: ABS_PATH, relativePath: PATH, type: 'change' },
        ]),
      ])
      .silentRun(150);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('debounces duplicate watcher:file-changed events for the same path', async () => {
    const channel = createSagaChannel();
    createElectronChannelMock.mockReturnValue(channel);
    const initialState = { ...stateWithFiles(), refreshCount: 0 } as any;

    const result = await expectSaga(watchWatcherFileChanged)
      .withReducer((state = initialState, action: any) => ({
        ...state,
        refreshCount:
          action.type === refreshFileContentRequested.type
            ? state.refreshCount + 1
            : state.refreshCount,
      }))
      .provide([
        provideChannelEvents(channel, [
          { workspaceId: WS_ID, path: ABS_PATH, relativePath: PATH, type: 'change' },
          { workspaceId: WS_ID, path: ABS_PATH, relativePath: PATH, type: 'change' },
          { workspaceId: WS_ID, path: ABS_PATH, relativePath: PATH, type: 'add' },
        ]),
      ])
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .silentRun(150);

    expect((result as any).storeState.refreshCount).toBe(1);
  });

  it('loads content for simultaneous requests for different files', async () => {
    await expectSaga(filesSaga)
      .provide([
        [matchers.call.fn(invoke), { success: true, data: { content: 'loaded', isBinary: false } }],
      ])
      .put(loadFileContentSucceeded(WS_ID, 'src/a.ts', '/repo/src/a.ts', 'loaded', false, false))
      .put(loadFileContentSucceeded(WS_ID, 'src/b.ts', '/repo/src/b.ts', 'loaded', false, false))
      .dispatch(loadFileContentRequested(WS_ID, 'src/a.ts', '/repo/src/a.ts'))
      .dispatch(loadFileContentRequested(WS_ID, 'src/b.ts', '/repo/src/b.ts'))
      .silentRun(50);
  });

  it('saves content for simultaneous requests without leaving entries saving', async () => {
    const result = await expectSaga(filesSaga)
      .withReducer(filesRootReducer)
      .provide([[matchers.call.fn(invoke), { success: true }]])
      .put(saveFileContentSucceeded(WS_ID, 'src/a.ts', 'a'))
      .put(saveFileContentSucceeded(WS_ID, 'src/b.ts', 'b'))
      .dispatch(saveFileContentRequested(WS_ID, 'src/a.ts', '/repo/src/a.ts', 'a'))
      .dispatch(saveFileContentRequested(WS_ID, 'src/b.ts', '/repo/src/b.ts', 'b'))
      .silentRun(50);

    const files = (result as any).storeState.files.byWorkspaceId[WS_ID].files.map;
    expect(files['src/a.ts'].saving).toBe(false);
    expect(files['src/b.ts'].saving).toBe(false);
  });

  it('loads file content through file:read', async () => {
    await expectSaga(
      handleLoadFileContentRequested,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH),
    )
      .provide([
        [matchers.call.fn(invoke), { success: true, data: { content: 'hello', isBinary: true } }],
      ])
      .put(loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'hello', true, false))
      .silentRun(50);
  });

  it('passes load file read options and stores truncated responses', async () => {
    await expectSaga(
      handleLoadFileContentRequested,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH, { maxSize: 1024, truncateIfLarge: true }),
    )
      .provide([
        [matchers.call.fn(invoke), { success: true, data: { content: 'part', truncated: true } }],
      ])
      .call(invoke, 'file:read', {
        workspaceId: WS_ID,
        path: ABS_PATH,
        maxSize: 1024,
        truncateIfLarge: true,
      })
      .put(loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, 'part', false, true))
      .silentRun(50);
  });

  it('normalizes missing files to empty content', async () => {
    await expectSaga(
      handleLoadFileContentRequested,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH),
    )
      .provide([[matchers.call.fn(invoke), Promise.reject(new Error('ENOENT: no such file'))]])
      .put(loadFileContentSucceeded(WS_ID, PATH, ABS_PATH, '', false, false))
      .silentRun(50);
  });

  it('stores non-ENOENT load failures', async () => {
    await expectSaga(
      handleLoadFileContentRequested,
      loadFileContentRequested(WS_ID, PATH, ABS_PATH),
    )
      .provide([[matchers.call.fn(invoke), Promise.reject(new Error('permission denied'))]])
      .put(loadFileContentFailed(WS_ID, PATH, ABS_PATH, 'permission denied'))
      .silentRun(50);
  });

  it('refreshes file content as clean external content', async () => {
    await expectSaga(
      handleRefreshFileContentRequested,
      refreshFileContentRequested(WS_ID, PATH, ABS_PATH),
    )
      .provide([
        [matchers.call.fn(invoke), { success: true, data: { content: 'fresh', isBinary: false } }],
      ])
      .put(applyExternalFileContent(WS_ID, PATH, 'fresh', false, false))
      .silentRun(50);
  });

  it('refreshes clean open files from changes/git refresh paths and applies disk content', async () => {
    await expectSaga(filesSaga)
      .withState(stateWithFiles())
      .provide([
        [matchers.call.fn(invoke), { success: true, data: { content: 'fresh from refresh' } }],
      ])
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .put(applyExternalFileContent(WS_ID, PATH, 'fresh from refresh', false, false))
      .dispatch(refreshOpenFileContentForPathsRequested(WS_ID, [PATH, 'src/unopened.ts']))
      .silentRun(50);
  });

  it('applies two sequential disk refreshes for the same clean open file', async () => {
    const refreshedContents = ['fresh external one', 'fresh external two'];
    let readIndex = 0;

    const result = await expectSaga(filesSaga)
      .withReducer(filesRootReducer, stateWithFiles())
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              return {
                success: true,
                data: { content: refreshedContents[readIndex++] },
              };
            }
            return next();
          },
        },
      ])
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .put(applyExternalFileContent(WS_ID, PATH, 'fresh external one', false, false))
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .put(applyExternalFileContent(WS_ID, PATH, 'fresh external two', false, false))
      .dispatch(refreshOpenFileContentForPathsRequested(WS_ID, [PATH]))
      .dispatch(refreshOpenFileContentForPathsRequested(WS_ID, [PATH]))
      .silentRun(50);

    const entry = (result as any).storeState.files.byWorkspaceId[WS_ID].files.map[PATH];
    expect(readIndex).toBe(2);
    expect(entry.localContent).toBe('fresh external two');
    expect(entry.originalContent).toBe('fresh external two');
    expect(entry.lastUpdated).toBe(3);
  });

  it('matches user-issue README changes by relative path when the open entry path is absolute', async () => {
    const readmePath = 'README.md';
    const readmeAbsolutePath = '/Users/example/repos/user-issue-2/README.md';

    await expectSaga(handleRefreshOpenFileContentForPathsRequested, {
      type: refreshOpenFileContentForPathsRequested.type,
      payload: [WS_ID, [readmePath]],
    })
      .withState(
        stateWithFiles([
          {
            workspaceId: WS_ID,
            path: readmeAbsolutePath,
            absolutePath: readmeAbsolutePath,
            content: '# Project\n',
          },
        ]),
      )
      .put(refreshFileContentRequested(WS_ID, readmeAbsolutePath, readmeAbsolutePath))
      .silentRun(50);
  });

  it('does not refresh dirty or saving open files from changes/git refresh paths', async () => {
    const state = stateWithFiles([
      { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: 'original' },
      { workspaceId: WS_ID, path: PATH_2, absolutePath: ABS_PATH_2, content: 'other' },
    ]);
    state.files.byWorkspaceId[WS_ID].files.map[PATH].localContent = 'local edit';
    state.files.byWorkspaceId[WS_ID].files.map[PATH_2].saving = true;

    const result = await expectSaga(
      handleRefreshOpenFileContentForPathsRequested,
      refreshOpenFileContentForPathsRequested(WS_ID, [PATH, PATH_2]),
    )
      .withState(state)
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('passes refresh file read options and stores truncated responses', async () => {
    await expectSaga(
      handleRefreshFileContentRequested,
      refreshFileContentRequested(WS_ID, PATH, ABS_PATH, { maxSize: 2048, truncateIfLarge: true }),
    )
      .provide([
        [matchers.call.fn(invoke), { success: true, data: { content: 'fresh', truncated: true } }],
      ])
      .call(invoke, 'file:read', {
        workspaceId: WS_ID,
        path: ABS_PATH,
        maxSize: 2048,
        truncateIfLarge: true,
      })
      .put(applyExternalFileContent(WS_ID, PATH, 'fresh', false, true))
      .silentRun(50);
  });

  it('saves file content and emits file:changed', async () => {
    dispatchWindowEventMock.mockClear();

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'hello'),
    )
      .withState({ files: { byWorkspaceId: {} } })
      .provide([[matchers.call.fn(invoke), { success: true }]])
      .put(saveFileContentSucceeded(WS_ID, PATH, 'hello'))
      .silentRun(50);

    expect(dispatchWindowEventMock).toHaveBeenCalledWith('file:changed', {
      workspaceId: WS_ID,
      files: [ABS_PATH],
      type: 'change',
    });
  });

  it('checks original content before saving to avoid stale writes', async () => {
    dispatchWindowEventMock.mockClear();
    let writeCalled = false;

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'edited'),
    )
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: 'original' },
        ]),
      )
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              return { success: true, data: { content: 'original' } };
            }
            if (effect.fn === invoke && effect.args[0] === 'file:write') {
              writeCalled = true;
              return { success: true };
            }
            return next();
          },
        },
      ])
      .put(saveFileContentSucceeded(WS_ID, PATH, 'edited'))
      .silentRun(50);

    expect(dispatchWindowEventMock).toHaveBeenCalledWith('file:changed', {
      workspaceId: WS_ID,
      files: [ABS_PATH],
      type: 'change',
    });
    expect(writeCalled).toBe(true);
  });

  it('fails stale saves when disk content no longer matches original content', async () => {
    dispatchWindowEventMock.mockClear();
    let writeCalled = false;
    const staleWriteError =
      'File changed on disk. Reload the file before saving to avoid overwriting external changes.';

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'edited'),
    )
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: 'original' },
        ]),
      )
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              return { success: true, data: { content: 'external change' } };
            }
            if (effect.fn === invoke && effect.args[0] === 'file:write') {
              writeCalled = true;
              return { success: true };
            }
            return next();
          },
        },
      ])
      .put(saveFileContentFailed(WS_ID, PATH, staleWriteError))
      .silentRun(50);

    expect(dispatchWindowEventMock).not.toHaveBeenCalled();
    expect(writeCalled).toBe(false);
  });

  it('bypasses stale-write checks for restore saves and emits create for file explorer refresh', async () => {
    dispatchWindowEventMock.mockClear();
    let readCalled = false;
    let writeCalled = false;

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'restored', { intent: 'restore' }),
    )
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: 'original' },
        ]),
      )
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              readCalled = true;
              return { success: true, data: { content: 'external change' } };
            }
            if (effect.fn === invoke && effect.args[0] === 'file:write') {
              writeCalled = true;
              return { success: true };
            }
            return next();
          },
        },
      ])
      .put(saveFileContentSucceeded(WS_ID, PATH, 'restored'))
      .silentRun(50);

    expect(readCalled).toBe(false);
    expect(writeCalled).toBe(true);
    expect(dispatchWindowEventMock).toHaveBeenCalledWith('file:changed', {
      workspaceId: WS_ID,
      files: [ABS_PATH],
      type: 'create',
    });
  });

  it('treats ENOENT during stale-write disk read as empty content and proceeds when original is empty', async () => {
    dispatchWindowEventMock.mockClear();
    let writeCalled = false;

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'new content'),
    )
      .withState(
        stateWithFiles([{ workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: '' }]),
      )
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              return Promise.reject(new Error('ENOENT: no such file or directory'));
            }
            if (effect.fn === invoke && effect.args[0] === 'file:write') {
              writeCalled = true;
              return { success: true };
            }
            return next();
          },
        },
      ])
      .put(saveFileContentSucceeded(WS_ID, PATH, 'new content'))
      .silentRun(50);

    expect(writeCalled).toBe(true);
  });

  it('fails stale saves when the stale-write disk read fails with a non-ENOENT error', async () => {
    dispatchWindowEventMock.mockClear();
    let writeCalled = false;

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'edited'),
    )
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: 'some content' },
        ]),
      )
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              return Promise.reject(new Error('EACCES: permission denied'));
            }
            if (effect.fn === invoke && effect.args[0] === 'file:write') {
              writeCalled = true;
              return { success: true };
            }
            return next();
          },
        },
      ])
      .put(saveFileContentFailed(WS_ID, PATH, 'EACCES: permission denied'))
      .silentRun(50);

    expect(writeCalled).toBe(false);
    expect(dispatchWindowEventMock).not.toHaveBeenCalled();
  });

  it('saves without a stale-write disk read when original content is unknown', async () => {
    dispatchWindowEventMock.mockClear();
    let readCalled = false;

    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'hello'),
    )
      .withState({
        files: {
          byWorkspaceId: {
            [WS_ID]: {
              ...emptyFilesWorkspaceState,
              files: {
                idField: 'path',
                ids: [PATH],
                map: {
                  [PATH]: {
                    ...createFileEntry(PATH, ABS_PATH, 'hello'),
                    originalContent: null,
                  },
                },
                refsCount: {},
              },
            },
          },
        },
      })
      .provide([
        {
          call(effect: any, next: () => unknown) {
            if (effect.fn === invoke && effect.args[0] === 'file:read') {
              readCalled = true;
              return { success: true, data: { content: 'hello' } };
            }
            if (effect.fn === invoke && effect.args[0] === 'file:write') {
              return { success: true };
            }
            return next();
          },
        },
      ])
      .put(saveFileContentSucceeded(WS_ID, PATH, 'hello'))
      .silentRun(50);

    expect(readCalled).toBe(false);
  });

  it('stores save failures', async () => {
    await expectSaga(
      handleSaveFileContentRequested,
      saveFileContentRequested(WS_ID, PATH, ABS_PATH, 'hello'),
    )
      .withState({ files: { byWorkspaceId: {} } })
      .provide([[matchers.call.fn(invoke), { success: false, error: { message: 'write failed' } }]])
      .put(saveFileContentFailed(WS_ID, PATH, 'write failed'))
      .silentRun(50);
  });

  it('applies content events to matching tracked files in the payload workspace', async () => {
    const state = stateWithFiles([
      { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH },
      { workspaceId: WS_ID_2, path: PATH_2, absolutePath: ABS_PATH_2 },
    ]);

    await expectSaga(handleFileContentChangedEvent, WS_ID, {
      workspaceId: WS_ID,
      path: ABS_PATH,
      content: 'external-1',
    })
      .withState(state)
      .put(applyExternalFileContent(WS_ID, PATH, 'external-1', false))
      .silentRun(50);

    await expectSaga(handleFileContentChangedEvent, WS_ID_2, {
      workspaceId: WS_ID_2,
      path: ABS_PATH_2,
      content: 'external-2',
    })
      .withState(state)
      .put(applyExternalFileContent(WS_ID_2, PATH_2, 'external-2', false))
      .silentRun(50);
  });

  it('matches content-bearing events by relative path when the open entry has an absolute path', async () => {
    await expectSaga(handleFileContentChangedEvent, WS_ID, {
      workspaceId: WS_ID,
      relativePath: PATH,
      content: 'external-relative',
    })
      .withState(stateWithFiles())
      .put(applyExternalFileContent(WS_ID, PATH, 'external-relative', false))
      .silentRun(50);
  });

  it('updates the disk baseline from content-bearing events while preserving dirty local content', async () => {
    const state = stateWithFiles([
      { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH, content: 'original' },
    ]);
    state.files.byWorkspaceId[WS_ID].files.map[PATH].localContent = 'local edit';

    const result = await expectSaga(handleFileContentChangedEvent, WS_ID, {
      workspaceId: WS_ID,
      path: ABS_PATH,
      content: 'external baseline',
    })
      .withReducer(filesRootReducer, state)
      .put(applyExternalFileContent(WS_ID, PATH, 'external baseline', false))
      .silentRun(50);

    const entry = (result as any).storeState.files.byWorkspaceId[WS_ID].files.map[PATH];
    expect(entry.localContent).toBe('local edit');
    expect(entry.originalContent).toBe('external baseline');
    expect(entry.lastUpdated).toBe(2);
  });

  it('refreshes matching files for agent file changes by absolute path', async () => {
    await expectSaga(handleAgentFileChangedEvent, {
      workspaceId: WS_ID,
      filePath: ABS_PATH,
    })
      .withState(stateWithFiles())
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .silentRun(50);
  });

  it('refreshes matching files for content-less file:changed events by relative path', async () => {
    await expectSaga(handleFileChangedEvent, {
      workspaceId: WS_ID,
      data: { path: PATH, action: 'modify' },
    })
      .withState(stateWithFiles())
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .silentRun(50);
  });

  it('refreshes matching files from summarized file:changed events', async () => {
    await expectSaga(handleFileChangedEvent, {
      workspaceId: WS_ID,
      data: {
        files: [
          { path: 'src/unopened.ts', action: 'Modify' },
          { path: PATH, action: 'Modify' },
        ],
      },
    })
      .withState(stateWithFiles())
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .silentRun(50);
  });

  it('refreshes all matching open files from a multi-file content-less event', async () => {
    await expectSaga(handleFileChangedEvent, {
      workspaceId: WS_ID,
      data: {
        files: [
          { path: PATH, action: 'Modify' },
          { path: PATH_2, action: 'Modify' },
        ],
      },
    })
      .withState(
        stateWithFiles([
          { workspaceId: WS_ID, path: PATH, absolutePath: ABS_PATH },
          { workspaceId: WS_ID, path: PATH_2, absolutePath: ABS_PATH_2 },
        ]),
      )
      .put(refreshFileContentRequested(WS_ID, PATH, ABS_PATH))
      .put(refreshFileContentRequested(WS_ID, PATH_2, ABS_PATH_2))
      .silentRun(50);
  });

  it('ignores file content changes while the file is saving', async () => {
    const state = stateWithFiles();
    state.files.byWorkspaceId[WS_ID].files.map[PATH].saving = true;

    const result = await expectSaga(handleFileContentChangedEvent, WS_ID, {
      workspaceId: WS_ID,
      path: ABS_PATH,
      content: 'external',
    })
      .withState(state)
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('ignores content-less file:changed events while the file is saving', async () => {
    const state = stateWithFiles();
    state.files.byWorkspaceId[WS_ID].files.map[PATH].saving = true;

    const result = await expectSaga(handleFileChangedEvent, {
      workspaceId: WS_ID,
      data: { path: PATH, action: 'modify' },
    })
      .withState(state)
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('does not refresh open files for delete-only file:changed events', async () => {
    const result = await expectSaga(handleFileChangedEvent, {
      workspaceId: WS_ID,
      data: { path: PATH, action: 'delete' },
    })
      .withState(stateWithFiles())
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('ignores file events for other workspaces', async () => {
    const result = await expectSaga(handleFileContentChangedEvent, WS_ID, {
      workspaceId: 'other-ws',
      path: ABS_PATH,
      content: 'external',
    })
      .withState(stateWithFiles())
      .silentRun(50);

    expect(result.effects.put ?? []).toEqual([]);
  });

  it('exposes global listener sagas for fork wiring', () => {
    expect(watchGlobalFileContentChanged.name).toBe('watchGlobalFileContentChanged');
    expect(watchAgentFileChangedGlobal.name).toBe('watchAgentFileChangedGlobal');
    expect(watchFileChangedGlobal.name).toBe('watchFileChangedGlobal');
  });
});
