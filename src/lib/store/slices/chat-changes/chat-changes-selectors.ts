import { getItem, getItems } from "../../utils/collection-utils";
import { createSelector } from "../../utils/create-selector";
import { emptyChatChangesWorkspaceState } from "./chat-changes-slice";
import type { AgentFileRefreshEntry, ChatChangesWorkspaceState } from "./chat-changes-types";

export const selectChatChangesWorkspaceState = createSelector<
  [wsId?: string | null],
  ChatChangesWorkspaceState
>((state, wsId) => {
  if (!wsId) return emptyChatChangesWorkspaceState;
  return state.chatChanges.byWorkspaceId[wsId] ?? emptyChatChangesWorkspaceState;
});

export const selectAgentFileRefreshes = createSelector<[wsId?: string | null], AgentFileRefreshEntry[]>(
  (state, wsId) => {
    if (!wsId) return [];
    return getItems(selectChatChangesWorkspaceState.select(state, wsId).refreshes);
  },
);

export const selectAgentFileRefreshVersion = createSelector<
  [wsId?: string | null, path?: string | null],
  number
>((state, wsId, path) => {
  if (!wsId || !path) return 0;
  return getItem(selectChatChangesWorkspaceState.select(state, wsId).refreshes, path)?.version ?? 0;
});