/** Chief footer regression: real card, selectors, saga and service; fake wire only for PRs. */
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  backendSubscribe: vi.fn(),
  backendUnsubscribe: vi.fn().mockResolvedValue(undefined),
  onBackendNotification: vi.fn(() => () => {}),
  onBackendReconnected: vi.fn(() => () => {}),
}));
vi.mock('../AgentSubscriptions.svelte', async () => ({
  default: (await import('./mocks/MockAgentEventSection.svelte')).default,
}));
vi.mock('../BackgroundHooksRow.svelte', async () => ({
  default: (await import('./mocks/MockHookEventSection.svelte')).default,
}));
vi.mock('../BrowserTabsRow.svelte', async () => ({
  default: (await import('./mocks/MockBrowserTabsSection.svelte')).default,
}));

import {
  backendRequest,
  backendSubscribe,
  backendUnsubscribe,
  onBackendNotification,
} from '$lib/client/live/backend-transport';
import { store as appStore } from '$store/renderer/store';
import { prMonitorSaga } from '$store/renderer/slices/pr-monitor/sagas/pr-monitor-saga';
import { removeWorkspaceEntity } from '$store/renderer/slices/workspace/workspace-slice';
import {
  closeWorkspaceTab,
  openWorkspaceTab,
} from '$store/renderer/slices/tab-state/tab-state-slice';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';
import EventSubscriptionsCard from '../EventSubscriptionsCard.svelte';

const OTHER_WORKSPACE = 'workspace-other';
const AGENT = 'chief-thread-one';
let stopSaga: (() => void) | undefined;

function monitor(agentId = AGENT, workspaceId: string = CHIEF_WORKSPACE_ID): PrMonitorRow {
  return {
    monitorId: `monitor-${agentId}`,
    workspaceId,
    agentId,
    repo: 'acme/widgets',
    prNumber: 42,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: '2026-09-10T10:00:00Z',
    updatedAt: '2026-09-10T10:00:00Z',
    title: agentId,
  };
}

beforeAll(() => appStore.init());
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(backendRequest).mockResolvedValue({ monitors: [] });
  vi.mocked(backendSubscribe).mockImplementation(async ({ workspaceId }) => ({
    subscriptionId: `pr-sub-${workspaceId}`,
  }));
  stopSaga = appStore.runSaga(prMonitorSaga);
});
afterEach(() => {
  cleanup();
  stopSaga?.();
  for (const id of [CHIEF_WORKSPACE_ID, OTHER_WORKSPACE]) {
    appStore.dispatch(closeWorkspaceTab(id));
    appStore.dispatch(removeWorkspaceEntity(id));
  }
  resetAgentSubscriptionsViewStateForTests();
});

