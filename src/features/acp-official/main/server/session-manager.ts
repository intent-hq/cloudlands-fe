/**
 * Session Manager for ACP Server
 *
 * Manages ACP sessions including creation, retrieval, and lifecycle.
 */

// Use globalThis.crypto for browser compatibility
const randomUUID = () => globalThis.crypto.randomUUID();
import * as fs from 'fs';
import * as path from 'path';
import type { SessionId, Message } from '../../types';
import type { AgentId } from '$shared/types/branded-ids';
import { Logger } from '../../../../shared/logger';

const logger = new Logger('ACPSessionManager');

export interface SessionRetentionOptions {
  workspacePath?: string;
  storageDirectory?: string;
  maxSessions?: number;
  maxMessagesPerSession?: number;
  maxSessionAgeHours?: number;
  maxInMemoryPayloadSessions?: number;
  maxInMemoryMessagesPerSession?: number;
}

const DEFAULT_MAX_SESSIONS = 50;
const DEFAULT_MAX_MESSAGES_PER_SESSION = 100;
const DEFAULT_MAX_SESSION_AGE_HOURS = 24;
const ACP_PAYLOAD_DIR = path.join('.intent', 'acp-session-payloads');
const INTENT_GITIGNORE_CONTENT = `# Intent workspace config directory
# Only config.json is tracked in git — everything else is local
*
!.gitignore
!config.json
`;

interface PersistedACPSessionPayload {
  version: 1;
  id: AgentId;
  messages: Message[];
  metadata?: Record<string, unknown>;
  createdAt: string;
  lastActivity: string;
  cancelled?: boolean;
  currentMode?: string;
  currentModel?: string;
}

interface ACPSession {
  id: AgentId;
  messages: Message[];
  metadata?: Record<string, unknown>;
  createdAt: Date;
  lastActivity: Date;
  cancelled?: boolean;
  currentMode?: string;
  currentModel?: string;
  payloadPath?: string;
  payloadPersisted?: boolean;
  payloadLoaded?: boolean;
}

export interface SessionRetentionStats {
  totalSessions: number;
  inMemoryPayloadSessions: number;
  persistedPayloadSessions: number;
}

export class SessionManager {
  private sessions = new Map<SessionId, ACPSession>();
  private readonly maxInMemoryPayloadSessions: number;
  private readonly maxInMemoryMessagesPerSession: number;
  private readonly maxPayloadAgeHours: number;
  private readonly storageDirectory?: string;

  constructor(options: SessionRetentionOptions = {}) {
    this.maxInMemoryPayloadSessions =
      options.maxInMemoryPayloadSessions ?? options.maxSessions ?? DEFAULT_MAX_SESSIONS;
    this.maxInMemoryMessagesPerSession =
      options.maxInMemoryMessagesPerSession ??
      options.maxMessagesPerSession ??
      DEFAULT_MAX_MESSAGES_PER_SESSION;
    this.maxPayloadAgeHours = options.maxSessionAgeHours ?? DEFAULT_MAX_SESSION_AGE_HOURS;
    this.storageDirectory =
      options.storageDirectory ??
      (options.workspacePath ? path.join(options.workspacePath, ACP_PAYLOAD_DIR) : undefined);
  }

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
    this.enforceRetentionBounds(session.id);
    logger.info('Created new session', { sessionId, metadata });

