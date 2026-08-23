export type TaskAgentAssociation = {
  taskText: string;
  taskKey?: string;
  agentId: string;
  noteId: string;
  createdAt: number;
};

export type TaskAgentAssociationsByTaskKey = Record<string, TaskAgentAssociation>;

export type TaskAgentAssociationsWorkspaceState = {
  byNoteId: Record<string, TaskAgentAssociationsByTaskKey>;
  /**
   * True once `task.listAgentLinks` has resolved at least once for this
   * workspace. Lets consumers distinguish "no links" (a legitimate root/
   * Coordinator signal) from "links not loaded yet" (monorepo#3249).
   */
  hydrated: boolean;
};

export type TaskAgentAssociationsState = {
  byWorkspaceId: Record<string, TaskAgentAssociationsWorkspaceState>;
};