describe('Chief PR-monitor subscription ownership', () => {
  it.each([null, OTHER_WORKSPACE])(
    'requests Chief without changing selected tab %s and hides a confirmed empty footer',
    async (selected) => {
      let resolveList!: (value: { monitors: PrMonitorRow[] }) => void;
      const pending = new Promise<{ monitors: PrMonitorRow[] }>((resolve) => {
        resolveList = resolve;
      });
      vi.mocked(backendRequest).mockImplementation(async (_method, params) =>
        params?.workspaceId === CHIEF_WORKSPACE_ID ? pending : { monitors: [] },
      );
      if (selected) appStore.dispatch(openWorkspaceTab(selected));
      render(EventSubscriptionsCard, { workspaceId: CHIEF_WORKSPACE_ID, agentId: AGENT });
      await tick();

      expect(backendRequest).toHaveBeenCalledWith('prMonitor.list', {
        workspaceId: CHIEF_WORKSPACE_ID,
      });
      expect(backendSubscribe).toHaveBeenCalledWith({
        eventTypes: ['prMonitor:*'],
        workspaceId: CHIEF_WORKSPACE_ID,
      });
      expect(screen.getByTestId('pr-monitors-snapshot-status').dataset.snapshotStatus).toBe(
        'loading',
      );
      resolveList({ monitors: [] });
      await waitFor(() => {
        expect(screen.queryByTestId('pr-monitors-snapshot-status')).toBeNull();
        expect(screen.getByTestId('subscription-utility-area').dataset.hasSubscriptions).toBe(
          'false',
        );
      });
      expect(appStore.state.tabState.currentTabId).toBe(selected);
    },
  );

  it('preserves real errors rather than treating a failed read as an empty snapshot', async () => {
    vi.mocked(backendRequest).mockRejectedValue(new Error('list unavailable'));
    render(EventSubscriptionsCard, { workspaceId: CHIEF_WORKSPACE_ID, agentId: AGENT });
    await waitFor(() => {
      expect(screen.getByTestId('pr-monitors-snapshot-status').getAttribute('role')).toBe('alert');
      expect(screen.getByTestId('subscription-utility-area').dataset.hasSubscriptions).toBe('true');
    });
    expect(appStore.state.prMonitor.byWorkspaceId[CHIEF_WORKSPACE_ID].snapshotStatus).toBe(
      'failed',
    );
  });

  it('scopes active monitors to each Chief thread and releases the old workspace on view change', async () => {
    const secondAgent = 'chief-thread-two';
    vi.mocked(backendRequest).mockResolvedValue({ monitors: [monitor(), monitor(secondAgent)] });
    const view = render(EventSubscriptionsCard, {
      workspaceId: CHIEF_WORKSPACE_ID,
      agentId: AGENT,
    });
    await waitFor(() =>
      expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(AGENT),
    );
    expect(screen.getAllByTestId('monitored-pr-chip')).toHaveLength(1);
    await view.rerender({ workspaceId: CHIEF_WORKSPACE_ID, agentId: secondAgent });
    await waitFor(() =>
      expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(secondAgent),
    );
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    expect(backendUnsubscribe).not.toHaveBeenCalled();

    vi.mocked(backendRequest).mockResolvedValue({ monitors: [] });
    await view.rerender({ workspaceId: OTHER_WORKSPACE, agentId: AGENT });
    await waitFor(() => expect(screen.queryByTestId('monitored-pr-chip')).toBeNull());
    expect(backendUnsubscribe).toHaveBeenCalledWith(`pr-sub-${CHIEF_WORKSPACE_ID}`);
    expect(backendSubscribe).toHaveBeenLastCalledWith({
      eventTypes: ['prMonitor:*'],
      workspaceId: OTHER_WORKSPACE,
    });
    view.unmount();
    expect(backendUnsubscribe).toHaveBeenCalledWith(`pr-sub-${OTHER_WORKSPACE}`);
  });

  it('keeps one live subscription while collapsed and shares it across mounted cards', async () => {
    vi.mocked(backendRequest).mockResolvedValue({ monitors: [monitor()] });
    const first = render(EventSubscriptionsCard, {
      workspaceId: CHIEF_WORKSPACE_ID,
      agentId: AGENT,
    });
    await waitFor(() => expect(screen.getByTestId('monitored-pr-chip')).toBeTruthy());
    const second = render(EventSubscriptionsCard, {
      workspaceId: CHIEF_WORKSPACE_ID,
      agentId: 'chief-thread-two',
    });
    await tick();
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    await fireEvent.click(screen.getByTestId('event-subscriptions-summary'));
    await waitFor(() => expect(screen.getAllByTestId('event-subscriptions-body')).toHaveLength(1));
    expect(backendUnsubscribe).not.toHaveBeenCalled();
    const notification = vi.mocked(onBackendNotification).mock.calls[0][0];
    notification({
      method: 'events.event',
      params: {
        subscriptionId: `pr-sub-${CHIEF_WORKSPACE_ID}`,
        event: {
          type: 'prMonitor:cancelled',
          workspaceId: CHIEF_WORKSPACE_ID,
          data: { monitorId: monitor().monitorId },
        },
      },
    });
    await waitFor(() =>
      expect(appStore.state.prMonitor.byWorkspaceId[CHIEF_WORKSPACE_ID].monitors.ids).toEqual([]),
    );
    await fireEvent.click(screen.getByTestId('event-subscriptions-summary'));
    await waitFor(() => {
      expect(screen.queryByTestId('pr-monitors-snapshot-status')).toBeNull();
      expect(screen.queryByTestId('monitored-pr-chip')).toBeNull();
      expect(screen.queryByTestId('event-subscriptions-summary')).toBeNull();
    });
    expect(backendSubscribe).toHaveBeenCalledTimes(1);
    first.unmount();
    expect(backendUnsubscribe).not.toHaveBeenCalled();
    second.unmount();
    expect(backendUnsubscribe).toHaveBeenCalledExactlyOnceWith(`pr-sub-${CHIEF_WORKSPACE_ID}`);
  });

  it('releases an inactive Chief card and reloads its snapshot on reactivation', async () => {
    vi.mocked(backendRequest).mockResolvedValue({ monitors: [monitor()] });
    const view = render(EventSubscriptionsCard, {
      workspaceId: CHIEF_WORKSPACE_ID,
      agentId: AGENT,
      isActive: true,
    });
    await waitFor(() => expect(screen.getByTestId('monitored-pr-chip')).toBeTruthy());
    await view.rerender({ workspaceId: CHIEF_WORKSPACE_ID, agentId: AGENT, isActive: false });
    expect(backendUnsubscribe).toHaveBeenCalledExactlyOnceWith(`pr-sub-${CHIEF_WORKSPACE_ID}`);

    vi.mocked(backendRequest).mockClear().mockResolvedValue({ monitors: [] });
    await view.rerender({ workspaceId: CHIEF_WORKSPACE_ID, agentId: AGENT, isActive: true });
    await waitFor(() => expect(screen.queryByTestId('monitored-pr-chip')).toBeNull());
    expect(backendRequest).toHaveBeenLastCalledWith('prMonitor.list', {
      workspaceId: CHIEF_WORKSPACE_ID,
    });
    expect(backendSubscribe).toHaveBeenCalledTimes(2);
    expect(backendSubscribe).toHaveBeenLastCalledWith({
      eventTypes: ['prMonitor:*'],
      workspaceId: CHIEF_WORKSPACE_ID,
    });
    view.unmount();
    expect(backendUnsubscribe).toHaveBeenCalledTimes(2);
    expect(appStore.state.tabState.currentTabId).toBeNull();
  });

  it('keeps the selected-tab lease but disposes a retained inactive card after switching away', async () => {
    appStore.dispatch(openWorkspaceTab(OTHER_WORKSPACE));
    const view = render(EventSubscriptionsCard, {
      workspaceId: OTHER_WORKSPACE,
      agentId: AGENT,
      isActive: true,
    });
    await waitFor(() => expect(backendSubscribe).toHaveBeenCalledTimes(1));
    await view.rerender({ workspaceId: OTHER_WORKSPACE, agentId: AGENT, isActive: false });
    expect(backendUnsubscribe).not.toHaveBeenCalled();

    appStore.dispatch(closeWorkspaceTab(OTHER_WORKSPACE));
    await waitFor(() =>
      expect(backendUnsubscribe).toHaveBeenCalledExactlyOnceWith(`pr-sub-${OTHER_WORKSPACE}`),
    );
    view.unmount();
    expect(backendUnsubscribe).toHaveBeenCalledTimes(1);
  });

  it('does not acquire subscriptions for isolated catalog previews', async () => {
    const view = render(EventSubscriptionsCard, {
      workspaceId: CHIEF_WORKSPACE_ID,
      agentId: AGENT,
      isolatedPreview: { count: 1 },
    });
    await tick();
    view.unmount();
    expect(backendRequest).not.toHaveBeenCalled();
    expect(backendSubscribe).not.toHaveBeenCalled();
    expect(backendUnsubscribe).not.toHaveBeenCalled();
  });
});
