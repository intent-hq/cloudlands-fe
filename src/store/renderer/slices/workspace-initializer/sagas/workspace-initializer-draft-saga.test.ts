import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  warn: vi.fn(),
  admission: undefined as string | undefined,
}));

vi.mock('$lib/client', () => ({
  appClient: { drafts: { get: mocks.get, set: mocks.set, clear: mocks.clear } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));
vi.mock('../../principal/principal-selectors', () => ({
  selectPrincipalActionContext: {
    effect: function* () {
      return mocks.admission;
    },
  },
}));

import { hostExecutionConnectionChanged } from '../../host-execution/host-execution-slice';
import {
  workspaceInitializerDraftClearFinished,
  workspaceInitializerDraftClearRequested,
  workspaceInitializerDraftFlushRequested,
  workspaceInitializerDraftOwnerReleased,
  workspaceInitializerDraftRestoreFinished,
  workspaceInitializerDraftRestoreRequested,
  workspaceInitializerDraftSaveScheduled,
} from '../workspace-initializer-slice';
import { workspaceInitializerDraftSaga } from './workspace-initializer-draft-saga';

const A = 'host/member-a';
const B = 'host/member-b';
const restore = (id: string, requestId: string, legacyKey = 'legacy-key', admission = A) =>
  workspaceInitializerDraftRestoreRequested(id, requestId, legacyKey, admission);
const save = (id: string, text: string, requestId: string, admission = A) =>
  workspaceInitializerDraftSaveScheduled(id, { text }, requestId, admission);
const flush = (id: string, requestId: string, admission = A) =>
  workspaceInitializerDraftFlushRequested(id, requestId, admission);
const clear = (id: string, clearId: string, requestId: string, admission = A) =>
  workspaceInitializerDraftClearRequested(id, clearId, requestId, admission);

const settle = async () => {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

describe('workspaceInitializerDraftSaga', () => {
  let channel: ReturnType<typeof stdChannel>;
  let task: Task;
  let dispatched: unknown[];

  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    mocks.get.mockResolvedValue(null);
    mocks.set.mockResolvedValue(undefined);
    mocks.clear.mockResolvedValue(undefined);
    mocks.admission = A;
    sessionStorage.clear();
    channel = stdChannel();
    dispatched = [];
    task = runSaga(
      {
        channel,
        dispatch: (action) => {
          dispatched.push(action);
          channel.put(action);
          return action;
        },
      },
      workspaceInitializerDraftSaga,
    );
  });

  afterEach(async () => {
    task.cancel();
    await task.toPromise();
    vi.useRealTimers();
  });

  it('restores the shared draft with exact wire params and correlated output', async () => {
    const attachments = [{ id: 'file-1', type: 'file', label: 'a.txt', path: '/a.txt' }];
    mocks.get.mockResolvedValue({ text: 'saved', attachments });

    channel.put(restore('compact', 'restore-1'));
    await settle();

    expect(mocks.get.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished(
        'compact',
        'restore-1',
        'restored',
        'saved',
        attachments,
      ),
    );
  });

  it('debounces to the latest payload and flushes once with exact wire params', async () => {
    channel.put(restore('compact', 'restore-1'));
    await settle();
    channel.put(save('compact', 'first', 'restore-1'));
    channel.put(
      workspaceInitializerDraftSaveScheduled(
        'compact',
        {
          text: 'latest',
          attachments: [{ id: 'image-1', type: 'file', label: 'image.png' }],
        },
        'restore-1',
        A,
      ),
    );
    channel.put(flush('compact', 'restore-1'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.set.mock.calls).toEqual([
      [
        '__new-workspace__',
        '__initializer__',
        'latest',
        [{ id: 'image-1', type: 'file', label: 'image.png' }],
      ],
    ]);
  });

  it('drops a debounced save when its principal admission changes', async () => {
    mocks.admission = 'host/member';
    channel.put(
      workspaceInitializerDraftRestoreRequested(
        'compact',
        'restore-1',
        'legacy-key',
        'host/member',
      ),
    );
    await settle();
    channel.put(
      workspaceInitializerDraftSaveScheduled(
        'compact',
        { text: 'stale' },
        'restore-1',
        'host/member',
      ),
    );
    await settle();

    mocks.admission = 'replacement/member';
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not flush a pending save admitted under a stale principal', async () => {
    mocks.admission = 'host/member-a';
    channel.put(
      workspaceInitializerDraftRestoreRequested(
        'compact',
        'restore-1',
        'legacy-key',
        'host/member-a',
      ),
    );
    await settle();
    channel.put(
      workspaceInitializerDraftSaveScheduled(
        'compact',
        { text: 'stale' },
        'restore-1',
        'host/member-a',
      ),
    );
    await settle();

    mocks.admission = 'host/member-b';
    channel.put(workspaceInitializerDraftFlushRequested('compact', 'restore-1', 'host/member-b'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('does not flush a pending save from a stale owner request', async () => {
    channel.put(restore('compact', 'restore-old'));
    await settle();
    channel.put(save('compact', 'stale', 'restore-old'));
    channel.put(restore('compact', 'restore-new'));
    await settle();

    channel.put(flush('compact', 'restore-new'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('rejects a mounted owner acting under a replacement authority', async () => {
    channel.put(restore('compact', 'restore-1'));
    await settle();

    mocks.admission = B;
    channel.put(save('compact', 'under b', 'restore-1', B));
    channel.put(flush('compact', 'restore-1', B));
    channel.put(save('compact', 'under a', 'restore-1', A));
    channel.put(flush('compact', 'restore-1', A));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('fails closed when admission is absent', async () => {
    mocks.admission = undefined;
    sessionStorage.setItem('legacy-key', 'legacy prompt');
    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-1', 'legacy-key'));
    channel.put(workspaceInitializerDraftSaveScheduled('compact', { text: 'x' }, 'restore-1'));
    channel.put(workspaceInitializerDraftFlushRequested('compact', 'restore-1'));
    channel.put(workspaceInitializerDraftClearRequested('compact', 'clear-1', 'restore-1'));
    channel.put(workspaceInitializerDraftClearRequested('onboarding', 'clear-2'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(sessionStorage.getItem('legacy-key')).toBe('legacy prompt');
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'restore-1', 'error', '', []),
    );
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('compact', 'clear-1', 'failure'),
    );
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('onboarding', 'clear-2', 'failure'),
    );
  });

  it('fails closed when admission is stale at dispatch', async () => {
    mocks.admission = B;
    channel.put(restore('compact', 'restore-1'));
    channel.put(save('compact', 'x', 'restore-1'));
    channel.put(flush('compact', 'restore-1'));
    channel.put(clear('compact', 'clear-1', 'restore-1'));
    channel.put(workspaceInitializerDraftClearRequested('onboarding', 'clear-2', undefined, A));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.get).not.toHaveBeenCalled();
    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'restore-1', 'error', '', []),
    );
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('compact', 'clear-1', 'failure'),
    );
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('onboarding', 'clear-2', 'failure'),
    );
  });

  it('does not publish or migrate a read that resolves under a replaced authority', async () => {
    const held = deferred<null>();
    mocks.get.mockReturnValueOnce(held.promise);
    sessionStorage.setItem('legacy-key', 'legacy prompt');
    channel.put(restore('compact', 'restore-1'));
    await settle();

    mocks.admission = B;
    held.resolve(null);
    await settle();

    expect(sessionStorage.getItem('legacy-key')).toBe('legacy prompt');
    expect(mocks.set).not.toHaveBeenCalled();
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'restore-1', 'error', '', []),
    );
    expect(dispatched).not.toContainEqual(
      workspaceInitializerDraftRestoreFinished(
        'compact',
        'restore-1',
        'restored',
        'legacy prompt',
        [],
      ),
    );
  });

  it('invalidates owners, pending saves and reads on host execution change', async () => {
    const held = deferred<{ text: string; attachments: never[] }>();
    mocks.get.mockResolvedValueOnce(null).mockReturnValueOnce(held.promise);
    channel.put(restore('compact', 'compact-restore'));
    await settle();
    channel.put(restore('onboarding', 'onboarding-restore'));
    channel.put(save('compact', 'before switch', 'compact-restore'));
    await settle();

    channel.put(hostExecutionConnectionChanged('other-host'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);
    held.resolve({ text: 'old host', attachments: [] });
    await settle();
    channel.put(save('compact', 'after switch', 'compact-restore'));
    channel.put(flush('compact', 'compact-restore'));
    await settle();

    expect(mocks.set).not.toHaveBeenCalled();
    expect(
      dispatched.filter(
        (action) =>
          (action as { type: string }).type === workspaceInitializerDraftRestoreFinished.type &&
          (action as { payload: unknown[] }).payload[0] === 'onboarding',
      ),
    ).toEqual([]);
  });

  it('keeps another owner admitted after clearing the shared draft', async () => {
    channel.put(restore('compact', 'compact-restore', 'compact'));
    channel.put(restore('onboarding', 'onboarding-restore', 'onboarding'));
    await settle();

    channel.put(save('onboarding', 'pending', 'onboarding-restore'));
    channel.put(clear('onboarding', 'onboarding-clear', 'onboarding-restore'));
    await settle();
    channel.put(save('compact', 'compact remains active', 'compact-restore'));
    channel.put(flush('compact', 'compact-restore'));
    channel.put(save('onboarding', 'after clear', 'onboarding-restore'));
    channel.put(flush('onboarding', 'onboarding-restore'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'compact-restore', 'empty', '', []),
    );

    expect(mocks.clear).toHaveBeenCalledOnce();
    expect(mocks.set.mock.calls).toEqual([
      ['__new-workspace__', '__initializer__', 'compact remains active', undefined],
    ]);
  });

  it('invalidates another owner restore that was pending before clear', async () => {
    const held = deferred<{ text: string; attachments: never[] }>();
    mocks.get.mockReturnValueOnce(held.promise).mockResolvedValueOnce(null);
    channel.put(restore('compact', 'compact-restore', 'compact'));
    channel.put(restore('onboarding', 'onboarding-restore', 'onboarding'));
    await settle();

    channel.put(clear('onboarding', 'onboarding-clear', 'onboarding-restore'));
    await settle();
    held.resolve({ text: 'cleared draft', attachments: [] });
    await settle();

    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'compact-restore', 'empty', '', []),
    );
    expect(dispatched).not.toContainEqual(
      workspaceInitializerDraftRestoreFinished(
        'compact',
        'compact-restore',
        'restored',
        'cleared draft',
        [],
      ),
    );
    channel.put(save('compact', 'compact remains active', 'compact-restore'));
    channel.put(flush('compact', 'compact-restore'));
    await settle();

    expect(mocks.set.mock.calls).toEqual([
      ['__new-workspace__', '__initializer__', 'compact remains active', undefined],
    ]);
  });

  it('settles a clear rejected for stale ownership', async () => {
    channel.put(restore('compact', 'restore-new'));
    await settle();
    channel.put(clear('compact', 'clear-stale', 'restore-old'));
    await settle();

    expect(mocks.clear).not.toHaveBeenCalled();
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('compact', 'clear-stale', 'failure'),
    );
  });

  it('flushes a newer save while restore is still pending', async () => {
    const held = deferred<null>();
    mocks.get.mockReturnValue(held.promise);
    channel.put(restore('compact', 'restore-1'));
    channel.put(save('compact', 'typed while loading', 'restore-1'));
    channel.put(flush('compact', 'restore-1'));
    await settle();

    expect(mocks.set.mock.calls).toEqual([
      ['__new-workspace__', '__initializer__', 'typed while loading', undefined],
    ]);
    expect(mocks.get).toHaveBeenCalledOnce();
    held.resolve(null);
  });

  it('does not let late legacy migration overwrite a newer flushed save', async () => {
    const held = deferred<null>();
    mocks.get.mockReturnValue(held.promise);
    sessionStorage.setItem('legacy-key', 'legacy prompt');
    channel.put(restore('compact', 'restore-1'));
    channel.put(save('compact', 'new prompt', 'restore-1'));
    channel.put(flush('compact', 'restore-1'));
    await settle();
    held.resolve(null);
    await settle();

    expect(mocks.set.mock.calls).toEqual([
      ['__new-workspace__', '__initializer__', 'new prompt', undefined],
    ]);
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished(
        'compact',
        'restore-1',
        'restored',
        'legacy prompt',
        [],
      ),
    );
  });

  it('holds clear behind an issued save write', async () => {
    const held = deferred<void>();
    mocks.set.mockReturnValueOnce(held.promise);
    channel.put(restore('compact', 'restore-1'));
    await settle();
    channel.put(save('compact', 'typed', 'restore-1'));
    channel.put(flush('compact', 'restore-1'));
    channel.put(clear('compact', 'clear-after-save', 'restore-1'));
    await settle();

    expect(mocks.set).toHaveBeenCalledOnce();
    expect(mocks.clear).not.toHaveBeenCalled();

    held.resolve();
    await settle();
    expect(mocks.clear.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
  });

  it('holds clear behind an issued legacy migration write', async () => {
    const held = deferred<void>();
    mocks.get.mockResolvedValueOnce(null);
    mocks.set.mockReturnValueOnce(held.promise);
    sessionStorage.setItem('legacy-key', 'legacy prompt');
    channel.put(restore('compact', 'restore-1'));
    await settle();
    expect(mocks.set).toHaveBeenCalledOnce();

    channel.put(workspaceInitializerDraftClearRequested('onboarding', 'clear-after-migration'));
    await settle();
    expect(mocks.clear).not.toHaveBeenCalled();

    held.resolve();
    await settle();
    expect(mocks.clear.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
  });

  it('ignores a stale owner release after a newer restore starts', async () => {
    const oldRestore = deferred<null>();
    const newRestore = deferred<{ text: string; attachments: never[] }>();
    mocks.get.mockReturnValueOnce(oldRestore.promise).mockReturnValueOnce(newRestore.promise);
    channel.put(restore('compact', 'restore-old'));
    await settle();
    channel.put(restore('compact', 'restore-new'));
    channel.put(workspaceInitializerDraftOwnerReleased('compact', 'restore-old'));
    await settle();
    newRestore.resolve({ text: 'current', attachments: [] });
    await settle();

    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'restore-new', 'restored', 'current', []),
    );
    oldRestore.resolve(null);
  });

  it('cancels pending saves before clear and removes both legacy keys', async () => {
    sessionStorage.setItem('compact-workspace-initializer-state-prompt', 'compact');
    sessionStorage.setItem('onboarding-prompt', 'onboarding');
    channel.put(restore('onboarding', 'restore-1', 'other-key'));
    await settle();
    channel.put(save('onboarding', 'stale', 'restore-1'));
    channel.put(clear('onboarding', 'clear-1', 'restore-1'));
    await settle();
    await vi.advanceTimersByTimeAsync(300);

    expect(mocks.set).not.toHaveBeenCalled();
    expect(mocks.clear.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
    expect(sessionStorage.getItem('compact-workspace-initializer-state-prompt')).toBeNull();
    expect(sessionStorage.getItem('onboarding-prompt')).toBeNull();
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('onboarding', 'clear-1', 'success'),
    );
  });

  it('publishes a correlated failure when clear is unavailable and keeps legacy data', async () => {
    mocks.clear.mockRejectedValue(new Error('offline'));
    sessionStorage.setItem('compact-workspace-initializer-state-prompt', 'compact');
    sessionStorage.setItem('onboarding-prompt', 'onboarding');
    channel.put(restore('compact', 'compact-restore', 'unused-compact'));
    channel.put(restore('onboarding', 'onboarding-restore', 'unused-onboarding'));
    await settle();
    channel.put(clear('compact', 'clear-2', 'compact-restore'));
    await settle();
    channel.put(
      workspaceInitializerDraftSaveScheduled('onboarding', { text: '' }, 'onboarding-restore', A),
    );
    channel.put(flush('onboarding', 'onboarding-restore'));
    await settle();

    expect(
      dispatched.filter(
        (action) =>
          (action as { type: string }).type === workspaceInitializerDraftClearFinished.type,
      ),
    ).toEqual([workspaceInitializerDraftClearFinished('compact', 'clear-2', 'failure')]);
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('onboarding', 'onboarding-restore', 'error', '', []),
    );
    expect(sessionStorage.getItem('compact-workspace-initializer-state-prompt')).toBe('compact');
    expect(sessionStorage.getItem('onboarding-prompt')).toBe('onboarding');
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it('fails a clear whose authority changes before the reply and keeps legacy data', async () => {
    const held = deferred<void>();
    mocks.clear.mockReturnValueOnce(held.promise);
    sessionStorage.setItem('onboarding-prompt', 'onboarding');
    channel.put(restore('compact', 'compact-restore', 'unused'));
    await settle();
    channel.put(workspaceInitializerDraftClearRequested('onboarding', 'clear-1'));
    await settle();
    mocks.admission = B;
    held.resolve();
    await settle();

    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('onboarding', 'clear-1', 'failure'),
    );
    expect(dispatched).toContainEqual(
      workspaceInitializerDraftRestoreFinished('compact', 'compact-restore', 'error', '', []),
    );
    expect(sessionStorage.getItem('onboarding-prompt')).toBe('onboarding');
  });

  it('publishes nothing after root cancellation and orders a re-entered write behind it', async () => {
    const held = deferred<void>();
    mocks.set.mockReturnValueOnce(held.promise);
    channel.put(restore('compact', 'restore-1'));
    await settle();
    channel.put(save('compact', 'before teardown', 'restore-1'));
    channel.put(flush('compact', 'restore-1'));
    await settle();
    expect(mocks.set).toHaveBeenCalledOnce();

    task.cancel();
    await task.toPromise();
    const dispatchedBeforeCancel = dispatched.length;

    channel = stdChannel();
    task = runSaga(
      {
        channel,
        dispatch: (action) => {
          dispatched.push(action);
          channel.put(action);
          return action;
        },
      },
      workspaceInitializerDraftSaga,
    );
    channel.put(workspaceInitializerDraftClearRequested('onboarding', 'clear-after-reentry'));
    await settle();
    expect(mocks.clear).not.toHaveBeenCalled();
    expect(dispatched.length).toBe(dispatchedBeforeCancel);

    held.resolve();
    await settle();
    await settle();
    expect(mocks.clear.mock.calls).toEqual([['__new-workspace__', '__initializer__']]);
    expect(dispatched.slice(dispatchedBeforeCancel)).toEqual([
      workspaceInitializerDraftClearFinished('onboarding', 'clear-after-reentry', 'success'),
    ]);
  });
});
