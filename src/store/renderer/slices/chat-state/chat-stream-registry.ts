/**
 * Chat Stream Registry
 *
 * Module-level runtime state for non-serializable timeout handles used by the
 * chat stream sagas. These handles cannot live in Redux state.
 */

import { AGENT_STREAMING_CONFIG } from '$shared/constants/agent-streaming';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Stream timeout duration — sourced from shared config */
export const STREAM_TIMEOUT_MS = AGENT_STREAMING_CONFIG.BACKEND_STREAM_TIMEOUT_MS;

// ---------------------------------------------------------------------------
// Module-level state (saga-managed, NOT in Redux)
// ---------------------------------------------------------------------------

/** Stream timeout cleanup handles per sessionId */
const streamTimeouts = new Map<string, { cleanup: () => void }>();

// ---------------------------------------------------------------------------
// streamTimeout accessors
// ---------------------------------------------------------------------------

export function getStreamTimeout(sessionId: string): { cleanup: () => void } | undefined {
  return streamTimeouts.get(sessionId);
}

export function setStreamTimeout(sessionId: string, timeout: { cleanup: () => void }): void {
  streamTimeouts.set(sessionId, timeout);
}

export function deleteStreamTimeout(sessionId: string): boolean {
  return streamTimeouts.delete(sessionId);
}

export function clearAllStreamTimeouts(): void {
  for (const timeout of streamTimeouts.values()) {
    timeout.cleanup();
  }
  streamTimeouts.clear();
}
