/**
 * Agent IPC Bridge
 *
 * Thin module-function bridge replacing the RefactoredAgentService class.
 * All shared/domain state is managed by Redux; non-serializable runtime
 * coordination (activation mutexes, pending deletions) lives in module-level
 * Maps that are NOT stored in Redux.
 *
 * Consumers should import individual functions from this module:
 *   import { getSession, saveSession } from '$features/agent/agent-ipc-bridge';
 *
 * Or use the backward-compatible agentService object:
 *   import { agentService } from '$features/agent/agent-ipc-bridge';
 */

import { invoke } from '$lib/electron-bridge';
import { AGENT_BACKEND_CHANNELS } from '$shared/ipc/channels';
import { createLogger } from '$lib/utils/client-logger';
import type { Workspace, CommandResponse, AgentMessage, AgentSession } from '$shared/types';
import { AgentStatus } from '$shared/types';
import { AgentActivationState } from '$shared/types/agent-session';
import { DEFAULT_AGENT_MODEL } from '$shared/constants/agent-services';
import { getReduxStore } from '$lib/store/redux-dispatch-bridge';
import {
  upsertAgentSession,
  setAgentStreaming,
  removeAgent,
  setActiveAgentId,
  setDiskMessageCount,
  addAgentMessage,
} from '$lib/store/slices/workspace-agents/workspace-agents-slice';
import {
  selectAgentById,
  selectAllWorkspaceAgents,
  selectActiveAgentId,
} from '$lib/store/slices/workspace-agents/workspace-agents-selectors';
import { selectActiveWorkspaceId } from '$lib/store/slices/workspace/workspace-selectors';
import { agentIpcProxy, errorBoundary, persistenceService } from './browser';
import { agentFactory } from '$features/agent/services/agent-factory';
import { performanceOptimizer } from '$features/agent/services/performance-optimizer';
import { requestDeduplicator } from './browser/services/request-deduplicator.service';
import { compareMessageCompleteness } from '$shared/utils/message-comparator';
import { clearAgentUnread } from '$lib/store/slices/unread-tracking/unread-tracking-slice';
import { track } from '$lib/services/analytics';
import { eventCollector, AgentEventType } from '../observability/event-collector-client';
import { workspaceMetrics } from '$lib/store/slices/workspace/utils/workspace-metrics';
import { agentFileTracker } from './agent-file-tracker';
import { WorkspaceId } from '$shared/types/branded-ids';
import { EventEmitter } from '$lib/utils/browser-event-emitter';
import {
  registerDomHandler as _registerDomHandler,
  unregisterDomHandler as _unregisterDomHandler,
  replayPendingEvents as _replayPendingEvents,
  clearPendingEvents as _clearPendingEvents,
  ensureStreamHandler as _ensureStreamHandler,
  hasActiveStreamHandler as _hasActiveStreamHandler,
  isSendMessageSettingUpStream as _isSendMessageSettingUpStream,
  clearPendingStreamRegistration as _clearPendingStreamRegistration,
  reconnectToBackendStreams as _reconnectToBackendStreams,
  reconnectStreamHandlersForWorkspace as _reconnectStreamHandlersForWorkspace,
  sendMessage as _sendMessage,
  dispatchStreamEvent,
  registerStreamHandlerForSession,
} from './agent-stream-lifecycle';

const logger = createLogger('AgentIpcBridge');

// Re-export types for backward compat
export type { AgentSession, AgentStatus, AgentMessage } from '$shared/types';

// ---------------------------------------------------------------------------
// Module-level runtime state (non-serializable, NOT in Redux)
// ---------------------------------------------------------------------------

/** Mutex for agent activation — prevents duplicate concurrent activations. */
const activationMutex = new Map<string, Promise<AgentSession | null>>();

/** Dedup for createSession — prevents concurrent factory calls for same agentId. */
const pendingSessionCreations = new Map<string, Promise<AgentSession>>();

/** Lock for initial agent activation — prevents duplicate coordinator creation. */
const initialAgentActivationLocks = new Map<string, Promise<AgentSession | null>>();

/** Pending undo-able deletions with timeout handles. */
const pendingDeletions = new Map<
  string,
  { timeoutId: ReturnType<typeof setTimeout>; workspaceId?: string }
>();

/** Per-agent analytics tracking state. */
interface AgentAnalyticsEntry {
  turnStartTime: number;
  prevToolCallCount: number;
}
const agentAnalyticsState = new Map<string, AgentAnalyticsEntry>();

