import { getItem } from '@themislib/themis/utils/collections/collection-utils';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from './index';
import { selectAllWorkspaceScriptEntries } from './scripts/scripts-selectors';
import { selectShouldRequestAgentLineStats } from './changes/changes-selectors';
import { selectPRStatusLastRefreshTime } from './pr-status/pr-status-selectors';
import { selectTerminalsForWorkspace } from './terminals/terminals-selectors';
import {
  selectDemandedTaskWorkspaceIds,
  selectWorkspaceTasksShouldLoad,
} from './workspace-tasks/workspace-tasks-selectors';
import {
  setScriptsData,
  setActiveScriptsData,
  removeScript,
} from '../../../../src/store/renderer/slices/scripts/scripts-slice';
import type { ScriptWithState } from '../../../../src/store/renderer/slices/scripts/scripts-types';
import {
  agentLineStatsRequestStarted,
  agentLineStatsRequestSucceeded,
  agentLineStatsRequestFailed,
  updateAgentStats,
} from '../../../../src/store/renderer/slices/changes/changes-slice';
import {
  prStatusRefreshStarted,
  prStatusRefreshCompleted,
} from '../../../../src/store/renderer/slices/pr-status/pr-status-slice';
import {
  loadWorkspaceTerminals,
  renameTerminal,
  removeTerminal,
} from '../../../../src/store/renderer/slices/terminals/terminals-slice';
import {
  acquireWorkspaceTasksDemand,
  releaseWorkspaceTasksDemand,
  workspaceTasksReadStarted,
  loadWorkspaceTasksSucceeded,
  loadWorkspaceTasksFailed,
  invalidateWorkspaceTasks,
} from '../../../../src/store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import {
  backendReconnected,
  workspaceUnmounted,
} from '../../../../src/store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';

const ws = 'workspace-one';
const other = 'workspace-two';
let dispose: () => void;
const stops: Array<() => void> = [];
beforeEach(() => {
  dispose = store.init();
});
afterEach(() => {
  for (const stop of stops.splice(0).reverse()) stop();
  dispose();
});
function script(id: string, archived = false): ScriptWithState {
  return {
    id,
    workspaceId: ws,
    name: id,
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00.000Z',
    runtime: { status: 'idle', restartCount: 0 },
    ...(archived ? { archivedAt: '2026-01-02T00:00:00.000Z' } : {}),
  };
}
const stats = { total: 12, completed: 4, inProgress: 3 };

