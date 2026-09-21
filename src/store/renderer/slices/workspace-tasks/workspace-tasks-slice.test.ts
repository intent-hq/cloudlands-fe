import { describe, expect, it } from 'vitest';
import type { Workspace, WorkspaceId, WorkspaceTask, WorkspaceTaskStats } from '$shared/types';
import { WorkspaceStatusEnum } from '$shared/types';
import { getItem, getItems } from '@augmentcode/themis/utils/collections/collection-utils';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import {
  removeWorkspaceEntity,
  replaceWorkspaceList,
  setWorkspaceEntity,
} from '../workspace/workspace-slice';
import {
  applyTaskStatusChanged,
  clearWorkspaceTasks,
  emptyWorkspaceTaskStats,
  initialState,
  loadWorkspaceTasksFailed,
  loadWorkspaceTasksRequested,
  loadWorkspaceTasksSucceeded,
  workspaceTasksReducer,
} from './workspace-tasks-slice';

const WS = 'ws-1';

function makeTask(id: string, status: WorkspaceTask['status'] = 'not_started'): WorkspaceTask {
  return { id, title: `Task ${id}`, status };
}

function makeWorkspace(overrides: Partial<Workspace> & { id: string }): Workspace {
  return {
    title: 'Test Workspace',
    branch: 'main',
    changesets: [],
    timeline: [],
    conversationInfo: [],
    status: WorkspaceStatusEnum.Active,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...overrides,
    id: overrides.id as WorkspaceId,
  };
}

const ZERO_STATS: WorkspaceTaskStats = emptyWorkspaceTaskStats;

function loadedState(tasks: WorkspaceTask[], stats: WorkspaceTaskStats = ZERO_STATS) {
  return workspaceTasksReducer(initialState, loadWorkspaceTasksSucceeded(WS, tasks, stats));
}

