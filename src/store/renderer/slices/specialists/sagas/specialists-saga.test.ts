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
    },
  ],
}));
vi.mock('svelte-sonner', () => ({ toast: { error: mocks.toastError } }));
vi.mock('$lib/components/ui/toast', () => ({ toast: { error: mocks.toastError } }));

import { m } from '$shared/paraglide/messages.js';
import {
  deleteFileSpecialist,
  exportBuiltinToFile,
  loadFileSpecialists,
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
  modelTier: 'smart',
  behaviorPrompt: 'Review.',
  roleReminder: 'Verify.',
  path: `/tmp/${id}.md`,
  source: 'user' as const,
  hidden: false,
  parentAgentId: 'wire-only',
  wireOnly: 'drop',
});

const mappedFileDef = (id: string) => ({
  id,
  name: 'Reviewer',
  description: 'Reviews',
  codingAgent: 'codex',
  model: 'gpt',
  modelTier: 'smart' as const,
  behaviorPrompt: 'Review.',
  roleReminder: 'Verify.',
  filePath: `/tmp/${id}.md`,
  source: 'user' as const,
  hidden: false,
});

const sagaState = (files: Record<string, ReturnType<typeof mappedFileDef>> = {}) => ({
  specialists: {
    fileSpecialists: { map: files },
    bundledSpecialists: [],
  },
});

