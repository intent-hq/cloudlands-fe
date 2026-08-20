/**
 * AgentSession Type Guards
 *
 * Runtime type checking functions for AgentSession and related types.
 * These guards ensure type safety at runtime.
 *
 * Note: isPendingAgentSession is defined in agent-session.ts
 */

import type { AgentSession } from './agent-session';
import { AgentStatus } from './agent.types';

// Re-export isPendingAgentSession for convenience

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