describe('workspaceTasksReducer', () => {
  it('starts with no workspace entries', () => {
    expect(initialState.byWorkspaceId).toEqual({});
  });

  describe('loadWorkspaceTasksRequested', () => {
    it('marks the workspace as loading and clears errors', () => {
      const failed = workspaceTasksReducer(initialState, loadWorkspaceTasksFailed(WS, 'nope'));
      const state = workspaceTasksReducer(failed, loadWorkspaceTasksRequested(WS));

      expect(state.byWorkspaceId[WS]).toMatchObject({ loading: true, error: null });
    });

    it('is a no-op when a request is already in flight', () => {
      const loading = workspaceTasksReducer(initialState, loadWorkspaceTasksRequested(WS));
      const again = workspaceTasksReducer(loading, loadWorkspaceTasksRequested(WS));

      expect(again).toBe(loading);
    });
  });

  describe('loadWorkspaceTasksSucceeded', () => {
    it('stores tasks and marks the workspace initialized', () => {
      const state = loadedState([makeTask('t1'), makeTask('t2', 'complete')]);
      const ws = state.byWorkspaceId[WS];

      expect(ws.loading).toBe(false);
      expect(ws.error).toBeNull();
      expect(ws.initialized).toBe(true);
      expect(getItems(ws.tasks).map((t) => t.id)).toEqual(['t1', 't2']);
    });

    it('replaces previously loaded tasks', () => {
      const state = workspaceTasksReducer(
        loadedState([makeTask('t1'), makeTask('t2')]),
        loadWorkspaceTasksSucceeded(WS, [makeTask('t3')], ZERO_STATS),
      );

      expect(getItems(state.byWorkspaceId[WS].tasks).map((t) => t.id)).toEqual(['t3']);
    });

    it('stores the BE-provided stats verbatim alongside the task list', () => {
      const stats: WorkspaceTaskStats = { total: 4, completed: 1, inProgress: 2 };
      const state = workspaceTasksReducer(
        initialState,
        loadWorkspaceTasksSucceeded(WS, [makeTask('t1')], stats),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(stats);
    });
  });

  describe('loadWorkspaceTasksFailed', () => {
    it('records the error and stops loading', () => {
      const loading = workspaceTasksReducer(initialState, loadWorkspaceTasksRequested(WS));
      const state = workspaceTasksReducer(loading, loadWorkspaceTasksFailed(WS, 'boom'));

      expect(state.byWorkspaceId[WS]).toMatchObject({ loading: false, error: 'boom' });
    });
  });

  describe('applyTaskStatusChanged', () => {
    it('updates the status of a known task', () => {
      const state = workspaceTasksReducer(
        loadedState([makeTask('t1', 'not_started')]),
        applyTaskStatusChanged(WS, 't1', 'in_progress'),
      );

      expect(getItem(state.byWorkspaceId[WS].tasks, 't1')?.status).toBe('in_progress');
    });

    it('is a no-op when the workspace is not initialized', () => {
      const state = workspaceTasksReducer(
        initialState,
        applyTaskStatusChanged(WS, 't1', 'complete'),
      );

      expect(state).toBe(initialState);
    });

    it('is a no-op for an unknown task', () => {
      const loaded = loadedState([makeTask('t1')]);
      const state = workspaceTasksReducer(
        loaded,
        applyTaskStatusChanged(WS, 'missing', 'complete'),
      );

      expect(state).toBe(loaded);
    });

    it('is a no-op when the status is unchanged', () => {
      const loaded = loadedState([makeTask('t1', 'complete')]);
      const state = workspaceTasksReducer(loaded, applyTaskStatusChanged(WS, 't1', 'complete'));

      expect(state).toBe(loaded);
    });
  });

  describe('cleanup', () => {
    it('clears workspace state on clearWorkspaceTasks', () => {
      const state = workspaceTasksReducer(loadedState([makeTask('t1')]), clearWorkspaceTasks(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it('retains workspace state on workspaceUnmounted to avoid sidebar status flicker', () => {
      const stats: WorkspaceTaskStats = { total: 3, completed: 3, inProgress: 0 };
      const loaded = loadedState([makeTask('t1', 'complete')], stats);
      const state = workspaceTasksReducer(loaded, workspaceUnmounted(WS));

      // Task state must survive unmount so sidebar can still compute 'complete' status.
      // Clearing on unmount caused complete→idle flicker when navigating workspaces.
      expect(state.byWorkspaceId[WS]).toBeDefined();
      expect(state.byWorkspaceId[WS].stats).toEqual(stats);
      expect(state.byWorkspaceId[WS].initialized).toBe(true);
    });

    it('clears workspace state on removeWorkspaceEntity', () => {
      const state = workspaceTasksReducer(loadedState([makeTask('t1')]), removeWorkspaceEntity(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });
  });

  describe('stats seeding from workspace list rows', () => {
    const seedStats: WorkspaceTaskStats = { total: 5, completed: 2, inProgress: 1 };

    it('seeds stats for an unknown workspace on replaceWorkspaceList', () => {
      const state = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: seedStats })]),
      );
      const ws = state.byWorkspaceId[WS];

      expect(ws.stats).toEqual(seedStats);
      expect(ws.initialized).toBe(false);
      expect(ws.loading).toBe(false);
      expect(getItems(ws.tasks)).toEqual([]);
    });

    it('seeds stats for multiple workspaces in one list', () => {
      const otherStats: WorkspaceTaskStats = { total: 2, completed: 2, inProgress: 0 };
      const state = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([
          makeWorkspace({ id: WS, taskStats: seedStats }),
          makeWorkspace({ id: 'ws-2', taskStats: otherStats }),
        ]),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(seedStats);
      expect(state.byWorkspaceId['ws-2'].stats).toEqual(otherStats);
    });

    it('is a no-op for an initialized workspace (task.list stays authoritative)', () => {
      const canonical: WorkspaceTaskStats = { total: 3, completed: 1, inProgress: 1 };
      const loaded = loadedState([makeTask('t1')], canonical);
      const state = workspaceTasksReducer(
        loaded,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: seedStats })]),
      );

      expect(state).toBe(loaded);
      expect(state.byWorkspaceId[WS].stats).toEqual(canonical);
    });

    it('is a no-op for rows without taskStats', () => {
      const state = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([makeWorkspace({ id: WS })]),
      );

      expect(state).toBe(initialState);
    });

    it('is a no-op when seeded stats are unchanged', () => {
      const seeded = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: seedStats })]),
      );
      const again = workspaceTasksReducer(
        seeded,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: { ...seedStats } })]),
      );

      expect(again).toBe(seeded);
    });

    it('applies a seed when the rollup carries fields beyond the numeric trio', () => {
      const seeded = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: seedStats })]),
      );
      const withTasks: WorkspaceTaskStats = {
        ...seedStats,
        tasks: [{ title: 'Task a', status: 'in_progress' }],
      };
      const state = workspaceTasksReducer(
        seeded,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: withTasks })]),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(withTasks);
      expect(state.byWorkspaceId[WS].initialized).toBe(false);
    });

    it('updates a previous seed for a not-yet-initialized workspace', () => {
      const seeded = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: seedStats })]),
      );
      const newer: WorkspaceTaskStats = { total: 5, completed: 3, inProgress: 1 };
      const state = workspaceTasksReducer(
        seeded,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: newer })]),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(newer);
      expect(state.byWorkspaceId[WS].initialized).toBe(false);
    });

    it('seeds stats on setWorkspaceEntity for an unknown workspace', () => {
      const state = workspaceTasksReducer(
        initialState,
        setWorkspaceEntity(makeWorkspace({ id: WS, taskStats: seedStats })),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(seedStats);
      expect(state.byWorkspaceId[WS].initialized).toBe(false);
    });

    it('does not overwrite an initialized workspace on setWorkspaceEntity', () => {
      const canonical: WorkspaceTaskStats = { total: 3, completed: 1, inProgress: 1 };
      const loaded = loadedState([makeTask('t1')], canonical);
      const state = workspaceTasksReducer(
        loaded,
        setWorkspaceEntity(makeWorkspace({ id: WS, taskStats: seedStats })),
      );

      expect(state).toBe(loaded);
    });

    it('keeps a pre-seed load flow intact: seed then task.list load still initializes', () => {
      const seeded = workspaceTasksReducer(
        initialState,
        replaceWorkspaceList([makeWorkspace({ id: WS, taskStats: seedStats })]),
      );
      const canonical: WorkspaceTaskStats = { total: 6, completed: 4, inProgress: 1 };
      const state = workspaceTasksReducer(
        seeded,
        loadWorkspaceTasksSucceeded(WS, [makeTask('t1')], canonical),
      );

      expect(state.byWorkspaceId[WS].stats).toEqual(canonical);
      expect(state.byWorkspaceId[WS].initialized).toBe(true);
    });
  });
});
