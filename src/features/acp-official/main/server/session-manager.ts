/**
 * Session Manager for ACP Server
 *
 * Manages ACP sessions including creation, retrieval, and lifecycle.
 */

// Use globalThis.crypto for browser compatibility
const randomUUID = () => globalThis.crypto.randomUUID();
import type { SessionId, Message } from '../../types';
import type { AgentId } from '$shared/types/branded-ids';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('ACPSessionManager');

interface ACPSession {
  id: AgentId;
  messages: Message[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActivity: Date;
  cancelled?: boolean;
  currentMode?: string;
  currentModel?: string;
}

export class SessionManager {
  private sessions = new Map<SessionId, ACPSession>();

  /**
   * Create a new session
   */
  createSession(metadata?: Record<string, unknown>): ACPSession {
    const sessionId = `sess_${randomUUID()}`;
    const now = new Date();

    const session: ACPSession = {
      id: sessionId as AgentId,
      messages: [],
      metadata,
      createdAt: now,
      lastActivity: now,
      cancelled: false,
      currentMode: 'default',
    };

    this.sessions.set(sessionId, session);
    logger.info('Created new session', { sessionId, metadata });

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: AgentId): ACPSession | undefined {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.lastActivity = new Date();
    }
    return session;
  }

  /**
   * Add a message to a session
   */
  addMessage(sessionId: AgentId, message: Message): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.messages.push(message);
      session.lastActivity = new Date();
      logger.debug('Added message to session', { sessionId, role: message.role });
    } else {
      logger.warn('Attempted to add message to non-existent session', { sessionId });
    }
  }

  /**
   * Update session metadata
   */
  updateMetadata(sessionId: AgentId, metadata: Record<string, unknown>): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.metadata = { ...session.metadata, ...metadata };
      session.lastActivity = new Date();
    }
  }

  /**
   * Mark session as cancelled
   */
  cancelSession(sessionId: AgentId): void {
    const session = this.sessions.get(sessionId);
    if (session) {
      session.cancelled = true;
      session.lastActivity = new Date();
      logger.info('Session cancelled', { sessionId });
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: AgentId): boolean {
    const deleted = this.sessions.delete(sessionId);
    if (deleted) {
      logger.info('Session deleted', { sessionId });
    }
    return deleted;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): ACPSession[] {
    return Array.from(this.sessions.values());
  }

  /**
   * Clean up old sessions (older than specified hours)
   */
  cleanupOldSessions(hoursOld: number = 24): number {
    const cutoffTime = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    let deletedCount = 0;

    for (const [sessionId, session] of this.sessions.entries()) {
      if (session.lastActivity < cutoffTime) {
        this.sessions.delete(sessionId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      logger.info(`Cleaned up ${deletedCount} old sessions`);
    }

    return deletedCount;
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    const count = this.sessions.size;
    this.sessions.clear();
    logger.info(`Cleared ${count} sessions`);
  }
}
