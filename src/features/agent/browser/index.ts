/// <reference types="vite/client" />
/**
 * Browser-Safe Agent Services
 *
 * Export browser-safe services for use in the renderer process.
 * Services that need Node.js APIs should be in the main/ directory
 * and accessed via IPC proxies.
 */

// Browser-safe services that don't need Node.js APIs
export { errorBoundary, ErrorBoundaryService } from './error-boundary.service';

// Export unified state store
export { unifiedStateStore } from '$features/agent/services/unified-state-store';
export type {
  AgentState,
  WorkspaceState,
  ContextItem,
} from '$features/agent/services/unified-state-store';

// Create sessionStore compatibility wrapper for agent.service.ts
import { writable, type Readable } from 'svelte/store';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('browser/index');

// Track which deprecation warnings have been shown (once per method per session)
const deprecationWarningShown = new Set<string>();

export const sessionStoreData = writable<{ sessions: AgentSession[] }>({ sessions: [] });

// Per-agent subscribers for efficient updates during streaming
// Instead of notifying ALL subscribers for ANY agent update, this allows
// ChatPanel to subscribe to a specific agent and only get notified when
// that agent's data changes
const agentSubscribers = new Map<string, Set<(session: AgentSession | undefined) => void>>();

// Track agent IDs that have pending updates (for targeted notifications)
const pendingAgentUpdates = new Set<string>();

// Batching mechanism for store updates during streaming
// This prevents UI jank by batching multiple updates into a single frame
let pendingStoreUpdate = false;
let rafId: number | null = null;
// Store the target workspace ID so it can be updated if a more specific one is provided
let pendingTargetWorkspaceId: WorkspaceId | undefined = undefined;

/**
 * Subscribe to updates for a specific agent.
 * More efficient than subscribing to the global store during streaming.
 * The callback only fires when the specified agent's data changes.
 *
 * @param agentId - The agent ID to subscribe to
 * @param callback - Called when the agent's data changes
 * @param workspaceId - Optional workspace ID to scope the lookup. When provided,
 *   only that workspace is searched. When omitted, falls back to currentWorkspace only.
 *   This prevents cross-workspace state bleed where an agent from workspace B
 *   could be returned while viewing workspace A.
 */
export function subscribeToAgent(
  agentId: string,
  callback: (session: AgentSession | undefined) => void,
  workspaceId?: string,
): () => void {
  let subscribers = agentSubscribers.get(agentId);
  if (!subscribers) {
    subscribers = new Set();
    agentSubscribers.set(agentId, subscribers);
  }
  subscribers.add(callback);

  // Immediately call with current value
  // When workspaceId is provided, only search that workspace (workspace-scoped).
  // Otherwise, search currentWorkspace only (no all-workspace fallback to prevent cross-workspace bleed).
  let agent = null;

  if (workspaceId) {
    // Scoped lookup: only search the specified workspace
    const targetWorkspace = unifiedStateStore.getWorkspace(workspaceId as WorkspaceId);
    agent = targetWorkspace?.agents.get(agentId as any);
  } else {
    // Unscoped: use currentWorkspace only (no all-workspace fallback)
    const currentWorkspace = unifiedStateStore.currentWorkspace;
    agent = currentWorkspace?.agents.get(agentId as any);
  }

  if (agent?.session) {
    const sessionData = {
      ...agent.session,
      messages: agent.messages || agent.session.messages || [],
    };
    logger.debug('[subscribeToAgent] Initial callback data', {
      agentId,
      workspaceId: workspaceId || 'current',
      hasSession: true,
    });
    callback(sessionData);
  } else {
    logger.debug('[subscribeToAgent] No session found', { agentId, workspaceId: workspaceId || 'current' });
    callback(undefined);
  }

  // Return unsubscribe function
  return () => {
    const subs = agentSubscribers.get(agentId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        agentSubscribers.delete(agentId);
      }
    }
  };
}

/**
 * Notify subscribers for a specific agent.
 *
 * When targetWorkspaceId is provided, only that workspace is searched for the agent.
 * When not provided, falls back to currentWorkspace only.
 * The all-workspaces fallback has been removed to prevent cross-workspace state bleed.
 *
 * @param agentId - The agent ID to notify subscribers for
 * @param targetWorkspaceId - Optional specific workspace to look in
 */
export function notifyAgentSubscribers(agentId: string, targetWorkspaceId?: WorkspaceId) {
  const subscribers = agentSubscribers.get(agentId);
  if (!subscribers || subscribers.size === 0) return;

  let agent = null;

  if (targetWorkspaceId) {
    // Scoped: only search the target workspace
    const targetWorkspace = unifiedStateStore.getWorkspace(targetWorkspaceId);
    agent = targetWorkspace?.agents.get(agentId as any);
  } else {
    // Unscoped: use currentWorkspace only (no all-workspace fallback)
    const currentWorkspace = unifiedStateStore.currentWorkspace;
    agent = currentWorkspace?.agents.get(agentId as any);
  }

  const session = agent?.session
    ? {
        ...agent.session,
        messages: agent.messages || agent.session.messages || [],
      }
    : undefined;

  logger.debug('[notifyAgentSubscribers] Notifying', {
    agentId,
    targetWorkspaceId: targetWorkspaceId || 'current',
    hasSession: !!session,
    subscriberCount: subscribers.size,
  });

  for (const callback of subscribers) {
    try {
      callback(session);
    } catch (e) {
      logger.error('Error in agent subscriber callback', { agentId, error: e });
    }
  }
}