    return session;
  }

  /**
   * Get a session by ID
   */
  getSession(sessionId: AgentId): ACPSession | undefined {
    const session = this.getOrLoadSession(sessionId);
    if (session) {
      this.rehydrateSessionPayload(session);
      session.lastActivity = new Date();
    }
    return session;
  }

  /**
   * Add a message to a session
   */
  addMessage(sessionId: AgentId, message: Message): void {
    const session = this.getOrLoadSession(sessionId);
    if (session) {
      this.rehydrateSessionPayload(session);
      session.messages.push(message);
      session.lastActivity = new Date();
      this.enforceRetentionBounds(session.id);
      logger.debug('Added message to session', { sessionId, role: message.role });
    } else {
      logger.warn('Attempted to add message to non-existent session', { sessionId });
    }
  }

  /**
   * Update session metadata
   */
  updateMetadata(sessionId: AgentId, metadata: Record<string, unknown>): void {
    const session = this.getOrLoadSession(sessionId);
    if (session) {
      session.metadata = { ...session.metadata, ...metadata };
      session.lastActivity = new Date();
      this.updatePersistedSessionMetadata(session);
    }
  }

  /**
   * Mark session as cancelled
   */
  cancelSession(sessionId: AgentId): void {
    const session = this.getOrLoadSession(sessionId);
    if (session) {
      session.cancelled = true;
      session.lastActivity = new Date();
      this.updatePersistedSessionMetadata(session);
      logger.info('Session cancelled', { sessionId });
    }
  }

  /**
   * Delete a session
   */
  deleteSession(sessionId: AgentId): boolean {
    const deleted = this.deleteSessionEntry(sessionId);
    if (deleted) {
      logger.info('Session deleted', { sessionId });
    }
    return deleted;
  }

  /**
   * Get all sessions
   */
  getAllSessions(): ACPSession[] {
    this.loadPersistedSessionsFromDisk(false);
    const sessions = Array.from(this.sessions.values());
    for (const session of sessions) {
      this.rehydrateSessionPayload(session);
    }
    return sessions;
  }

  /**
   * Spill old session payloads (older than specified hours) without deleting sessions.
   */
  cleanupOldSessions(hoursOld: number = 24): number {
    const cutoffTime = new Date(Date.now() - hoursOld * 60 * 60 * 1000);
    let evictedCount = 0;

    for (const session of this.sessions.values()) {
      if (session.lastActivity < cutoffTime) {
        if (this.evictSessionPayload(session)) {
          evictedCount++;
        }
      }
    }

    if (evictedCount > 0) {
      logger.info(`Spilled ${evictedCount} old ACP session payloads`);
    }

    return evictedCount;
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    const count = this.sessions.size;
    for (const session of this.sessions.values()) {
      session.messages.length = 0;
      this.deletePersistedPayload(session);
    }
    this.sessions.clear();
    this.deleteAllPersistedPayloads();
    logger.info(`Cleared ${count} sessions`);
  }

  getRetentionStats(): SessionRetentionStats {
    this.loadPersistedSessionsFromDisk(false);
    return {
      totalSessions: this.sessions.size,
      inMemoryPayloadSessions: Array.from(this.sessions.values()).filter(
        (session) => session.messages.length > 0,
      ).length,
      persistedPayloadSessions: Array.from(this.sessions.values()).filter(
        (session) => session.payloadPersisted,
      ).length,
    };
  }

  private enforceRetentionBounds(protectedSessionId?: AgentId): void {
    if (!this.storageDirectory) {
      return;
    }

    this.cleanupOldSessions(this.maxPayloadAgeHours);
    this.evictOversizedInactivePayloads(protectedSessionId);
    this.evictOldestPayloadsUntilBounded(protectedSessionId);
  }

  private evictOversizedInactivePayloads(protectedSessionId?: AgentId): void {
    for (const session of this.sessions.values()) {
      if (session.id === protectedSessionId) {
        continue;
      }
      if (session.messages.length > this.maxInMemoryMessagesPerSession) {
        this.evictSessionPayload(session);
      }
    }
  }

  private evictOldestPayloadsUntilBounded(protectedSessionId?: AgentId): void {
    while (this.countInMemoryPayloadSessions() > this.maxInMemoryPayloadSessions) {
      const oldest = Array.from(this.sessions.values())
        .filter((session) => session.id !== protectedSessionId && session.messages.length > 0)
        .sort((a, b) => a.lastActivity.getTime() - b.lastActivity.getTime())[0];

      if (!oldest) {
        return;
      }

      if (!this.evictSessionPayload(oldest)) {
        return;
      }
      logger.info('Evicted oldest ACP session payload to enforce memory bound', {
        sessionId: oldest.id,
        maxInMemoryPayloadSessions: this.maxInMemoryPayloadSessions,
      });
    }
  }

  private countInMemoryPayloadSessions(): number {
    return Array.from(this.sessions.values()).filter((session) => session.messages.length > 0)
      .length;
  }

  private evictSessionPayload(session: ACPSession): boolean {
    if (session.messages.length === 0) {
      return false;
    }

    if (!this.persistSessionPayload(session)) {
      return false;
    }

    session.messages = [];
    session.payloadLoaded = false;
    logger.debug('Evicted ACP session payload from memory after persisting to disk', {
      sessionId: session.id,
      payloadPath: session.payloadPath,
    });
    return true;
  }

  private persistSessionPayload(session: ACPSession): boolean {
    const payloadPath = this.getPayloadPath(session.id);
    if (!payloadPath) {
      return false;
    }

    const payload: PersistedACPSessionPayload = {
      version: 1,
      id: session.id,
      messages: session.messages,
      metadata: session.metadata,
      createdAt: session.createdAt.toISOString(),
      lastActivity: session.lastActivity.toISOString(),
      cancelled: session.cancelled,
      currentMode: session.currentMode,
      currentModel: session.currentModel,
    };

    const tempPath = `${payloadPath}.${process.pid}.tmp`;
    try {
      this.ensureStorageDirectory();
      fs.writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, 'utf-8');
      fs.renameSync(tempPath, payloadPath);
      session.payloadPath = payloadPath;
      session.payloadPersisted = true;
      session.payloadLoaded = true;
      return true;
    } catch (error) {
      try {
        if (fs.existsSync(tempPath)) {
          fs.unlinkSync(tempPath);
        }
      } catch {
        // Best-effort temp cleanup only.
      }
      logger.warn('Failed to persist ACP session payload; retaining payload in memory', {
        sessionId: session.id,
        payloadPath,
        error: error instanceof Error ? error.message : String(error),
      });
      return false;
    }
  }

  private updatePersistedSessionMetadata(session: ACPSession): void {
    if (!session.payloadPersisted || !session.payloadPath || !fs.existsSync(session.payloadPath)) {
      return;
    }

    try {
      const payload = this.readPayloadFile(session.payloadPath);
      payload.metadata = session.metadata;
      payload.lastActivity = session.lastActivity.toISOString();
      payload.cancelled = session.cancelled;
      payload.currentMode = session.currentMode;
      payload.currentModel = session.currentModel;
      fs.writeFileSync(session.payloadPath, `${JSON.stringify(payload)}\n`, 'utf-8');
    } catch (error) {
      logger.warn('Failed to update persisted ACP session metadata', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private rehydrateSessionPayload(session: ACPSession): void {
    if (session.payloadLoaded || !session.payloadPersisted || !session.payloadPath) {
      return;
    }

    try {
      const payload = this.readPayloadFile(session.payloadPath);
      session.messages = payload.messages;
      session.metadata = session.metadata ?? payload.metadata;
      session.createdAt = new Date(payload.createdAt);
      session.lastActivity = new Date(payload.lastActivity);
      session.cancelled = payload.cancelled;
      session.currentMode = payload.currentMode;
      session.currentModel = payload.currentModel;
      session.payloadLoaded = true;
    } catch (error) {
      logger.warn('Failed to rehydrate ACP session payload', {
        sessionId: session.id,
        payloadPath: session.payloadPath,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private getOrLoadSession(sessionId: AgentId): ACPSession | undefined {
    const existing = this.sessions.get(sessionId as SessionId);
    if (existing) {
      return existing;
    }
    return this.loadPersistedSessionFromDisk(sessionId, true);
  }

  private loadPersistedSessionsFromDisk(includeMessages: boolean): void {
    const storageDirectory = this.getReadableStorageDirectory();
    if (!storageDirectory) {
      return;
    }

    for (const fileName of fs.readdirSync(storageDirectory)) {
      if (!fileName.endsWith('.json')) {
        continue;
      }
      try {
        const payload = this.readPayloadFile(path.join(storageDirectory, fileName));
        if (!this.sessions.has(payload.id as SessionId)) {
          this.sessions.set(
            payload.id as SessionId,
            this.sessionFromPayload(payload, includeMessages),
          );
        }
      } catch (error) {
        logger.warn('Failed to load persisted ACP session metadata', {
          fileName,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  private loadPersistedSessionFromDisk(
    sessionId: AgentId,
    includeMessages: boolean,
  ): ACPSession | undefined {
    const payloadPath = this.getPayloadPath(sessionId);
    if (!payloadPath || !fs.existsSync(payloadPath)) {
      return undefined;
    }

    try {
      const payload = this.readPayloadFile(payloadPath);
      const session = this.sessionFromPayload(payload, includeMessages);
      this.sessions.set(session.id as SessionId, session);
      return session;
    } catch (error) {
      logger.warn('Failed to load persisted ACP session', {
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      });
      return undefined;
    }
  }

  private sessionFromPayload(
    payload: PersistedACPSessionPayload,
    includeMessages: boolean,
  ): ACPSession {
    return {
      id: payload.id,
      messages: includeMessages ? payload.messages : [],
      metadata: payload.metadata,
      createdAt: new Date(payload.createdAt),
      lastActivity: new Date(payload.lastActivity),
      cancelled: payload.cancelled,
      currentMode: payload.currentMode,
      currentModel: payload.currentModel,
      payloadPath: this.getPayloadPath(payload.id),
      payloadPersisted: true,
      payloadLoaded: includeMessages,
    };
  }

  private readPayloadFile(payloadPath: string): PersistedACPSessionPayload {
    return JSON.parse(fs.readFileSync(payloadPath, 'utf-8')) as PersistedACPSessionPayload;
  }

  private ensureStorageDirectory(): void {
    if (!this.storageDirectory) {
      return;
    }

    const intentDir =
      path.basename(path.dirname(this.storageDirectory)) === '.intent'
        ? path.dirname(this.storageDirectory)
        : undefined;
    if (intentDir) {
      fs.mkdirSync(intentDir, { recursive: true });
      const gitignorePath = path.join(intentDir, '.gitignore');
      if (!fs.existsSync(gitignorePath)) {
        fs.writeFileSync(gitignorePath, INTENT_GITIGNORE_CONTENT, 'utf-8');
      }
    }
    fs.mkdirSync(this.storageDirectory, { recursive: true });
  }

  private getPayloadPath(sessionId: AgentId): string | undefined {
    if (!this.storageDirectory) {
      return undefined;
    }
    return path.join(this.storageDirectory, `${encodeURIComponent(sessionId)}.json`);
  }

  private deleteSessionEntry(sessionId: SessionId | AgentId): boolean {
    const session = this.sessions.get(sessionId as SessionId);
    if (session) {
      session.messages.length = 0;
      this.deletePersistedPayload(session);
      return this.sessions.delete(sessionId as SessionId);
    }

    const payloadPath = this.getPayloadPath(sessionId as AgentId);
    if (payloadPath && fs.existsSync(payloadPath)) {
      fs.unlinkSync(payloadPath);
      return true;
    }

    return false;
  }

  private deletePersistedPayload(session: ACPSession): void {
    const payloadPath = session.payloadPath ?? this.getPayloadPath(session.id);
    if (!payloadPath || !fs.existsSync(payloadPath)) {
      return;
    }
    try {
      fs.unlinkSync(payloadPath);
    } catch (error) {
      logger.warn('Failed to delete persisted ACP session payload', {
        sessionId: session.id,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private deleteAllPersistedPayloads(): void {
    const storageDirectory = this.getReadableStorageDirectory();
    if (!storageDirectory) {
      return;
    }
    for (const fileName of fs.readdirSync(storageDirectory)) {
      if (fileName.endsWith('.json')) {
        fs.unlinkSync(path.join(storageDirectory, fileName));
      }
    }
  }

  private getReadableStorageDirectory(): string | undefined {
    if (!this.storageDirectory || !fs.existsSync(this.storageDirectory)) {
      return undefined;
    }
    return fs.statSync(this.storageDirectory).isDirectory() ? this.storageDirectory : undefined;
  }
}
