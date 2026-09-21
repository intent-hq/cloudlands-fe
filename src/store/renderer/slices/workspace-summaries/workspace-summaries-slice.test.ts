import { describe, expect, it } from 'vitest';
import type { WorkspaceDiffSummary, WorkspaceGitSummary } from '$shared/types';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import { removeWorkspaceEntity } from '../workspace/workspace-slice';
import {
  clearWorkspaceSummaries,
  initialState,
  loadWorkspaceSummariesSucceeded,
  workspaceSummariesReducer,
} from './workspace-summaries-slice';

const WS = 'ws-1';

const diffSummary: WorkspaceDiffSummary = {
  schemaVersion: 1,
  updatedAt: '2026-01-01T00:00:00.000Z',
  totalFiles: 3,
  totalAdditions: 10,
  totalDeletions: 4,
  files: [],
};

const gitSummary: WorkspaceGitSummary = {
  ahead: 2,
  behind: 0,
  hasUnpushed: true,
};

function loadedState() {
  return workspaceSummariesReducer(
    initialState,
    loadWorkspaceSummariesSucceeded(WS, diffSummary, gitSummary),
  );
}

describe('workspaceSummariesReducer', () => {
  it('starts with no workspace entries', () => {
    expect(initialState.byWorkspaceId).toEqual({});
  });

  describe('loadWorkspaceSummariesSucceeded', () => {
    it('stores summaries and marks the workspace initialized', () => {
      const ws = loadedState().byWorkspaceId[WS];

      expect(ws).toEqual({
        diffSummary,
        gitSummary,
        initialized: true,
      });
    });

    it('accepts null summaries when data is unavailable', () => {
      const state = workspaceSummariesReducer(
        loadedState(),
        loadWorkspaceSummariesSucceeded(WS, null, null),
      );

      expect(state.byWorkspaceId[WS]).toMatchObject({
        diffSummary: null,
        gitSummary: null,
        initialized: true,
      });
    });
  });

  describe('cleanup', () => {
    it('clears workspace state on clearWorkspaceSummaries', () => {
      const state = workspaceSummariesReducer(loadedState(), clearWorkspaceSummaries(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it('clears workspace state on workspaceUnmounted', () => {
      const state = workspaceSummariesReducer(loadedState(), workspaceUnmounted(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });

    it('clears workspace state on removeWorkspaceEntity', () => {
      const state = workspaceSummariesReducer(loadedState(), removeWorkspaceEntity(WS));

      expect(state.byWorkspaceId[WS]).toBeUndefined();
    });
  });
});