function scheduleStoreUpdate(forWorkspaceId?: WorkspaceId, forAgentId?: string) {
  // Track which agent triggered this update for targeted notifications
  if (forAgentId) {
    pendingAgentUpdates.add(forAgentId);
  }

  // If a specific workspace ID is provided, always use it (even if update is already scheduled)
  // This fixes a race condition where streaming listener schedules update without workspace ID,
  // then addSession tries to schedule with workspace ID but gets ignored
  if (forWorkspaceId) {
    pendingTargetWorkspaceId = forWorkspaceId;
  } else if (!pendingTargetWorkspaceId) {
    // Only use currentWorkspace if no specific workspace ID has been set
    pendingTargetWorkspaceId = unifiedStateStore.currentWorkspace?.workspace?.id as WorkspaceId;
  }

  if (pendingStoreUpdate) return; // Already scheduled, but workspace ID may have been updated above
  pendingStoreUpdate = true;

  // Debug: Log what workspace ID we're using
  logger.debug('Scheduling store update', {
    forWorkspaceId,
    pendingTargetWorkspaceId,
    currentWorkspaceId: unifiedStateStore.currentWorkspace?.workspace?.id,
    pendingAgentCount: pendingAgentUpdates.size,
  });

  // Use requestAnimationFrame to batch updates within a single frame
  rafId = requestAnimationFrame(() => {
    pendingStoreUpdate = false;
    rafId = null;
    // Use the stored workspace ID (which may have been updated by subsequent calls)
    const targetWorkspaceId = pendingTargetWorkspaceId;
    pendingTargetWorkspaceId = undefined; // Reset for next batch

    // Capture and clear pending agent updates
    const agentIdsToNotify = Array.from(pendingAgentUpdates);
    pendingAgentUpdates.clear();

    // Notify per-agent subscribers first (more efficient - only notifies affected subscribers)
    // Pass the targetWorkspaceId so we can find agents that may have been loaded into a specific workspace
    for (const agentId of agentIdsToNotify) {
      notifyAgentSubscribers(agentId, targetWorkspaceId);
    }

    // Also update the global store for backward compatibility
    // CRITICAL FIX: Always get ALL agents from ALL workspaces, not just the target workspace.
    // The sidebar's useAllAgentsSubscription expects sessionStoreData to contain all agents,
    // and then filters by workspaceId in the component. If we only include agents from one
    // workspace, the sidebar shows "No agents yet" when switching workspaces.
    const sessions = unifiedStateStore.getAllAgents();

    sessionStoreData.set({ sessions });
  });
}

// Subscribe to streaming state changes from unifiedStateStore
// This ensures sessionStoreData is updated when streaming starts/stops
// (e.g., for background agents managed by stream-manager)
let streamingListenerSetup = false;
function ensureStreamingListener() {
  if (streamingListenerSetup) return;
  streamingListenerSetup = true;

  // Import dynamically to avoid circular dependencies
  import('$features/agent/services/unified-state-store')
    .then(({ unifiedStateStore }) => {
      unifiedStateStore.onStreamingChange(() => {
        // Schedule store update when any agent's streaming state changes
        scheduleStoreUpdate();
      });
    })
    .catch((error) => {
      // Log error but don't crash - streaming listener is optional
      logger.error('Failed to set up streaming listener', { error });
    });
}

// Cancel pending update (useful for cleanup)
export function cancelPendingStoreUpdate() {
  if (rafId !== null) {
    cancelAnimationFrame(rafId);
    rafId = null;
    pendingStoreUpdate = false;
    pendingTargetWorkspaceId = undefined;
  }
}

