/** Rendered PR intent through the production workflow owner and mocked daemon. */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { backendRequest } from '$lib/client/live/backend-transport';
import { store } from '$store/renderer/store';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { prWorkflowSaga } from '$store/renderer/slices/pr-workflow/sagas/pr-workflow-saga';
import { prCreatorRequested } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
import { connectionsListReceived } from '$store/renderer/slices/connections/connections-slice';
import { guestSessionsListReceived } from '$store/renderer/slices/guest-sessions/guest-sessions-slice';
import { setWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import { setPRContent } from '$store/renderer/slices/changes/changes-slice';
import { selectAcceptChangesState } from '$store/renderer/slices/changes/changes-selectors';
import { WorkspaceId } from '$shared/types/branded-ids';
import { PullRequestStatus, type Workspace } from '$shared/types';
import { warmImport } from '../../../../test/warm-import';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn(), warning: vi.fn(), info: vi.fn() },
}));

vi.mock('svelte-fa', async () => {
  const MockFa = (await import('../sidebar/__tests__/mocks/Fa.svelte')).default;
  return { default: MockFa };
});

async function renderCreator() {
  const PullRequestCreator = (await import('../PullRequestCreator.svelte')).default;
  const onCreated = vi.fn();
  const onClose = vi.fn();
  const result = render(PullRequestCreator, {
    props: { workspaceId: 'pr-creator', onClose, onCreated },
  });
  return { ...result, onCreated, onClose };
}

function findButton(container: HTMLElement, label: string) {
  return Array.from(container.querySelectorAll('button')).find(
    (b) => b.textContent?.trim() === label,
  ) as HTMLButtonElement | undefined;
}

// Pre-warm the component module graph so the cold dynamic import is not
// billed to the first test's timeout (intent-hq/monorepo#1464).
warmImport(() => import('../sidebar/__tests__/mocks/Fa.svelte'));
warmImport(() => import('../PullRequestCreator.svelte'));

describe('PullRequestCreator', () => {
  const workspace = {
    id: WorkspaceId('pr-creator'),
    title: 'My Workspace',
    branch: 'feat/x',
    baseRef: 'main',
    myRole: 'owner',
  } as Workspace;
  const pr = {
    id: '7',
    number: 7,
    url: 'https://github.test/o/r/pull/7',
    title: 'Suggested title',
    status: PullRequestStatus.Open,
    createdAt: '2026-09-29T00:00:00Z',
    updatedAt: '2026-09-29T00:00:00Z',
  };
  let dispose: () => void;
  let stop: () => void;
  let executeResult: Record<string, unknown>;
  beforeEach(() => {
    vi.clearAllMocks();
    executeResult = {
      success: true,
      steps: [{ id: 'create-pr', name: 'Create PR', status: 'completed' }],
      result: { prNumber: 7, prHtmlUrl: pr.url },
    };
    vi.mocked(backendRequest).mockImplementation(async (method) => {
      if (method === 'accept-changes.prepare')
        return {
          valid: true,
          warnings: [],
          errors: [],
          suggestedPRTitle: 'Suggested title',
          suggestedPRBody: 'Suggested body',
          filesCount: 1,
          additions: 1,
          deletions: 0,
          files: [],
        };
      if (method === 'accept-changes.execute') return executeResult;
      if (method === 'workspace.get')
        return { workspace: { ...workspace, activePullRequest: pr, prNumber: 7 } };
      throw new Error(`Unexpected RPC ${method}`);
    });
    dispose = startRootStoreLifecycle(store, { startSagas: () => [] });
    stop = store.runSaga(prWorkflowSaga);
    store.dispatch(
      connectionsListReceived({ connections: [], activeId: 'local', windowBackendId: 'local' }),
    );
    store.dispatch(guestSessionsListReceived({ sessions: [], openIds: [], connectedIds: [] }));
    store.dispatch(setWorkspaceEntity(workspace));
  });
  afterEach(() => {
    cleanup();
    stop();
    dispose();
    vi.restoreAllMocks();
  });

  it('auto-fills and creates through the workflow, then calls back with the authoritative workspace PR', async () => {
    const { container, onCreated, onClose } = await renderCreator();
    await fireEvent.click(findButton(container, 'Auto-fill & Create')!);
    const completionWait = { timeout: 4000 };
    await waitFor(() => expect(onCreated).toHaveBeenCalledWith(pr), completionWait);
    expect(onClose).toHaveBeenCalledOnce();
    expect(backendRequest).toHaveBeenCalledWith('accept-changes.prepare', {
      workspaceId: 'pr-creator',
      action: 'create-pr',
    });
    expect(backendRequest).toHaveBeenCalledWith('accept-changes.execute', {
      workspaceId: 'pr-creator',
      action: 'create-pr',
      files: undefined,
      commitMessage: undefined,
      prTitle: 'Suggested title',
      prBody: 'Suggested body',
      targetBranch: 'main',
      mergeStrategy: undefined,
      upToCommitHash: undefined,
      undoCommitsMetadata: undefined,
      options: {
        stageUnstaged: undefined,
        pushAfterCommit: undefined,
        createPRAfterPush: undefined,
        rebaseFirst: undefined,
        localOnly: undefined,
      },
    });
  });

  it('surfaces the real daemon error when execute reports an in-band failure', async () => {
    executeResult = {
      success: false,
      steps: [{ id: 'create-pr', name: 'Create PR', status: 'failed', error: 'boom' }],
      error: 'GitHub authentication required',
    };
    const { container, onCreated, onClose } = await renderCreator();
    await fireEvent.click(findButton(container, 'Auto-fill & Create')!);
    await waitFor(() => {
      expect(container.textContent).toContain('GitHub authentication required');
    });
    expect(onCreated).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
    expect(selectAcceptChangesState.select(store.state, 'pr-creator').prTitle).toBe(
      'Suggested title',
    );
  });

  it('keeps edited drafts through remount and suppresses callbacks after unmount', async () => {
    store.dispatch(setPRContent('pr-creator', 'Existing title', 'Existing body'));
    const first = await renderCreator();
    const input = first.container.querySelector('input') as HTMLInputElement;
    await fireEvent.input(input, { target: { value: 'Edited title' } });
    await waitFor(() =>
      expect(selectAcceptChangesState.select(store.state, 'pr-creator').prTitle).toBe(
        'Edited title',
      ),
    );
    first.unmount();
    const second = await renderCreator();
    expect((second.container.querySelector('input') as HTMLInputElement).value).toBe(
      'Edited title',
    );
    const dispatch = vi.spyOn(store, 'dispatch');
    await fireEvent.click(findButton(second.container, 'Create')!);
    await waitFor(() =>
      expect(
        vi
          .mocked(backendRequest)
          .mock.calls.some(([method]) => method === 'accept-changes.execute'),
      ).toBe(true),
    );
    second.unmount();
    const request = dispatch.mock.calls
      .map(([action]) => action)
      .find((action) => action.type === prCreatorRequested.type) as ReturnType<
      typeof prCreatorRequested
    >;
    await request.promise;
    expect(second.onCreated).not.toHaveBeenCalled();
    expect(second.onClose).not.toHaveBeenCalled();
  });
});