describe('canonical lifecycle selector domains on the configured React Store', () => {
  it('reads missing-domain fallbacks without materializing workspace or request state', () => {
    const before = store.state;
    expect(selectAllWorkspaceScriptEntries.select(store.state, ws)).toEqual([]);
    expect(selectAllWorkspaceScriptEntries.select(store.state, '')).toEqual([]);
    expect(selectTerminalsForWorkspace.select(store.state, ws)).toEqual([]);
    expect(selectPRStatusLastRefreshTime.select(store.state, ws)).toBeNull();
    expect(selectShouldRequestAgentLineStats.select(store.state, 'unknown')).toBe(true);
    expect(selectShouldRequestAgentLineStats.select(store.state, 'unknown', true)).toBe(true);
    expect(selectDemandedTaskWorkspaceIds.select(store.state)).toEqual([]);
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(false);
    expect(store.state).toBe(before);
    expect(store.state.scripts.byWorkspaceId[ws]).toBeUndefined();
    expect(store.state.terminals.workspaces[ws]).toBeUndefined();
    expect(store.state.workspaceTasks.byWorkspaceId[ws]).toBeUndefined();
    expect(store.state.changes.agentLineStatsRequests.unknown).toBeUndefined();
  });

  it('keeps script history outside active membership and returns canonical updated references', () => {
    const historical = script('history', true);
    const retained = script('retained');
    const active = script('active');
    store.dispatch(setScriptsData(ws, [historical, retained]));
    store.dispatch(setActiveScriptsData(ws, [active]));
    const rows = selectAllWorkspaceScriptEntries.select(store.state, ws);
    expect(rows.map((row) => row.id)).toEqual(['history', 'retained', 'active']);
    expect(rows[0]).toBe(store.state.scripts.byWorkspaceId[ws].scripts.history);
    expect(rows[1]).toBe(store.state.scripts.byWorkspaceId[ws].scripts.retained);
    expect(rows[2]).toBe(store.state.scripts.byWorkspaceId[ws].scripts.active);
    const replacement = { ...active, name: 'Updated' };
    store.dispatch(setActiveScriptsData(ws, [replacement]));
    const updated = selectAllWorkspaceScriptEntries.select(store.state, ws);
    expect(updated[2].name).toBe('Updated');
    expect(updated[2]).toBe(store.state.scripts.byWorkspaceId[ws].scripts.active);
    expect(updated[0]).toBe(rows[0]);
    store.dispatch(removeScript(ws, 'history'));
    expect(selectAllWorkspaceScriptEntries.select(store.state, ws).map((row) => row.id)).toEqual([
      'retained',
      'active',
    ]);
    expect(selectAllWorkspaceScriptEntries.select(store.state, other)).toEqual([]);
  });

  it('refuses in-flight line stats even when forced and retries failed uncached requests independently', () => {
    store.dispatch(agentLineStatsRequestStarted('a', '2026-01-01T00:00:00.000Z'));
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a')).toBe(false);
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a', true)).toBe(false);
    expect(selectShouldRequestAgentLineStats.select(store.state, 'b')).toBe(true);
    store.dispatch(agentLineStatsRequestFailed('a', 'offline', '2026-01-01T00:00:01.000Z'));
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a')).toBe(true);
    store.dispatch(agentLineStatsRequestStarted('a', '2026-01-01T00:00:02.000Z'));
    store.dispatch(
      updateAgentStats('a', { additions: 0, deletions: 0, timestamp: '2026-01-01T00:00:02.000Z' }),
    );
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a', true)).toBe(false);
    store.dispatch(agentLineStatsRequestSucceeded('a', '2026-01-01T00:00:03.000Z'));
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a')).toBe(false);
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a', false)).toBe(false);
    expect(selectShouldRequestAgentLineStats.select(store.state, 'a', true)).toBe(true);
  });

  it('retains the last successful PR refresh through failures and clears it on reconnect', () => {
    store.dispatch(prStatusRefreshStarted(ws));
    store.dispatch(prStatusRefreshCompleted(ws, true));
    const refreshed = selectPRStatusLastRefreshTime.select(store.state, ws);
    expect(refreshed).toBeTypeOf('number');
    store.dispatch(prStatusRefreshStarted(ws));
    store.dispatch(prStatusRefreshCompleted(ws, false, 'offline'));
    expect(selectPRStatusLastRefreshTime.select(store.state, ws)).toBe(refreshed);
    expect(selectPRStatusLastRefreshTime.select(store.state, other)).toBeNull();
    store.dispatch(backendReconnected());
    expect(selectPRStatusLastRefreshTime.select(store.state, ws)).toBeNull();
  });

  it('preserves terminal collection order and references through updates and same-boot reconciliation', () => {
    store.dispatch(
      loadWorkspaceTerminals(
        ws,
        [
          { id: 'b', name: 'Build' },
          { id: 'a', name: 'Shell' },
        ],
        undefined,
        'boot-one',
      ),
    );
    const rows = selectTerminalsForWorkspace.select(store.state, ws);
    expect(rows.map((row) => row.id)).toEqual(['b', 'a']);
    expect(rows[0]).toBe(getItem(store.state.terminals.workspaces[ws].terminals, 'b'));
    expect(rows[1]).toBe(getItem(store.state.terminals.workspaces[ws].terminals, 'a'));
    store.dispatch(renameTerminal(ws, 'b', '  Renamed  '));
    const renamed = selectTerminalsForWorkspace.select(store.state, ws);
    expect(renamed[0].customName).toBe('Renamed');
    expect(renamed[0]).toBe(getItem(store.state.terminals.workspaces[ws].terminals, 'b'));
    expect(renamed[1]).toBe(rows[1]);
    store.dispatch(removeTerminal(ws, 'a'));
    expect(selectTerminalsForWorkspace.select(store.state, ws).map((row) => row.id)).toEqual(['b']);
    store.dispatch(loadWorkspaceTerminals(ws, [], undefined, 'boot-two'));
    expect(selectTerminalsForWorkspace.select(store.state, ws).map((row) => row.id)).toEqual(['b']);
    store.dispatch(loadWorkspaceTerminals(ws, [], undefined, 'boot-two'));
    expect(selectTerminalsForWorkspace.select(store.state, ws)).toEqual([]);
    expect(selectTerminalsForWorkspace.select(store.state, other)).toEqual([]);
  });

  it('admits demanded task reads in workspace insertion order and releases consumers independently', () => {
    store.dispatch(acquireWorkspaceTasksDemand(other, 'other-view'));
    store.dispatch(acquireWorkspaceTasksDemand(ws, 'first-view'));
    store.dispatch(acquireWorkspaceTasksDemand(ws, 'second-view'));
    store.dispatch(acquireWorkspaceTasksDemand(ws, 'first-view'));
    expect(selectDemandedTaskWorkspaceIds.select(store.state)).toEqual([other, ws]);
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(true);
    store.dispatch(workspaceTasksReadStarted(ws));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(false);
    store.dispatch(loadWorkspaceTasksSucceeded(ws, [], stats));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(false);
    store.dispatch(invalidateWorkspaceTasks(ws));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(true);
    store.dispatch(releaseWorkspaceTasksDemand(ws, 'first-view'));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(true);
    store.dispatch(releaseWorkspaceTasksDemand(ws, 'second-view'));
    expect(selectDemandedTaskWorkspaceIds.select(store.state)).toEqual([other]);
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(false);
    store.dispatch(workspaceUnmounted(other));
    expect(selectDemandedTaskWorkspaceIds.select(store.state)).toEqual([]);
  });

  it('keeps invalidated in-flight task results stale and rechecks demand after failure or unmount', () => {
    store.dispatch(acquireWorkspaceTasksDemand(ws, 'view'));
    store.dispatch(workspaceTasksReadStarted(ws));
    store.dispatch(invalidateWorkspaceTasks(ws));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(false);
    store.dispatch(loadWorkspaceTasksSucceeded(ws, [], stats));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(true);
    store.dispatch(workspaceTasksReadStarted(ws));
    store.dispatch(loadWorkspaceTasksFailed(ws, 'offline'));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(true);
    store.dispatch(workspaceTasksReadStarted(ws));
    store.dispatch(workspaceUnmounted(ws));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(false);
    store.dispatch(acquireWorkspaceTasksDemand(ws, 'remounted'));
    expect(selectWorkspaceTasksShouldLoad.select(store.state, ws)).toBe(true);
  });

  it('reads all six production effects on the configured Store sole saga middleware', async () => {
    store.dispatch(setScriptsData(ws, [script('retained', true)]));
    store.dispatch(loadWorkspaceTerminals(ws, [{ id: 'terminal', name: 'Shell' }]));
    store.dispatch(
      updateAgentStats('agent', {
        additions: 2,
        deletions: 1,
        timestamp: '2026-01-01T00:00:00.000Z',
      }),
    );
    store.dispatch(prStatusRefreshCompleted(ws, true));
    store.dispatch(acquireWorkspaceTasksDemand(ws, 'view'));
    const refresh = selectPRStatusLastRefreshTime.select(store.state, ws);
    const result = await new Promise((resolve, reject) => {
      stops.push(
        store.runSaga(function* readLifecycleSelectors() {
          try {
            resolve({
              scripts: yield* selectAllWorkspaceScriptEntries.effect(ws),
              shouldRequest: yield* selectShouldRequestAgentLineStats.effect('agent'),
              forced: yield* selectShouldRequestAgentLineStats.effect('agent', true),
              lastRefresh: yield* selectPRStatusLastRefreshTime.effect(ws),
              terminals: yield* selectTerminalsForWorkspace.effect(ws),
              demanded: yield* selectDemandedTaskWorkspaceIds.effect(),
              shouldLoad: yield* selectWorkspaceTasksShouldLoad.effect(ws),
            });
          } catch (error) {
            reject(error);
          }
        }),
      );
    });
    expect(result).toEqual({
      scripts: [store.state.scripts.byWorkspaceId[ws].scripts.retained],
      shouldRequest: false,
      forced: true,
      lastRefresh: refresh,
      terminals: [getItem(store.state.terminals.workspaces[ws].terminals, 'terminal')],
      demanded: [ws],
      shouldLoad: true,
    });
  });
});