export const sessionStore = {
  getStore: () => {
    // Ensure streaming listener is set up when store is accessed
    ensureStreamingListener();
    return sessionStoreData;
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  getSession: (agentId: string): AgentSession | undefined => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('getSession')) {
      deprecationWarningShown.add('getSession');
      logger.warn('sessionStore.getSession is deprecated — consider using workspace-aware alternative (e.g., getSessionForWorkspace)');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    const agent = workspace?.agents.get(agentId as any);

    if (!agent?.session) {
      return undefined;
    }

    // Merge the messages from AgentState with the session
    // FIX: Check array length, not just truthiness, because empty arrays are truthy
    // and would prevent falling through to agent.session.messages
    //
    // CRITICAL FIX: Use agent.streaming.active as the authoritative source for isStreaming.
    // The agent.session.isStreaming can become stale in some timing scenarios because
    // updates are batched via requestAnimationFrame. The agent.streaming.active is
    // updated synchronously by setStreaming/setStreamingForWorkspace.
    // This prevents "Already processing a message" errors when the user sends a message
    // immediately after streaming completes.
    const isStreaming = agent.streaming?.active ?? agent.session.isStreaming ?? false;

    return {
      ...agent.session,
      isStreaming,
      messages:
        agent.messages && agent.messages.length > 0
          ? agent.messages
          : agent.session.messages && agent.session.messages.length > 0
            ? agent.session.messages
            : [],
    };
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  getAllSessions: (): AgentSession[] => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('getAllSessions')) {
      deprecationWarningShown.add('getAllSessions');
      logger.warn('sessionStore.getAllSessions is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (!workspace) return [];
    const sessions: AgentSession[] = [];
    workspace.agents.forEach((agent) => {
      if (agent.session) {
        // Merge the messages from AgentState with the session
        // Use agent.streaming.active as authoritative source for isStreaming
        const isStreaming = agent.streaming?.active ?? agent.session.isStreaming ?? false;
        const sessionWithMessages = {
          ...agent.session,
          isStreaming,
          messages: agent.messages || agent.session.messages || [],
        };
        sessions.push(sessionWithMessages);
      }
    });
    return sessions;
  },
  /**
   * Get all STREAMING sessions across ALL workspaces.
   * This is more efficient than getting all sessions - it only returns sessions
   * that are marked as streaming, which is what we need for clearing stale states.
   * This avoids expensive iteration through archived/old workspaces.
   */
  getAllSessionsAcrossWorkspaces: (): AgentSession[] => {
    const sessions: AgentSession[] = [];
    const allWorkspaces = unifiedStateStore.getAllWorkspaces();
    for (const workspaceState of allWorkspaces) {
      workspaceState.agents.forEach((agent) => {
        // Only include sessions that are marked as streaming
        // This is a performance optimization - we only care about streaming sessions
        // when checking for stale streaming states
        // Use agent.streaming.active as authoritative source for isStreaming
        const isStreaming = agent.streaming?.active ?? agent.session?.isStreaming ?? false;
        if (agent.session && isStreaming) {
          const sessionWithMessages = {
            ...agent.session,
            isStreaming,
            messages: agent.messages || agent.session.messages || [],
          };
          sessions.push(sessionWithMessages);
        }
      });
    }
    return sessions;
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  findSessions: (predicate: (s: any) => boolean): AgentSession[] => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('findSessions')) {
      deprecationWarningShown.add('findSessions');
      logger.warn('sessionStore.findSessions is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (!workspace) return [];
    const sessions: AgentSession[] = [];
    workspace.agents.forEach((agent) => {
      if (agent.session) {
        // Merge the messages from AgentState with the session
        const sessionWithMessages = {
          ...agent.session,
          messages: agent.messages || agent.session.messages || [],
        };
        if (predicate(sessionWithMessages)) {
          sessions.push(sessionWithMessages);
        }
      }
    });
    return sessions;
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  updateSession: (agentId: string, updates: Partial<AgentSession>) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('updateSession')) {
      deprecationWarningShown.add('updateSession');
      logger.warn('sessionStore.updateSession is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      const agent = workspace.agents.get(agentId as any);
      if (agent?.session) {
        Object.assign(agent.session, updates);
        // CRITICAL: Also update agent.messages when messages are provided
        // Otherwise getSession() will return stale data from agent.messages
        // while agent.session.messages has the updated content
        if (updates.messages && Array.isArray(updates.messages)) {
          agent.messages = updates.messages;
        }
        // Schedule store update to notify subscribers of the change
        // Pass agentId so per-agent subscribers are notified
        scheduleStoreUpdate(workspace.workspace?.id as WorkspaceId, agentId);
      }
    }
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace as fallback which may be incorrect for background agents. */
  addSession: (session: AgentSession) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('addSession')) {
      deprecationWarningShown.add('addSession');
      logger.warn('sessionStore.addSession is deprecated — consider using workspace-aware alternative');
    }
    // CRITICAL FIX: Guard against null/undefined session to prevent errors
    if (!session) {
      logger.warn('addSession called with null/undefined session, ignoring');
      return;
    }

    // Use the session's own workspaceId if available, fallback to current workspace
    const sessionWorkspaceId = session.workspaceId as WorkspaceId | undefined;
    const currentWorkspace = unifiedStateStore.currentWorkspace;
    const targetWorkspaceId = sessionWorkspaceId || currentWorkspace?.workspace?.id;

    logger.debug('sessionStore.addSession called', {
      sessionId: session?.id,
      hasWorkspace: !!currentWorkspace,
      workspaceId: targetWorkspaceId,
      sessionWorkspaceId,
      currentWorkspaceId: currentWorkspace?.workspace?.id,
    });
    if (targetWorkspaceId) {
      // Pass the session directly - setAgent will preserve existing state
      unifiedStateStore.setAgent(targetWorkspaceId, session);
      // Schedule batched store update with the target workspace ID AND agent ID
      // CRITICAL: Pass agentId so per-agent subscribers are notified when the agent is added
      // This fixes the issue where panels remain empty after workspace switch because
      // subscribeToAgent callbacks were never notified of the new agent
      scheduleStoreUpdate(targetWorkspaceId as WorkspaceId, session.id);
    } else {
      // Log warning if we can't determine the target workspace
      logger.warn('addSession: No target workspace ID available, session not added', {
        sessionId: session?.id,
        sessionWorkspaceId,
        hasCurrentWorkspace: !!currentWorkspace,
      });
    }
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  removeSession: (agentId: string) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('removeSession')) {
      deprecationWarningShown.add('removeSession');
      logger.warn('sessionStore.removeSession is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      workspace.agents.delete(agentId as any);
      // Schedule batched store update with the current workspace ID and agent ID
      // CRITICAL: Pass agentId so per-agent subscribers are notified the agent was deleted
      scheduleStoreUpdate(workspace.workspace?.id as WorkspaceId, agentId);
    }
  },
  /** @deprecated Use workspace-aware alternative. Delegates to removeSession which uses currentWorkspace. */
  removeAgent: (agentId: string) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('removeAgent')) {
      deprecationWarningShown.add('removeAgent');
      logger.warn('sessionStore.removeAgent is deprecated — consider using workspace-aware alternative');
    }
    sessionStore.removeSession(agentId);
  },
  /** @deprecated Use setStreamingForWorkspace instead. This method uses currentWorkspace which may be incorrect for background agents. */
  setStreaming: (agentId: string, isStreaming: boolean) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('setStreaming')) {
      deprecationWarningShown.add('setStreaming');
      logger.warn('sessionStore.setStreaming is deprecated — consider using setStreamingForWorkspace');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      logger.info('sessionStore.setStreaming - updating unified state store', {
        agentId,
        isStreaming,
        workspaceId: workspace.workspace.id,
      });
      unifiedStateStore.setStreaming(workspace.workspace.id, agentId as any, isStreaming);
      // Schedule batched store update with the current workspace ID and agent ID
      // Pass agentId so per-agent subscribers are notified of streaming state changes
      scheduleStoreUpdate(workspace.workspace?.id as WorkspaceId, agentId);
    } else {
      // FIX: When currentWorkspace is null, try to find the agent in any workspace
      // This prevents streaming indicators from getting stuck when user switches workspaces
      const allWorkspaces = unifiedStateStore.getAllWorkspaces();
      for (const ws of allWorkspaces) {
        if (ws.agents.has(agentId as any)) {
          logger.info('sessionStore.setStreaming - found agent in workspace (fallback)', {
            agentId,
            isStreaming,
            workspaceId: ws.workspace.id,
          });
          unifiedStateStore.setStreaming(ws.workspace.id, agentId as any, isStreaming);
          scheduleStoreUpdate(ws.workspace.id, agentId);
          return;
        }
      }
      // Only log warning if agent wasn't found anywhere
      logger.warn('sessionStore.setStreaming - Agent not found in any workspace', {
        agentId,
        isStreaming,
      });
    }
  },
  /**
   * Set streaming state for an agent in a specific workspace.
   * Unlike setStreaming(), this works even when the user is viewing a different workspace.
   * Use this when handling stream completion events that may occur while user is on another workspace.
   */
  setStreamingForWorkspace: (workspaceId: string, agentId: string, isStreaming: boolean) => {
    logger.info('sessionStore.setStreamingForWorkspace - updating unified state store', {
      agentId,
      isStreaming,
      workspaceId,
    });
    unifiedStateStore.setStreaming(workspaceId as WorkspaceId, agentId as any, isStreaming);
    // Schedule batched store update with the target workspace ID and agent ID
    // Pass agentId so per-agent subscribers are notified of streaming state changes
    scheduleStoreUpdate(workspaceId as WorkspaceId, agentId);
  },
  /**
   * Get a session from a specific workspace.
   * Unlike getSession(), this works even when the user is viewing a different workspace.
   * Use this when handling stream events that may occur while user is on another workspace.
   */
  getSessionForWorkspace: (workspaceId: string, agentId: string): AgentSession | undefined => {
    const sessions = unifiedStateStore.getAgentsForWorkspace(workspaceId as WorkspaceId);
    return sessions.find((s) => s.id === agentId);
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  setActiveSession: (agentId: string) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('setActiveSession')) {
      deprecationWarningShown.add('setActiveSession');
      logger.warn('sessionStore.setActiveSession is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      unifiedStateStore.setActiveAgent(workspace.workspace.id, agentId as any);
    }
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  getActiveSession: (): AgentSession | undefined => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('getActiveSession')) {
      deprecationWarningShown.add('getActiveSession');
      logger.warn('sessionStore.getActiveSession is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (!workspace || !workspace.activeAgentId) return undefined;
    const agent = workspace.agents.get(workspace.activeAgentId);
    if (!agent?.session) return undefined;
    // Merge the messages from AgentState with the session
    // FIX: Check array length, not just truthiness, because empty arrays are truthy
    // Use agent.streaming.active as authoritative source for isStreaming
    const isStreaming = agent.streaming?.active ?? agent.session.isStreaming ?? false;
    return {
      ...agent.session,
      isStreaming,
      messages:
        agent.messages && agent.messages.length > 0
          ? agent.messages
          : agent.session.messages && agent.session.messages.length > 0
            ? agent.session.messages
            : [],
    };
  },
  /** @deprecated Use addMessageForWorkspace instead. This method uses currentWorkspace which may be incorrect for background agents. */
  addMessage: (agentId: string, message: any) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('addMessage')) {
      deprecationWarningShown.add('addMessage');
      logger.warn('sessionStore.addMessage is deprecated — consider using addMessageForWorkspace');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      unifiedStateStore.addMessage(workspace.workspace.id, agentId as any, message);
      // Schedule batched store update with the current workspace ID and agent ID
      // Pass agentId so per-agent subscribers are notified of new messages
      scheduleStoreUpdate(workspace.workspace?.id as WorkspaceId, agentId);
    }
  },
  /**
   * Add a message to a specific workspace.
   * Unlike addMessage(), this works even when the user is viewing a different workspace.
   * Use this when handling wake messages from subscription events that may occur while
   * user is on another workspace.
   */
  addMessageForWorkspace: (workspaceId: string, agentId: string, message: any) => {
    logger.info('sessionStore.addMessageForWorkspace - adding message to specific workspace', {
      agentId,
      workspaceId,
      messageId: message?.id,
      hasMetadata: !!message?.metadata,
      metadataType: message?.metadata?.type,
    });
    unifiedStateStore.addMessage(workspaceId as WorkspaceId, agentId as any, message);
    // Schedule batched store update with the target workspace ID and agent ID
    // Pass agentId so per-agent subscribers are notified of new messages
    scheduleStoreUpdate(workspaceId as WorkspaceId, agentId);
  },
  /** @deprecated Use updateMessageForWorkspace instead. This method uses currentWorkspace which may be incorrect for background agents. */
  updateMessage: (agentId: string, messageId: string, updates: any) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('updateMessage')) {
      deprecationWarningShown.add('updateMessage');
      logger.warn('sessionStore.updateMessage is deprecated — consider using updateMessageForWorkspace');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      const agent = workspace.agents.get(agentId as any);
      if (agent) {
        const messageIndex = agent.messages.findIndex((m: any) => m.id === messageId);
        if (messageIndex !== -1) {
          // Create a new message object to trigger reactivity
          agent.messages[messageIndex] = {
            ...agent.messages[messageIndex],
            ...updates,
          };

          // Also update the session messages if they exist
          if (agent.session && agent.session.messages) {
            agent.session.messages[messageIndex] = agent.messages[messageIndex];
          }

          // Schedule batched store update with the current workspace ID and agent ID
          // Passing agentId enables targeted per-agent notifications during streaming
          scheduleStoreUpdate(workspace.workspace?.id as WorkspaceId, agentId);
        }
      }
    }
  },
  /**
   * Update a message in a specific workspace.
   * Unlike updateMessage(), this works even when the user is viewing a different workspace.
   * Use this when handling stream events that may occur while user is on another workspace.
   */
  updateMessageForWorkspace: (
    workspaceId: string,
    agentId: string,
    messageId: string,
    updates: any,
  ) => {
    const workspace = unifiedStateStore
      .getAllWorkspaces()
      .find((w) => w.workspace.id === workspaceId);
    if (workspace) {
      const agent = workspace.agents.get(agentId as any);
      if (agent) {
        const messageIndex = agent.messages.findIndex((m: any) => m.id === messageId);
        if (messageIndex !== -1) {
          // Create a new message object to trigger reactivity
          agent.messages[messageIndex] = {
            ...agent.messages[messageIndex],
            ...updates,
          };

          // Also update the session messages if they exist
          if (agent.session && agent.session.messages) {
            agent.session.messages[messageIndex] = agent.messages[messageIndex];
          }

          // Schedule batched store update with the target workspace ID and agent ID
          scheduleStoreUpdate(workspaceId as WorkspaceId, agentId);
        }
      }
    }
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  updateMessages: (agentId: string, messages: any[]) => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('updateMessages')) {
      deprecationWarningShown.add('updateMessages');
      logger.warn('sessionStore.updateMessages is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      const agent = workspace.agents.get(agentId as any);
      if (agent) {
        // FIX: Use separate array copies to prevent shared-reference bug.
        // If both agent.messages and agent.session.messages point to the same array,
        // addMessage() will push to both references (which is the same array), causing
        // duplicate entries. Using [...messages] creates independent copies.
        agent.messages = [...messages];
        if (agent.session) {
          agent.session.messages = [...messages];
        }
        // Also rebuild messageIdSet to match the new messages
        agent.messageIdSet = new Set(messages.map((m: any) => m.id));
        // Schedule batched store update with the current workspace ID and agent ID
        scheduleStoreUpdate(workspace.workspace?.id as WorkspaceId, agentId);
      }
    }
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  getStats: () => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('getStats')) {
      deprecationWarningShown.add('getStats');
      logger.warn('sessionStore.getStats is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (!workspace) return { totalSessions: 0, activeSessions: 0, totalMessages: 0 };
    let totalMessages = 0;
    let activeSessions = 0;
    workspace.agents.forEach((agent) => {
      if (agent.session) {
        if (agent.streaming.active) activeSessions++;
        totalMessages += agent.messages.length;
      }
    });
    return { totalSessions: workspace.agents.size, activeSessions, totalMessages };
  },
  /** @deprecated Use workspace-aware alternative. This method uses currentWorkspace which may be incorrect for background agents. */
  clear: () => {
    if (import.meta.env.DEV && !deprecationWarningShown.has('clear')) {
      deprecationWarningShown.add('clear');
      logger.warn('sessionStore.clear is deprecated — consider using workspace-aware alternative');
    }
    const workspace = unifiedStateStore.currentWorkspace;
    if (workspace) {
      workspace.agents.clear();
    }
  },
};

