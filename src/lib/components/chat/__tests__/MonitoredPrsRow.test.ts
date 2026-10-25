/**
 * @vitest-environment jsdom
 *
 * MonitoredPrsRow rendering (PROTOCOL §6.9): inline disclosure rows for the
 * active agent's ACTIVE monitors, summary labels (repo shown as `repo #N`
 * same-owner, `owner/repo #N` cross-owner or unknown workspace repo),
 * expandable last-refresh details, and the kebab action menu (check and
 * flush / open in app / open in external browser / cancel) dispatch wiring.
 */
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  listPrMonitors,
  subscribePrMonitors,
  type PrMonitorRow,
} from '$features/pr-monitor/pr-monitor-service';
import producer from '../../../../test/fixtures/qualified-monitor-producer.json';
import producerRowsRaw from '$features/pr-monitor/__fixtures__/legacy-monitor-rows.fixture';
import type { ReviewMonitorRow, PrMonitorSession } from '$shared/types/pr-monitor';
import { runSaga } from 'redux-saga';
import {
  cancelPrMonitorWorker,
  flushPrMonitorWorker,
} from '$store/renderer/slices/pr-monitor/sagas/pr-monitor-saga';
import { resetAgentSubscriptionsViewStateForTests } from '../agent-subscriptions-view-state';

const {
  dispatchMock,
  monitorsState,
  captureSession,
  snapshotState,
  workspaceState,
  handleLinkMock,
  openLinkInAppMock,
} = vi.hoisted(() => ({
  dispatchMock: vi.fn(),
  monitorsState: {
    monitors: [] as ReviewMonitorRow[],
    listeners: new Set<(rows: ReviewMonitorRow[]) => void>(),
  },
  captureSession: vi.fn(),
  snapshotState: { status: 'ready' as 'loading' | 'stale' | 'ready' | 'failed' },
  workspaceState: {
    workspace: {
      id: 'ws-1',
      repositoryOwner: 'acme',
      repositoryName: 'widgets',
    } as unknown,
  },
  handleLinkMock: vi.fn(),
  openLinkInAppMock: vi.fn(),
}));

vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  const { select } = await import('typed-redux-saga');
  const module = createAppStoreMockModule({
    state: () => ({ theme: { name: 'dark' } }),
    dispatch: dispatchMock,
  });
  const createSelector = module.store.createSelector;
  module.store.createSelector = (fn) => {
    const selector = createSelector(fn);
    // Component mock readables plus real Redux select effects for control workers.
    selector.effect = function* (...args) {
      return yield* select(selector.select, ...args);
    };
    return selector;
  };
  return module;
});

vi.mock('$lib/client/live/backend-transport', () => ({
  capturePrMonitorSession: captureSession,
  onMonitorReconnected: () => () => {},
}));