/** Module-level EventEmitter for stream events (backward compat). */
export const agentEventEmitter = new EventEmitter();

// ---------------------------------------------------------------------------
// Public API — Group 1: Pure Redux reads
// ---------------------------------------------------------------------------

/** Get a session by agent ID (from current workspace). */
export function getSession(agentId: string): AgentSession | null {
  const plainAgentId = agentId ? String(agentId) : '';
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  const session = wsId ? selectAgentById.select(getReduxStore().getState(), plainAgentId) : null;
  if (session && !session.workspaceId) {
    const allSessions = getAllSessions();
    const other = allSessions.find((s) => s.workspaceId);
    if (other) session.workspaceId = other.workspaceId;
  }
  return session ?? null;
}

/** Get all sessions for the current workspace. */
export function getAllSessions(): AgentSession[] {
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  if (!wsId) return [];
  return selectAllWorkspaceAgents.select(getReduxStore().getState(), wsId);
}

/** Get non-background sessions for a workspace. */
export function getSessionsForWorkspace(workspaceId: string): AgentSession[] {
  const allSessions = selectAllWorkspaceAgents.select(
    getReduxStore().getState(),
    workspaceId as any,
  );
  return allSessions.filter((s: any) => {
    const isBackground = !!(s as any).isBackground || !!(s.metadata as any)?.isBackground;
    return !isBackground;
  });
}

/** Check if an agent exists in the current workspace. */
export function hasAgent(agentId: string): boolean {
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  if (!wsId) return false;
  return !!selectAgentById.select(getReduxStore().getState(), agentId);
}

/** Check if a session is currently streaming. */
export function isStreamingCheck(agentId: string): boolean {
  const session = getSession(agentId);
  return session?.isStreaming === true;
}

/** Check if a session is soft-deleted. */
export function isSoftDeleted(agentId: string): boolean {
  const session = getSession(agentId);
  return session?.metadata?.softDeleted === true;
}

/** Get active session for current workspace. */
export function getActiveSession(): AgentSession | null {
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  if (!wsId) return null;
  const aid = selectActiveAgentId.select(getReduxStore().getState(), wsId);
  return aid ? (selectAgentById.select(getReduxStore().getState(), aid) ?? null) : null;
}

// ---------------------------------------------------------------------------
// Public API — Group 2: Redux dispatches
// ---------------------------------------------------------------------------

/** Set the active session. */
export function setActiveSession(agentId: string | null): void {
  if (agentId) {
    const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
    if (!wsId) return;
    getReduxStore().dispatch(setActiveAgentId(wsId, agentId));
  }
}