// Export the config cache proxy (communicates with main process)
export { configCache, ConfigCacheProxyService } from './config-cache-proxy.service';

// Create IPC proxies for services that need Node.js APIs
import { invoke } from '$lib/electron-bridge';
import { AGENT_CHANNELS, PERSISTENCE_CHANNELS } from '$shared/ipc/channels';
import { unifiedStateStore } from '$features/agent/services/unified-state-store';
import type { Workspace } from '$shared/types';
import type { AgentSession } from '../../../shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';


const agentProxiesLogger = createLogger('AgentProxies');

/**
 * Agent IPC Proxy - provides IPC access to agent operations
 *
 * NOTE: This is NOT the same as UnifiedAgentFactory in services/agent-factory.ts!
 * - UnifiedAgentFactory: Full agent creation logic with validation, rules loading, etc.
 * - AgentIpcProxy: Simple IPC proxy for activate/delete operations
 *
 * For agent CREATION, use agentFactory from services/agent-factory.ts
 * For agent ACTIVATION/DELETION, use agentIpcProxy from this file
 */
export class AgentIpcProxy {
  // Mutex for agent operations - prevents concurrent operations (create/activate) for the same agentId.
  // Cross-type callers wait for the in-flight operation to finish, then proceed with their own logic
  // to avoid returning the wrong type.
  private agentOperationMutex = new Map<string, Promise<any>>();

