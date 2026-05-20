import { createAction } from "svelte-redux-toolkit/utils/store/create-action";
import { createReducer } from "svelte-redux-toolkit/utils/store/create-reducer";
import {
  createCollection,
  getItem,
  upsertItem,
} from "svelte-redux-toolkit/utils/collections/collection-utils";
import { createWorkspaceScopedHelpers } from "../../utils/workspace-scoped";
import { workspaceUnmounted } from "../workspace-lifecycle/workspace-lifecycle-slice";
import type { AgentFileRefreshEntry, ChatChangesState, ChatChangesWorkspaceState } from "./chat-changes-types";

export type { AgentFileRefreshEntry, ChatChangesState, ChatChangesWorkspaceState };

export const emptyChatChangesWorkspaceState: ChatChangesWorkspaceState = {
  refreshes: createCollection<AgentFileRefreshEntry, "path">("path"),
};

export const initialState: ChatChangesState = {
  byWorkspaceId: {},
};

const { getWorkspaceState, setWorkspaceState, clearWorkspaceState } =
  createWorkspaceScopedHelpers(emptyChatChangesWorkspaceState);

export const agentFileChangeReceived = createAction<[wsId: string, path: string]>(
  "chatChanges/agentFileChangeReceived",
);

export const agentFileRefreshTriggered = createAction<[wsId: string, path: string]>(
  "chatChanges/agentFileRefreshTriggered",
);

export const chatChangesReducer = createReducer<ChatChangesState>(initialState)
  .with(workspaceUnmounted, (state, { payload: [wsId] }) => clearWorkspaceState(state, wsId))
  .with(agentFileRefreshTriggered, (state, { payload: [wsId, path] }) => {
    const workspaceState = getWorkspaceState(state, wsId);
    const current = getItem(workspaceState.refreshes, path);
    const next: AgentFileRefreshEntry = {
      path,
      version: (current?.version ?? 0) + 1,
    };

    return setWorkspaceState(state, wsId, {
      ...workspaceState,
      refreshes: upsertItem(workspaceState.refreshes, next),
    });
  });