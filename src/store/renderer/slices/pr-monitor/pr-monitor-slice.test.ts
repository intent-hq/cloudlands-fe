/**
 * prMonitor slice reducer + selector tests (PROTOCOL §6.9 monitored-PRs state).
 */
import { describe, expect, it } from 'vitest';
import { getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import type { PrMonitorRow, PrMonitorSnapshot } from '$features/pr-monitor/pr-monitor-service';
import { initialState, prMonitorReducer, prMonitorsUpdated } from './pr-monitor-slice';
import { selectDisplayPrMonitors } from './pr-monitor-selectors';

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

describe('selectDisplayPrMonitors', () => {
  function makeSnapshot(overrides: Partial<PrMonitorSnapshot> = {}): PrMonitorSnapshot {
    return {
      state: 'open',
      isDraft: false,
      hasConflicts: false,
      isBehind: false,
      checks: {
        total: 0,
        passed: 0,
        failed: 0,
        pending: 0,
        failingRequired: 0,
        pendingRequired: 0,
        requiredKnown: false,
      },
      approvals: { decision: '', have: 0, changesRequested: 0 },
      threads: { unresolved: 0 },
      rulesKnown: false,
      ...overrides,
    };
  }

  function stateWith(monitors: PrMonitorRow[]) {
    return prMonitorReducer(initialState, prMonitorsUpdated('ws-1', monitors));
  }

  function select(monitors: PrMonitorRow[]): PrMonitorRow[] {
    return selectDisplayPrMonitors.select({ prMonitor: stateWith(monitors) }, 'ws-1');
  }

  it('returns an empty list for unknown workspaces', () => {
    expect(selectDisplayPrMonitors.select({ prMonitor: initialState }, 'ws-1')).toEqual([]);
  });

  it('returns only active monitors when any exist', () => {
    const active = makeMonitor();
    const mergedCompleted = makeMonitor({
      monitorId: 'mon-2',
      state: 'completed',
      lastSnapshot: makeSnapshot({ state: 'merged' }),
    });
    expect(select([active, mergedCompleted])).toEqual([active]);
  });

  it('falls back to merged completed monitors when there are no active ones', () => {
    const merged = makeMonitor({
      monitorId: 'mon-2',
      state: 'completed',
      lastSnapshot: makeSnapshot({ state: 'merged' }),
    });
    const closed = makeMonitor({
      monitorId: 'mon-3',
      state: 'completed',
      lastSnapshot: makeSnapshot({ state: 'closed' }),
    });
    const noVerdict = makeMonitor({ monitorId: 'mon-4', state: 'completed' });
    expect(select([closed, merged, noVerdict])).toEqual([merged]);
  });

  it('matches the merged snapshot state case-insensitively', () => {
    const merged = makeMonitor({
      state: 'completed',
      lastSnapshot: makeSnapshot({ state: 'Merged' }),
    });
    expect(select([merged])).toEqual([merged]);
  });

  it('sorts merged completed monitors updatedAt desc so index 0 is the last merged PR', () => {
    const older = makeMonitor({
      monitorId: 'mon-old',
      prNumber: 7,
      state: 'completed',
      updatedAt: '2026-08-07T10:00:00Z',
      lastSnapshot: makeSnapshot({ state: 'merged' }),
    });
    const newer = makeMonitor({
      monitorId: 'mon-new',
      prNumber: 42,
      state: 'completed',
      updatedAt: '2026-08-08T10:00:00Z',
      lastSnapshot: makeSnapshot({ state: 'merged' }),
    });
    expect(select([older, newer]).map((m) => m.monitorId)).toEqual(['mon-new', 'mon-old']);
  });

  it('returns an empty list when completions all ended closed', () => {
    const closed = makeMonitor({
      state: 'completed',
      lastSnapshot: makeSnapshot({ state: 'closed' }),
    });
    expect(select([closed])).toEqual([]);
  });
});
