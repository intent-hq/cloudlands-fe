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
  selectPrincipalActionContext: { select: () => mocks.admission },
}));
vi.mock('../../../store', () => ({ store: { state: {} } }));

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
    mocks.admission = undefined;
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

    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-1', 'legacy-key'));
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
    channel.put(workspaceInitializerDraftSaveScheduled('compact', { text: 'first' }));
    channel.put(
      workspaceInitializerDraftSaveScheduled('compact', {
        text: 'latest',
        attachments: [{ id: 'image-1', type: 'file', label: 'image.png' }],
      }),
    );
    channel.put(workspaceInitializerDraftFlushRequested('compact'));
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

  it('flushes a newer save while restore is still pending', async () => {
    const held = deferred<null>();
    mocks.get.mockReturnValue(held.promise);
    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-1', 'legacy-key'));
    channel.put(workspaceInitializerDraftSaveScheduled('compact', { text: 'typed while loading' }));
    channel.put(workspaceInitializerDraftFlushRequested('compact'));
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
    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-1', 'legacy-key'));
    channel.put(workspaceInitializerDraftSaveScheduled('compact', { text: 'new prompt' }));
    channel.put(workspaceInitializerDraftFlushRequested('compact'));
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
    channel.put(workspaceInitializerDraftSaveScheduled('compact', { text: 'typed' }));
    channel.put(workspaceInitializerDraftFlushRequested('compact'));
    channel.put(workspaceInitializerDraftClearRequested('compact', 'clear-after-save'));
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
    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-1', 'legacy-key'));
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
    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-old', 'legacy-key'));
    await settle();
    channel.put(workspaceInitializerDraftRestoreRequested('compact', 'restore-new', 'legacy-key'));
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
    channel.put(workspaceInitializerDraftSaveScheduled('onboarding', { text: 'stale' }));
    channel.put(workspaceInitializerDraftClearRequested('onboarding', 'clear-1'));
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

  it('publishes a correlated failure when clear is unavailable', async () => {
    mocks.clear.mockRejectedValue(new Error('offline'));
    channel.put(workspaceInitializerDraftClearRequested('compact', 'clear-2'));
    await settle();

    expect(dispatched).toContainEqual(
      workspaceInitializerDraftClearFinished('compact', 'clear-2', 'failure'),
    );
  });
});
