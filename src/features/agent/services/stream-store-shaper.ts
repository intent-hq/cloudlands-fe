/**
 * Stream store-shaper seam.
 *
 * Decouples the (main-side) StreamManager lifecycle from the renderer Redux
 * store. StreamManager runs in the main process and must not statically import
 * `$store/renderer/*` or call `getRendererStore()`. The renderer registers an
 * implementation of this interface so that, when the manager runs in a renderer
 * context, stream activity is reflected into the renderer store.
 *
 * This module imports only types, so it is safe to import from both processes.
 */

import type { AgentMessage, Workspace } from '$shared/types';

/** Minimal projection of an agent session needed by the stream manager. */
export interface StreamAgentSessionView {
  messages?: AgentMessage[];
  isBackground?: boolean;
  metadata?: { isBackground?: boolean };
}

/**
 * Renderer-store operations the stream manager needs. All methods are invoked
 * through `getStreamStoreShaper()?.…`, so a missing shaper is a no-op (the
 * manager simply runs headless in the main process).
 */
export interface StreamStoreShaper {
  /** Look up a workspace entity by id (returns undefined when absent). */
  getWorkspace(workspaceId: string): Workspace | undefined;
  /** Project the agent session needed for unread/restore decisions. */
  getAgentSession(agentId: string): StreamAgentSessionView | undefined;
  /** Flip the streaming flag for an agent. */
  setAgentStreaming(agentId: string, isStreaming: boolean): void;
  /** Record an extracted agent digest. */
  updateAgentDigest(workspaceId: string, agentId: string, digest: string): void;
  /** Mark that a new assistant message arrived (unread tracking). */
  notifyAssistantMessage(agentId: string, workspaceId: string, isBackground: boolean): void;
  /** Append an assistant message to an agent session (restore path). */
  addAgentMessage(agentId: string, message: AgentMessage): void;
  /** Register a workspace entity (test harness). */
  setWorkspaceEntity(workspace: Workspace): void;
  /** Remove a workspace entity (test harness). */
  removeWorkspaceEntity(workspaceId: string): void;
  /** Remove workspace-scoped agent state (test harness). */
  removeWorkspaceAgentState(workspaceId: string): void;
}

let shaper: StreamStoreShaper | null = null;

/**
 * Register the renderer store-shaper. Called once from the renderer barrel.
 * Passing `null` clears the registration (primarily for tests).
 */
export function registerStreamStoreShaper(impl: StreamStoreShaper | null): void {
  shaper = impl;
}

/** Get the registered store-shaper, or `null` when none is registered. */
export function getStreamStoreShaper(): StreamStoreShaper | null {
  return shaper;
}