  async createAgent(config: any) {
    const agentId = config?.agentId || config?.id;

    // If we have an agentId, check for in-flight operations and wait if needed
    if (agentId) {
      const pendingOperation = this.agentOperationMutex.get(agentId);
      if (pendingOperation) {
        agentProxiesLogger.warn('createAgent blocked by in-flight operation, waiting...', {
          agentId,
          workspaceId: config?.workspaceId,
          codePath: 'AgentIpcProxy.createAgent',
        });
        await pendingOperation.catch(() => {}); // Wait for it to finish, ignore errors
        // Now proceed normally — the agent may already exist
      }

      const createPromise = this._doCreateAgent(config);
      this.agentOperationMutex.set(agentId, createPromise);

      try {
        return await createPromise;
      } finally {
        this.agentOperationMutex.delete(agentId);
      }
    }

    // No agentId available (backend will generate one) - no mutex needed
    return this._doCreateAgent(config);
  }

  /**
   * Internal implementation of agent creation (called under mutex when agentId is known)
   */
  private async _doCreateAgent(config: any) {
    try {
      const response = (await invoke(AGENT_CHANNELS.CREATE, config)) as any;

      // Debug log the response
      agentProxiesLogger.info('agent:create response:', {
        hasDirectSuccess: response?.success !== undefined,
        hasDirectAgent: !!response?.agent,
        hasData: !!response?.data,
        dataType: typeof response?.data,
        hasDataAgent: !!response?.data?.agent,
        hasDataSuccess: response?.data?.success !== undefined,
        directAgentWorkspaceId: response?.agent?.workspaceId,
        dataAgentWorkspaceId: response?.data?.agent?.workspaceId,
        response,
      });

      // Check if response has the expected structure directly (not wrapped in data)
      // This is the current format from the backend
      if (response?.success !== undefined && response?.agent) {
        agentProxiesLogger.info('Response has direct structure', {
          success: response.success,
          hasAgent: !!response.agent,
          agentId: response.agent?.id,
          agentWorkspaceId: response.agent?.workspaceId,
        });
        return response; // Return as-is: { success: true, agent: {...} }
      }

      // Fallback: Check if response is wrapped in data property (legacy format)
      if (response?.data?.success !== undefined) {
        agentProxiesLogger.info('Response wrapped in data property (legacy)', {
          success: response.data.success,
          hasAgent: !!response.data?.agent,
          agentId: response.data?.agent?.id,
          agentWorkspaceId: response.data?.agent?.workspaceId,
        });
        return response.data;
      } else if (response?.data?.agent) {
        // Fallback: wrap agent in success structure
        agentProxiesLogger.warn('Wrapping agent in success structure for compatibility');
        return {
          success: true,
          agent: response.data.agent,
        };
      } else if (response?.data?.id) {
        // Fallback: if only ID is returned, create a minimal agent object
        agentProxiesLogger.warn('Only agent ID returned, creating minimal agent object');
        return {
          success: true,
          agent: {
            id: String(response.data.id),
            workspaceId: config.workspaceId,
            name: config.name || 'Agent',
          },
        };
      } else {
        agentProxiesLogger.error('Invalid response from agent:create - no agent found', response);
        return {
          success: false,
          error: 'Failed to create agent - no agent returned',
        };
      }
    } catch (error) {
      agentProxiesLogger.error('Failed to create agent:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      };
    }
  }

  async activateAgent(agentId: string, workspace?: any) {
    // Mutex: if an operation is already in progress for this agentId, wait for it then proceed
    const pendingOperation = this.agentOperationMutex.get(agentId);
    if (pendingOperation) {
      agentProxiesLogger.warn('activateAgent blocked by in-flight operation, waiting...', {
        agentId,
        workspaceId: workspace?.id,
        codePath: 'AgentIpcProxy.activateAgent',
      });
      await pendingOperation.catch(() => {}); // Wait for it to finish, ignore errors
      // Now proceed normally — the agent may already exist
    }

    // Create the activation promise and store it in the mutex map
    const activationPromise = this._doActivateAgent(agentId, workspace);
    this.agentOperationMutex.set(agentId, activationPromise);

    try {
      return await activationPromise;
    } finally {
      this.agentOperationMutex.delete(agentId);
    }
  }

  /**
   * Internal implementation of agent activation (called under mutex)
   */
  private async _doActivateAgent(agentId: string, workspace?: any) {
    try {
      // The IPC handler expects sessionId, agentId, and workspaceId
      // Extract only the workspace ID from the workspace object
      agentProxiesLogger.info('Activating agent', {
        agentId,
        agentIdType: typeof agentId,
        workspaceType: typeof workspace,
        hasWorkspace: !!workspace,
        workspaceId: workspace?.id,
      });

      // Validate workspace - MUST have a valid workspace with ID
      if (!workspace?.id) {
        const errorMsg = 'activateAgent called with invalid workspace - workspace ID is required';
        agentProxiesLogger.error(errorMsg, {
          agentId,
          workspace,
          hasWorkspace: !!workspace,
          workspaceKeys: workspace ? Object.keys(workspace) : [],
          stack: new Error().stack,
        });
        throw new Error(errorMsg);
      }

      // Ensure agentId is a string
      const id = String(agentId);

      // Extract workspace ID - we know it exists from validation above
      const workspaceId = String(workspace.id);

      // Create a clean object with only serializable data
      const params = {
        agentId: id,
        sessionId: id, // Use agentId as sessionId for activation
        workspaceId, // Include workspace ID for loading from disk
      };

      agentProxiesLogger.info('IPC params for agent:activate', {
        params,
        paramsType: typeof params,
        paramsKeys: Object.keys(params),
      });

      const response = (await invoke(AGENT_CHANNELS.ACTIVATE, params)) as any;

      // The response should contain the backendSessionId and agent
      agentProxiesLogger.info('Activation response received', {
        agentId,
        hasResponse: !!response,
        responseType: typeof response,
        responseKeys: response ? Object.keys(response) : [],
        hasData: !!response?.data,
        dataType: response?.data ? typeof response.data : 'undefined',
        hasBackendSessionId: !!response?.data?.backendSessionId,
        backendSessionId: response?.data?.backendSessionId,
        hasAgent: !!response?.data?.agent,
        fullResponse: response,
      });

      // Check if response or response.data is undefined
      if (!response) {
        agentProxiesLogger.error('No response received from agent activation');
        return null;
      }

      // Check if response is the agent directly (not wrapped in data)
      if (response.id && response.workspaceId) {
        agentProxiesLogger.info('Response is agent directly', { agentId: response.id });
        return response;
      }

      if (!response.data) {
        agentProxiesLogger.error('Response has no data property and is not an agent', { response });
        return null;
      }

      // If we have an agent object, update it with the correct backendSessionId
      if (response.data.agent) {
        const agent = response.data.agent;
        // Update the agent with the correct backendSessionId from the response
        // The backend returns the real session ID separately
        if (response.data.backendSessionId) {
          agent.backendSessionId = response.data.backendSessionId;
          agent.id = response.data.backendSessionId; // Also set id to match for compatibility
        }
        agentProxiesLogger.info('Returning activated agent with updated sessionId', {
          agentId: agent.id,
          backendSessionId: agent.backendSessionId,
          messageCount: agent.messages?.length || 0,
          hasMessages: !!agent.messages,
          messagesArray: Array.isArray(agent.messages),
        });
        return agent;
      }

      // Fallback: return the response data
      return response.data;
    } catch (error) {
      agentProxiesLogger.error('Failed to activate agent:', error);
      throw error;
    }
  }

  async deleteAgent(agentId: string, workspace?: Workspace, options?: { softDelete?: boolean }) {
    try {
      agentProxiesLogger.info('[AgentIpcProxy] deleteAgent called', {
        agentId,
        workspaceId: workspace?.id,
        softDelete: options?.softDelete,
      });

      // Pass workspaceId to the IPC handler to ensure deletion even if agent not in backend sessions
      agentProxiesLogger.info('[AgentIpcProxy] Invoking DELETE_SESSION IPC', {
        agentId,
        workspaceId: workspace?.id,
      });
      const response = (await invoke(AGENT_CHANNELS.DELETE_SESSION, {
        agentId,
        sessionId: agentId, // Include sessionId for backward compatibility
        workspaceId: workspace?.id,
      })) as any;
      agentProxiesLogger.info('[AgentIpcProxy] DELETE_SESSION response', { response });

      // No need to also call unifiedOrchestrator since backend now handles it

      return response.data;
    } catch (error) {
      agentProxiesLogger.error('[AgentIpcProxy] Failed to delete agent:', error);
      throw error;
    }
  }
}

// Export with clear naming to avoid confusion with UnifiedAgentFactory
export const agentIpcProxy = new AgentIpcProxy();

// Persistence Service Proxy
export class PersistenceService {
  // Cache for loadSession to prevent duplicate IPC calls
  private loadSessionCache = new Map<
    string,
    { data: any; timestamp: number; promise?: Promise<any> }
  >();
  private readonly LOAD_SESSION_CACHE_TTL_MS = 5000; // 5 second TTL

