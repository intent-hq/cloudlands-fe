/**
 * prMonitor slice reducer + selector tests (PROTOCOL §6.9 monitored-PRs state).
 */
import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { PrMonitorRow } from '$features/pr-monitor/pr-monitor-service';
import { initialState, prMonitorReducer, prMonitorsUpdated } from './pr-monitor-slice';
import { selectPrMonitors, selectPrMonitorsSnapshotDelivered } from './pr-monitor-selectors';

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
    ...overrides,
  };
}

describe('prMonitorReducer', () => {
  it('starts with no workspaces', () => {
    const state = prMonitorReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
  });

  it('prMonitorsUpdated stores the list as a Collection keyed by monitorId', () => {
    const monitors = [makeMonitor(), makeMonitor({ monitorId: 'mon-2', state: 'completed' })];
    const state = prMonitorReducer(initialState, prMonitorsUpdated('ws-1', monitors));

    const ws = state.byWorkspaceId['ws-1'];
    expect(ws).toBeDefined();
    expect(getItems(ws.monitors)).toEqual(monitors);
    expect(ws.monitors.map['mon-2'].state).toBe('completed');
  });

  it('prMonitorsUpdated stores lastSnapshot from the prMonitor.list wire shape (§6.9)', () => {
    const lastSnapshot = {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      checks: {
        total: 4,
        passed: 3,
        failed: 0,
        pending: 1,
        failingRequired: 0,
        pendingRequired: 1,
        requiredKnown: true,
      },
      approvals: { decision: 'REVIEW_REQUIRED', have: 0, changesRequested: 0 },
      threads: { unresolved: 2 },
      rulesKnown: true,
    };
    const state = prMonitorReducer(
      initialState,
      prMonitorsUpdated('ws-1', [
        makeMonitor({
          lastSnapshot,
          title: 'Fix widget',
          url: 'https://github.com/acme/widgets/pull/42',
        }),
      ]),
    );
    const row = state.byWorkspaceId['ws-1'].monitors.map['mon-1'];
    expect(row.lastSnapshot).toEqual(lastSnapshot);
    expect(row.title).toBe('Fix widget');
  });

  it('prMonitorsUpdated replaces the previous list for the same workspace', () => {
    let state = prMonitorReducer(
      initialState,
      prMonitorsUpdated('ws-1', [makeMonitor(), makeMonitor({ monitorId: 'mon-2' })]),
    );
    state = prMonitorReducer(
      state,
      prMonitorsUpdated('ws-1', [makeMonitor({ monitorId: 'mon-2', state: 'completed' })]),
    );

    expect(getItems(state.byWorkspaceId['ws-1'].monitors)).toEqual([
      makeMonitor({ monitorId: 'mon-2', state: 'completed' }),
    ]);
  });

  it('keeps workspaces isolated', () => {
    let state = prMonitorReducer(initialState, prMonitorsUpdated('ws-1', [makeMonitor()]));
    state = prMonitorReducer(
      state,
      prMonitorsUpdated('ws-2', [makeMonitor({ monitorId: 'mon-9', workspaceId: 'ws-2' })]),
    );

    expect(getItems(state.byWorkspaceId['ws-1'].monitors)).toHaveLength(1);
    expect(getItems(state.byWorkspaceId['ws-2'].monitors)[0].monitorId).toBe('mon-9');
  });

  it("removeWorkspaceEntity clears the workspace's monitors", () => {
    let state = prMonitorReducer(initialState, prMonitorsUpdated('ws-1', [makeMonitor()]));
    state = prMonitorReducer(state, removeWorkspaceEntity('ws-1'));
    expect(state.byWorkspaceId['ws-1']).toBeUndefined();
  });
});

describe('selectPrMonitors', () => {
  function stateWith(monitors: PrMonitorRow[]) {
    return prMonitorReducer(initialState, prMonitorsUpdated('ws-1', monitors));
  }

  it('returns an empty list for unknown workspaces', () => {
    expect(selectPrMonitors.select({ prMonitor: initialState }, 'ws-1')).toEqual([]);
  });

  it('returns all monitors (active + completed) in seed order', () => {
    const active = makeMonitor();
    const completed = makeMonitor({ monitorId: 'mon-2', state: 'completed' });
    expect(selectPrMonitors.select({ prMonitor: stateWith([active, completed]) }, 'ws-1')).toEqual([
      active,
      completed,
    ]);
  });

  it('selectPrMonitorsSnapshotDelivered flips once any list (even empty) is delivered', () => {
    expect(selectPrMonitorsSnapshotDelivered.select({ prMonitor: initialState }, 'ws-1')).toBe(
      false,
    );
    expect(selectPrMonitorsSnapshotDelivered.select({ prMonitor: stateWith([]) }, 'ws-1')).toBe(
      true,
    );
  });
});
