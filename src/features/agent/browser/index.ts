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
import { selectActiveWorkspaceId } from '$store/renderer/slices/workspace/workspace-selectors';



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

// Export the config cache proxy (communicates with main process)
export { configCache, ConfigCacheProxyService } from './config-cache-proxy.service';

// Create IPC proxies for services that need Node.js APIs
import { invoke } from '$lib/electron-bridge';
import { PERSISTENCE_CHANNELS } from '$shared/ipc/channels';
import type { AgentSession } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';


const agentProxiesLogger = createLogger('AgentProxies');

// The former AgentIpcProxy (agent:create/activate/delete-session), agent
// lifecycle (agent:lifecycle:*) and messaging (agent:messaging:*) IPC proxies
// were retired with the legacy agent IPC surface: none had production callers
// (agent creation goes through UnifiedAgentFactory, deletion through the
// agent-mutation middleware's soft-hide-then-commit → daemon agent.delete).
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
  private pendingSaves = new Map<string, { session: AgentSession; workspaceId: string; allowTruncation?: boolean }>();
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

  async saveSession(session: AgentSession, workspaceId: string, options?: { immediate?: boolean; allowTruncation?: boolean }) {
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

      return this.doSaveSession(session, workspaceId, options?.allowTruncation);
    }

    // For non-immediate saves, debounce to batch rapid updates
    // Store the latest session data (newer data overwrites older)
    this.pendingSaves.set(agentId, { session, workspaceId, allowTruncation: options?.allowTruncation });

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
        this.doSaveSession(pending.session, pending.workspaceId, pending.allowTruncation).catch((error) => {
          agentProxiesLogger.error('Failed to save debounced session:', error);
        });
      }
    }, this.SAVE_DEBOUNCE_MS);

    this.saveDebounceTimers.set(agentId, timer);
  }

  private async doSaveSession(session: AgentSession, workspaceId: string, allowTruncation?: boolean): Promise<void> {
    try {
      // Ensure session is serializable for IPC
      // Use structuredClone for deep cloning — faster than JSON round-trip
      // and doesn't create an intermediate string representation
      let serializableSession: AgentSession;

      const estimatedSize = session.messages?.length ?? 0;
      agentProxiesLogger.debug('Saving session', {
        agentId: session.id,
        messageCount: estimatedSize,
      });

      try {
        serializableSession = structuredClone(session);
      } catch (serializeError) {
        // If clone fails (e.g., non-cloneable values), try with truncated messages
        agentProxiesLogger.warn('Session clone failed, trying minimal save:', {
          agentId: session.id,
          messageCount: estimatedSize,
          error: serializeError instanceof Error ? serializeError.message : String(serializeError),
        });

        // Create a minimal session with just essential fields
        serializableSession = {
          ...session,
          messages: session.messages?.slice(-50) || [], // Keep only last 50 messages
        } as AgentSession;

        try {
          serializableSession = structuredClone(serializableSession);
        } catch {
          // If even truncated version fails, save without messages
          agentProxiesLogger.error('Cannot clone session even with truncation:', {
            agentId: session.id,
          });
          serializableSession = {
            ...session,
            messages: [],
          } as AgentSession;
          try {
            serializableSession = structuredClone(serializableSession);
          } catch {
            // Last resort: JSON round-trip handles most non-cloneable values
            serializableSession = JSON.parse(JSON.stringify(serializableSession));
          }
        }
      }

      await invoke(PERSISTENCE_CHANNELS.SAVE_SESSION, {
        session: serializableSession,
        workspaceId,
        options: { immediate: true, allowTruncation },
      });
    } catch (saveError) {
      agentProxiesLogger.error('Failed to save session:', saveError);
    }
  }

  async load(key: string) {
    try {
      const response = (await invoke(PERSISTENCE_CHANNELS.LOAD, { key })) as any;
      return response.data;
    } catch {
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

      // Get workspace ID from parameter or Redux state
      let finalWorkspaceId = workspaceId;
      if (!finalWorkspaceId) {
        const reduxState = appStore.state;
        const wsId = selectActiveWorkspaceId.select(reduxState) ?? '';
        const agent = wsId ? selectAgentSession.select(reduxState, plainAgentId) : undefined;
        finalWorkspaceId = (agent?.workspaceId as string) || wsId || '';
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

  async loadSession(agentId: string, workspaceId?: string, options?: { bypassCache?: boolean }) {
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

    const bypassCache = options?.bypassCache === true;

    // Check for in-flight request (dedupe concurrent calls) — still dedupe even when bypassing cache
    const cached = this.loadSessionCache.get(cacheKey);
    if (!bypassCache && cached?.promise) {
      agentProxiesLogger.debug('Waiting for in-flight loadSession request', {
        agentId: plainAgentId,
        workspaceId: plainWorkspaceId,
      });
      return cached.promise;
    }

    // Check for cached data that's still fresh (skip when bypassing cache)
    const now = Date.now();
    if (!bypassCache && cached && now - cached.timestamp < this.LOAD_SESSION_CACHE_TTL_MS) {
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