vi.mock('$store/renderer/slices/pr-monitor/pr-monitor-selectors', async (importOriginal) => ({
  selectReviewMonitors: (
    await importOriginal<typeof import('$store/renderer/slices/pr-monitor/pr-monitor-selectors')>()
  ).selectReviewMonitors,
  selectAgentReviewMonitors: () => ({
    subscribe: (run: (value: unknown[]) => void) => {
      run(monitorsState.monitors);
      monitorsState.listeners.add(run);
      return () => monitorsState.listeners.delete(run);
    },
  }),
  selectPrMonitorsSnapshotStatus: () => ({
    subscribe: (run: (value: 'loading' | 'stale' | 'ready' | 'failed') => void) => {
      run(snapshotState.status);
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
  openLinkInApp: openLinkInAppMock,
}));

import MonitoredPrsRow from '../MonitoredPrsRow.svelte';
import {
  cancelPrMonitorRequested,
  flushPrMonitorRequested,
  prMonitorReducer,
  prMonitorsUpdated,
} from '$store/renderer/slices/pr-monitor/pr-monitor-slice';

const producerCases: Array<{ name: string; monitor: PrMonitorRow }> =
  JSON.parse(producerRowsRaw).cases;

async function openMenu() {
  await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
  const menu = await waitFor(() => screen.getByTestId('monitored-pr-menu'));
  const content = menu.closest<HTMLElement>('[data-slot="menu-content"]');
  if (!content) throw new Error('Expected the monitored PR menu to render inside menu content');
  return { menu, content };
}

function makeMonitor(overrides: Partial<PrMonitorRow> = {}): PrMonitorRow {
  return {
    monitorId: 'mon-1',
    workspaceId: 'ws-1',
    origin: { backendId: 'A', sessionId: 'current', workspaceId: 'ws-1' },
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

async function openDetails() {
  await fireEvent.click(screen.getByTestId('monitored-pr-summary'));
  return screen.getByTestId('monitored-pr-details');
}

describe('MonitoredPrsRow', () => {
  it.each(['isDraft', 'hasConflicts', 'isBehind', 'checks', 'approvals'] as const)(
    'does not turn unknown %s into ready-to-merge',
    async (fact) => {
      const row = structuredClone(producer) as ReviewMonitorRow;
      const snapshot = row.lastSnapshot!;
      snapshot.isDraft = false;
      snapshot.hasConflicts = false;
      snapshot.isBehind = false;
      snapshot.mergeable = true;
      snapshot.approvals = { decision: 'approved', have: 1, needed: 1, changesRequested: 0 };
      snapshot.availability = {
        policy: 'available',
        checks: 'available',
        approvals: 'available',
        discussions: 'available',
      };
      if (fact === 'checks') snapshot.checks.total = null;
      else if (fact === 'approvals') snapshot.approvals.have = null;
      else snapshot[fact] = null;
      monitorsState.monitors = [row];
      render(MonitoredPrsRow, { workspaceId: row.workspaceId, agentId: row.agentId });
      await openDetails();
      expect(screen.getByTestId('monitored-pr-readiness').textContent).toContain(
        'still being checked',
      );
    },
  );
  it('renders the actual backend producer without treating restricted null approvals as zero', async () => {
    monitorsState.monitors = [producer as ReviewMonitorRow];
    render(MonitoredPrsRow, { workspaceId: producer.workspaceId, agentId: producer.agentId });
    const details = await openDetails();
    expect(details.textContent).toContain('Approval status is unknown');
    expect(details.textContent).not.toContain('Ready to merge');
    await openMenu();
    await fireEvent.click(screen.getByTestId('monitored-pr-open-external-item'));
    expect(handleLinkMock).toHaveBeenCalledWith(
      producer.url,
      expect.objectContaining({ forceExternal: true }),
    );
  });
  it.each(['reconnect-required', 'restricted', 'unresolved'] as const)(
    'keeps %s recovery in the existing status slot',
    async (state) => {
      monitorsState.monitors = [
        {
          ...producer,
          monitorAvailability:
            state === 'unresolved' ? { state, reason: 'missing-provenance' } : { state },
        } as ReviewMonitorRow,
      ];
      render(MonitoredPrsRow, { workspaceId: producer.workspaceId, agentId: producer.agentId });
      const details = await openDetails();
      expect(details.textContent).not.toContain('Ready to merge');
      expect(details.textContent).not.toContain('missing-provenance');
      await openMenu();
      expect(screen.getByTestId('monitored-pr-cancel-item').getAttribute('aria-disabled')).not.toBe(
        'true',
      );
    },
  );

  it('disables both open actions for a qualified MR without a canonical URL', async () => {
    monitorsState.monitors = [
      makeMonitor({
        url: undefined,
        resource: {
          repository: {
            provider: 'gitlab',
            instanceBaseUrl: 'https://forge.example/gitlab',
            projectPath: 'acme/widgets',
          },
          kind: 'merge-request',
          number: 42,
        },
      }),
    ];
    render(MonitoredPrsRow, { workspaceId: 'ws-1', agentId: 'agent-1' });
    await openMenu();
    expect(screen.getByTestId('monitored-pr-open-in-app-item').getAttribute('aria-disabled')).toBe(
      'true',
    );
    expect(
      screen.getByTestId('monitored-pr-open-external-item').getAttribute('aria-disabled'),
    ).toBe('true');
    await fireEvent.click(screen.getByTestId('monitored-pr-open-external-item'));
    expect(handleLinkMock).not.toHaveBeenCalled();
  });

  const defaultWorkspace = workspaceState.workspace;

  afterEach(() => {
    cleanup();
    dispatchMock.mockReset();
    captureSession.mockReset();
    monitorsState.listeners.clear();
    handleLinkMock.mockClear();
    openLinkInAppMock.mockClear();
    resetAgentSubscriptionsViewStateForTests();
    workspaceState.workspace = defaultWorkspace;
    snapshotState.status = 'ready';
    monitorsState.monitors = [];
  });

  async function loadProducerMonitor(fixture: (typeof producerCases)[number]) {
    const origin = {
      backendId: 'legacy-host',
      sessionId: 'legacy-session',
      workspaceId: fixture.monitor.workspaceId,
    };
    const request = vi.fn().mockResolvedValue({
      monitors: [fixture.monitor, { ...fixture.monitor, workspaceId: 'other-workspace' }],
    });
    const release = vi.fn();
    captureSession.mockResolvedValueOnce({
      origin,
      support: 'unsupported',
      request: request as PrMonitorSession['request'],
      onNotification: () => () => {},
      onRetired: () => () => {},
      release,
    });
    monitorsState.monitors = await listPrMonitors(fixture.monitor.workspaceId);
    expect(captureSession).toHaveBeenCalledWith(fixture.monitor.workspaceId);
    expect(request).toHaveBeenCalledExactlyOnceWith('prMonitor.list', {
      workspaceId: fixture.monitor.workspaceId,
    });
    expect(release).toHaveBeenCalledOnce();
    expect(monitorsState.monitors).toEqual([{ ...fixture.monitor, origin }]);
  }

  it.each([
    ['empty', /ready to merge/],
    ['pending-build', /blocked by required checks still running/],
    ['multiple-pending', /blocked by required checks still running/],
    ['mixed-required-optional', /blocked by required checks failing/],
    ['optional-only', /blocked by required checks failing/],
    ['unknown-required', /blocked by required checks failing/],
    ['unknown-threads', /blocked by review threads that could not be read/],
    ['unknown-empty', /merge readiness is still being checked/],
    ['missing-baseline', /merge readiness is still being checked/],
  ])('renders readiness from the unmodified Rust producer row: %s', async (name, readiness) => {
    const fixture = producerCases.find((entry) => entry.name === name)!;
    expect(fixture, `missing producer case ${name}`).toBeDefined();
    await loadProducerMonitor(fixture);
    render(MonitoredPrsRow, {
      props: {
        workspaceId: fixture.monitor.workspaceId,
        agentId: fixture.monitor.agentId,
      },
    });

    const details = await openDetails();
    expect(details.firstElementChild?.textContent).toMatch(readiness);
  });

  it('renders an actual paused producer row without inventing a checklist', async () => {
    vi.useFakeTimers({ now: new Date('2026-01-02T03:30:00Z'), toFake: ['Date'] });
    try {
      const fixture = producerCases.find((entry) => entry.name === 'paused-missing-baseline')!;
      await loadProducerMonitor(fixture);
      render(MonitoredPrsRow, {
        props: {
          workspaceId: fixture.monitor.workspaceId,
          agentId: fixture.monitor.agentId,
        },
      });

      const details = await openDetails();
      expect(details.firstElementChild?.textContent).toMatch(/Monitoring paused until/);
      expect(details.textContent).not.toMatch(
        /ready to merge|checks failed|checks are still running/,
      );
      expect(
        screen
          .getByTestId('monitored-pr-summary')
          .closest('[data-monitor-paused]')
          ?.getAttribute('data-monitor-paused'),
      ).toBe('true');
    } finally {
      vi.useRealTimers();
    }
  });

  it('renders a normalized inline disclosure row per active monitor', () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const summary = screen.getByTestId('monitored-pr-summary');
    const line = summary.closest('[data-monitor-state]')?.firstElementChild;
    expect(summary.textContent).toContain('Fix widget rendering');
    // Same-owner label shows the repo name without the owner
    expect(summary.textContent).toContain('widgets #42');
    expect(summary.textContent).not.toContain('acme/');
    expect(line?.className).toContain('min-h-9');
    expect(line?.className).toContain('gap-2');
    expect(line?.className).toContain('subscription-card-row-inset');
    expect(screen.getByTestId('monitored-pr-label').className).toContain('text-muted-foreground');
    expect(screen.getByTestId('monitored-pr-chip').className).toContain('h-6');
    expect(screen.getByTestId('monitored-pr-disclosure').className).toContain('h-6');
  });

  it('renders selector data without dispatching lifecycle actions on mount', () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-summary')).toBeTruthy();
    expect(dispatchMock).not.toHaveBeenCalled();
  });

  it('starts collapsed and supports summary and chevron expand/collapse transitions', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    const summary = screen.getByTestId('monitored-pr-summary');
    const disclosure = screen.getByTestId('monitored-pr-disclosure');

    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('monitored-pr-details')).toBeNull();
    await fireEvent.click(summary);
    expect(summary.getAttribute('aria-expanded')).toBe('true');
    expect(screen.getByTestId('monitored-pr-details')).toBeTruthy();
    await fireEvent.click(disclosure);
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(screen.queryByTestId('monitored-pr-details')).toBeNull();
  });

  it('persists expanded PR details across remounts in the session', async () => {
    monitorsState.monitors = [makeMonitor()];
    const first = render(MonitoredPrsRow, {
      props: { workspaceId: 'ws-1', agentId: 'agent-1' },
    });
    await fireEvent.click(screen.getByTestId('monitored-pr-summary'));
    expect(screen.getByTestId('monitored-pr-details')).toBeTruthy();
    first.unmount();

    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    await waitFor(() =>
      expect(screen.getByTestId('monitored-pr-summary').getAttribute('aria-expanded')).toBe('true'),
    );
    expect(screen.getByTestId('monitored-pr-details')).toBeTruthy();
  });

  it('renders nothing when the agent has only completed monitors', () => {
    monitorsState.monitors = [makeMonitor({ state: 'completed' })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
    expect(screen.queryByTestId('monitored-prs-row')).toBeNull();
  });

  it('renders nothing while the initial list is still loading', () => {
    snapshotState.status = 'loading';
    monitorsState.monitors = [];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.queryByTestId('pr-monitors-snapshot-status')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('renders its own failed state when the initial list could not be read', () => {
    snapshotState.status = 'failed';
    monitorsState.monitors = [];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByRole('alert');
    expect(row.getAttribute('data-testid')).toBe('pr-monitors-snapshot-status');
    expect(row.getAttribute('data-snapshot-status')).toBe('failed');
  });

  it.each(['monitored-pr-cancel-item', 'monitored-pr-check-flush-item'])(
    'renders retained stale rows but disables %s until the list is refreshed',
    async (item) => {
      snapshotState.status = 'stale';
      monitorsState.monitors = [makeMonitor()];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      expect(screen.getByTestId('monitored-pr-summary').textContent).toContain('#42');
      await openMenu();
      const action = screen.getByTestId(item);
      expect(action.getAttribute('aria-disabled')).toBe('true');
      await fireEvent.click(action);
      expect(dispatchMock).not.toHaveBeenCalled();
      expect(
        screen.getByTestId('monitored-pr-open-external-item').getAttribute('aria-disabled'),
      ).not.toBe('true');
    },
  );

  it('renders 4+ digit PR numbers without digit grouping', () => {
    monitorsState.monitors = [
      makeMonitor({ prNumber: 1182, url: 'https://github.com/acme/widgets/pull/1182' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const summary = screen.getByTestId('monitored-pr-summary');
    expect(summary.textContent).toContain('widgets #1182');
    expect(summary.textContent).not.toContain('1,182');
  });

  it('labels a same-owner, different-repo monitor with the repo name only', () => {
    monitorsState.monitors = [
      makeMonitor({ repo: 'acme/lib', url: 'https://github.com/acme/lib/pull/42' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const summary = screen.getByTestId('monitored-pr-summary');
    expect(summary.textContent).toContain('lib #42');
    expect(summary.textContent).not.toContain('acme/');
  });

  it('labels a different-owner monitor with owner/repo', () => {
    monitorsState.monitors = [
      makeMonitor({ repo: 'other/lib', url: 'https://github.com/other/lib/pull/42' }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(
      'Monitoring PR other/lib #42: Fix widget rendering',
    );
  });

  it('labels with owner/repo when the workspace owner/repo is unknown', () => {
    workspaceState.workspace = { id: 'ws-1' } as unknown;
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    expect(screen.getByTestId('monitored-pr-summary').textContent).toContain('acme/widgets #42');
  });

  it('caps the restored disclosure summary so long labels ellipsize, not overflow', () => {
    monitorsState.monitors = [
      makeMonitor({
        repo: 'intent-hq/cloudlands-releases',
        prNumber: 1248,
        url: 'https://github.com/intent-hq/cloudlands-releases/pull/1248',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const row = screen.getByTestId('monitored-prs-row');
    const summary = screen.getByTestId('monitored-pr-summary');
    const label = summary.querySelector('.truncate') as HTMLElement;
    expect(row.className).toContain('min-w-0');
    expect(row.className).toContain('max-w-full');
    expect(summary.className).toContain('min-w-0');
    expect(summary.className).toContain('max-w-full');
    expect(summary.className).toContain('overflow-hidden');
    expect(label).toBeTruthy();
    expect(label.className).toContain('min-w-0');
    expect(label.className).toContain('flex-1');
  });

  it('inline details lead with human readiness and useful blocking facts', async () => {
    monitorsState.monitors = [
      makeMonitor({
        hasPendingChanges: true,
        pendingChanges: ['checks regressed', 'new review'],
        lastChangeAt: '2026-08-07T10:04:00Z',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(
      'Fix widget rendering',
    );
    expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    expect(card.textContent).toContain('1 of 4 checks are still running.');
    expect(card.textContent).toContain('0 of 1 required approvals received.');
    expect(card.textContent).toContain('2 unresolved threads.');
    expect(card.textContent).not.toContain('Mergeable');
    expect(card.textContent).not.toContain('REVIEW_REQUIRED');
    expect(screen.getByTestId('monitored-pr-pending').textContent).toContain(
      '2 changes pending emit',
    );
  });

  it('renders non-empty details as ordered plain sentences', async () => {
    monitorsState.monitors = [
      makeMonitor({
        hasPendingChanges: true,
        pendingChanges: ['checks regressed'],
        lastChangeAt: '2026-08-07T10:04:00Z',
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    const lines = Array.from(card.children).map((line) => line.textContent?.trim());
    expect(card.querySelector('dl, dt, dd, strong')).toBeNull();
    expect(lines.slice(0, 4)).toEqual([
      'Open, but blocked by required checks still running.',
      '1 of 4 checks are still running.',
      '0 of 1 required approvals received.',
      '2 unresolved threads.',
    ]);
    expect(lines[4]).toMatch(/^Last change at .*2026.*$/);
    expect(lines[4]).not.toMatch(/:[0-9]{2}:[0-9]{2}/);
    expect(lines[5]).toBe('1 change pending emit');
  });

  it('inline details render no pending line at all when nothing is pending', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(screen.queryByTestId('monitored-pr-pending')).toBeNull();
    expect(card.textContent).not.toContain('No changes pending');
    expect(Array.from(card.children).map((line) => line.textContent?.trim())).toEqual([
      'Open, but blocked by required checks still running.',
      '1 of 4 checks are still running.',
      '0 of 1 required approvals received.',
      '2 unresolved threads.',
    ]);

    expect(document.querySelector('[data-tooltip-trigger]')).toBeNull();
  });

  it('prefers localized blocker fragments over the raw wire merge-blocked reason', async () => {
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...makeMonitor().lastSnapshot!,
          mergeable: false,
          mergeBlockedReason: 'blocked by required checks or reviews',
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    expect(card.textContent).not.toContain('blocked by blocked by');
    expect(card.textContent).not.toContain('Not mergeable');
  });

  it('falls back to unmet merge requirements when only the wire merge-blocked reason is set', async () => {
    const base = makeMonitor().lastSnapshot!;
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...base,
          mergeBlockedReason: 'blocked by required checks or reviews',
          checks: {
            ...base.checks,
            passed: 4,
            failed: 0,
            pending: 0,
            failingRequired: 0,
            pendingRequired: 0,
          },
          approvals: { decision: 'APPROVED', have: 1, needed: 1, changesRequested: 0 },
          threads: { unresolved: 0, resolutionRequired: true },
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open, but blocked by unmet merge requirements.');
    expect(card.textContent).not.toContain('blocked by blocked by');
  });

  it('reports an absent unresolved count as unreadable when thread resolution is required', async () => {
    const base = makeMonitor().lastSnapshot!;
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...base,
          mergeable: false,
          checks: {
            ...base.checks,
            passed: 4,
            failed: 0,
            pending: 0,
            failingRequired: 0,
            pendingRequired: 0,
          },
          approvals: { decision: 'APPROVED', have: 1, needed: 1, changesRequested: 0 },
          threads: { resolutionRequired: true },
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain(
      'Open, but blocked by review threads that could not be read.',
    );
    expect(card.textContent).toContain('Review threads could not be read.');
    expect(card.textContent).not.toContain('0 unresolved');
    expect(card.textContent).not.toContain('unmet merge requirements');
  });

  it('omits the threads line when the count is absent and resolution is not required', async () => {
    const base = makeMonitor().lastSnapshot!;
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...base,
          checks: {
            ...base.checks,
            passed: 4,
            failed: 0,
            pending: 0,
            failingRequired: 0,
            pendingRequired: 0,
          },
          approvals: { decision: 'APPROVED', have: 1, needed: 1, changesRequested: 0 },
          threads: { resolutionRequired: false },
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open and ready to merge.');
    expect(card.textContent).not.toContain('thread');
  });

  it('shows queued to merge when the open snapshot is in the merge queue', async () => {
    // The default fixture carries a pending-required-checks blocker — the
    // queued status takes precedence over the blocker/unknown fallthrough.
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: { ...makeMonitor().lastSnapshot!, isInMergeQueue: true },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open; queued to merge.');
    expect(card.textContent).not.toContain('Open, but blocked by');
    expect(card.textContent).not.toContain('still being checked');
  });

  it('adds the queue position and estimate when the snapshot carries mergeQueue', async () => {
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...makeMonitor().lastSnapshot!,
          isInMergeQueue: true,
          mergeQueue: { position: 2, queueSize: 2, estimatedTimeToMerge: 2254 },
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain(
      'Open; queued to merge (#2 of 2 in queue · ~38 min to merge).',
    );
  });

  it('shows the position alone while GitHub has no estimate yet', async () => {
    monitorsState.monitors = [
      makeMonitor({
        lastSnapshot: {
          ...makeMonitor().lastSnapshot!,
          isInMergeQueue: true,
          mergeQueue: { position: 1, queueSize: 3 },
        },
      }),
    ];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open; queued to merge (#1 of 3 in queue).');
  });

  it('renders the pre-existing readiness statuses when isInMergeQueue is absent', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const card = await openDetails();
    expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    expect(card.textContent).not.toContain('queued to merge');
  });

  describe('rate-limit pause (pausedUntil)', () => {
    const NOW = new Date('2026-08-07T10:10:00Z');

    function pausedMonitor(overrides: Partial<PrMonitorRow> = {}) {
      return makeMonitor({
        lastPolledAt: new Date(NOW.getTime() - 12 * 60_000).toISOString(),
        pausedUntil: new Date(NOW.getTime() + 35 * 60_000).toISOString(),
        lastError: 'forge rate limit hit; polling paused',
        ...overrides,
      });
    }

    afterEach(() => {
      vi.useRealTimers();
    });

    it('replaces the readiness line with the paused status and marks checklist lines stale', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
      monitorsState.monitors = [pausedMonitor()];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      const card = await openDetails();
      const row = screen.getByTestId('monitored-pr-summary').closest('[data-monitor-state]');
      expect(row?.getAttribute('data-monitor-paused')).toBe('true');
      const readiness = screen.getByTestId('monitored-pr-readiness').textContent ?? '';
      expect(readiness).toMatch(
        /^Monitoring paused until .* \(GitHub rate limit\); last checked 12 minutes ago\.$/,
      );
      expect(readiness).not.toContain('blocked by');
      const lines = Array.from(card.children).map((line) => line.textContent?.trim());
      expect(lines.slice(1, 4)).toEqual([
        'As of 12 minutes ago: 1 of 4 checks are still running.',
        'As of 12 minutes ago: 0 of 1 required approvals received.',
        'As of 12 minutes ago: 2 unresolved threads.',
      ]);
    });

    it('omits the last-checked clause when the paused row has never been polled', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
      monitorsState.monitors = [pausedMonitor({ lastPolledAt: undefined })];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      const card = await openDetails();
      const readiness = screen.getByTestId('monitored-pr-readiness').textContent ?? '';
      expect(readiness).toMatch(/^Monitoring paused until .* \(GitHub rate limit\)\.$/);
      expect(readiness).not.toContain('last checked');
      expect(card.textContent).toContain('1 of 4 checks are still running.');
      expect(card.textContent).not.toContain('As of');
    });

    it('renders unchanged when pausedUntil is already in the past', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
      monitorsState.monitors = [
        pausedMonitor({ pausedUntil: new Date(NOW.getTime() - 60_000).toISOString() }),
      ];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      const card = await openDetails();
      const row = screen.getByTestId('monitored-pr-summary').closest('[data-monitor-state]');
      expect(row?.hasAttribute('data-monitor-paused')).toBe(false);
      expect(card.textContent).not.toContain('Monitoring paused');
      expect(card.textContent).not.toContain('As of');
      expect(Array.from(card.children).map((line) => line.textContent?.trim())).toEqual([
        'Open, but blocked by required checks still running.',
        '1 of 4 checks are still running.',
        '0 of 1 required approvals received.',
        '2 unresolved threads.',
      ]);
    });

    it('renders unchanged when pausedUntil is absent', async () => {
      monitorsState.monitors = [makeMonitor({ lastPolledAt: '2026-08-07T10:05:00Z' })];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      const card = await openDetails();
      expect(card.textContent).not.toContain('Monitoring paused');
      expect(card.textContent).not.toContain('As of');
      expect(card.textContent).toContain('Open, but blocked by required checks still running.');
    });

    it('stops rendering as paused once the deadline elapses without a wire update', async () => {
      vi.useFakeTimers({ now: NOW, toFake: ['Date', 'setInterval', 'clearInterval'] });
      monitorsState.monitors = [
        pausedMonitor({ pausedUntil: new Date(NOW.getTime() + 45_000).toISOString() }),
      ];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

      await openDetails();
      expect(screen.getByTestId('monitored-pr-readiness').textContent).toContain(
        'Monitoring paused',
      );
      await vi.advanceTimersByTimeAsync(60_000);
      await waitFor(() =>
        expect(screen.getByTestId('monitored-pr-readiness').textContent).toBe(
          'Open, but blocked by required checks still running.',
        ),
      );
    });
  });

  it('uses the custom kebab before the disclosure and keeps their actions isolated', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    const kebab = screen.getByTestId('monitored-pr-chip');
    const disclosure = screen.getByTestId('monitored-pr-disclosure');
    expect(kebab.querySelector('svg')?.getAttribute('data-icon')).toBeNull();
    expect(
      kebab.compareDocumentPosition(disclosure) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await fireEvent.click(kebab);
    expect(disclosure.getAttribute('aria-expanded')).toBe('false');
    await fireEvent.click(disclosure);
    expect(disclosure.getAttribute('aria-expanded')).toBe('true');
  });

  it('chip menu shows exactly the four items in order: Check and Flush, Open in App, Open in External Browser, Cancel monitor', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    await waitFor(() => screen.getByTestId('monitored-pr-check-flush-item'));
    const menu = screen.getByTestId('monitored-pr-menu');
    const items = Array.from(menu.querySelectorAll('[role="menuitem"]'));
    expect(items.map((item) => item.textContent?.trim())).toEqual([
      'Check and Flush',
      'Open in App',
      'Open in External Browser',
      'Cancel monitor',
    ]);
  });

  describe.each(['current', 'retained-live', 'retained-retired'] as const)(
    'menu origin %s',
    (scenario) => {
      it.each(
        ['github', 'gitlab'].flatMap(
          (provider) =>
            [
              ['cancel', 'monitored-pr-cancel-item', 'prMonitor.cancel', provider],
              ['check and flush', 'monitored-pr-check-flush-item', 'prMonitor.flush', provider],
            ] as const,
        ),
      )(
        'routes real %s menu controls through the captured origin (%s %s %s)',
        async (kind, item, method, provider) => {
          const a = makeMonitor({
            ...(provider === 'gitlab'
              ? {
                  resource: {
                    repository: {
                      provider: 'gitlab' as const,
                      instanceBaseUrl: 'https://forge.example/gitlab',
                      projectPath: 'acme/widgets',
                    },
                    kind: 'merge-request' as const,
                    number: 42,
                  },
                  url: 'https://forge.example/gitlab/acme/widgets/-/merge_requests/42',
                }
              : {}),
            origin: { backendId: 'A', sessionId: `A-${scenario}`, workspaceId: 'ws-1' },
          });
          const b = makeMonitor({
            title: 'Replacement host row',
            origin: { backendId: 'B', sessionId: `B-${scenario}`, workspaceId: 'ws-1' },
          });
          const session = (row: PrMonitorRow) => {
            const request = vi.fn(async (rpc: string) =>
              rpc === 'prMonitor.list'
                ? { monitors: [row] }
                : rpc === 'events.subscribe'
                  ? { subscriptionId: row.origin!.sessionId }
                  : {},
            );
            return {
              origin: row.origin!,
              support: 'unsupported' as const,
              request: request as PrMonitorSession['request'],
              onNotification: () => () => {},
              onRetired: () => () => {},
              release: async () => {},
            };
          };
          const sessionA = session(a);
          const sessionB = session(b);
          captureSession.mockResolvedValueOnce(sessionA);
          const rowsA = vi.fn();
          const leaseA = subscribePrMonitors('ws-1', rowsA);
          let leaseB: ReturnType<typeof subscribePrMonitors> | undefined;
          const pending: Promise<unknown>[] = [];
          let state = { prMonitor: prMonitorReducer(undefined, prMonitorsUpdated('ws-1', [a])) };
          dispatchMock.mockImplementation((action) => {
            if (action.type === cancelPrMonitorRequested.type)
              pending.push(
                runSaga({ getState: () => state }, cancelPrMonitorWorker, action).toPromise(),
              );
            if (action.type === flushPrMonitorRequested.type)
              pending.push(
                runSaga({ getState: () => state }, flushPrMonitorWorker, action).toPromise(),
              );
          });
          try {
            await waitFor(() => expect(rowsA).toHaveBeenCalled());
            monitorsState.monitors = [a];
            render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
            await openMenu();
            if (scenario !== 'current') {
              if (scenario === 'retained-retired') leaseA.dispose();
              captureSession.mockResolvedValueOnce(sessionB);
              const rowsB = vi.fn();
              leaseB = subscribePrMonitors('ws-1', rowsB);
              await waitFor(() => expect(rowsB).toHaveBeenCalled());
              state = {
                prMonitor: prMonitorReducer(state.prMonitor, prMonitorsUpdated('ws-1', [b])),
              };
              monitorsState.monitors = [b];
              for (const listener of monitorsState.listeners) listener([b]);
              await waitFor(() =>
                expect(screen.getByTestId('monitored-pr-summary').textContent).toContain(b.title),
              );
            }
            await fireEvent.click(screen.getByTestId(item));
            await Promise.all(pending);
            const controlsA = vi
              .mocked(sessionA.request)
              .mock.calls.filter(([rpc]) => rpc === method);
            const controlsB = vi
              .mocked(sessionB.request)
              .mock.calls.filter(([rpc]) => rpc === method);
            expect(controlsB).toEqual([]);
            expect(dispatchMock).toHaveBeenLastCalledWith(
              kind === 'cancel'
                ? cancelPrMonitorRequested('ws-1', 'mon-1', a.origin)
                : flushPrMonitorRequested('ws-1', 'mon-1', true, a.origin),
            );
            expect(controlsA).toEqual(
              scenario === 'retained-retired'
                ? []
                : [
                    [
                      method,
                      {
                        workspaceId: 'ws-1',
                        monitorId: 'mon-1',
                        ...(kind === 'cancel' ? {} : { check: true }),
                      },
                    ],
                  ],
            );
          } finally {
            leaseA.dispose();
            leaseB?.dispose();
            cleanup();
            dispatchMock.mockReset();
          }
        },
      );
    },
  );

  it.each(['monitored-pr-cancel-item', 'monitored-pr-check-flush-item'])(
    'does not recover a missing captured origin for %s',
    async (item) => {
      monitorsState.monitors = [makeMonitor({ origin: undefined })];
      render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });
      await openMenu();
      const replacement = makeMonitor({
        title: 'New host',
        origin: { backendId: 'B', sessionId: 'replacement', workspaceId: 'ws-1' },
      });
      for (const listener of monitorsState.listeners) listener([replacement]);
      await waitFor(() =>
        expect(screen.getByTestId('monitored-pr-summary').textContent).toContain('New host'),
      );
      await fireEvent.click(screen.getByTestId(item));
      expect(dispatchMock).not.toHaveBeenCalled();
    },
  );

  it('chip menu Check and Flush dispatches the flush trigger with check: true', async () => {
    monitorsState.monitors = [makeMonitor({ hasPendingChanges: true, pendingChanges: ['x'] })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const flushItem = await waitFor(() => screen.getByTestId('monitored-pr-check-flush-item'));
    await fireEvent.click(flushItem);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      flushPrMonitorRequested('ws-1', 'mon-1', true, makeMonitor().origin),
    );
  });

  it('chip menu Check and Flush stays enabled when nothing is pending', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const flushItem = await waitFor(() => screen.getByTestId('monitored-pr-check-flush-item'));
    expect(flushItem.hasAttribute('data-disabled')).toBe(false);

    await fireEvent.click(flushItem);
    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      flushPrMonitorRequested('ws-1', 'mon-1', true, makeMonitor().origin),
    );
  });

  it('chip menu Cancel monitor dispatches the cancel trigger', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const cancelItem = await waitFor(() => screen.getByTestId('monitored-pr-cancel-item'));
    await fireEvent.click(cancelItem);

    expect(dispatchMock).toHaveBeenCalledTimes(1);
    expect(dispatchMock).toHaveBeenCalledWith(
      cancelPrMonitorRequested('ws-1', 'mon-1', makeMonitor().origin),
    );
  });

  it('chip menu Open in App opens the PR URL in the embedded browser panel', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openInAppItem = await waitFor(() => screen.getByTestId('monitored-pr-open-in-app-item'));
    await fireEvent.click(openInAppItem);

    expect(openLinkInAppMock).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/acme/widgets/pull/42',
      'ws-1',
      { openInWorkspace: false, assistantLayoutId: undefined },
    );
    expect(handleLinkMock).not.toHaveBeenCalled();
  });

  it('chip menu Open in App enters the workspace from its Home preview', async () => {
    monitorsState.monitors = [makeMonitor()];
    const preview = document.createElement('div');
    preview.dataset.workspaceLinkTarget = 'ws-1';
    document.body.append(preview);
    render(MonitoredPrsRow, {
      target: preview,
      props: { workspaceId: 'ws-1', agentId: 'agent-1' },
    });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openInAppItem = await waitFor(() => screen.getByTestId('monitored-pr-open-in-app-item'));
    await fireEvent.click(openInAppItem);

    expect(openLinkInAppMock).toHaveBeenCalledExactlyOnceWith(
      'https://github.com/acme/widgets/pull/42',
      'ws-1',
      { openInWorkspace: true, assistantLayoutId: undefined },
    );
    preview.remove();
  });

  it('chip menu Open in External Browser routes the PR URL through the forceExternal link handler', async () => {
    monitorsState.monitors = [makeMonitor()];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openItem = await waitFor(() => screen.getByTestId('monitored-pr-open-external-item'));
    await fireEvent.click(openItem);

    expect(handleLinkMock).toHaveBeenCalledTimes(1);
    expect(handleLinkMock).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      expect.objectContaining({ forceExternal: true }),
    );
    expect(openLinkInAppMock).not.toHaveBeenCalled();
  });

  it('open actions fall back to the canonical GitHub URL when the monitor has no url', async () => {
    monitorsState.monitors = [makeMonitor({ url: undefined })];
    render(MonitoredPrsRow, { props: { workspaceId: 'ws-1', agentId: 'agent-1' } });

    await fireEvent.click(screen.getByTestId('monitored-pr-chip'));
    const openInAppItem = await waitFor(() => screen.getByTestId('monitored-pr-open-in-app-item'));
    await fireEvent.click(openInAppItem);

    expect(openLinkInAppMock).toHaveBeenCalledTimes(1);
    expect(openLinkInAppMock).toHaveBeenCalledWith(
      'https://github.com/acme/widgets/pull/42',
      'ws-1',
      expect.anything(),
    );
  });
});
