import { createSelector } from "../../utils/create-selector";
import type { TaskAgentAssociation } from "./task-agent-associations-types";

export const selectTaskAgentAssociationsByNoteId = createSelector(
  (state, workspaceId: string) => state.taskAgentAssociations?.byWorkspaceId[workspaceId]?.byNoteId ?? {},
);

export const selectAssociationsForNote = createSelector(
  (state, workspaceId: string, noteId: string): TaskAgentAssociation[] =>
    Object.values(state.taskAgentAssociations?.byWorkspaceId[workspaceId]?.byNoteId[noteId] ?? {}),
);

export const selectTaskAgentAssociation = createSelector(
  (state, workspaceId: string, noteId: string, taskKeyOrText: string): TaskAgentAssociation | undefined => {
    const noteAssociations = state.taskAgentAssociations?.byWorkspaceId[workspaceId]?.byNoteId[noteId];
    if (!noteAssociations) return undefined;
    return noteAssociations[taskKeyOrText] ??
      Object.values(noteAssociations).find((association) => association.taskText === taskKeyOrText);
  },
);

export const selectTasksForAgent = createSelector(
  (state, workspaceId: string, agentId: string): TaskAgentAssociation[] => {
    const byNoteId = state.taskAgentAssociations?.byWorkspaceId[workspaceId]?.byNoteId ?? {};
    return Object.values(byNoteId)
      .flatMap((noteAssociations) => Object.values(noteAssociations))
      .filter((association) => association.agentId === agentId);
  },
);
