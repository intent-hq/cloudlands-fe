import type { Collection } from "@augmentcode/ag-redux-toolkit/utils/collections/collection-utils";

export type AgentFileRefreshEntry = {
  path: string;
  version: number;
};

export type ChatChangesWorkspaceState = {
  refreshes: Collection<AgentFileRefreshEntry, "path">;
};

export type ChatChangesState = {
  byWorkspaceId: Record<string, ChatChangesWorkspaceState>;
};