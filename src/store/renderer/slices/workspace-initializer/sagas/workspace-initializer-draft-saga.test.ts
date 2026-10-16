import { runSaga, stdChannel, type Task } from 'redux-saga';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  get: vi.fn(),
  set: vi.fn(),
  clear: vi.fn(),
  warn: vi.fn(),
}));

vi.mock('$lib/client', () => ({
  appClient: { drafts: { get: mocks.get, set: mocks.set, clear: mocks.clear } },
}));
vi.mock('$lib/utils/client-logger', () => ({
  createLogger: () => ({ warn: mocks.warn }),
}));

import {
  workspaceInitializerDraftClearFinished,
  workspaceInitializerDraftClearRequested,
  workspaceInitializerDraftFlushRequested,
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
