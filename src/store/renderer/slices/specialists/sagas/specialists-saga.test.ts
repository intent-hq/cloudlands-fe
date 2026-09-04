import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { runSaga, stdChannel } from 'redux-saga';

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  edit: vi.fn(),
  remove: vi.fn(),
  list: vi.fn(),
  subscribe: vi.fn(),
  subscription: undefined as ((defs: any[]) => void) | undefined,
  unsubscribe: vi.fn(),
  toastError: vi.fn(),
  loggerError: vi.fn(),
  loggerWarn: vi.fn(),
}));
vi.mock('$lib/client', () => ({
  appClient: {
    specialists: {
      create: mocks.create,
      edit: mocks.edit,
      delete: mocks.remove,
      list: mocks.list,
      subscribe: (handler: (defs: any[]) => void) => {
        mocks.subscription = handler;
        mocks.subscribe(handler);
        return mocks.unsubscribe;
      },
    },
  },
}));
vi.mock('$lib/constants/specialists', () => ({
  GITHUB_DEPENDENT_SPECIALIST_IDS: new Set<string>(),
  SPECIALISTS: [
    {
      id: 'builtin',
      name: 'Builtin',
      description: 'Default',
      defaultBehaviorPrompt: 'Default prompt',
      hidden: true,
    },
  ],
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('$lib/components/ui/toast', () => ({ toast: { error: mocks.toastError } }));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn }),
}));

import { settingsChanged } from '../../settings-events/settings-events-slice';
import type { StoreState } from '../../../types';
import { selectSpecialists } from '../specialists-selectors';
import {
  deleteFileSpecialist,
  initialState,
  refetchSpecialistsRequested,
  saveFileSpecialist,
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
  specialistsReducer,
} from '../specialists-slice';
import { specialistsSaga } from './specialists-saga';

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

const fileDef = (id: string) => ({
  id,
  name: 'Reviewer',
  description: 'Reviews',
  codingAgent: 'codex',
  model: 'gpt',
  modelOptions: [{ model: 'opencode:kimi-k3', hint: 'Use for broad review' }],
  behaviorPrompt: 'Review.',
  roleReminder: 'Verify.',
  path: `/tmp/${id}.md`,
  source: 'user' as const,
  hidden: false,
  resolvedModel: 'gpt',
  resolvedProvider: 'codex',
  role: 'internal' as const,
  teamAgents: ['implementor'],
  icon: 'verifier',
  parentAgentId: 'wire-only',
  wireOnly: 'drop',
});

const mappedFileDef = (id: string) => ({
  id,
  name: 'Reviewer',
  description: 'Reviews',
  codingAgent: 'codex',
  model: 'gpt',
  modelOptions: [{ model: 'opencode:kimi-k3', hint: 'Use for broad review' }],
  behaviorPrompt: 'Review.',
  roleReminder: 'Verify.',
  filePath: `/tmp/${id}.md`,
  source: 'user' as const,
  hidden: false,
  resolvedModel: 'gpt',
  resolvedProvider: 'codex',
  role: 'internal' as const,
  teamAgents: ['implementor'],
  icon: 'verifier',
});

const sagaState = (files: Record<string, ReturnType<typeof mappedFileDef>> = {}) => ({
  specialists: {
    fileSpecialists: { map: files },
    bundledSpecialists: [],
  },
});

// A successful list carrying only user/project defs means the base set is
// intentionally empty — no hardcoded resurrection (replacement mode).
const expectedListActions = (ids: string[]) => [
  setBundledSpecialists([]),
  setBundledSpecialistsLoaded(true),
  setOverridesLoaded(true),
  setCustomSpecialistsLoaded(true),
  setFileSpecialists(ids.map(mappedFileDef)),
  setFileSpecialistsLoaded(true),
];

// The saga settles the per-dispatch async-action promise with the daemon write
// outcome by dispatching the paired _SUCCESS/_FAILURE stage action.
type WriteAction = ReturnType<typeof saveFileSpecialist> | ReturnType<typeof deleteFileSpecialist>;
const successAction = (action: WriteAction) => ({
  type: `${action.type}_SUCCESS`,
  payload: { request: action.payload, response: undefined },
});
const failureAction = (action: WriteAction) => ({
  type: `${action.type}_FAILURE`,
  payload: { request: action.payload, error: expect.any(Error) },
});