  // Debounce timers for saveSession to batch rapid saves
  private saveDebounceTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private pendingSaves = new Map<string, { session: AgentSession; workspaceId: string }>();
  private readonly SAVE_DEBOUNCE_MS = 500; // 500ms debounce for non-immediate saves

  async save(key: string, data: any) {
    try {
      await invoke(PERSISTENCE_CHANNELS.SAVE, { key, data });
    } catch (error) {
      agentProxiesLogger.error('Failed to save:', error);
      // Fallback to localStorage
      localStorage.setItem(key, JSON.stringify(data));
    }
  }

  async saveSession(session: AgentSession, workspaceId: string, options?: { immediate?: boolean }) {
    // Guard: session must have required fields
    if (!session || !session.id || !Array.isArray(session.messages) || !session.status) {
      agentProxiesLogger.warn('Cannot save session: missing required fields', {
        hasSession: !!session,
        hasId: !!session?.id,
        sessionId: session?.id,
        hasMessages: Array.isArray(session?.messages),
        hasStatus: !!session?.status,
        status: session?.status,
        sessionKeys: session ? Object.keys(session).join(',') : 'N/A',
      });
      return;
    }

    // Guard: workspaceId is required for IPC validation
    if (!workspaceId) {
      agentProxiesLogger.warn('Cannot save session: workspaceId is undefined', {
        agentId: session?.id,
        sessionHasWorkspaceId: !!(session as any)?.workspaceId,
      });
      return;
    }

    const agentId = session.id;

    // For immediate saves, execute right away (used for critical saves like before page unload)
    if (options?.immediate) {
      // Cancel any pending debounced save for this agent
      const existingTimer = this.saveDebounceTimers.get(agentId);
      if (existingTimer) {
        clearTimeout(existingTimer);
        this.saveDebounceTimers.delete(agentId);
        this.pendingSaves.delete(agentId);
      }

      return this.doSaveSession(session, workspaceId);
    }

    // For non-immediate saves, debounce to batch rapid updates
    // Store the latest session data (newer data overwrites older)
    this.pendingSaves.set(agentId, { session, workspaceId });

    // Cancel existing timer if any
    const existingTimer = this.saveDebounceTimers.get(agentId);
    if (existingTimer) {
      clearTimeout(existingTimer);
    }

    // Set new debounce timer
    const timer = setTimeout(() => {
      const pending = this.pendingSaves.get(agentId);
      if (pending) {
        this.pendingSaves.delete(agentId);
        this.saveDebounceTimers.delete(agentId);
        this.doSaveSession(pending.session, pending.workspaceId).catch((error) => {
          agentProxiesLogger.error('Failed to save debounced session:', error);
        });
      }
    }, this.SAVE_DEBOUNCE_MS);

    this.saveDebounceTimers.set(agentId, timer);
  }

