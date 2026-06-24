/**
 * Stream Handler Registry
 *
 * Module-level runtime bridge for non-serializable stream handler state.
 * Moved out of AgentService class fields so that stream lifecycle is
 * managed by sagas (agent-session/sagas/agent-stream-saga.ts) rather than the service singleton.
 *
 * These Maps/Sets hold function references, timer IDs, and listener IDs
 * that cannot live in Redux state (non-serializable).
 */

import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('StreamHandlerRegistry');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface StreamHandlerInfo {
  channel: string;
  handler: (data: any) => void;
  wrappedHandler?: any;
  workspaceId?: string;
  listenerId?: string;
  registeredAt?: number;
  cleanup?: () => void;
}

export interface PingHandlerInfo {
  channel: string;
  handler: (data: any) => void;
  listenerId?: string;
}

// ---------------------------------------------------------------------------
// Module-level state (saga-managed, NOT in Redux)
// ---------------------------------------------------------------------------

/** Active IPC stream handlers per agent */
const activeStreamHandlers = new Map<string, StreamHandlerInfo>();

/** Stream timeout timers per agent */
const streamTimeouts = new Map<string, NodeJS.Timeout>();

/** Pending stream handler registrations (race condition guard) */
const pendingStreamRegistrations = new Set<string>();

/** Agents whose sendMessage() is currently setting up a stream handler */
const sendMessageStreamSetup = new Set<string>();

/** IPC heartbeat ping handlers per agent */
const activePingHandlers = new Map<string, PingHandlerInfo>();

/** Safety timeout to force-clear stale streaming indicators */
let streamingSafetyTimeout: ReturnType<typeof setTimeout> | null = null;

// ---------------------------------------------------------------------------
// activeStreamHandlers accessors
// ---------------------------------------------------------------------------

export function hasStreamHandler(agentId: string): boolean {
  return activeStreamHandlers.has(agentId);
}

export function getStreamHandler(agentId: string): StreamHandlerInfo | undefined {
  return activeStreamHandlers.get(agentId);
}

export function setStreamHandler(agentId: string, info: StreamHandlerInfo): void {
  activeStreamHandlers.set(agentId, info);
}

export function deleteStreamHandler(agentId: string): boolean {
  return activeStreamHandlers.delete(agentId);
}

export function getStreamHandlerKeys(): string[] {
  return Array.from(activeStreamHandlers.keys());
}

export function getStreamHandlerEntries(): [string, StreamHandlerInfo][] {
  return Array.from(activeStreamHandlers.entries());
}

export function getStreamHandlerCount(): number {
  return activeStreamHandlers.size;
}

export function clearAllStreamHandlers(): void {
  activeStreamHandlers.clear();
}

// ---------------------------------------------------------------------------
// streamTimeouts accessors
// ---------------------------------------------------------------------------

export function getStreamTimeout(agentId: string): NodeJS.Timeout | undefined {
  return streamTimeouts.get(agentId);
}

export function setStreamTimeout(agentId: string, timeout: NodeJS.Timeout): void {
  streamTimeouts.set(agentId, timeout);
}

export function deleteStreamTimeout(agentId: string): boolean {
  return streamTimeouts.delete(agentId);
}

export function getStreamTimeoutKeys(): string[] {
  return Array.from(streamTimeouts.keys());
}

export function getStreamTimeoutCount(): number {
  return streamTimeouts.size;
}

export function clearAndCancelAllStreamTimeouts(): void {
  for (const timeout of streamTimeouts.values()) {
    clearTimeout(timeout);
  }
  streamTimeouts.clear();
}



// ---------------------------------------------------------------------------
// pendingStreamRegistrations accessors
// ---------------------------------------------------------------------------

export function hasPendingRegistration(agentId: string): boolean {
  return pendingStreamRegistrations.has(agentId);
}

export function addPendingRegistration(agentId: string): void {
  pendingStreamRegistrations.add(agentId);
}

export function deletePendingRegistration(agentId: string): boolean {
  return pendingStreamRegistrations.delete(agentId);
}

// ---------------------------------------------------------------------------
// sendMessageStreamSetup accessors
// ---------------------------------------------------------------------------

export function isSendMessageSettingUpStream(agentId: string): boolean {
  return sendMessageStreamSetup.has(agentId);
}

export function markSendMessageStreamSetup(agentId: string): void {
  sendMessageStreamSetup.add(agentId);
}

export function clearSendMessageStreamSetup(agentId: string): boolean {
  return sendMessageStreamSetup.delete(agentId);
}

// ---------------------------------------------------------------------------
// activePingHandlers accessors
// ---------------------------------------------------------------------------

export function getPingHandler(agentId: string): PingHandlerInfo | undefined {
  return activePingHandlers.get(agentId);
}

export function setPingHandler(agentId: string, info: PingHandlerInfo): void {
  activePingHandlers.set(agentId, info);
}

export function deletePingHandler(agentId: string): boolean {
  return activePingHandlers.delete(agentId);
}

export function getPingHandlerEntries(): [string, PingHandlerInfo][] {
  return Array.from(activePingHandlers.entries());
}

export function getPingHandlerCount(): number {
  return activePingHandlers.size;
}

export function clearAllPingHandlers(): void {
  activePingHandlers.clear();
}

// ---------------------------------------------------------------------------
// streamingSafetyTimeout accessors
// ---------------------------------------------------------------------------

export function getStreamingSafetyTimeout(): ReturnType<typeof setTimeout> | null {
  return streamingSafetyTimeout;
}

export function setStreamingSafetyTimeout(timeout: ReturnType<typeof setTimeout>): void {
  streamingSafetyTimeout = timeout;
}

