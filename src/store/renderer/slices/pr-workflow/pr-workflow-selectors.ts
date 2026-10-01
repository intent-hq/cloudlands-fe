import { store } from '../../store';
import { emptyPRWorkflowState } from './pr-workflow-slice';
import type { PRWorkflowCommand } from './pr-workflow-types';

export const selectPRWorkflow = store.createSelector(
  (state, workspaceId: string) =>
    state.prWorkflow.byWorkspaceId[workspaceId] ?? emptyPRWorkflowState,
);
export const selectPRWorkflowOperation = store.createSelector(
  (state, workspaceId: string, kind: PRWorkflowCommand['kind']) =>
    selectPRWorkflow.select(state, workspaceId).operations[kind],
);