describe('specialistsSaga', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.subscription = undefined;
    mocks.list.mockResolvedValue([]);
    mocks.create.mockResolvedValue({});
    mocks.edit.mockResolvedValue({});
    mocks.remove.mockResolvedValue({});
  });
  afterEach(() => vi.clearAllMocks());

  it('maps subscription payloads field-by-field and unsubscribes on cancellation', async () => {
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel: stdChannel(),
        dispatch,
        getState: () => ({
          ...sagaState(),
        }),
      },
      specialistsSaga,
    );
    await settle();
    mocks.subscription?.([fileDef('reviewer')]);
    await settle();
    const fileAction = dispatch.mock.calls.find(
      ([action]) => action.type === setFileSpecialists.type,
    )?.[0];
    expect(fileAction).toEqual(
      setFileSpecialists([
        {
          id: 'reviewer',
          name: 'Reviewer',
          description: 'Reviews',
          codingAgent: 'codex',
          model: 'gpt',
          modelOptions: [{ model: 'opencode:kimi-k3', hint: 'Use for broad review' }],
          behaviorPrompt: 'Review.',
          roleReminder: 'Verify.',
          filePath: '/tmp/reviewer.md',
          source: 'user',
          hidden: false,
          resolvedModel: 'gpt',
          resolvedProvider: 'codex',
          role: 'internal',
          teamAgents: ['implementor'],
          icon: 'verifier',
        },
      ]),
    );
    task.cancel();
    await task.toPromise();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('daemon bundled specialists replace the hardcoded set — no resurrection (replacement mode)', async () => {
    const dispatch = vi.fn();
    const task = runSaga(
      { channel: stdChannel(), dispatch, getState: () => sagaState() },
      specialistsSaga,
    );
    await settle();
    mocks.subscription?.([
      {
        id: 'daemon-only',
        name: 'Daemon Only',
        description: 'from daemon',
        behaviorPrompt: 'prompt',
        source: 'bundled' as const,
        hidden: false,
      },
    ]);
    await settle();
    const bundledAction = dispatch.mock.calls.find(
      ([action]) => action.type === setBundledSpecialists.type,
    )?.[0];
    const ids = bundledAction.payload[0].map((s: { id: string }) => s.id);
    expect(ids).toEqual(['daemon-only']);
    expect(ids).not.toContain('builtin');
    task.cancel();
    await task.toPromise();
  });

  it('a user/project-only daemon list keeps the base set empty — no hardcoded resurrection (replacement mode)', async () => {
    const dispatch = vi.fn();
    const task = runSaga(
      { channel: stdChannel(), dispatch, getState: () => sagaState() },
      specialistsSaga,
    );
    await settle();
    mocks.subscription?.([fileDef('reviewer')]);
    await settle();
    const bundledAction = dispatch.mock.calls.find(
      ([action]) => action.type === setBundledSpecialists.type,
    )?.[0];
    expect(bundledAction).toEqual(setBundledSpecialists([]));
    task.cancel();
    await task.toPromise();
  });

  it('falls back to the hardcoded set on an empty initial load', async () => {
    const dispatch = vi.fn();
    const task = runSaga(
      { channel: stdChannel(), dispatch, getState: () => sagaState() },
      specialistsSaga,
    );
    await settle();
    mocks.subscription?.([]);
    await settle();
    const bundledAction = dispatch.mock.calls.find(
      ([action]) => action.type === setBundledSpecialists.type,
    )?.[0];
    expect(bundledAction.payload[0].map((s: { id: string }) => s.id)).toEqual(['builtin']);
    expect(dispatch).toHaveBeenCalledWith(setBundledSpecialistsLoaded(true));
    expect(dispatch).toHaveBeenCalledWith(setFileSpecialistsLoaded(true));
    task.cancel();
    await task.toPromise();
  });

  it('sends exact create payloads while global takeEvery processes repeated writes concurrently', async () => {
    mocks.list.mockResolvedValue([fileDef('builtin')]);
    let release!: () => void;
    mocks.create.mockReturnValue(
      new Promise((resolve) => {
        release = () => resolve({});
      }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => sagaState(),
      },
      specialistsSaga,
    );
    const action = saveFileSpecialist({
      id: 'builtin',
      name: 'Builtin',
      description: 'Edited',
      behaviorPrompt: 'Edited prompt',
      scope: 'project',
      workspacePath: '/workspace',
    });
    channel.put(action);
    channel.put(action);
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.create.mock.calls[0]).toEqual([
      'builtin',
      {
        id: 'builtin',
        name: 'Builtin',
        description: 'Edited',
        codingAgent: undefined,
        model: undefined,
        roleReminder: undefined,
        modelOptions: undefined,
        behaviorPrompt: 'Edited prompt',
        source: 'project',
        hidden: true,
      },
      'project',
      '/workspace',
    ]);
    release();
    await settle();
    expect(mocks.create).toHaveBeenCalledTimes(2);
    expect(mocks.list.mock.calls).toEqual([[], []]);
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched)).toEqual([
      successAction(action),
      successAction(action),
      ...expectedListActions(['builtin']),
    ]);
    await expect(action.promise).resolves.toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('sends exact edit arguments and applies the exact post-mutation refetch result', async () => {
    mocks.list.mockResolvedValue([fileDef('edited')]);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => sagaState({ edited: mappedFileDef('edited') }),
      },
      specialistsSaga,
    );
    const action = saveFileSpecialist({
      id: 'edited',
      name: 'Edited',
      description: 'Updated',
      codingAgent: 'auggie',
      model: 'opus',
      modelOptions: [{ model: 'opencode:kimi-k3', hint: 'Use for broad review' }],
      roleReminder: 'Check.',
      behaviorPrompt: 'Inspect.',
      scope: 'project',
      workspacePath: '/workspace',
    });
    channel.put(action);
    await settle();

    expect(mocks.edit.mock.calls).toEqual([
      [
        'edited',
        {
          id: 'edited',
          name: 'Edited',
          description: 'Updated',
          codingAgent: 'auggie',
          model: 'opus',
          modelOptions: [{ model: 'opencode:kimi-k3', hint: 'Use for broad review' }],
          roleReminder: 'Check.',
          behaviorPrompt: 'Inspect.',
          source: 'project',
          hidden: false,
          role: 'internal',
          teamAgents: ['implementor'],
          icon: 'verifier',
        },
        'project',
        '/workspace',
      ],
    ]);
    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched)).toEqual([
      successAction(action),
      ...expectedListActions(['edited']),
    ]);
    await expect(action.promise).resolves.toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('sends exact delete arguments and refetches the exact remaining list', async () => {
    mocks.list.mockResolvedValue([fileDef('remaining')]);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);
    const action = deleteFileSpecialist({
      id: 'removed',
      scope: 'project',
      workspacePath: '/workspace',
    });
    channel.put(action);
    await settle();

    expect(mocks.remove.mock.calls).toEqual([['removed', 'project', '/workspace']]);
    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched)).toEqual([
      successAction(action),
      ...expectedListActions(['remaining']),
    ]);
    await expect(action.promise).resolves.toBeUndefined();
    task.cancel();
    await task.toPromise();
  });

  it('rejects the save action promise when the daemon write fails (monorepo review PR#1947)', async () => {
    mocks.create.mockRejectedValue(new Error('daemon write failed'));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);
    const action = saveFileSpecialist({
      id: 'new-one',
      name: 'New One',
      description: 'Desc',
      behaviorPrompt: 'Prompt',
      scope: 'project',
      workspacePath: '/workspace',
    });
    channel.put(action);
    await settle();

    await expect(action.promise).rejects.toThrow('daemon write failed');
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched)).toEqual([failureAction(action)]);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  it('rejects the delete action promise when the daemon write fails (monorepo review PR#1947)', async () => {
    mocks.remove.mockRejectedValue(new Error('delete rpc failed'));
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);
    const action = deleteFileSpecialist({ id: 'gone', scope: 'user' });
    channel.put(action);
    await settle();

    await expect(action.promise).rejects.toThrow('delete rpc failed');
    expect(dispatch.mock.calls.map(([dispatched]) => dispatched)).toEqual([failureAction(action)]);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.toastError).toHaveBeenCalledTimes(1);
    task.cancel();
    await task.toPromise();
  });

  describe('explicit refetch requests', () => {
    afterEach(() => vi.useRealTimers());

    it('replaces prior specialists with the authoritative list', async () => {
      vi.useFakeTimers();
      mocks.list.mockResolvedValue([
        {
          id: 'fresh-bundled',
          name: 'Fresh Bundled',
          description: 'Bundled from daemon',
          behaviorPrompt: 'Coordinate.',
          source: 'bundled',
        },
        fileDef('fresh-file'),
      ]);
      let state = specialistsReducer(
        initialState,
        setFileSpecialists([mappedFileDef('stale-file')]),
      );
      const channel = stdChannel();
      const dispatch = vi.fn((action) => {
        state = specialistsReducer(state, action);
      });
      const getState = () =>
        ({ specialists: state, githubAuth: { isAuthenticated: true } }) as unknown as StoreState;
      const task = runSaga({ channel, dispatch, getState }, specialistsSaga);

      channel.put(refetchSpecialistsRequested());
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.list.mock.calls).toEqual([[]]);
      expect(selectSpecialists.select(getState()).map(({ id }) => id)).toEqual([
        'fresh-bundled',
        'fresh-file',
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('keeps the last-known-good state and logs when the refetch fails', async () => {
      vi.useFakeTimers();
      const error = new Error('list unavailable');
      mocks.list.mockRejectedValue(error);
      let state = {
        ...specialistsReducer(initialState, setFileSpecialists([mappedFileDef('existing')])),
        overridesLoaded: true,
        customSpecialistsLoaded: true,
        fileSpecialistsLoaded: true,
        bundledSpecialistsLoaded: true,
      };
      const priorState = state;
      const channel = stdChannel();
      const dispatch = vi.fn((action) => {
        state = specialistsReducer(state, action);
      });
      const task = runSaga(
        { channel, dispatch, getState: () => ({ specialists: state }) },
        specialistsSaga,
      );

      channel.put(refetchSpecialistsRequested());
      await vi.advanceTimersByTimeAsync(100);

      expect(state).toBe(priorState);
      expect(state.fileSpecialistsLoaded).toBe(true);
      expect(mocks.loggerError).toHaveBeenCalledWith('Failed to refetch specialist list', error);
      expect(mocks.toastError).toHaveBeenCalledTimes(1);
      task.cancel();
      await task.toPromise();
    });

    it('keeps the loaded roster and flags when a refetch resolves to an empty list', async () => {
      vi.useFakeTimers();
      mocks.list.mockResolvedValue([]);
      let state = initialState;
      const channel = stdChannel();
      const dispatch = vi.fn((action) => {
        state = specialistsReducer(state, action);
      });
      const getState = () => ({ specialists: state }) as unknown as StoreState;
      const task = runSaga({ channel, dispatch, getState }, specialistsSaga);
      await settle();

      mocks.subscription?.([
        {
          id: 'loaded-bundled',
          name: 'Loaded Bundled',
          description: 'Bundled from daemon',
          behaviorPrompt: 'Coordinate.',
          source: 'bundled',
        },
        fileDef('loaded-file'),
      ]);
      await settle();
      const priorState = state;

      channel.put(refetchSpecialistsRequested());
      await vi.advanceTimersByTimeAsync(100);

      expect(mocks.list.mock.calls).toEqual([[]]);
      expect(state).toBe(priorState);
      expect(state.bundledSpecialists.map(({ id }) => id)).toEqual(['loaded-bundled']);
      expect(selectSpecialists.select(getState()).map(({ id }) => id)).toEqual([
        'loaded-bundled',
        'loaded-file',
      ]);
      expect(state.bundledSpecialistsLoaded).toBe(true);
      expect(state.customSpecialistsLoaded).toBe(true);
      expect(state.fileSpecialistsLoaded).toBe(true);
      expect(mocks.loggerWarn).toHaveBeenCalledWith(
        'Ignoring empty specialist list after initial load',
      );
      task.cancel();
      await task.toPromise();
    });

    it('coalesces rapid and in-flight requests into one leading and one trailing refetch', async () => {
      vi.useFakeTimers();
      const resolvers: Array<(defs: any[]) => void> = [];
      mocks.list.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);

      channel.put(refetchSpecialistsRequested());
      channel.put(refetchSpecialistsRequested());
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.list).toHaveBeenCalledTimes(1);

      channel.put(refetchSpecialistsRequested());
      channel.put(refetchSpecialistsRequested());
      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.list).toHaveBeenCalledTimes(1);

      resolvers[0]!([fileDef('first')]);
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.list).toHaveBeenCalledTimes(2);
      resolvers[1]!([fileDef('second')]);
      await vi.advanceTimersByTimeAsync(0);

      const fileActions = dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === setFileSpecialists.type);
      expect(fileActions).toEqual([
        setFileSpecialists([mappedFileDef('first')]),
        setFileSpecialists([mappedFileDef('second')]),
      ]);
      task.cancel();
      await task.toPromise();
    });
  });

  describe('settings-driven refetch (monorepo#1925)', () => {
    afterEach(() => vi.useRealTimers());

    it('debounces a model-resolution settings burst into one specialist.list refetch', async () => {
      vi.useFakeTimers();
      mocks.list.mockResolvedValue([fileDef('loaded')]);
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);

      channel.put(
        settingsChanged([{ path: 'model.providerDefaults', value: { 'claude-code': 'fable-5' } }]),
      );
      // Unrelated delta inside the debounce window must neither trigger a
      // refetch nor swallow the pending one (predicate-filtered pattern).
      channel.put(settingsChanged([{ path: 'mcp.servers', value: [] }]));
      channel.put(settingsChanged([{ path: 'model.default', value: 'fable-5' }]));
      channel.put(settingsChanged([{ path: 'model.defaultProvider', value: 'claude-code' }]));
      await vi.advanceTimersByTimeAsync(200);

      expect(mocks.list.mock.calls).toEqual([[]]);
      expect(dispatch.mock.calls.map(([action]) => action)).toEqual(
        expectedListActions(['loaded']),
      );
      task.cancel();
      await task.toPromise();
    });

    it('serializes refetches: deltas arriving mid-flight coalesce into one trailing refetch', async () => {
      vi.useFakeTimers();
      const resolvers: Array<(defs: any[]) => void> = [];
      mocks.list.mockImplementation(() => new Promise((resolve) => resolvers.push(resolve)));
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);

      channel.put(settingsChanged([{ path: 'model.default', value: 'fable-5' }]));
      await vi.advanceTimersByTimeAsync(100);
      expect(mocks.list).toHaveBeenCalledTimes(1); // refetch in flight

      // Relevant deltas spaced past the debounce window while the RPC hangs
      // must NOT start concurrent specialist.list calls (single-flight).
      channel.put(settingsChanged([{ path: 'model.defaultProvider', value: 'codex' }]));
      await vi.advanceTimersByTimeAsync(150);
      channel.put(settingsChanged([{ path: 'model.providerDefaults', value: {} }]));
      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.list).toHaveBeenCalledTimes(1);

      resolvers[0]!([fileDef('first')]);
      await vi.advanceTimersByTimeAsync(300);
      expect(mocks.list).toHaveBeenCalledTimes(2); // ONE trailing refetch, not two
      resolvers[1]!([fileDef('second')]);
      await vi.advanceTimersByTimeAsync(0);

      const fileActions = dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === setFileSpecialists.type);
      expect(fileActions).toEqual([
        setFileSpecialists([mappedFileDef('first')]),
        setFileSpecialists([mappedFileDef('second')]),
      ]);
      task.cancel();
      await task.toPromise();
    });

    it('does not refetch for settings deltas that do not touch model resolution', async () => {
      vi.useFakeTimers();
      const channel = stdChannel();
      const dispatch = vi.fn();
      const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);

      channel.put(settingsChanged([{ path: 'mcp.servers', value: [] }]));
      channel.put(settingsChanged([{ path: 'model.defaultReasoningEffort', value: 'high' }]));
      await vi.advanceTimersByTimeAsync(200);

      expect(mocks.list).not.toHaveBeenCalled();
      expect(dispatch).not.toHaveBeenCalled();
      task.cancel();
      await task.toPromise();
    });
  });
});