  private async doSaveSession(session: AgentSession, workspaceId: string): Promise<void> {
    try {
      // Ensure session is serializable for IPC
      // Use try-catch to handle "Maximum call stack size exceeded" errors
      // that can occur with deeply nested message content blocks
      let serializableSession: AgentSession;
      try {
        serializableSession = JSON.parse(JSON.stringify(session));
      } catch (serializeError) {
        // If serialization fails (e.g., stack overflow), try with truncated messages
        agentProxiesLogger.warn('Session serialization failed, trying minimal save:', {
          agentId: session.id,
          messageCount: session.messages?.length,
          error: serializeError instanceof Error ? serializeError.message : String(serializeError),
        });

        // Create a minimal session with just essential fields
        serializableSession = {
          ...session,
          messages: session.messages?.slice(-50) || [], // Keep only last 50 messages
        } as AgentSession;

        try {
          serializableSession = JSON.parse(JSON.stringify(serializableSession));
        } catch (retryError) {
          // If even truncated version fails, save without messages
          agentProxiesLogger.error('Cannot serialize session even with truncation:', {
            agentId: session.id,
          });
          serializableSession = {
            ...session,
            messages: [],
          } as AgentSession;
          serializableSession = JSON.parse(JSON.stringify(serializableSession));
        }
      }

      await invoke(PERSISTENCE_CHANNELS.SAVE_SESSION, {
        session: serializableSession,
        workspaceId,
        options: { immediate: true },
      });
    } catch (error) {
      agentProxiesLogger.error('Failed to save session:', error);
    }
  }

  async load(key: string) {
    try {
      const response = (await invoke(PERSISTENCE_CHANNELS.LOAD, { key })) as any;
      return response.data;
    } catch (error) {
      // Fallback to localStorage
      const data = localStorage.getItem(key);
      return data ? JSON.parse(data) : null;
    }
  }

  async loadAgentConfig(agentId: string, workspaceId?: string) {
    try {
      // Validate agentId
      if (!agentId) {
        agentProxiesLogger.warn('loadAgentConfig called with empty agentId');
        return null;
      }

      // Debug: log what we're receiving
      if (typeof agentId === 'object') {
        agentProxiesLogger.warn('loadAgentConfig received object instead of string:', {
          type: typeof agentId,
          constructor: (agentId as any)?.constructor?.name,
          value: agentId,
        });
      }

      // Ensure agentId is a plain string (not a Proxy)
      const plainAgentId = agentId ? String(agentId) : '';

      // Get workspace ID from parameter or session store
      let finalWorkspaceId = workspaceId;
      if (!finalWorkspaceId) {
        const workspace = unifiedStateStore.currentWorkspace;
        const agent = workspace?.agents.get(plainAgentId);
        finalWorkspaceId = agent?.session.workspaceId || '';
      }

      const response = (await invoke(PERSISTENCE_CHANNELS.LOAD_AGENT_CONFIG, {
        agentId: plainAgentId,
        workspaceId: finalWorkspaceId,
      })) as { data: any };
      return response.data;
    } catch (error) {
      agentProxiesLogger.error('Failed to load agent config:', error as Error);
      return null;
    }
  }

