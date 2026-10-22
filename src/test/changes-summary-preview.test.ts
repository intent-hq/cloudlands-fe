import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { backendRequest } from '$lib/client/live/backend-transport';
import { startRootStoreLifecycle } from '$store/renderer/root-store-lifecycle';
import { store } from '$store/renderer/store';
import { prWorkflowRequested } from '$store/renderer/slices/pr-workflow/pr-workflow-slice';
import { selectGitOperationFlags } from '$store/renderer/slices/git/git-selectors';
import { setupChangesSummaryPreview } from './changes-summary-preview';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(() => {
    throw new Error('Preview attempted a live daemon request');
  }),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));

let disposeRoot: () => void;
let disposePreview: (() => void) | undefined;
const workspaceId = 'changes-summary-preview';
const refreshing = () =>
  selectGitOperationFlags.select(store.state, workspaceId).isRefreshingGitStatus;

beforeEach(() => {
  vi.useFakeTimers();
  vi.clearAllMocks();
  disposeRoot = startRootStoreLifecycle(store, { startSagas: () => [] });
});

afterEach(() => {
  disposePreview?.();
  disposePreview = undefined;
  disposeRoot();
  vi.useRealTimers();
});

describe('changes summary preview owner lifecycle', () => {
  it('routes refresh through the production owner without reaching a daemon', async () => {
    disposePreview = setupChangesSummaryPreview(workspaceId, 'feature/preview');
    const request = prWorkflowRequested(workspaceId, { kind: 'refresh' });
    store.dispatch(request);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshing()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(request.promise).resolves.toEqual({ success: true });
    expect(refreshing()).toBe(false);
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('cancels pending feedback on disposal and starts a fresh owner on remount', async () => {
    disposePreview = setupChangesSummaryPreview(workspaceId, 'feature/preview');
    const pending = prWorkflowRequested(workspaceId, { kind: 'refresh' });
    store.dispatch(pending);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshing()).toBe(true);
    disposePreview();
    disposePreview = undefined;
    await expect(pending.promise).resolves.toMatchObject({ success: false });
    expect(refreshing()).toBe(false);

    store.dispatch(prWorkflowRequested(workspaceId, { kind: 'refresh' }));
    await vi.advanceTimersByTimeAsync(1000);
    expect(refreshing()).toBe(false);

    disposePreview = setupChangesSummaryPreview(workspaceId, 'feature/remounted');
    const remounted = prWorkflowRequested(workspaceId, { kind: 'refresh' });
    store.dispatch(remounted);
    await vi.advanceTimersByTimeAsync(0);
    expect(refreshing()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(remounted.promise).resolves.toEqual({ success: true });
    expect(refreshing()).toBe(false);
    expect(backendRequest).not.toHaveBeenCalled();
  });
});
