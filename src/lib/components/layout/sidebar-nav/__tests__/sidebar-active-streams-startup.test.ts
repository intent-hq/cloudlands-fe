import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import { store as appStore } from '$store/renderer/store';
import { resetWorkspaceState } from '$store/renderer/slices/workspace/workspace-slice';
import AllWorkspacesCardHarness from './mocks/AllWorkspacesCardHarness.svelte';
import ActiveWorkspacesCardHarness from './mocks/ActiveWorkspacesCardHarness.svelte';

const tracker = vi.hoisted(() => {
  const fetchActiveStreams = vi.fn();
  return {
    fetchActiveStreams,
    startPolling: vi.fn(() => fetchActiveStreams()),
    subscribe: vi.fn(() => () => {}),
  };
});

vi.mock('$features/agent/services/active-streams-tracker', () => ({
  activeStreamsTracker: {
    ...tracker,
    getStreamingAgentIdsForWorkspace: vi.fn(() => []),
  },
}));

describe('sidebar active-stream startup', () => {
  beforeEach(() => {
    appStore.init();
    appStore.dispatch(resetWorkspaceState());
    vi.clearAllMocks();
  });

  afterEach(cleanup);

  it('starts one initial refresh from AllWorkspacesCard', () => {
    render(AllWorkspacesCardHarness);

    expect(tracker.startPolling).toHaveBeenCalledOnce();
    expect(tracker.fetchActiveStreams).toHaveBeenCalledOnce();
  });

  it('starts one initial refresh from ActiveWorkspacesCard', () => {
    render(ActiveWorkspacesCardHarness);

    expect(tracker.startPolling).toHaveBeenCalledOnce();
    expect(tracker.fetchActiveStreams).toHaveBeenCalledOnce();
  });
});
