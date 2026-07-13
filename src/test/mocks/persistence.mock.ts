/**
 * Mock Persistence Service for Testing
 *
 * Provides mock implementations of persistence services for testing.
 */

import type { AgentSession, AgentMessage } from '$shared/types';

export interface MockStorageData {
  sessions: Map<string, AgentSession>;
  messages: Map<string, AgentMessage[]>;
  metadata: Map<string, any>;
}

export class MockPersistenceService {
  private storage: MockStorageData = {
    sessions: new Map(),
    messages: new Map(),
    metadata: new Map(),
  };

  private saveHistory: Array<{ key: string; data: any; timestamp: number }> = [];
  private loadHistory: Array<{ key: string; timestamp: number }> = [];

  /**
   * Save a session
   */
  async saveSession(session: AgentSession, workspaceId: string): Promise<void> {
    const key = `session:${workspaceId}:${session.id}`;
    this.storage.sessions.set(key, session);
    this.recordSave(key, session);
  }

  /**
   * Load a session
   */
  async loadSession(sessionId: string, workspaceId: string): Promise<AgentSession | null> {
    const key = `session:${workspaceId}:${sessionId}`;
    this.recordLoad(key);
    return this.storage.sessions.get(key) || null;
  }

  /**
   * Delete a session
   */
  async deleteSession(sessionId: string, workspaceId: string): Promise<void> {
    const key = `session:${workspaceId}:${sessionId}`;
    this.storage.sessions.delete(key);
    this.storage.messages.delete(key);
  }

  /**
   * Save a message
   */
  async saveMessage(message: AgentMessage, sessionId: string): Promise<void> {
    const key = `messages:${sessionId}`;
    const messages = this.storage.messages.get(key) || [];
    messages.push(message);
    this.storage.messages.set(key, messages);
    this.recordSave(key, message);
  }

  /**
   * Load messages for a session
   */
  async loadMessages(sessionId: string): Promise<AgentMessage[]> {
    const key = `messages:${sessionId}`;
    this.recordLoad(key);
    return this.storage.messages.get(key) || [];
  }

  /**
   * Save metadata
   */
  async saveMetadata(key: string, data: any): Promise<void> {
    this.storage.metadata.set(key, data);
    this.recordSave(key, data);
  }

  /**
   * Load metadata
   */
  async loadMetadata(key: string): Promise<any> {
    this.recordLoad(key);
    return this.storage.metadata.get(key);
  }

  /**
   * List all sessions in a workspace
   */
  async listSessions(workspaceId: string): Promise<AgentSession[]> {
    const prefix = `session:${workspaceId}:`;
    const sessions: AgentSession[] = [];

    for (const [key, session] of this.storage.sessions.entries()) {
      if (key.startsWith(prefix)) {
        sessions.push(session);
      }
    }

    return sessions;
  }

  /**
   * Clear all data
   */
  clear(): void {
    this.storage.sessions.clear();
    this.storage.messages.clear();
    this.storage.metadata.clear();
    this.saveHistory = [];
    this.loadHistory = [];
  }

  /**
   * Get save history for testing
   */
  getSaveHistory() {
    return [...this.saveHistory];
  }

  /**
   * Get load history for testing
   */
  getLoadHistory() {
    return [...this.loadHistory];
  }

  /**
   * Record a save operation
   */
  private recordSave(key: string, data: any): void {
    this.saveHistory.push({ key, data, timestamp: Date.now() });
  }

  /**
   * Record a load operation
   */
  private recordLoad(key: string): void {
    this.loadHistory.push({ key, timestamp: Date.now() });
  }
}

export function createMockPersistenceService(): MockPersistenceService {
  return new MockPersistenceService();
}
