import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { call, takeEvery } from 'typed-redux-saga';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { prWorkflowSaga } from '$store/renderer/slices/pr-workflow/sagas/pr-workflow-saga';
import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { backgroundGitActionsService } from '../background-git-actions.service';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(() => new Promise(() => {})),
  backendUnsubscribe: vi.fn(async () => {}),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

let dispose: () => void;
let stop: () => void;
let stopRefreshObserver: () => void;
const refreshed = vi.fn();
let handlers: Map<string, () => unknown>;
const calls = (method: string) =>
  vi.mocked(backendRequest).mock.calls.filter(([name]) => name === method);

beforeEach(() => {
  vi.clearAllMocks();
  handlers = new Map([
    ['git.agentCommit', () => ({ ok: true, hash: 'committed', files: ['a.ts'], fileCount: 1 })],
    [
      'accept-changes.execute',
      () => ({
        success: true,
        steps: [],
        result: { prNumber: 7, prUrl: 'https://github.test/o/r/pull/7' },
      }),
    ],
    ['workspace.get', () => ({ workspace: null })],
  ]);
  vi.mocked(backendRequest).mockImplementation(async (method) => {
    const handler = handlers.get(method);
    if (!handler) throw new Error(`Unexpected RPC: ${method}`);
    return handler();
  });
  dispose = startRootStoreLifecycle(appStore, { startSagas: () => [] });
  appStore.dispatch(
    connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
  );
  appStore.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
  stopRefreshObserver = appStore.runSaga(function* () {
    yield* takeEvery(refreshRequested, function* (action) {
      yield* call(refreshed, action.payload);
    });
  });
  stop = appStore.runSaga(prWorkflowSaga);
});
afterEach(() => {
  stop();
  stopRefreshObserver();
  dispose();
});

describe('backgroundGitActionsService refresh ownership (real saga, mock transport)', () => {
  it('dispatches one broad refresh after a successful commit', async () => {
    await expect(
      backgroundGitActionsService.commit({ workspaceId: 'ws-1', commitMessage: 'Commit' }),
    ).resolves.toEqual({ success: true });
    expect(calls('git.agentCommit')).toEqual([
      ['git.agentCommit', { workspaceId: 'ws-1', message: 'Commit', userRequested: true }],
    ]);
    expect(refreshed.mock.calls).toEqual([[['ws-1', true]]]);
  });

  it('dispatches one broad refresh after creating a pull request', async () => {
    await expect(
      backgroundGitActionsService.createPR({
        workspaceId: 'ws-1',
        prTitle: 'Pull request',
        prDescription: 'Description',
      }),
    ).resolves.toEqual({ success: true, prNumber: 7, prHtmlUrl: 'https://github.test/o/r/pull/7' });
    expect(
      calls('accept-changes.execute').map(([method, params]) => [
        method,
        JSON.parse(JSON.stringify(params)),
      ]),
    ).toEqual([
      [
        'accept-changes.execute',
        {
          workspaceId: 'ws-1',
          action: 'create-pr',
          prTitle: 'Pull request',
          prBody: 'Description',
          options: {},
        },
      ],
    ]);
    expect(refreshed.mock.calls).toEqual([[['ws-1', true]]]);
  });

  it('preserves in-band commit failure and reconciles without retrying the mutation', async () => {
    handlers.set('git.agentCommit', () => {
      throw new Error('commit hook rejected');
    });
    await expect(
      backgroundGitActionsService.commit({ workspaceId: 'ws-fail', commitMessage: 'Commit' }),
    ).resolves.toEqual({ success: false, error: 'commit hook rejected' });
    expect(calls('git.agentCommit')).toHaveLength(1);
    expect(refreshed.mock.calls).toEqual([[['ws-fail', true]]]);
  });
});