/** Add a session to the Redux store. */
export function addSession(session: AgentSession): void {
  const wsId =
    session.workspaceId ||
    (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
  if (!wsId) return;
  getReduxStore().dispatch(upsertAgentSession(wsId, session));
}

/** Add an optimistic message to a session. */
export function addOptimisticMessage(agentId: string, message: AgentMessage): void {
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  if (!wsId) return;
  getReduxStore().dispatch(addAgentMessage(wsId, agentId, message));
}

/** Track file changes for an agent. */
export function trackFileChanges(agentId: string, fileChanges: any[]): void {
  agentFileTracker.trackChanges(agentId, fileChanges);
}

/** Get file changes for an agent. */
export function getFileChanges(agentId: string): any[] {
  return agentFileTracker.getChanges(agentId);
}

// ---------------------------------------------------------------------------
// Public API — Group 3: IPC calls + Redux state
// ---------------------------------------------------------------------------

/** Save a session to disk. */
export async function saveSession(
  agentId: string,
  workspaceId: string,
  immediate = false,
  options?: { allowTruncation?: boolean },
): Promise<void> {
  const session = selectAgentById.select(getReduxStore().getState(), agentId);
  if (!session) {
    logger.warn('Cannot save session - session not found', { agentId });
    return;
  }
  if (!session.messages || session.messages.length === 0) {
    if (session.isProcessing || session.isStreaming) {
      logger.error('Refusing to save session with no messages while processing/streaming', {
        agentId,
      });
      return;
    }
  }
  await persistenceService.saveSession(session, workspaceId, {
    immediate,
    allowTruncation: options?.allowTruncation,
  });
}

/** Stop a streaming session. */
export async function stopSession(agentId: string): Promise<void> {
  requestDeduplicator.clearKeysForAgent(agentId);
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  if (!wsId) return;
  const tempSession = selectAgentById.select(getReduxStore().getState(), agentId);
  if (tempSession) {
    getReduxStore().dispatch(
      setAgentStreaming(tempSession.workspaceId || wsId, tempSession.id, false),
    );
  }
  const session = selectAgentById.select(getReduxStore().getState(), agentId);
  if (session?.id) {
    const response = await invoke<any>(AGENT_BACKEND_CHANNELS.STOP, {
      agentId,
      sessionId: session.id,
    });
    if (response && typeof response === 'object' && 'success' in response && !response.success) {
      throw new Error(response.error?.message || 'Failed to stop session');
    }
    track('Stopped Agent', {
      agent_id: agentId,
      workspace_id: session.workspaceId || '',
      agent_name: session.name,
      agent_model: session.model,
    });
  }
}

/** Soft delete a session (for undo). */
export async function softDeleteSession(agentId: string): Promise<AgentSession | null> {
  const wsId = selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined;
  if (!wsId) return null;
  const session = selectAgentById.select(getReduxStore().getState(), agentId);
  if (!session) return null;
  await stopSession(agentId);
  getReduxStore().dispatch(removeAgent(session.workspaceId || wsId, agentId));
  agentAnalyticsState.delete(agentId);
  getReduxStore().dispatch(clearAgentUnread(agentId));
  eventCollector.track(AgentEventType.SESSION_DELETED, {
    agentId,
    workspaceId: session.workspaceId,
    isSoftDelete: true,
  });
  return session;
}

/** Delete a session permanently. */
export async function deleteSession(agentId: string, workspaceId?: string): Promise<void> {
  const wsId =
    workspaceId ||
    (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
  if (!wsId) {
    logger.warn('No workspace ID for deleteSession', { agentId });
    return;
  }
  const session = selectAgentById.select(getReduxStore().getState(), agentId);
  if (session) await stopSession(agentId);
  const effectiveWorkspaceId = workspaceId || session?.workspaceId;
  if (effectiveWorkspaceId) {
    const workspace = {
      id: effectiveWorkspaceId,
      title: '',
      branch: '',
      status: 'active',
      changesets: [],
      timeline: [],
      conversationInfo: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as unknown as Workspace;
    await agentIpcProxy.deleteAgent(agentId, workspace);
  } else {
    await agentIpcProxy.deleteAgent(agentId);
  }
  if (session) {
    const wsIdForRemove = session.workspaceId || effectiveWorkspaceId || wsId;
    if (!wsIdForRemove)
      throw new Error(`[AgentIpcBridge] Cannot remove session without workspaceId: ${agentId}`);
    getReduxStore().dispatch(removeAgent(wsIdForRemove, agentId));
  }
  agentAnalyticsState.delete(agentId);
  getReduxStore().dispatch(clearAgentUnread(agentId));
  eventCollector.track(AgentEventType.SESSION_DELETED, {
    agentId,
    workspaceId: effectiveWorkspaceId || 'unknown',
  });
}

/** Delete a session with undo support. */
export async function deleteSessionWithUndo(opts: {
  agentId: string;
  workspaceId?: string;
  agentName?: string;
}): Promise<AgentSession | null> {
  const saved = await softDeleteSession(opts.agentId);
  if (!saved) {
    await deleteSession(opts.agentId, opts.workspaceId);
    return null;
  }
  const effectiveWsId = opts.workspaceId || saved.workspaceId;
  let undoClicked = false;
  const { toast } = await import('svelte-sonner');
  const displayName = opts.agentName || saved.name || '';
  const toastId = toast.warning(displayName ? `Deleted "${displayName}"` : 'Agent deleted', {
    duration: 15000,
    action: {
      label: 'Undo',
      onClick: () => {
        undoClicked = true;
        pendingDeletions.delete(opts.agentId);
        const wsIdForUndo = saved.workspaceId || effectiveWsId;
        if (!wsIdForUndo)
          throw new Error(`[AgentIpcBridge] Cannot undo delete without workspaceId`);
        getReduxStore().dispatch(upsertAgentSession(wsIdForUndo, saved));
        toast.dismiss(toastId);
      },
    },
  });
  const timeoutId = setTimeout(async () => {
    pendingDeletions.delete(opts.agentId);
    if (!undoClicked) {
      try {
        await deleteSession(opts.agentId, effectiveWsId);
      } catch (e) {
        logger.error('Failed to permanently delete', { error: e });
      }
    }
  }, 15000);
  pendingDeletions.set(opts.agentId, { timeoutId, workspaceId: effectiveWsId });
  return saved;
}

/** Flush all pending deletions immediately. */
export async function flushPendingDeletions(workspaceId?: string): Promise<void> {
  if (pendingDeletions.size === 0) return;
  const entries = [...pendingDeletions.entries()];
  pendingDeletions.clear();
  for (const [agentId, { timeoutId, workspaceId: storedWsId }] of entries) {
    clearTimeout(timeoutId);
    try {
      await deleteSession(agentId, workspaceId || storedWsId);
    } catch (e) {
      logger.error('Failed to delete during flush', { agentId, error: e });
    }
  }
}

/** Extract pending deletions (used by beforeunload saga). */
export function extractPendingDeletions(): Array<{ agentId: string; workspaceId?: string }> {
  if (pendingDeletions.size === 0) return [];
  const result: Array<{ agentId: string; workspaceId?: string }> = [];
  for (const [agentId, { timeoutId, workspaceId }] of pendingDeletions.entries()) {
    clearTimeout(timeoutId);
    result.push({ agentId, workspaceId });
  }
  pendingDeletions.clear();
  return result;
}

// ---------------------------------------------------------------------------
// Public API — Group 4: Activation & session creation (with dedup)
// ---------------------------------------------------------------------------

/** Activate a pending agent on the backend (with mutex). */
export async function activateAgent(
  agentId: string,
  workspaceId: string,
): Promise<AgentSession | null> {
  const currentSession = selectAgentById.select(getReduxStore().getState(), agentId);
  if (currentSession?.backendSessionId && currentSession.status === 'active') {
    return currentSession;
  }
  const pendingActivation = activationMutex.get(agentId);
  if (pendingActivation) {
    logger.warn('Duplicate activateAgent call, awaiting existing', { agentId });
    return pendingActivation;
  }
  const activationPromise = doActivateAgent(agentId, workspaceId, currentSession);
  activationMutex.set(agentId, activationPromise);
  try {
    return await activationPromise;
  } finally {
    activationMutex.delete(agentId);
  }
}

/** Internal activation with retry. */
async function doActivateAgent(
  agentId: string,
  workspaceId: string,
  currentSession: AgentSession | undefined,
): Promise<AgentSession | null> {
  const maxRetries = 3;
  let lastError: Error | null = null;
  if (currentSession) {
    getReduxStore().dispatch(
      upsertAgentSession(workspaceId, {
        ...currentSession,
        activationState: AgentActivationState.ACTIVATING,
        activationAttempts: (currentSession.activationAttempts || 0) + 1,
      }),
    );
  }
  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      const response = await invoke<any>('workspace:get', { id: workspaceId });
      const workspace = response?.data;
      if (!workspace) {
        if (currentSession)
          getReduxStore().dispatch(
            upsertAgentSession(workspaceId, {
              ...currentSession,
              activationState: AgentActivationState.ERROR,
              lastActivationError: 'Space not found',
            }),
          );
        return null;
      }
      const { agentIpcProxy: proxy } = await import('./browser/index');
      const activatedSession = (await proxy.activateAgent(
        agentId,
        workspace,
      )) as AgentSession | null;
      if (activatedSession) {
        const finalSession = {
          ...activatedSession,
          activationState: AgentActivationState.ACTIVE,
          activationAttempts: (currentSession?.activationAttempts || 0) + 1,
        };
        if (!finalSession.workspaceId) finalSession.workspaceId = workspaceId as any;
        getReduxStore().dispatch(upsertAgentSession(workspaceId, finalSession));
        return finalSession;
      }
      return activatedSession;
    } catch (error) {
      lastError = error as Error;
      logger.warn(`Failed to activate agent (attempt ${attempt + 1}/${maxRetries})`, {
        agentId,
        error: lastError.message,
      });
      if (attempt < maxRetries - 1)
        await new Promise((r) => setTimeout(r, Math.pow(2, attempt) * 1000));
    }
  }
  if (currentSession)
    getReduxStore().dispatch(
      upsertAgentSession(workspaceId, {
        ...currentSession,
        activationState: AgentActivationState.ERROR,
        lastActivationError: lastError?.message || 'Unknown error',
      }),
    );
  return null;
}

/** Lock-based dedup for initial agent activation. */
export async function activateInitialAgent(
  agentId: string,
  workspace: Workspace,
  createFn: () => Promise<AgentSession | null>,
): Promise<AgentSession | null> {
  const key = `${workspace.id}:${agentId}`;
  const existing = selectAgentById.select(getReduxStore().getState(), agentId);
  if (existing?.backendSessionId) return existing;
  const pending = initialAgentActivationLocks.get(key);
  if (pending) return pending;
  let timeoutId: ReturnType<typeof setTimeout> | undefined;
  const promise = Promise.race([
    createFn(),
    new Promise<null>((resolve) => {
      timeoutId = setTimeout(() => resolve(null), 60_000);
    }),
  ]).finally(() => {
    if (timeoutId !== undefined) clearTimeout(timeoutId);
    initialAgentActivationLocks.delete(key);
  });
  initialAgentActivationLocks.set(key, promise);
  return promise;
}

/** Create a new agent session (with dedup). */
export async function createSession(
  workspace: Workspace,
  options: {
    agentId?: string;
    name?: string;
    model?: string;
    provider?: string;
    agentType?: import('$shared/types/agent.types').AgentTypeId;
    initialMessage?: string;
    contextReferences?: any[];
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
    behaviorPrompt?: string;
    metadata?: any;
    isPending?: boolean;
  } = {},
): Promise<AgentSession> {
  return performanceOptimizer.track(`createSession:${workspace.id}`, async () => {
    if (!workspace) throw new Error('Cannot create session without space');
    if (!workspace.id) throw new Error('Cannot create session with space missing id');
    if (options.agentId) {
      const existingSession = selectAgentById.select(getReduxStore().getState(), options.agentId);
      if (existingSession?.backendSessionId) return existingSession;
      const pendingCreation = pendingSessionCreations.get(options.agentId);
      if (pendingCreation) return pendingCreation;
    }
    const creationPromise = executeCreateSession(workspace, options);
    if (options.agentId) {
      pendingSessionCreations.set(options.agentId, creationPromise);
      creationPromise.finally(() => pendingSessionCreations.delete(options.agentId!));
    }
    return creationPromise;
  });
}

/** Internal: execute createSession (after dedup guard). */
async function executeCreateSession(
  workspace: Workspace,
  options: {
    agentId?: string;
    name?: string;
    model?: string;
    provider?: string;
    agentType?: any;
    initialMessage?: string;
    contextReferences?: any[];
    imageBlocks?: Array<{ type: 'image'; data: string; mimeType: string }>;
    behaviorPrompt?: string;
    metadata?: any;
    isPending?: boolean;
  },
): Promise<AgentSession> {
  const createdSession = await agentFactory.createAgent(workspace, {
    id: options.agentId, // Pass through so the factory reuses the caller-provided ID
    name: options.name || 'Agent',
    workspaceId: WorkspaceId(workspace.id),
    model: options.model,
    provider: options.provider,
    agentType: options.agentType,
    initialMessage: options.initialMessage,
    contextReferences: options.contextReferences,
    imageBlocks: options.imageBlocks,
    behaviorPrompt: options.behaviorPrompt,
    isBackground: options.metadata?.isBackground,
    metadata: options.metadata,
  });
  if (!createdSession.success) throw new Error(createdSession.error || 'Failed to create agent');
  const agentId = createdSession.agent?.id;
  if (!agentId || !createdSession.agent) throw new Error('Failed to create agent - no ID returned');
  const session = createdSession.agent;
  if (!session.workspaceId) session.workspaceId = workspace.id;
  if (options.metadata?.isInitialAgent && !session.isInitialAgent) {
    session.isInitialAgent = true;
    if (!session.metadata) session.metadata = {};
    (session.metadata as any).isInitialAgent = true;
  }
  getReduxStore().dispatch(upsertAgentSession(workspace.id, session));
  getReduxStore().dispatch(setActiveAgentId(workspace.id, agentId));
  eventCollector.track(AgentEventType.SESSION_CREATED, {
    agentId,
    workspaceId: workspace.id,
    model: session.model,
    isPending: !session.id,
  });
  workspaceMetrics.incrementAgentCreated(workspace.id);
  return session;
}

/** Resume an existing session from disk. */
export async function resumeSession(
  agentId: string,
  workspace: Workspace,
): Promise<AgentSession | null> {
  return errorBoundary.wrap(
    async () => {
      const plainAgentId = agentId ? String(agentId) : '';
      if (!workspace) return null;
      if (!workspace.id) return null;
      let session = await persistenceService.loadSession(plainAgentId, workspace.id);
      if (session && !session.workspaceId) session.workspaceId = workspace.id;
      if (session?.messages) {
        getReduxStore().dispatch(
          setDiskMessageCount(workspace.id as string, plainAgentId, session.messages.length),
        );
      }
      if (session) {
        if (!session.messages?.find((msg: any) => msg.isStreaming)) {
          session.isStreaming = false;
        }
        if (session.messages && session.messages.length > 0 && session.status === 'pending') {
          session.status = 'active' as AgentStatus;
          if (!session.backendSessionId) session.backendSessionId = session.id;
        }
      }
      if (!session) {
        try {
          const config = await persistenceService.loadAgentConfig(plainAgentId, workspace.id);
          if (config) {
            const isOptimistic = workspace.id.startsWith('optimistic-');
            const hasPath = workspace.worktreePath || workspace.repositoryPath || workspace.path;
            if (!isOptimistic && hasPath) {
              session = await agentIpcProxy.activateAgent(plainAgentId, workspace);
              if (!session) {
                session = {
                  id: plainAgentId,
                  sessionId: null,
                  workspaceId: workspace.id,
                  name: config.name || 'Agent',
                  status: 'pending' as AgentStatus,
                  messages: [],
                  model: config.model || DEFAULT_AGENT_MODEL,
                  createdAt: new Date(config.createdAt || Date.now()),
                  updatedAt: new Date(config.updatedAt || Date.now()),
                  metadata: config.metadata,
                  isInitialAgent: config.metadata?.isInitialAgent || false,
                  isPending: true,
                } as any;
              }
            } else {
              session = {
                id: plainAgentId,
                sessionId: null,
                workspaceId: workspace.id,
                name: config.name || 'Agent',
                status: 'pending' as AgentStatus,
                messages: [],
                model: config.model || DEFAULT_AGENT_MODEL,
                createdAt: new Date(config.createdAt || Date.now()),
                updatedAt: new Date(config.updatedAt || Date.now()),
                metadata: config.metadata,
                isInitialAgent: config.metadata?.isInitialAgent || false,
                isPending: true,
              } as any;
            }
          } else {
            return null;
          }
        } catch {
          return null;
        }
      }
      // Preserve richer in-memory data
      const existingSession = selectAgentById.select(getReduxStore().getState(), plainAgentId);
      if (existingSession?.messages && session?.messages) {
        const cmp = compareMessageCompleteness(
          { messages: existingSession.messages },
          { messages: session.messages },
        );
        if (cmp > 0) session.messages = existingSession.messages;
      }
      getReduxStore().dispatch(upsertAgentSession(workspace.id, session));
      return session;
    },
    'resume session',
    { notify: false, fallback: null, context: { agentId, workspace: workspace?.id } },
  );
}

/** Restore a session from disk (alias for resumeSession). */
export async function restoreSession(
  agentId: string,
  workspace: Workspace,
): Promise<AgentSession | null> {
  const plainAgentId = agentId ? String(agentId) : '';
  return resumeSession(plainAgentId, workspace);
}

/** Restore a session from disk without backend activation. */
export async function restoreSessionWithoutBackend(
  agentId: string,
  workspace: Workspace,
): Promise<AgentSession | null> {
  try {
    if (!agentId || !workspace) return null;
    const plainAgentId = agentId ? String(agentId) : '';
    let session = await persistenceService.loadSession(plainAgentId, workspace?.id);
    // Compare with in-memory data
    const inMemoryAgents = selectAllWorkspaceAgents.select(
      getReduxStore().getState(),
      workspace.id,
    );
    const inMemoryAgent = inMemoryAgents.find((a) => String(a.id) === plainAgentId);
    if (inMemoryAgent?.messages?.length) {
      const cmp = compareMessageCompleteness(
        { messages: inMemoryAgent.messages },
        { messages: session?.messages || [] },
      );
      if (cmp > 0) session = inMemoryAgent;
    }
    if (session && !session.workspaceId) session.workspaceId = workspace.id;
    if (session?.messages) {
      getReduxStore().dispatch(
        setDiskMessageCount(workspace.id as string, plainAgentId, session.messages.length),
      );
    }
    if (session) {
      if (!session.messages?.find((msg: any) => msg.isStreaming)) session.isStreaming = false;
      if (!session.isInitialAgent && session.metadata?.isInitialAgent)
        session.isInitialAgent = true;
      // Normalize stale active status
      if (
        (session.status === AgentStatus.Active || session.status === AgentStatus.Processing) &&
        !session.messages?.find((msg: any) => msg.isStreaming)
      ) {
        session.status = AgentStatus.Idle;
      }
      getReduxStore().dispatch(upsertAgentSession(workspace.id, session));
      return session;
    }
    // Try loading config
    if (!session) {
      const config = await persistenceService.loadAgentConfig(agentId, workspace.id);
      if (config) {
        session = {
          id: plainAgentId,
          backendSessionId: null,
          workspaceId: workspace.id,
          name: config.name || 'Agent',
          status: 'pending' as AgentStatus,
          messages: [],
          model: config.model || DEFAULT_AGENT_MODEL,
          isStreaming: false,
          metadata: config.metadata,
          isInitialAgent: config.metadata?.isInitialAgent || false,
          createdAt: new Date(config.createdAt || Date.now()),
          updatedAt: new Date(config.updatedAt || Date.now()),
        } as any;
        getReduxStore().dispatch(upsertAgentSession(workspace.id, session));
        return session;
      }
    }
    return null;
  } catch (error) {
    logger.error('Failed to restore session without backend', error as Error, { agentId });
    return null;
  }
}

/** Restore a deleted session. */
export async function restoreDeletedSession(
  sessionOrId: AgentSession | string,
  workspaceId?: string,
): Promise<AgentSession | null> {
  if (typeof sessionOrId === 'string') {
    const session = await persistenceService.loadSession(sessionOrId, workspaceId);
    if (session && !session.workspaceId && workspaceId) session.workspaceId = workspaceId;
    if (session) {
      const wsId = workspaceId || session.workspaceId;
      if (!wsId) throw new Error(`[AgentIpcBridge] Cannot restore without workspaceId`);
      getReduxStore().dispatch(upsertAgentSession(wsId, session));
    }
    return session;
  }
  const wsId =
    sessionOrId.workspaceId ||
    workspaceId ||
    (selectActiveWorkspaceId.select(getReduxStore().getState()) as string | undefined);
  if (!wsId) return sessionOrId;
  getReduxStore().dispatch(upsertAgentSession(wsId, sessionOrId));
  return sessionOrId;
}

/** Enhance a prompt using AI. */
export async function enhancePrompt(
  prompt: string,
  workspace: Workspace,
  modelId?: string,
): Promise<string> {
  try {
    const result = (await invoke<CommandResponse<{ enhanced: string }>>('agent:enhance-prompt', {
      prompt,
      workspaceId: workspace.id,
      modelId: modelId || DEFAULT_AGENT_MODEL,
    })) as CommandResponse<{ enhanced: string }>;
    if (result?.success && result?.data?.enhanced) return result.data.enhanced;
    return prompt;
  } catch (error) {
    logger.error('Failed to enhance prompt', error as Error);
    return prompt;
  }
}

/** List all sessions for a workspace from backend. */
export async function listSessions(workspaceId: string): Promise<AgentSession[]> {
  try {
    const result = (await invoke<CommandResponse<any[]>>('agent:list-sessions', {
      workspaceId,
    })) as CommandResponse<any[]>;
    if (result?.success && Array.isArray(result.data)) {
      const sessions: AgentSession[] = [];
      for (const data of result.data) {
        const session = { ...data, workspaceId };
        if (session) sessions.push(session);
      }
      return sessions;
    }
    return [];
  } catch (error) {
    logger.error('Failed to list sessions', error as Error);
    return [];
  }
}

/** Alias for listSessions. */
export async function getAgentsList(workspaceId: string): Promise<AgentSession[]> {
  return listSessions(workspaceId);
}

/** Dispose / clean up bridge state. */
export function dispose(): void {
  initialAgentActivationLocks.clear();
  pendingSessionCreations.clear();
  activationMutex.clear();
  agentAnalyticsState.clear();
  for (const [, { timeoutId }] of pendingDeletions.entries()) clearTimeout(timeoutId);
  pendingDeletions.clear();
  logger.info('Agent IPC bridge disposed');
}

/** Alias for dispose. */
export function cleanup(): void {
  dispose();
}

/**
 * Create agent for a workspace.
 * Thin wrapper around createSession with extra validation, Redux sync, and analytics.
 */
export async function createAgent(
  workspace: Workspace,
  options?: any,
): Promise<AgentSession | null> {
  if (!workspace) {
    logger.error('Cannot create agent without workspace');
    return null;
  }
  if (!workspace.id) {
    logger.error('Cannot create agent with workspace missing id', { workspace, options });
    return null;
  }

  logger.info(`Creating agent via clean services for workspace ${workspace.id}`, {
    workspaceName: workspace.name,
    options,
  });

  try {
    const session = await createSession(workspace, {
      name: options?.name,
      model: options?.model,
      provider: options?.provider,
      agentType: options?.agentType,
      initialMessage: options?.initialMessage,
      behaviorPrompt: options?.behaviorPrompt,
      metadata: {
        ...options?.metadata,
        agentType: options?.agentType,
        originalAgentId: options?.agentId,
        contextReferences: options?.contextReferences,
      },
    });

    if (session) {
      logger.info('Successfully created agent via clean services', {
        agentId: session.id,
        workspaceId: session.workspaceId,
        name: session.name,
      });
      getReduxStore().dispatch(upsertAgentSession(session.workspaceId || workspace.id, session));
      getReduxStore().dispatch(setActiveAgentId(session.workspaceId || workspace.id, session.id));
      track('Created Agent', {
        agent_id: session.id,
        workspace_id: session.workspaceId || workspace.id,
        agent_name: session.name,
        agent_model: session.model,
        source: 'background-agent',
      });
    }

    return session;
  } catch (error) {
    logger.error('Failed to create agent for workspace', error as Error, {
      workspaceId: workspace.id,
    });
    throw error;
  }
}

// ---------------------------------------------------------------------------
// Backward-compatible agentService object
// Provides the same API shape as the old RefactoredAgentService class
// so consumers can migrate incrementally.
// ---------------------------------------------------------------------------

export const agentService = {
  // Group 1: Pure reads
  getSession,
  getAllSessions,
  getSessionsForWorkspace,
  hasAgent,
  isStreaming: isStreamingCheck,
  isSoftDeleted,
  getActiveSession,

  // Group 2: Redux dispatches
  setActiveSession,
  addSession,
  addOptimisticMessage,
  trackFileChanges,
  getFileChanges,

  // Group 3: IPC + Redux
  saveSession,
  stopSession,
  softDeleteSession,
  deleteSession,
  deleteSessionWithUndo,
  flushPendingDeletions,
  extractPendingDeletions,

  // Group 4: Activation & session creation
  activateAgent,
  activateInitialAgent,
  createSession,
  createAgent,

  // Group 5: Session restore
  resumeSession,
  restoreSession,
  restoreSessionWithoutBackend,
  restoreDeletedSession,

  // Group 6: Other IPC
  enhancePrompt,
  listSessions,
  getAgentsList,

  // Cleanup
  dispose,
  cleanup,

  // EventEmitter compat (for stream events)
  on: agentEventEmitter.on.bind(agentEventEmitter),
  off: agentEventEmitter.off.bind(agentEventEmitter),
  emit: agentEventEmitter.emit.bind(agentEventEmitter),

  // Stream lifecycle functions (migrated from RefactoredAgentService)
  registerDomHandler: _registerDomHandler,
  unregisterDomHandler: _unregisterDomHandler,
  replayPendingEvents: _replayPendingEvents,
  clearPendingEvents: _clearPendingEvents,
  ensureStreamHandler: _ensureStreamHandler,
  hasActiveStreamHandler: _hasActiveStreamHandler,
  isSendMessageSettingUpStream: _isSendMessageSettingUpStream,
  clearPendingStreamRegistration: _clearPendingStreamRegistration,
  reconnectToBackendStreams: _reconnectToBackendStreams,
  reconnectStreamHandlersForWorkspace: _reconnectStreamHandlersForWorkspace,
  sendMessage: _sendMessage,

  // Additional stream utilities
  dispatchStreamEvent,
  registerStreamHandlerForSession,
};

// Re-export stream lifecycle functions for direct import
export {
  registerDomHandler as registerDomHandler,
  unregisterDomHandler as unregisterDomHandler,
  replayPendingEvents as replayPendingEvents,
  clearPendingEvents as clearPendingEvents,
  ensureStreamHandler as ensureStreamHandler,
  hasActiveStreamHandler as hasActiveStreamHandler,
  isSendMessageSettingUpStream as isSendMessageSettingUpStream,
  clearPendingStreamRegistration as clearPendingStreamRegistration,
  reconnectToBackendStreams as reconnectToBackendStreams,
  reconnectStreamHandlersForWorkspace as reconnectStreamHandlersForWorkspace,
  sendMessage as sendMessage,
  dispatchStreamEvent as bridgeDispatchStreamEvent,
  registerStreamHandlerForSession as bridgeRegisterStreamHandlerForSession,
} from './agent-stream-lifecycle';
