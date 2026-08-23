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
};

export type TaskAgentAssociationsState = {
  byWorkspaceId: Record<string, TaskAgentAssociationsWorkspaceState>;
};
