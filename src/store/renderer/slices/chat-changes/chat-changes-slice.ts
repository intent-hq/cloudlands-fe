import { createReducer } from '@augmentcode/themis/utils/store/create-reducer';
import { createCollection } from '@augmentcode/themis/utils/collections/collection-utils';
import { createWorkspaceScopedHelpers } from '../../utils/workspace-scoped';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';
import type {
  AgentFileRefreshEntry,
  ChatChangesState,
  ChatChangesWorkspaceState,
} from './chat-changes-types';

export type { ChatChangesState, ChatChangesWorkspaceState };

export const emptyChatChangesWorkspaceState: ChatChangesWorkspaceState = {
  refreshes: createCollection<AgentFileRefreshEntry, 'path'>('path'),
};

export const initialState: ChatChangesState = {
  byWorkspaceId: {},
};

const { clearWorkspaceState } = createWorkspaceScopedHelpers(emptyChatChangesWorkspaceState);

export const chatChangesReducer = createReducer<ChatChangesState>(initialState);
chatChangesReducer.with(workspaceUnmounted, (state, { payload: [wsId] }) =>
  clearWorkspaceState(state, wsId),
);