export function clearStreamingSafetyTimeout(): void {
  if (streamingSafetyTimeout) {
    clearTimeout(streamingSafetyTimeout);
    streamingSafetyTimeout = null;
  }
}

// ---------------------------------------------------------------------------
// Composite operations
// ---------------------------------------------------------------------------

/**
 * Clean up all stream-related state for an agent:
 * IPC stream handler, ping handler, pending registration, and timeout.
 */
export function cleanupStreamHandler(agentId: string): void {
  // 1. Remove IPC stream handler
  const storedHandler = activeStreamHandlers.get(agentId);
  if (storedHandler) {
    logger.info('Cleaning up stream handler', { agentId, channel: storedHandler.channel });
    try {
      storedHandler.cleanup?.();
    } catch (e) {
      logger.debug('Error running stream handler cleanup', { agentId, error: e });
    }
    if (typeof window !== 'undefined' && window.electronAPI) {
      if (storedHandler.listenerId) {
        window.electronAPI.offById(storedHandler.channel, storedHandler.listenerId);
      } else {
        window.electronAPI.removeAllListeners(storedHandler.channel);
      }
    }
    activeStreamHandlers.delete(agentId);
  }

  // 2. Remove ping handler
  const pingHandler = activePingHandlers.get(agentId);
  if (pingHandler) {
    logger.debug('Cleaning up ping handler', { agentId, channel: pingHandler.channel });
    if (typeof window !== 'undefined' && window.electronAPI) {
      if (pingHandler.listenerId) {
        window.electronAPI.offById(pingHandler.channel, pingHandler.listenerId);
      } else {
        window.electronAPI.removeAllListeners(pingHandler.channel);
      }
    }
    activePingHandlers.delete(agentId);
  }

  // 3. Clear pending registration
  pendingStreamRegistrations.delete(agentId);

  // 4. Clear timeout
  const timeout = streamTimeouts.get(agentId);
  if (timeout) {
    clearTimeout(timeout);
    streamTimeouts.delete(agentId);
  }
}

/**
 * Clean up ALL stream state. Used by dispose() and forceClearCaches().
 */
export function disposeAllStreamState(): void {
  for (const [agentId, handler] of activeStreamHandlers.entries()) {
    try {
      handler.cleanup?.();
    } catch (e) {
      logger.debug('Error running stream handler cleanup', { agentId, error: e });
    }
  }

  // Clean up IPC stream handlers
  if (typeof window !== 'undefined' && window.electronAPI) {
    for (const [agentId, handler] of activeStreamHandlers.entries()) {
      try {
        if (handler.listenerId) {
          window.electronAPI.offById(handler.channel, handler.listenerId);
        } else {
          window.electronAPI.removeAllListeners(handler.channel);
        }
      } catch (e) {
        logger.debug('Error removing stream handler', { agentId, error: e });
      }
    }

    for (const [agentId, pingHandler] of activePingHandlers.entries()) {
      try {
        if (pingHandler.listenerId) {
          window.electronAPI.offById(pingHandler.channel, pingHandler.listenerId);
        } else {
          window.electronAPI.removeAllListeners(pingHandler.channel);
        }
      } catch (e) {
        logger.debug('Error removing ping handler', { agentId, error: e });
      }
    }
  }

  activeStreamHandlers.clear();
  activePingHandlers.clear();
  pendingStreamRegistrations.clear();
  sendMessageStreamSetup.clear();
  clearAndCancelAllStreamTimeouts();
  clearStreamingSafetyTimeout();
}

// ---------------------------------------------------------------------------
// HMR cleanup support
// ---------------------------------------------------------------------------

const HMR_CLEANUP_KEY = '__streamRegistry_hmr';

/** Persist references for HMR cleanup */
export function persistForHmr(): void {
  if (typeof window !== 'undefined') {
    (window as any)[HMR_CLEANUP_KEY] = {
      activeStreamHandlers,
      activePingHandlers,
      disposeAllStreamState,
    };
  }
}

/** Clean up orphaned handlers from previous HMR cycle */
export function cleanupPreviousHmrState(): void {
  if (typeof window === 'undefined') return;

  const prev = (window as any)[HMR_CLEANUP_KEY] as
    | {
        activeStreamHandlers?: Map<string, { channel: string; listenerId?: string }>;
        activePingHandlers?: Map<string, { channel: string; listenerId?: string }>;
        disposeAllStreamState?: () => void;
      }
    | undefined;

  if (!prev) return;

  if (typeof prev.disposeAllStreamState === 'function') {
    try {
      prev.disposeAllStreamState();
      return;
    } catch (e) {
      logger.debug('HMR cleanup: previous stream state disposer failed, falling back', { error: e });
    }
  }

  if (prev.activeStreamHandlers?.size) {
    logger.info('HMR cleanup: removing orphaned stream handlers', {
      count: prev.activeStreamHandlers.size,
    });
    for (const [, handler] of prev.activeStreamHandlers.entries()) {
      if (handler.listenerId && window.electronAPI) {
        window.electronAPI.offById(handler.channel, handler.listenerId);
      }
    }
    prev.activeStreamHandlers.clear();
  }

  if (prev.activePingHandlers?.size) {
    logger.info('HMR cleanup: removing orphaned ping handlers', {
      count: prev.activePingHandlers.size,
    });
    for (const [, handler] of prev.activePingHandlers.entries()) {
      if (handler.listenerId && window.electronAPI) {
        window.electronAPI.offById(handler.channel, handler.listenerId);
      }
    }
    prev.activePingHandlers.clear();
  }
}

// Run HMR cleanup on module load
cleanupPreviousHmrState();