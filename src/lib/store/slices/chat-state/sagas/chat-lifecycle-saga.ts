/**
 * Chat Lifecycle Saga
 *
 * Handles DOM-level lifecycle concerns that were previously instance fields on the chat service:
 * - connection event listener → eventChannel watching window online/offline
 * - `disposed` flag → unnecessary, saga cancellation handles lifecycle
 * - `lastDestroyTimestamp` / `isRecentRemount()` → dead code, removed entirely
 *
 * These are global (not per-agent) because DOM events apply to the whole tab.
 */

import {
  fork,
  take,
  type SagaGenerator,
} from 'typed-redux-saga';
import {
  eventChannel,
  type EventChannel,
  END,
} from 'redux-saga';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('ChatLifecycleSaga');

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

/**
 * Logs connection status changes. Previously lived on the chat service as
 * a connection event listener plus `handleConnectionChange` — pure logging, no state.
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
  yield* fork(watchConnectionChange);
}