const expectedListActions = (ids: string[]) => [
  setBundledSpecialists([
    {
      id: 'builtin',
      name: 'Builtin',
      description: 'Default',
      defaultBehaviorPrompt: 'Default prompt',
      source: 'bundled',
      hidden: true,
    },
  ]),
  setBundledSpecialistsLoaded(true),
  setOverridesLoaded(true),
  setCustomSpecialistsLoaded(true),
  setFileSpecialists(ids.map(mappedFileDef)),
  setFileSpecialistsLoaded(true),
];

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
          modelTier: 'smart',
          behaviorPrompt: 'Review.',
          roleReminder: 'Verify.',
          filePath: '/tmp/reviewer.md',
          source: 'user',
          hidden: false,
        },
      ]),
    );
    task.cancel();
    await task.toPromise();
    expect(mocks.unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('sends an exact create payload and serializes repeated writes for one specialist', async () => {
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
    expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(mocks.create.mock.calls[0]).toEqual([
      'builtin',
      {
        id: 'builtin',
        name: 'Builtin',
        description: 'Edited',
        codingAgent: undefined,
        model: undefined,
        modelTier: undefined,
        roleReminder: undefined,
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
      ...expectedListActions(['builtin']),
      ...expectedListActions(['builtin']),
    ]);
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
    channel.put(
      saveFileSpecialist({
        id: 'edited',
        name: 'Edited',
        description: 'Updated',
        codingAgent: 'auggie',
        model: 'opus',
        modelTier: 'balanced',
        roleReminder: 'Check.',
        behaviorPrompt: 'Inspect.',
        scope: 'project',
        workspacePath: '/workspace',
      }),
    );
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
          modelTier: 'balanced',
          roleReminder: 'Check.',
          behaviorPrompt: 'Inspect.',
          source: 'project',
          hidden: false,
        },
        'project',
        '/workspace',
      ],
    ]);
    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(expectedListActions(['edited']));
    task.cancel();
    await task.toPromise();
  });

  it('sends exact delete arguments and refetches the exact remaining list', async () => {
    mocks.list.mockResolvedValue([fileDef('remaining')]);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);
    channel.put(
      deleteFileSpecialist({ id: 'removed', scope: 'project', workspacePath: '/workspace' }),
    );
    await settle();

    expect(mocks.remove.mock.calls).toEqual([['removed', 'project', '/workspace']]);
    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(
      expectedListActions(['remaining']),
    );
    task.cancel();
    await task.toPromise();
  });

  it('sends exact export arguments and refetches the exact exported definition', async () => {
    mocks.list.mockResolvedValue([fileDef('builtin')]);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);
    channel.put(exportBuiltinToFile('builtin'));
    await settle();

    expect(mocks.create.mock.calls).toEqual([
      [
        'builtin',
        {
          id: 'builtin',
          name: 'Builtin',
          description: 'Default',
          codingAgent: undefined,
          model: undefined,
          modelTier: undefined,
          roleReminder: undefined,
          behaviorPrompt: 'Default prompt',
          source: 'user',
          hidden: true,
        },
        'user',
        undefined,
      ],
    ]);
    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(expectedListActions(['builtin']));
    task.cancel();
    await task.toPromise();
  });

  it('loads and maps an exact specialist.list result', async () => {
    mocks.list.mockResolvedValue([fileDef('loaded')]);
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga({ channel, dispatch, getState: () => sagaState() }, specialistsSaga);
    channel.put(loadFileSpecialists());
    await settle();

    expect(mocks.list.mock.calls).toEqual([[]]);
    expect(dispatch.mock.calls.map(([action]) => action)).toEqual(expectedListActions(['loaded']));
    task.cancel();
    await task.toPromise();
  });

  it('surfaces exact save, delete, export, and refetch terminal errors', async () => {
    mocks.create.mockImplementation((id: string) =>
      Promise.reject(new Error(id === 'builtin' ? 'export failed' : 'save failed')),
    );
    mocks.edit.mockRejectedValue(new Error('edit failed'));
    mocks.remove.mockRejectedValue(new Error('delete failed'));
    mocks.list.mockRejectedValue(new Error('refresh failed'));
    const channel = stdChannel();
    const task = runSaga(
      {
        channel,
        dispatch: vi.fn(),
        getState: () => sagaState({ edited: mappedFileDef('edited') }),
      },
      specialistsSaga,
    );

    channel.put(
      saveFileSpecialist({
        id: 'new',
        name: 'New',
        description: 'New',
        behaviorPrompt: 'New.',
      }),
    );
    await settle();
    channel.put(
      saveFileSpecialist({
        id: 'edited',
        name: 'Edited',
        description: 'Edited',
        behaviorPrompt: 'Edited.',
      }),
    );
    await settle();
    channel.put(deleteFileSpecialist({ id: 'removed' }));
    await settle();
    channel.put(exportBuiltinToFile('builtin'));
    await settle();
    channel.put(loadFileSpecialists());
    await settle();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(mocks.toastError.mock.calls).toEqual([
      ['save failed'],
      ['edit failed'],
      ['delete failed'],
      ['export failed'],
      [m.specialists_mutation_refreshFailed_error()],
    ]);
    task.cancel();
    await task.toPromise();
  });

  it('suppresses a stale explicit load after a newer subscription snapshot', async () => {
    let resolveList!: (defs: any[]) => void;
    mocks.list.mockReturnValue(
      new Promise((resolve) => {
        resolveList = resolve;
      }),
    );
    const channel = stdChannel();
    const dispatch = vi.fn();
    const task = runSaga(
      {
        channel,
        dispatch,
        getState: () => ({
          ...sagaState(),
        }),
      },
      specialistsSaga,
    );
    channel.put(loadFileSpecialists());
    await settle();
    mocks.subscription?.([fileDef('new')]);
    await settle();
    resolveList([fileDef('stale')]);
    await settle();
    const fileActions = dispatch.mock.calls
      .map(([action]) => action)
      .filter((action) => action.type === setFileSpecialists.type);
    expect(fileActions).toEqual([
      setFileSpecialists([
        {
          id: 'new',
          name: 'Reviewer',
          description: 'Reviews',
          codingAgent: 'codex',
          model: 'gpt',
          modelTier: 'smart',
          behaviorPrompt: 'Review.',
          roleReminder: 'Verify.',
          filePath: '/tmp/new.md',
          source: 'user',
          hidden: false,
        },
      ]),
    ]);
    task.cancel();
    await task.toPromise();
  });
});
