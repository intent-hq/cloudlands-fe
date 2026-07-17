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

// Re-export ContextItem from its canonical source for backward compatibility.
export type { ContextItem } from '$lib/components/chat/input/context-api';

import { createLogger } from '$lib/utils/client-logger';
import { store as appStore } from '$store/renderer/store';
import { selectAgentSession } from '$store/renderer/slices/agent-session/agent-session-selectors';
import type { AgentSession } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';



const logger = createLogger('browser/index');

type AgentSubscriberCallback = (session: AgentSession | undefined) => void;

// Per-agent subscribers for efficient updates during streaming.
const agentSubscribers = new Map<string, Set<AgentSubscriberCallback>>();

// Last session reference observed for each tracked agent id. Used for
// reference-equality change detection so unrelated store updates do not
// re-fire callbacks.
const lastSessionByAgent = new Map<string, AgentSession | undefined>();

// Lazy, shared Redux store subscription. Created on the first
// `subscribeToAgent` call and torn down when the last subscriber leaves.
let storeUnsubscribe: (() => void) | undefined;

function dispatchCallbacks(
  agentId: string,
  subscribers: Set<AgentSubscriberCallback>,
  session: AgentSession | undefined,
) {
  for (const callback of subscribers) {
    try {
      callback(session);
    } catch (e) {
      logger.error('Error in agent subscriber callback', { agentId, error: e });
    }
  }
}

function ensureStoreSubscription() {
  if (storeUnsubscribe) return;
  let didEmitInitialValue = false;
  storeUnsubscribe = appStore.getReadableState().subscribe(() => {
    if (!didEmitInitialValue) {
      didEmitInitialValue = true;
      return;
    }
    if (agentSubscribers.size === 0) return;
    const state = appStore.state;
    for (const [agentId, subscribers] of agentSubscribers) {
      const next = selectAgentSession.select(state, agentId);
      if (lastSessionByAgent.get(agentId) === next) continue;
      lastSessionByAgent.set(agentId, next);
      dispatchCallbacks(agentId, subscribers, next);
    }
  });
}

function teardownStoreSubscriptionIfEmpty() {
  if (agentSubscribers.size > 0 || !storeUnsubscribe) return;
  storeUnsubscribe();
  storeUnsubscribe = undefined;
  lastSessionByAgent.clear();
}

/**
 * Subscribe to updates for a specific agent.
 *
 * The callback is invoked synchronously once with the current value (or
 * `undefined`) and again whenever the Redux agent-session reference for
 * this agent changes. A single shared Redux subscription is created
 * lazily and torn down when the last subscriber unregisters.
 */
export function subscribeToAgent(
  agentId: string,
  callback: AgentSubscriberCallback,
  workspaceId?: string,
): () => void {
  let subscribers = agentSubscribers.get(agentId);
  const isNewAgent = !subscribers;
  if (!subscribers) {
    subscribers = new Set();
    agentSubscribers.set(agentId, subscribers);
  }
  subscribers.add(callback);

  // Ensure the shared Redux subscription is active before any callbacks run.
  ensureStoreSubscription();

  const state = appStore.state;
  const current = selectAgentSession.select(state, agentId);

  // Seed the last-seen session on first subscriber for this agent so the
  // shared listener only fires when the reference actually changes.
  if (isNewAgent) {
    lastSessionByAgent.set(agentId, current);
  }

  if (current) {
    logger.debug('[subscribeToAgent] Initial callback data', {
      agentId,
      workspaceId: workspaceId ?? 'current',
      hasSession: true,
    });
  } else {
    logger.debug('[subscribeToAgent] No session found', {
      agentId,
      workspaceId: workspaceId ?? 'current',
    });
  }
  callback(current);

  return () => {
    const subs = agentSubscribers.get(agentId);
    if (subs) {
      subs.delete(callback);
      if (subs.size === 0) {
        agentSubscribers.delete(agentId);
        lastSessionByAgent.delete(agentId);
      }
    }
    teardownStoreSubscriptionIfEmpty();
  };
}

/**
 * Force a fresh callback dispatch for a specific agent. Retained for
 * backwards compatibility with older manual notification callers; the shared store
 * subscription now handles the common case automatically.
 */
export function notifyAgentSubscribers(agentId: string, targetWorkspaceId?: WorkspaceId) {
  const subscribers = agentSubscribers.get(agentId);
  if (!subscribers || subscribers.size === 0) return;

  const state = appStore.state;
  const session = selectAgentSession.select(state, agentId);

  if (!session) {
    console.warn('[DIAG notifyAgentSubscribers] Agent NOT FOUND — subscribers get undefined', {
      agentId,
      targetWorkspaceId: targetWorkspaceId || 'current',
      subscriberCount: subscribers.size,
    });
  }

  // Keep the last-seen reference in sync so the shared listener does not
  // re-fire this same value on the very next store notification.
  lastSessionByAgent.set(agentId, session);
  dispatchCallbacks(agentId, subscribers, session);
}

// The former AgentIpcProxy (agent:create/activate/delete-session), agent
// lifecycle (agent:lifecycle:*), messaging (agent:messaging:*) and
// persistence (persistence:*) IPC proxies were retired with the legacy agent
// IPC surface: none had production callers (agent creation goes through
// UnifiedAgentFactory, deletion through the agent-mutation middleware's
// soft-hide-then-commit → daemon agent.delete, and persistence is owned by
// the daemon on the main side via direct agent.* RPCs, PROTOCOL.md §5.5).

// ============================================================================
// Stream store-shaper registration
// ============================================================================
// The stream manager lifecycle lives in the main process. Register the
// renderer store-shaper so stream activity is reflected into the renderer
// Redux store when the manager runs in a renderer context.

import { registerRendererStreamStoreShaper } from './stream-store-shaper';

registerRendererStreamStoreShaper();

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
