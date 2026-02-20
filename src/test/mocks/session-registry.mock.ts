/**
 * Mock Session Registry for Testing
 *
 * Provides mock implementations of session registry for testing.
 */

// Define SessionMapping interface locally since it's not exported from agent-state.svelte
interface SessionMapping {
  frontendId: string;
  backendId: string;
  auggieProcessId?: string;
  workspaceId: string;
  created: Date;
  lastAccessed: Date;
  status: 'active' | 'inactive' | 'error';
  metadata: Record<string, any>;
}

export class MockSessionRegistry {
  private registry = new Map<string, SessionMapping>();
  private callLog: Array<{ method: string; args: any; timestamp: number }> = [];

  /**
   * Register a new session
   */
  async registerSession(
    frontendId: string,
    backendId: string,
    workspaceId: string,
    auggieProcessId?: string,
  ): Promise<void> {
    this.logCall('registerSession', {
      frontendId,
      backendId,
      workspaceId,
      auggieProcessId,
    });

    const mapping: SessionMapping = {
      frontendId,
      backendId,
      auggieProcessId,
      workspaceId,
      created: new Date(),
      lastAccessed: new Date(),
      status: 'active',
      metadata: {},
    };

    this.registry.set(frontendId, mapping);
  }

  /**
   * Get a session mapping
   */
  async getSession(frontendId: string): Promise<SessionMapping | null> {
    this.logCall('getSession', { frontendId });
    return this.registry.get(frontendId) || null;
  }

  /**
   * Get backend ID for a frontend ID
   */
  async getBackendId(frontendId: string): Promise<string | null> {
    this.logCall('getBackendId', { frontendId });
    const mapping = this.registry.get(frontendId);
    return mapping?.backendId || null;
  }

  /**
   * Update session status
   */
  async updateStatus(
    frontendId: string,
    status: 'active' | 'inactive' | 'disconnected',
  ): Promise<void> {
    this.logCall('updateStatus', { frontendId, status });
    const mapping = this.registry.get(frontendId);
    if (mapping) {
      // Map "disconnected" to "inactive" for compatibility with SessionMapping type
      mapping.status = status === 'disconnected' ? 'inactive' : status;
      mapping.lastAccessed = new Date();
    }
  }

  /**
   * List all sessions
   */
  async listSessions(): Promise<SessionMapping[]> {
    this.logCall('listSessions', {});
    return Array.from(this.registry.values());
  }

  /**
   * List sessions for a workspace
   */
  async listSessionsForWorkspace(workspaceId: string): Promise<SessionMapping[]> {
    this.logCall('listSessionsForWorkspace', { workspaceId });
    return Array.from(this.registry.values()).filter((m) => m.workspaceId === workspaceId);
  }

  /**
   * Delete a session
   */
  async deleteSession(frontendId: string): Promise<void> {
    this.logCall('deleteSession', { frontendId });
    this.registry.delete(frontendId);
  }

  /**
   * Clear all sessions
   */
  clear(): void {
    this.registry.clear();
    this.callLog = [];
  }

  /**
   * Get call log for testing
   */
  getCallLog() {
    return [...this.callLog];
  }

  /**
   * Record a method call
   */
  private logCall(method: string, args: any): void {
    this.callLog.push({ method, args, timestamp: Date.now() });
  }
}

export function createMockSessionRegistry(): MockSessionRegistry {
  return new MockSessionRegistry();
}
