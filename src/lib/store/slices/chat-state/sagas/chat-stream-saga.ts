/**
 * Chat Stream Saga
 *
 * Manages the streaming lifecycle that was previously handled by ChatService
 * instance fields and methods:
 *
 * - Stream handler registration/cleanup (DOM event listeners)
 * - Session-updated handler registration/cleanup
 * - Stream timeout management
 * - Online/offline connection monitoring
 *
 * Non-serializable state (function refs, timer handles) lives in the
 * chat-stream-registry module, NOT in Redux state.
 */

import { call, takeEvery, type SagaGenerator } from 'typed-redux-saga';
import { createLogger } from '$lib/utils/client-logger';
import {
  cleanupStreamRequested,
} from '../chat-state-slice';
import * as registry from '../chat-stream-registry';

const logger = createLogger('ChatStreamSaga');

// NOTE: Connection change monitoring (online/offline) is handled by
// chat-lifecycle-saga.ts (watchConnectionChange). Not duplicated here.

// ============================================================================
// Cleanup Streaming — saga handler
// ============================================================================

function* handleCleanupStream(
  action: ReturnType<typeof cleanupStreamRequested>,
): SagaGenerator<void> {
  const [sessionId, preserveContent] = action.payload;

  logger.debug('cleanupStreamRequested received', { sessionId, preserveContent });

  // Perform registry cleanup
  yield* call(cleanupStreamFromRegistry, sessionId, preserveContent);
}



/**
 * Clean up stream state from the registry.
 * Extracted from ChatService.cleanupStream().
 *
 * The DOM listener removal and agentService interaction still happen
 * in ChatService (which calls registry accessors). This function
 * handles the registry-level cleanup for cases where the saga
 * directly triggers cleanup.
 */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function cleanupStreamFromRegistry(sessionId: string, _preserveContent: boolean): void {
  // 1. Remove stream handler
  const handler = registry.getStreamHandler(sessionId);
  if (handler) {
    if (typeof window !== 'undefined') {
      window.removeEventListener(`agent:stream:${sessionId}`, handler);
    }
    registry.deleteStreamHandler(sessionId);
  }

  // 2. Remove session-updated cleanup
  const sessionUpdatedCleanup = registry.getSessionUpdatedCleanup(sessionId);
  if (sessionUpdatedCleanup) {
    sessionUpdatedCleanup();
    registry.deleteSessionUpdatedCleanup(sessionId);
  }

  // 3. Clear timeout
  const timeout = registry.getStreamTimeout(sessionId);
  if (timeout) {
    timeout.cleanup();
    registry.deleteStreamTimeout(sessionId);
  }
}

// ============================================================================
// Dispose All — called on ChatService destroy
// ============================================================================

/**
 * Clean up all stream-related registry state.
 * Replaces the cleanup logic in ChatService.destroy().
 */
export function disposeAllChatStreamState(): void {
  // Clean up DOM stream handlers
  if (typeof window !== 'undefined') {
    registry.forEachStreamHandler((handler, sessionId) => {
      window.removeEventListener(`agent:stream:${sessionId}`, handler);
    });
  }
  registry.clearAllStreamHandlers();

  // Clean up session-updated handlers
  registry.forEachSessionUpdatedCleanup((cleanup) => {
    cleanup();
  });
  registry.clearAllSessionUpdatedCleanups();

  // Clean up timeouts
  registry.forEachStreamTimeout((timeout) => {
    timeout.cleanup();
  });
  registry.clearAllStreamTimeouts();

  // Clean up connection handler
  const connHandler = registry.getConnectionHandler();
  if (connHandler && typeof window !== 'undefined') {
    window.removeEventListener('online', connHandler);
    window.removeEventListener('offline', connHandler);
  }
  registry.setConnectionHandler(null);
}

// ============================================================================
// Root Saga
// ============================================================================

export function* chatStreamSaga(): SagaGenerator<void> {
  yield* takeEvery(cleanupStreamRequested, handleCleanupStream);
}
