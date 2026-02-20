/**
 * Permission Store
 *
 * Manages permission request state for inline permission UI.
 * Listens for permission requests via IPC and exposes state to components.
 */

import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '../../shared/ipc-registry';
import { createLogger } from '$lib/utils/client-logger';

const logger = createLogger('PermissionStore');

export interface PermissionRequest {
  requestId: string;
  sessionId: string;
  title: string;
  description?: string | null;
  options: Array<{
    id: string;
    label: string;
    description?: string;
    destructive?: boolean;
  }>;
  agentName?: string;
  riskLevel?: 'low' | 'medium' | 'high';
  timestamp: number;
}

class PermissionStore {
  // All pending permission requests
  requests = $state<PermissionRequest[]>([]);

  // IPC handler reference for cleanup
  private ipcHandler: ((request: PermissionRequest) => void) | null = null;
  private initialized = false;

  /**
   * Get permission requests for a specific agent/session
   */
  getRequestsForSession(sessionId: string): PermissionRequest[] {
    return this.requests.filter((r) => r.sessionId === sessionId);
  }

  /**
   * Get the current (oldest) permission request for a session
   */
  getCurrentRequest(sessionId: string): PermissionRequest | null {
    const sessionRequests = this.getRequestsForSession(sessionId);
    return sessionRequests[0] || null;
  }

  /**
   * Get count of pending requests for a session
   */
  getPendingCount(sessionId: string): number {
    return this.getRequestsForSession(sessionId).length;
  }

  /**
   * Handle an incoming permission request
   */
  private handleRequest(request: PermissionRequest): void {
    logger.info('Received permission request', {
      requestId: request.requestId,
      sessionId: request.sessionId,
      title: request.title,
    });
    this.requests = [...this.requests, request];
  }

  /**
   * Approve a permission request
   */
  async approve(requestId: string): Promise<void> {
    const request = this.requests.find((r) => r.requestId === requestId);
    if (!request) {
      logger.warn('Cannot approve: request not found', { requestId });
      return;
    }

    // Find the first non-destructive option, or fall back to the first option
    // This ensures we use the actual optionId that the agent sent, not a hardcoded value
    const approveOption = request.options.find((opt) => !opt.destructive) || request.options[0];
    const optionId = approveOption?.id || 'allow_once';

    logger.info('Approving permission request', {
      requestId,
      title: request.title,
      optionId,
      availableOptions: request.options.map((o) => o.id),
    });

    try {
      await invoke(IPC_CHANNELS.PERMISSION.RESPOND, {
        requestId,
        outcome: { outcome: 'selected', optionId },
      });
      this.removeRequest(requestId);
    } catch (error) {
      logger.error('Failed to approve permission request', { requestId, error });
    }
  }

  /**
   * Deny a permission request
   */
  async deny(requestId: string): Promise<void> {
    const request = this.requests.find((r) => r.requestId === requestId);
    if (!request) {
      logger.warn('Cannot deny: request not found', { requestId });
      return;
    }

    // Find the first destructive option, or fall back to the last option (usually deny)
    // This ensures we use the actual optionId that the agent sent, not a hardcoded value
    const denyOption =
      request.options.find((opt) => opt.destructive) || request.options[request.options.length - 1];
    const optionId = denyOption?.id || 'reject_once';

    logger.info('Denying permission request', {
      requestId,
      title: request.title,
      optionId,
      availableOptions: request.options.map((o) => o.id),
    });

    try {
      await invoke(IPC_CHANNELS.PERMISSION.RESPOND, {
        requestId,
        outcome: { outcome: 'selected', optionId },
      });
      this.removeRequest(requestId);
    } catch (error) {
      logger.error('Failed to deny permission request', { requestId, error });
    }
  }

  /**
   * Cancel a permission request
   */
  async cancel(requestId: string): Promise<void> {
    logger.info('Cancelling permission request', { requestId });

    try {
      await invoke(IPC_CHANNELS.PERMISSION.RESPOND, {
        requestId,
        outcome: { outcome: 'cancelled' },
      });
      this.removeRequest(requestId);
    } catch (error) {
      logger.error('Failed to cancel permission request', { requestId, error });
    }
  }

  /**
   * Select a specific option for a permission request
   */
  async selectOption(requestId: string, optionId: string): Promise<void> {
    const request = this.requests.find((r) => r.requestId === requestId);
    if (!request) {
      logger.warn('Cannot select option: request not found', { requestId });
      return;
    }

    logger.info('Selecting permission option', {
      requestId,
      title: request.title,
      optionId,
    });

    try {
      await invoke(IPC_CHANNELS.PERMISSION.RESPOND, {
        requestId,
        outcome: { outcome: 'selected', optionId },
      });
      this.removeRequest(requestId);
    } catch (error) {
      logger.error('Failed to select permission option', { requestId, optionId, error });
    }
  }

  /**
   * Remove a request from the list
   */
  private removeRequest(requestId: string): void {
    this.requests = this.requests.filter((r) => r.requestId !== requestId);
  }

  /**
   * Initialize IPC listeners
   */
  // Listener ID for ID-based removal
  private ipcListenerId: string | null = null;

  initialize(): void {
    if (this.initialized) return;
    this.initialized = true;

    logger.info('Initializing permission store IPC listeners');

    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      this.ipcHandler = (request: PermissionRequest) => {
        this.handleRequest(request);
      };
      // Use ID-based listener removal for reliable cleanup with context isolation
      this.ipcListenerId = (window as any).electronAPI.on(
        IPC_CHANNELS.PERMISSION.EVENT,
        this.ipcHandler,
      );

      // Fetch any pending permission requests from main process (for page refresh recovery)
      this.fetchPendingRequests();
    }
  }

  /**
   * Fetch pending permission requests from main process
   * This is called on initialization to recover any pending requests after a page refresh
   */
  private async fetchPendingRequests(): Promise<void> {
    try {
      const result = await invoke<{ success: boolean; requests: PermissionRequest[] }>(
        IPC_CHANNELS.PERMISSION.GET_PENDING,
      );
      if (result.success && result.requests && result.requests.length > 0) {
        logger.info('Recovered pending permission requests after page refresh', {
          count: result.requests.length,
        });
        // Add each request, avoiding duplicates
        for (const request of result.requests) {
          if (!this.requests.find((r) => r.requestId === request.requestId)) {
            this.requests = [...this.requests, request];
          }
        }
      }
    } catch (error) {
      logger.error('Failed to fetch pending permission requests', { error });
    }
  }

  /**
   * Cleanup IPC listeners
   */
  cleanup(): void {
    if (typeof window !== 'undefined' && (window as any).electronAPI) {
      // Use ID-based removal for reliable cleanup with context isolation
      if (this.ipcListenerId) {
        (window as any).electronAPI.offById(IPC_CHANNELS.PERMISSION.EVENT, this.ipcListenerId);
        this.ipcListenerId = null;
      }
      this.ipcHandler = null;
    }
    this.initialized = false;
  }
}

// Export singleton instance
export const permissionStore = new PermissionStore();
