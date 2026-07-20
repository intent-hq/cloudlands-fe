import { store } from "../../store";
import { getItems } from "$lib/store-shim/utils/collections/collection-utils";
import { emptyChatChangesWorkspaceState } from "./chat-changes-slice";
import type { AgentFileRefreshEntry, ChatChangesWorkspaceState } from "./chat-changes-types";

const selectChatChangesWorkspaceState = store.createSelector<
  [wsId?: string | null],
  ChatChangesWorkspaceState
>((state, wsId) => {
  if (!wsId) return emptyChatChangesWorkspaceState;
  return state.chatChanges.byWorkspaceId[wsId] ?? emptyChatChangesWorkspaceState;
});

export const selectAgentFileRefreshes = store.createSelector<[wsId?: string | null], AgentFileRefreshEntry[]>(
  (state, wsId) => {
    if (!wsId) return [];
    return getItems(selectChatChangesWorkspaceState.select(state, wsId).refreshes);
  },
);