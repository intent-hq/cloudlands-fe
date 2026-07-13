/**
 * AgentSession Type Guards
 *
 * Runtime type checking functions for AgentSession and related types.
 * These guards ensure type safety at runtime.
 *
 * Note: isPendingAgentSession is defined in agent-session.ts
 */

import type { AgentSession, PendingAgentSession } from './agent-session';
import { isPendingAgentSession } from './agent-session';
import { AgentStatus } from './agent.types';

// Re-export isPendingAgentSession for convenience
export { isPendingAgentSession };

/**
 * Check if an object is a valid AgentSession
 */
export function isAgentSession(obj: any): obj is AgentSession {
  if (!obj || typeof obj !== 'object') return false;

  // Required fields
  if (typeof obj.id !== 'string') return false;
  if (typeof obj.workspaceId !== 'string') return false;
  if (typeof obj.name !== 'string') return false;
  if (!Array.isArray(obj.messages)) return false;

  // Status should be a valid AgentStatus
  const validStatuses = Object.values(AgentStatus);
  if (!validStatuses.includes(obj.status)) return false;

  // backendSessionId should be string | null
  if (obj.backendSessionId !== null && typeof obj.backendSessionId !== 'string') {
    return false;
  }

  // isPending should not be true for active sessions
  if (obj.isPending === true) return false;

  return true;
}

/**
 * Check if a session has a backend session ID
 */
export function hasBackendSession(session: AgentSession | PendingAgentSession | any): boolean {
  return (
    session &&
    session.backendSessionId !== null &&
    session.backendSessionId !== undefined &&
    typeof session.backendSessionId === 'string'
  );
}

/**
 * Check if a session is active (not pending and has backend connection)
 */
export function isActiveSession(session: any): session is AgentSession {
  return isAgentSession(session) && hasBackendSession(session);
}

/**
 * Check if a session is in error state
 */
export function isErrorSession(session: AgentSession | PendingAgentSession | any): boolean {
  return session && session.status === AgentStatus.Error;
}

/**
 * Check if a session is currently streaming
 */
export function isStreamingSession(session: AgentSession | PendingAgentSession | any): boolean {
  return session && session.isStreaming === true;
}

/**
 * Check if a session is currently processing
 */
export function isProcessingSession(session: AgentSession | PendingAgentSession | any): boolean {
  return session && session.isProcessing === true;
}

/**
 * Check if a session is a background agent
 */
export function isBackgroundSession(session: AgentSession | PendingAgentSession | any): boolean {
  return session && session.isBackground === true;
}

/**
 * Check if a session is the initial agent for a workspace
 */
export function isInitialAgentSession(session: AgentSession | PendingAgentSession | any): boolean {
  return session && session.isInitialAgent === true;
}

/**
 * Check if a session has messages
 */
export function hasMessages(session: AgentSession | PendingAgentSession | any): boolean {
  return session && Array.isArray(session.messages) && session.messages.length > 0;
}

/**
 * Check if a session is deleted
 */
export function isDeletedSession(session: AgentSession | PendingAgentSession | any): boolean {
  return session && session.status === AgentStatus.Deleted;
}