  async loadSession(agentId: string, workspaceId?: string) {
    // Validate agentId
    if (!agentId) {
      agentProxiesLogger.warn('loadSession called with empty agentId');
      return null;
    }

    // Validate workspaceId - required for the IPC call
    if (!workspaceId) {
      agentProxiesLogger.warn('loadSession called without workspaceId', { agentId });
      return null;
    }

    // Ensure IDs are plain strings (not Proxies)
    const plainAgentId = agentId ? String(agentId) : '';
    const plainWorkspaceId = String(workspaceId);
    const cacheKey = `${plainWorkspaceId || 'unknown'}/${plainAgentId}`;

    // Check for in-flight request (dedupe concurrent calls)
    const cached = this.loadSessionCache.get(cacheKey);
    if (cached?.promise) {
      agentProxiesLogger.debug('Waiting for in-flight loadSession request', {
        agentId: plainAgentId,
        workspaceId: plainWorkspaceId,
      });
      return cached.promise;
    }

    // Check for cached data that's still fresh
    const now = Date.now();
    if (cached && now - cached.timestamp < this.LOAD_SESSION_CACHE_TTL_MS) {
      agentProxiesLogger.debug('Returning cached loadSession data', {
        agentId: plainAgentId,
        workspaceId: plainWorkspaceId,
        cacheAge: now - cached.timestamp,
      });
      return cached.data;
    }

    // Create promise for deduplication
    const loadPromise = (async () => {
      try {
        const response = (await invoke(PERSISTENCE_CHANNELS.LOAD_SESSION, {
          agentId: plainAgentId,
          workspaceId: plainWorkspaceId,
        })) as { success: boolean; data: any; error?: string };

        agentProxiesLogger.debug('loadSession response from IPC', {
          agentId: plainAgentId,
          workspaceId: plainWorkspaceId,
          success: response?.success,
          hasData: !!response?.data,
        });

        return response?.data || null;
      } catch (error) {
        agentProxiesLogger.error('Failed to load session:', error as Error);
        return null;
      }
    })();

    // Store promise for deduplication
    this.loadSessionCache.set(cacheKey, {
      data: cached?.data || null,
      timestamp: now,
      promise: loadPromise,
    });

    // Execute and cache result
    const result = await loadPromise;

    // Update cache with result (clear promise)
    this.loadSessionCache.set(cacheKey, {
      data: result,
      timestamp: Date.now(),
      promise: undefined,
    });

    return result;
  }

  async loadMessages(agentId: string, workspaceId: string): Promise<any[] | null> {
    try {
      // First try to load the full session which includes messages
      const session = await this.loadSession(agentId, workspaceId);
      if (session && session.messages) {
        agentProxiesLogger.info('Loaded messages from session', {
          agentId,
          workspaceId,
          messageCount: session.messages.length,
        });
        return session.messages;
      }

      // If no session found, return empty array
      agentProxiesLogger.debug('No session found for messages', { agentId, workspaceId });
      return [];
    } catch (error) {
      agentProxiesLogger.error('Failed to load messages:', error as Error);
      return null;
    }
  }

  async delete(key: string) {
    try {
      await invoke(PERSISTENCE_CHANNELS.DELETE, { key });
    } catch (error) {
      agentProxiesLogger.warn(
        'Failed to delete via IPC, falling back to localStorage:',
        error as Error,
      );
      localStorage.removeItem(key);
    }
  }
}
export const persistenceService = new PersistenceService();

// Agent Lifecycle Service Proxy
export class AgentLifecycleService {
  async start(agentId: string) {
    try {
      await invoke(AGENT_CHANNELS.LIFECYCLE_START, { agentId });
    } catch (error) {
      agentProxiesLogger.error('Failed to start agent:', error);
    }
  }

  async stop(agentId: string) {
    try {
      await invoke(AGENT_CHANNELS.LIFECYCLE_STOP, { agentId });
    } catch (error) {
      agentProxiesLogger.error('Failed to stop agent:', error);
    }
  }
}
export const agentLifecycleService = new AgentLifecycleService();

// Agent Messaging Service Proxy
export class AgentMessagingService {
  async sendMessage(agentId: string, message: any) {
    try {
      await invoke(AGENT_CHANNELS.MESSAGING_SEND, { agentId, message });
    } catch (error) {
      agentProxiesLogger.error('Failed to send message:', error);
    }
  }

  async receiveMessage(agentId: string) {
    try {
      const response = (await invoke(AGENT_CHANNELS.MESSAGING_RECEIVE, { agentId })) as any;
      return response.data;
    } catch (error) {
      agentProxiesLogger.error('Failed to receive message:', error);
      return null;
    }
  }
}
export const agentMessagingService = new AgentMessagingService();

// ============================================================================
// Streaming Service Proxy
// ============================================================================
// Provides a simplified interface for streaming operations
// Delegates to StreamManager for actual stream management

import { StreamManager } from '$features/agent/services/stream-manager';

class StreamingServiceProxy {
  private streamManager = StreamManager.getInstance();

  async startStream(
    agentId: string,
    sessionId: string,
    workspaceId: string,
    callbacks?: {
      onChunk?: (chunk: string) => void;
      onComplete?: () => Promise<void>;
      onError?: (error: Error) => void;
    },
  ): Promise<void> {
    this.streamManager.startStream(
      {
        agentId,
        sessionId,
        workspaceId: WorkspaceId(workspaceId),
      },
      callbacks
        ? {
            onChunk: callbacks.onChunk,
            onComplete: callbacks.onComplete,
            onError: callbacks.onError,
          }
        : undefined,
    );
  }

  async stopStream(agentId: string): Promise<void> {
    this.streamManager.cancelStream(agentId);
  }

  getStats() {
    return this.streamManager.getMetrics();
  }
}

export const streamingService = new StreamingServiceProxy();

// ============================================================================
// Recovery Service Proxy
// ============================================================================
// Provides session recovery tracking for streaming sessions
// Tracks which agents are streaming and need recovery on page reload

class RecoveryServiceProxy {
  private streamingAgents = new Set<string>();
  private recoveryData = new Map<
    string,
    { agentId: string; workspaceId: string; timestamp: number }
  >();

  async needsRecovery(agentId: string, _workspaceId: string): Promise<boolean> {
    // Check if there's recovery data for this agent
    return this.recoveryData.has(agentId);
  }

  async recoverSession(session: AgentSession, _workspaceId: string): Promise<AgentSession> {
    // Clear recovery data after recovery
    this.recoveryData.delete(session.id);
    return session;
  }

  async markStreaming(agentId: string): Promise<void> {
    this.streamingAgents.add(agentId);
  }

  async markComplete(agentId: string): Promise<void> {
    this.streamingAgents.delete(agentId);
    this.recoveryData.delete(agentId);
  }

  async getStats(): Promise<{ streamingAgents: number; recoveryPending: number }> {
    return {
      streamingAgents: this.streamingAgents.size,
      recoveryPending: this.recoveryData.size,
    };
  }
}

export const recoveryService = new RecoveryServiceProxy();
