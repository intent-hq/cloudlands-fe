/**
 * Chat Stream Registry
 *
 * Module-level runtime state for non-serializable stream handler references
 * used by ChatService's streaming lifecycle. Moved out of ChatService class
 * fields so the lifecycle can be managed by sagas.
 *
 * These Maps hold function references and cleanup callbacks that cannot
 * live in Redux state (non-serializable).
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

/** DOM event handlers registered by ChatService per sessionId */
const streamHandlers = new Map<string, (data: any) => void>();

/** Cleanup callbacks for session-updated DOM listeners per sessionId */
const sessionUpdatedCleanups = new Map<string, () => void>();

/** Stream timeout cleanup handles per sessionId */
const streamTimeouts = new Map<string, { cleanup: () => void }>();

/** Connection change handler (online/offline) — singleton */
let connectionHandler: ((e: Event) => void) | null = null;

// ---------------------------------------------------------------------------
// streamHandlers accessors
// ---------------------------------------------------------------------------

export function hasStreamHandler(sessionId: string): boolean {
  return streamHandlers.has(sessionId);
}

export function getStreamHandler(sessionId: string): ((data: any) => void) | undefined {
  return streamHandlers.get(sessionId);
}

export function setStreamHandler(sessionId: string, handler: (data: any) => void): void {
  streamHandlers.set(sessionId, handler);
}

export function deleteStreamHandler(sessionId: string): boolean {
  return streamHandlers.delete(sessionId);
}

export function getStreamHandlerKeys(): string[] {
  return Array.from(streamHandlers.keys());
}

export function forEachStreamHandler(fn: (handler: (data: any) => void, sessionId: string) => void): void {
  streamHandlers.forEach(fn);
}

export function clearAllStreamHandlers(): void {
  streamHandlers.clear();
}

// ---------------------------------------------------------------------------
// sessionUpdatedCleanups accessors
// ---------------------------------------------------------------------------

export function getSessionUpdatedCleanup(sessionId: string): (() => void) | undefined {
  return sessionUpdatedCleanups.get(sessionId);
}

export function setSessionUpdatedCleanup(sessionId: string, cleanup: () => void): void {
  sessionUpdatedCleanups.set(sessionId, cleanup);
}

export function deleteSessionUpdatedCleanup(sessionId: string): boolean {
  return sessionUpdatedCleanups.delete(sessionId);
}

export function forEachSessionUpdatedCleanup(fn: (cleanup: () => void) => void): void {
  sessionUpdatedCleanups.forEach(fn);
}

export function clearAllSessionUpdatedCleanups(): void {
  sessionUpdatedCleanups.clear();
}

// ---------------------------------------------------------------------------
// streamTimeouts accessors
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

export function forEachStreamTimeout(fn: (timeout: { cleanup: () => void }) => void): void {
  streamTimeouts.forEach(fn);
}

export function clearAllStreamTimeouts(): void {
  streamTimeouts.clear();
}

// ---------------------------------------------------------------------------
// connectionHandler accessors
// ---------------------------------------------------------------------------

export function getConnectionHandler(): ((e: Event) => void) | null {
  return connectionHandler;
}

export function setConnectionHandler(handler: ((e: Event) => void) | null): void {
  connectionHandler = handler;
}

