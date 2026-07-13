/**
 * Renderer implementation of the stream store-shaper seam.
 *
 * Lives in the renderer (`browser/`) because it imports `$store/renderer/*`
 * slices and `getRendererStore()`. It is registered from the renderer barrel so
 * that, when the stream manager runs in a renderer context, stream activity is
 * reflected into the renderer Redux store. The main-process stream manager only
 * depends on the process-neutral seam and never imports this module.
 */

import type { AgentMessage, Workspace } from '$shared/types';
import { getRendererStore } from '$store/renderer/renderer-store-bridge';
import { newAssistantMessage } from '$store/renderer/slices/unread-tracking/unread-tracking-slice';
import { removeWorkspaceAgentState } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  addMessage as addAgentSessionMessage,
  setAgentStreaming,
  updateAgentDigest,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import {
  setWorkspaceEntity,
  removeWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  registerStreamStoreShaper,
  type StreamAgentSessionView,
  type StreamStoreShaper,
} from '$features/agent/services/stream-store-shaper';

/** Mirrors selectWorkspaceById.select(state, wsId) without the Store dependency. */
function lookupWorkspaceById(state: any, wsId: string): Workspace | undefined {
  return state.workspace?.workspaces?.map?.[wsId];
}

/** Mirrors selectAgentSession.select(state, agentId) without the Store dependency. */
function lookupAgentSession(state: any, agentId: string): StreamAgentSessionView | undefined {
  return state.agentSessions?.byAgentId?.[agentId];
}

/** Renderer store-shaper: forwards stream activity into the renderer Redux store. */
export const rendererStreamStoreShaper: StreamStoreShaper = {
  getWorkspace(workspaceId) {
    return lookupWorkspaceById(getRendererStore().state, workspaceId);
  },
  getAgentSession(agentId) {
    return lookupAgentSession(getRendererStore().state, agentId);
  },
  setAgentStreaming(agentId, isStreaming) {
    getRendererStore().dispatch(setAgentStreaming(agentId, isStreaming));
  },
  updateAgentDigest(workspaceId, agentId, digest) {
    getRendererStore().dispatch(updateAgentDigest(workspaceId, agentId, digest));
  },
  notifyAssistantMessage(agentId, workspaceId, isBackground) {
    getRendererStore().dispatch(newAssistantMessage(agentId, workspaceId, isBackground));
  },
  addAgentMessage(agentId, message: AgentMessage) {
    getRendererStore().dispatch(addAgentSessionMessage(agentId, message));
  },
  setWorkspaceEntity(workspace) {
    getRendererStore().dispatch(setWorkspaceEntity(workspace));
  },
  removeWorkspaceEntity(workspaceId) {
    getRendererStore().dispatch(removeWorkspaceEntity(workspaceId));
  },
  removeWorkspaceAgentState(workspaceId) {
    getRendererStore().dispatch(removeWorkspaceAgentState(workspaceId));
  },
};

/** Register the renderer store-shaper. Idempotent; safe to call at barrel load. */
export function registerRendererStreamStoreShaper(): void {
  registerStreamStoreShaper(rendererStreamStoreShaper);
}
