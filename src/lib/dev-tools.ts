/**
 * Development Tools for Browser Console
 *
 * These tools are only exposed in development mode for debugging purposes.
 * They provide access to internal services for monitoring and debugging.
 */

import { createLogger } from './utils/client-logger';

const logger = createLogger('DevTools');

interface DevToolsStats {
  heartbeat: {
    monitored: number;
    dead: number;
    recovered: number;
  };
  messageQueue: {
    pending: number;
    processing: number;
    failed: number;
  };
  errorRecovery: {
    errors: number;
    recovered: number;
    circuitBreaker: 'closed' | 'open' | 'half-open';
  };
}

class DevTools {
  private static instance: DevTools;
  private isEnabled: boolean = false;

  private constructor() {
    // Only enable in development mode
    this.isEnabled = process.env.NODE_ENV === 'development';

    if (!this.isEnabled) {
      logger.info('DevTools disabled in production');
    }
  }

  static getInstance(): DevTools {
    if (!DevTools.instance) {
      DevTools.instance = new DevTools();
    }
    return DevTools.instance;
  }

  /**
   * Get all service statistics
   */
  getStats(): DevToolsStats | null {
    if (!this.isEnabled) {
      console.warn('DevTools are only available in development mode');
      return null;
    }

    return {
      heartbeat: this.getHeartbeatStats(),
      messageQueue: this.getMessageQueueStats(),
      errorRecovery: this.getErrorRecoveryStats(),
    };
  }

  /**
   * Get heartbeat service statistics
   */
  getHeartbeatStats() {
    // Heartbeat monitoring is managed by the heartbeat saga
    // in workspace-agents. Stats are not currently tracked in Redux state.
    return {
      monitored: 0,
      dead: 0,
      recovered: 0,
    };
  }

  /**
   * Get message queue statistics
   */
  getMessageQueueStats() {
    // This would need to be implemented in the message-queue.service.ts
    return {
      pending: 0,
      processing: 0,
      failed: 0,
    };
  }

  /**
   * Get error recovery statistics
   */
  getErrorRecoveryStats() {
    // This would need to be implemented in the error-recovery.service.ts
    return {
      errors: 0,
      recovered: 0,
      circuitBreaker: 'closed' as const,
    };
  }

  /**
   * Check health of a specific agent
   */
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  checkHealth(agentId: string): { healthy: boolean; lastSeen?: number } {
    if (!this.isEnabled) {
      console.warn('DevTools are only available in development mode');
      return { healthy: false };
    }

    // Implement health check logic
    return {
      healthy: true,
      lastSeen: Date.now(),
    };
  }

  /**
   * Retry a failed message
   */
  retryMessage(messageId: string): boolean {
    if (!this.isEnabled) {
      console.warn('DevTools are only available in development mode');
      return false;
    }

    try {
      // Implement message retry logic
      logger.info('Retrying message', { messageId });
      return true;
    } catch (error) {
      logger.error('Failed to retry message', error);
      return false;
    }
  }

  /**
   * Reset error recovery service
   */
  resetErrorRecovery(): void {
    if (!this.isEnabled) {
      console.warn('DevTools are only available in development mode');
      return;
    }

    // Implement error recovery reset
    logger.info('Resetting error recovery service');
  }

  /**
   * Get circuit breaker state
   */
  getCircuitBreakerState(): string {
    if (!this.isEnabled) {
      console.warn('DevTools are only available in development mode');
      return 'unknown';
    }

    // Implement circuit breaker state check
    return 'closed';
  }

  /**
   * Reset circuit breaker
   */
  resetCircuitBreaker(): void {
    if (!this.isEnabled) {
      console.warn('DevTools are only available in development mode');
      return;
    }

    // Implement circuit breaker reset
    logger.info('Resetting circuit breaker');
  }
}

// Export singleton instance
export const devTools = DevTools.getInstance();

// Expose to window in development mode only
if (typeof window !== 'undefined' && process.env.NODE_ENV === 'development') {
  // Create a namespace for all dev tools
  (window as any).DevTools = {
    // Main stats function
    getStats: () => devTools.getStats(),

    // Service-specific functions
    HeartbeatService: {
      getStats: () => devTools.getHeartbeatStats(),
      checkHealth: (agentId: string) => devTools.checkHealth(agentId),
    },

    MessageQueue: {
      getStatus: () => devTools.getMessageQueueStats(),
      retry: (messageId: string) => devTools.retryMessage(messageId),
    },

    ErrorRecovery: {
      getStats: () => devTools.getErrorRecoveryStats(),
      reset: () => devTools.resetErrorRecovery(),
    },

    CircuitBreaker: {
      getState: () => devTools.getCircuitBreakerState(),
      reset: () => devTools.resetCircuitBreaker(),
    },

    // Auto-update simulation tools — now use Redux store
    AutoUpdate: {
      getState: () => {
        try {
          const { getReduxStore } = require('$lib/store/redux-dispatch-bridge');
          return getReduxStore().getState().autoUpdate;
        } catch { return null; }
      },
      simulateSetState: (partial: Record<string, unknown>) => {
        try {
          const { getReduxStore } = require('$lib/store/redux-dispatch-bridge');
          const { simulateSetState } = require('$lib/store/slices/auto-update/auto-update-slice');
          getReduxStore().dispatch(simulateSetState(partial));
        } catch { /* ignore */ }
      },
    },
  };

  // Log that dev tools are available
  console.log('%cDevTools Available', 'color: #4CAF50; font-weight: bold; font-size: 14px;');
  console.log(
    '%cAccess debugging tools via window.DevTools or the shortcuts below:',
    'color: #888; font-size: 12px;',
  );
  console.log(
    '%c' +
      'DevTools.getStats() - Get all service statistics\n' +
      'DevTools.HeartbeatService.getStats() - Heartbeat stats\n' +
      'DevTools.MessageQueue.getStatus() - Message queue status\n' +
      'DevTools.ErrorRecovery.getStats() - Error recovery stats\n' +
      'DevTools.CircuitBreaker.getState() - Circuit breaker state\n' +
      'DevTools.AutoUpdate.getState() - Get auto-update state\n' +
      'DevTools.AutoUpdate.simulateSetState({...}) - Set auto-update state',
    'color: #666; font-size: 11px;',
  );
}
