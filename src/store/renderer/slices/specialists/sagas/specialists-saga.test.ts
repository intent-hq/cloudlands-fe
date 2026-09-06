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
  SPECIALISTS: [
    {
      id: 'builtin',
      name: 'Builtin',
      description: 'Default',
      defaultBehaviorPrompt: 'Default prompt',
      hidden: true,
      defaultModel: 'gpt',
      reasoningEffort: 'high',
    },
  ],
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('$lib/components/ui/toast', () => ({ toast: { error: mocks.toastError } }));

import { settingsChanged } from '../../settings-events/settings-events-slice';
import {
  deleteFileSpecialist,
  saveFileSpecialist,
  setBundledSpecialists,
  setBundledSpecialistsLoaded,
  setCustomSpecialistsLoaded,
  setFileSpecialists,
  setFileSpecialistsLoaded,
  setOverridesLoaded,
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

  it('falls back to the hardcoded set only on a fully empty daemon list', async () => {
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
    task.cancel();
    await task.toPromise();
  });

  it('carries reasoningEffort through the hardcoded fallback mapping', async () => {
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
    expect(bundledAction.payload[0]).toEqual([
      expect.objectContaining({
        id: 'builtin',
        source: 'bundled',
        defaultModel: 'gpt',
        reasoningEffort: 'high',
      }),
    ]);
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
