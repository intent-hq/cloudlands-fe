/**
 * @vitest-environment jsdom
 *
 * MonitoredPrsRow rendering (PROTOCOL §6.9): "Monitored PRs:" chip row for
 * the active agent's ACTIVE monitors, cross-repo label prefixing, hover-card
 * last-refresh details, and the click action menu (flush / open / cancel)
 * dispatch wiring.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';

const { dispatchMock, monitorsState, workspaceState, handleLinkMock } = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  monitorsState: { monitors: [] as unknown[] },
  workspaceState: {
    workspace: {
      id: 'ws-1',
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
    } as unknown,
  },
  handleLinkMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
    dispatch: dispatchMock,
  });
});

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', () => ({
  selectAgentPrMonitors: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      run(monitorsState.monitors);
      return () => {};
    },
  }),
}));

vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: () => ({
    subscribe: (run: (value: unknown) => void) => {
      run(workspaceState.workspace);
      return () => {};
    },
  }),
}));

vi.mock('$features/navigation/link-handler', () => ({
  handleLink: handleLinkMock,
}));

import MonitoredPrsRow from '../MonitoredPrsRow.svelte';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
} from '$store/renderer/slices/pr-monitor/pr-monitor-slice';

function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: 'mon-1',
    workspaceId: 'ws-1',
    agentId: 'agent-1',
    repo: 'acme/widgets',
    prNumber: 42,
    state: 'active',
    pendingChanges: [],
    hasPendingChanges: false,
    createdAt: '2026-08-07T10:00:00Z',
    updatedAt: '2026-08-07T10:05:00Z',
    title: 'Fix widget rendering',
    url: 'https://github.com/acme/widgets/pull/42',
    lastSnapshot: {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      mergeable: true,
      checks: {
        total: 4,
        passed: 3,
        failed: 0,
        pending: 1,
        failingRequired: 0,
        pendingRequired: 1,
        requiredKnown: true,
      },
      approvals: { decision: 'REVIEW_REQUIRED', have: 0, needed: 1, changesRequested: 0 },
      threads: { unresolved: 2, resolutionRequired: true },
      rulesKnown: true,
    },
    ...overrides,
  };
}

describe('MonitoredPrsRow', () => {
  afterEach(() => {
    cleanup();
    dispatchMock.mockClear();
    handleLinkMock.mockClear();
  });

  it('renders the "Monitored PRs:" label and a chip per active monitor', () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-prs-row')).toBeTruthy();
    expect(screen.getByText('Monitored PRs:')).toBeTruthy();
    const chip = screen.getByTestId('monitored-pr-chip');
    expect(chip.textContent).toContain('#42');
    // Same-repo chip carries no org/repo prefix
    expect(chip.textContent).not.toContain('acme/widgets');
  });

  it('renders selector data without dispatching lifecycle actions on mount', () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-chip')).toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('renders nothing when the agent has only completed monitors', () => {
    monitorsState.monitors = [makeMonitor({ state: 'completed' })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    expect(screen.queryByTestId('monitored-prs-row')).toBeNull();
  });

  it('prefixes the chip label with org/repo only for cross-repo monitors', () => {
    monitorsState.monitors = [
      makeMonitor({ repo: 'other/lib', url: 'https://github.com/other/lib/pull/42' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const chip = screen.getByTestId('monitored-pr-chip');
    expect(chip.textContent).toContain('other/lib: #42');
  });

  it('hover card shows title, state, checks/reviews/threads, mergeable, and pending status', async () => {
    monitorsState.monitors = [
      makeMonitor({
        hasPendingChanges: true,
        pendingChanges: ['checks regressed', 'new review'],
        lastChangeAt: '2026-08-07T10:04:00Z',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    expect(trigger).toBeTruthy();
    // bits-ui opens the tooltip on trigger focus (no hover delay)
    await fireEvent.focus(trigger);

    const card = await waitFor(() => screen.getByTestId('monitored-pr-hover-card'));
    expect(card.textContent).toContain('Fix widget rendering');
    expect(card.textContent).toContain('open');
    expect(card.textContent).toContain('checks: 1/4 running');
    expect(card.textContent).toContain('REVIEW_REQUIRED');
    expect(card.textContent).toContain('2 unresolved threads');
    expect(card.textContent).toContain('Mergeable');
    expect(screen.getByTestId('monitored-pr-pending').textContent).toContain(
      '2 changes pending emit',
    );
  });

  it('hover card content renders whitespace-normal, not the tooltip base whitespace-pre-wrap', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    await waitFor(() => screen.getByTestId('monitored-pr-hover-card'));
    const tooltipContent = document.querySelector('[data-tooltip-content]') as HTMLElement;
    expect(tooltipContent).toBeTruthy();
    // Regression (intent-hq/monorepo#1913): the Tooltip base class
    // whitespace-pre-wrap made the markup's literal whitespace render as a
    // leading space before "No changes pending" and extra vertical gaps.
    // The hover card must override it with whitespace-normal.
    expect(tooltipContent.className).toContain('whitespace-normal');
    expect(tooltipContent.className).not.toContain('whitespace-pre-wrap');
  });

  it('hover card prefers the merge-blocked reason over the mergeable line', async () => {
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...makeMonitor().lastSnapshot!,
          mergeable: false,
          mergeBlockedReason: 'required checks failing',
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const trigger = document.querySelector('[data-tooltip-trigger]') as HTMLElement;
    await fireEvent.focus(trigger);

    const card = await waitFor(() => screen.getByTestId('monitored-pr-hover-card'));
    expect(card.textContent).toContain('Merge blocked: required checks failing');
    expect(card.textContent).not.toContain('Not mergeable');
  });

  it('chip menu Flush now dispatches the flush trigger', async () => {
    monitorsState.monitors = [makeMonitor({ hasPendingChanges: true, pendingChanges: ['x'] })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const flushItem = await waitFor(() => screen.getByTestId('monitored-pr-flush-item'));
    await fireEvent.click(flushItem);

    expect(dispatchMock).toHaveBeenCalledWith(flushPrMonitorRequested('ws-1', 'mon-1'));
  });

  it('chip menu disables Flush now when nothing is pending', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const flushItem = await waitFor(() => screen.getByTestId('monitored-pr-flush-item'));
    expect((flushItem as HTMLButtonElement).disabled).toBe(true);
  });

  it('chip menu Cancel monitor dispatches the cancel trigger', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const cancelItem = await waitFor(() => screen.getByTestId('monitored-pr-cancel-item'));
    await fireEvent.click(cancelItem);

    expect(dispatchMock).toHaveBeenCalledWith(cancelPrMonitorRequested('ws-1', 'mon-1'));
  });

  it('chip menu Open PR routes the PR URL through the external link handler', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openItem = await waitFor(() => screen.getByTestId('monitored-pr-open-item'));
    await fireEvent.click(openItem);

    expect(handleLinkMock).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      expect.objectContaining({ forceExternal: true }),
    );
  });
});