import { selectPRStatusRefreshMetadata } from './pr-status/pr-status-selectors';
import { selectAdmittedWorkspaceReadContext } from './workspace-lifecycle/workspace-lifecycle-selectors';
import { prStatusScopedRefreshSucceeded } from '../../../../src/store/renderer/slices/pr-status/pr-status-slice';
it('reads the canonical atomic metadata row without materializing an admission for a missing principal', () => {
  expect(selectAdmittedWorkspaceReadContext.select(store.state, ws)).toBeNull();
  const before = store.state;
  expect(selectPRStatusRefreshMetadata.select(store.state, ws)).toEqual({
    lastRefreshTime: null,
    isRefreshing: false,
    lastError: null,
  });
  expect(store.state).toBe(before);
  const action = prStatusScopedRefreshSucceeded(ws, {
    principalContext: 'admitted',
    physicalOwnerId: 'physical',
  });
  store.dispatch(action);
  expect(selectPRStatusRefreshMetadata.select(store.state, ws)).toBe(
    store.state.prStatus.byWorkspaceId[ws],
  );
  expect(selectPRStatusLastRefreshTime.select(store.state, ws)).toBe(action.payload.timestamp);
  store.dispatch(prStatusRefreshCompleted(ws, true));
  expect(selectPRStatusRefreshMetadata.select(store.state, ws).refreshProvenance).toBeUndefined();
});
