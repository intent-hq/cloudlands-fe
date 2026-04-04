/**
 * Chat Lifecycle Saga
 *
 * Handles DOM-level lifecycle concerns that were previously instance fields on ChatService:
 * - `visibilityChangeHandler` → eventChannel watching document.visibilitychange
 * - `connectionHandler` → eventChannel watching window online/offline
 * - `disposed` flag → unnecessary, saga cancellation handles lifecycle
 * - `lastDestroyTimestamp` / `isRecentRemount()` → dead code, removed entirely
 *
 * These are global (not per-agent) because DOM events apply to the whole tab.
 */

import { fork, take, select, type SagaGenerator } from 'typed-redux-saga';
import { eventChannel, type EventChannel, END } from 'redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import { getChatService } from '$features/agent/services/chat.service';
import type { AgentSessionState } from '../../agent-session/agent-session-types';

const logger = createLogger('ChatLifecycleSaga');

// ============================================================================
// Visibility Change EventChannel
// ============================================================================

function createVisibilityChannel(): EventChannel<'visible' | 'hidden'> {
  return eventChannel((emitter) => {
    if (typeof document === 'undefined') {
      emitter(END);
      return () => {};
    }

    const handler = () => {
      emitter(document.visibilityState as 'visible' | 'hidden');
    };

    document.addEventListener('visibilitychange', handler);
    return () => {
      document.removeEventListener('visibilitychange', handler);
    };
  });
}

// ============================================================================
// Connection Change EventChannel
// ============================================================================

function createConnectionChannel(): EventChannel<boolean> {
  return eventChannel((emitter) => {
    if (typeof window === 'undefined') {
      emitter(END);
      return () => {};
    }

    const onlineHandler = () => emitter(true);
    const offlineHandler = () => emitter(false);

    window.addEventListener('online', onlineHandler);
    window.addEventListener('offline', offlineHandler);

    return () => {
      window.removeEventListener('online', onlineHandler);
      window.removeEventListener('offline', offlineHandler);
    };
  });
}

// ============================================================================
// Visibility Watcher
// ============================================================================

/**
 * When the browser tab returns to the foreground, RAF callbacks resume but any
 * streaming content accumulated while backgrounded hasn't been flushed yet.
 * This saga forces a flush for every agent that is currently processing.
 */
function* watchVisibilityChange(): SagaGenerator<void> {
  const channel = createVisibilityChannel();
  try {
    while (true) {
      const visibility: 'visible' | 'hidden' = yield* take(channel);
      if (visibility === 'visible') {
        const agentSessions: AgentSessionState | undefined = yield* select(
          (state: any) => state.agentSessions,
        );
        if (agentSessions?.byAgentId) {
          for (const [agentId, session] of Object.entries(agentSessions.byAgentId)) {
            if ((session as any)?.isProcessing) {
              try {
                const chatService = getChatService(agentId);
                chatService.flushPendingStreamingContent(agentId);
              } catch (e) {
                logger.debug('Failed to flush pending content on visibility restore', {
                  agentId,
                  error: e,
                });
              }
            }
          }
        }
      }
    }
  } finally {
    channel.close();
  }
}

// ============================================================================
// Connection Watcher
// ============================================================================

/**
 * Logs connection status changes. Previously lived on ChatService as
 * `connectionHandler` + `handleConnectionChange` — pure logging, no state.
 */
function* watchConnectionChange(): SagaGenerator<void> {
  const channel = createConnectionChannel();
  try {
    while (true) {
      const isOnline: boolean = yield* take(channel);
      if (!isOnline) {
        logger.warn('Connection lost - streaming may be interrupted');
      } else {
        logger.info('Connection restored');
      }
    }
  } finally {
    channel.close();
  }
}

// ============================================================================
// Root Saga
// ============================================================================

export function* chatLifecycleSaga(): SagaGenerator<void> {
  yield* fork(watchVisibilityChange);
  yield* fork(watchConnectionChange);
}

