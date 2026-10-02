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
  toastSuccess: vi.fn(),
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
  GITHUB_DEPENDENT_SPECIALIST_IDS: new Set(['pr-reviewer']),
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
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: mocks.toastError, success: mocks.toastSuccess },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ error: mocks.loggerError, warn: mocks.loggerWarn }),
}));

import { settingsChanged } from '../../settings-events/settings-events-slice';
import type { StoreState } from '../../../types';
import { selectSpecialists } from '../specialists-selectors';
import {
  createSpecialistFromDraft,
  setSpecialistCreation,
  updateSpecialistDraft,
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
import {
  providerCatalogReducer,
  workspaceCatalogReceived,
  workspaceCatalogReadFailed,
  workspaceCatalogRequested,
} from '../../provider-catalog/provider-catalog-slice';
import type { StoreAction } from '../../../types';

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
  reasoningEffort: 'high',
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
  reasoningEffort: 'high',
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
  payload: { request: action.payload, response: undefined, seq: action.seq },
});
const failureAction = (action: WriteAction) => ({
  type: `${action.type}_FAILURE`,
  payload: { request: action.payload, error: expect.any(Error), seq: action.seq },
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
          reasoningEffort: 'high',
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

  it('round-trips reasoningEffort through the post-mutation refetch so a follow-up save keeps it', async () => {
    // Regression: picking an effort level in the specialist Model row briefly
    // showed the level, then reverted to Auto with no error. The daemon
    // persisted it (the edit request carried it), but the refetched
    // `specialist.list` def was mapped into state without `reasoningEffort`,
    // so the picker re-read `undefined` — and any follow-up save built from
    // that state silently wrote the level away on the daemon too.
    const files: Record<string, ReturnType<typeof mappedFileDef>> = {
      edited: { ...mappedFileDef('edited'), reasoningEffort: undefined },
    };
    mocks.list.mockResolvedValue([{ ...fileDef('edited'), reasoningEffort: 'high' }]);
    const channel = stdChannel();
    const dispatch = vi.fn((dispatched: { type: string; payload?: unknown[] }) => {
      if (dispatched.type === setFileSpecialists.type) {
        for (const spec of dispatched.payload![0] as ReturnType<typeof mappedFileDef>[]) {
          files[spec.id] = spec;
        }
      }
    });
    const task = runSaga({ channel, dispatch, getState: () => sagaState(files) }, specialistsSaga);

    const pickLevel = saveFileSpecialist({
      id: 'edited',
      name: 'Reviewer',
      description: 'Reviews',
      codingAgent: 'auggie',
      model: 'opus',
      modelOptions: [{ model: 'opencode:kimi-k3', hint: 'Use for broad review' }],
      roleReminder: 'Verify.',
      reasoningEffort: 'high',
      behaviorPrompt: 'Review.',
      scope: 'user',
    });
    channel.put(pickLevel);
    await settle();
    await expect(pickLevel.promise).resolves.toBeUndefined();

    // The refetched state must carry the persisted level.
    const refetched = files.edited;
    expect(refetched.reasoningEffort).toBe('high');

    // A follow-up save built from state — as the editor does for a rename or
    // prompt edit — must not drop the level.
    const rename = saveFileSpecialist({
      id: refetched.id,
      name: 'Renamed',
      description: refetched.description,
      codingAgent: refetched.codingAgent,
      model: refetched.model || undefined,
      modelOptions: refetched.modelOptions,
      roleReminder: refetched.roleReminder,
      reasoningEffort: refetched.reasoningEffort,
      behaviorPrompt: refetched.behaviorPrompt,
      scope: refetched.source,
    });
    channel.put(rename);
    await settle();
    await expect(rename.promise).resolves.toBeUndefined();

    // Every edit request — not just the last — carries the level.
    expect(mocks.edit.mock.calls.map(([, spec]) => spec.reasoningEffort)).toEqual(['high', 'high']);
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

describe('specialist creation confirmation', () => {
  const tasks: ReturnType<typeof runSaga>[] = [];
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.list.mockReset().mockResolvedValue([]);
    mocks.create.mockReset().mockResolvedValue({});
  });
  afterEach(async () => {
    tasks.forEach((task) => task.cancel());
    await Promise.all(tasks.splice(0).map((task) => task.toPromise()));
    vi.useRealTimers();
  });
  function harness() {
    let state = {
      specialists: initialState,
      githubAuth: { isAuthenticated: false },
      providerCatalog: providerCatalogReducer(undefined, { type: '@@init' }),
    };
    const channel = stdChannel();
    const dispatch = vi.fn((action: StoreAction<unknown>) => {
      state = {
        ...state,
        specialists: specialistsReducer(state.specialists, action),
        providerCatalog: providerCatalogReducer(state.providerCatalog, action),
      };
      channel.put(action);
    });
    const task = runSaga({ channel, dispatch, getState: () => state }, specialistsSaga);
    tasks.push(task);
    dispatch(
      updateSpecialistDraft('user', {
        name: 'Reviewer',
        description: 'Reviews',
        behaviorPrompt: 'Review carefully.',
        codingAgent: 'codex',
        model: 'codex:gpt',
        reasoningEffort: 'high',
      }),
    );
    return {
      dispatch,
      state: () => state,
      creation: () => state.specialists.creationByContext.user,
    };
  }
  function deferred<T>() {
    let resolve!: (value: T) => void;
    let reject!: (error: Error) => void;
    const promise = new Promise<T>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    return { promise, resolve, reject };
  }

  it('creates a visible unique ID instead of reusing a GitHub-gated ID', async () => {
    const h = harness();
    h.dispatch(updateSpecialistDraft('user', { name: 'PR Reviewer' }));
    mocks.list.mockImplementation(async () => [fileDef(mocks.create.mock.calls[0][0])]);
    const action = createSpecialistFromDraft('user');
    h.dispatch(action);
    await expect(action.promise).resolves.toBe('pr-reviewer-2');
    expect(selectSpecialists.select(h.state() as StoreState).map((entry) => entry.id)).toContain(
      'pr-reviewer-2',
    );
  });

  it('does not confirm a persisted entry excluded from the sidebar by GitHub auth', async () => {
    const h = harness();
    h.dispatch(
      setSpecialistCreation('user', {
        draft: h.creation().draft,
        status: 'refresh-failed',
        specialistId: 'pr-reviewer',
      }),
    );
    mocks.list.mockResolvedValue([fileDef('pr-reviewer')]);
    const action = createSpecialistFromDraft('user');
    h.dispatch(action);
    await expect(action.promise).rejects.toThrow();
    expect(h.creation().status).toBe('refresh-failed');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it('keeps pending through write and catalog delays and ignores duplicate submissions', async () => {
    const write = deferred<unknown>();
    const catalog = deferred<ReturnType<typeof fileDef>[]>();
    mocks.create.mockReturnValue(write.promise);
    mocks.list.mockReturnValue(catalog.promise);
    const h = harness();
    const action = createSpecialistFromDraft('user');
    const done = vi.fn();
    void action.promise.then(done);
    h.dispatch(action);
    h.dispatch(createSpecialistFromDraft('user'));
    expect(h.creation().status).toBe('saving');
    expect(mocks.create.mock.calls).toEqual([
      [
        'reviewer',
        {
          id: 'reviewer',
          name: 'Reviewer',
          description: 'Reviews',
          codingAgent: 'codex',
          model: 'gpt',
          reasoningEffort: 'high',
          behaviorPrompt: 'Review carefully.',
          source: 'user',
        },
        'user',
        undefined,
      ],
    ]);
    expect(mocks.list).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    write.resolve({});
    await settle();
    expect(h.creation().status).toBe('refreshing');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    expect(done).not.toHaveBeenCalled();
    h.dispatch(createSpecialistFromDraft('user'));
    catalog.resolve([fileDef('reviewer')]);
    await expect(action.promise).resolves.toBe('reviewer');
    expect(selectSpecialists.select(h.state() as StoreState).map((s) => s.id)).toContain(
      'reviewer',
    );
    expect(h.creation().draft.name).toBe('');
    expect(h.creation().status).toBe('editing');
    expect(mocks.toastSuccess).toHaveBeenCalledOnce();
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('retains every input on write failure and retries the same specialist', async () => {
    mocks.create.mockRejectedValueOnce(new Error('Write failed'));
    const h = harness();
    const original = h.creation().draft;
    const action = createSpecialistFromDraft('user');
    h.dispatch(action);
    await expect(action.promise).rejects.toThrow('Write failed');
    expect(h.creation().draft).toEqual(original);
    expect(h.creation().status).toBe('save-failed');
    expect(mocks.list).not.toHaveBeenCalled();
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    mocks.list.mockResolvedValue([fileDef('reviewer')]);
    const retry = createSpecialistFromDraft('user');
    h.dispatch(retry);
    await expect(retry.promise).resolves.toBe('reviewer');
    expect(mocks.create.mock.calls.map(([id]) => id)).toEqual(['reviewer', 'reviewer']);
  });

  it.each(['rejected', 'missing'] as const)(
    'retries only refresh after a successful write and %s catalog',
    async (failure) => {
      if (failure === 'rejected') mocks.list.mockRejectedValueOnce(new Error('Offline'));
      const h = harness();
      const action = createSpecialistFromDraft('user');
      h.dispatch(action);
      await expect(action.promise).rejects.toThrow();
      expect(h.creation().status).toBe('refresh-failed');
      expect(h.creation().draft.name).toBe('Reviewer');
      expect(mocks.toastSuccess).not.toHaveBeenCalled();
      mocks.list.mockResolvedValue([fileDef('reviewer')]);
      const retry = createSpecialistFromDraft('user');
      h.dispatch(retry);
      await expect(retry.promise).resolves.toBe('reviewer');
      expect(mocks.create).toHaveBeenCalledOnce();
      expect(mocks.list).toHaveBeenCalledTimes(2);
    },
  );

  it('waits for the workspace sidebar, retains recovery on its failure, and retries without writing', async () => {
    mocks.list.mockResolvedValue([fileDef('reviewer')]);
    const h = harness();
    const action = createSpecialistFromDraft('user', 'A');
    h.dispatch(action);
    await vi.waitFor(() => expect(h.dispatch).toHaveBeenCalledWith(workspaceCatalogRequested('A')));
    expect(h.creation().status).toBe('refreshing');
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    h.dispatch(workspaceCatalogReadFailed('A'));
    await expect(action.promise).rejects.toThrow();
    expect(h.creation().status).toBe('refresh-failed');
    const retry = createSpecialistFromDraft('user', 'A');
    h.dispatch(retry);
    await vi.waitFor(() =>
      expect(
        h.dispatch.mock.calls.filter(([a]) => a.type === workspaceCatalogRequested.type),
      ).toHaveLength(2),
    );
    h.dispatch(
      workspaceCatalogReceived(
        'B',
        {
          catalog: { providers: [] },
          settings: [],
          specialists: [fileDef('reviewer')],
          readiness: {},
        },
        0,
      ),
    );
    expect(mocks.toastSuccess).not.toHaveBeenCalled();
    h.dispatch(
      workspaceCatalogReceived(
        'A',
        {
          catalog: { providers: [] },
          settings: [],
          specialists: [fileDef('reviewer')],
          readiness: {},
        },
        0,
      ),
    );
    await expect(retry.promise).resolves.toBe('reviewer');
    expect(selectSpecialists.select(h.state() as StoreState, 'A').map((s) => s.id)).toContain(
      'reviewer',
    );
    expect(mocks.create).toHaveBeenCalledOnce();
  });

  it('bounds waiting for a missing workspace catalog', async () => {
    vi.useFakeTimers();
    mocks.list.mockResolvedValue([fileDef('reviewer')]);
    const h = harness();
    const action = createSpecialistFromDraft('user', 'A');
    h.dispatch(action);
    await settle();
    await vi.advanceTimersByTimeAsync(30000);
    await expect(action.promise).rejects.toThrow();
    expect(h.creation().status).toBe('refresh-failed');
    expect(h.creation().draft.name).toBe('Reviewer');
  });

  it('reserves different IDs for simultaneous contexts with the same name', async () => {
    mocks.create.mockReturnValue(new Promise(() => {}));
    const h = harness();
    h.dispatch(updateSpecialistDraft('workspace:A', { name: 'Reviewer' }));
    h.dispatch(createSpecialistFromDraft('user'));
    h.dispatch(createSpecialistFromDraft('workspace:A'));
    expect(mocks.create.mock.calls.map(([id]) => id)).toEqual(['reviewer', 'reviewer-2']);
  });
});
