/**
 * Integration helpers for the Agent Error Tracking System
 *
 * Provides easy setup and usage patterns for the Intent app
 */

import { GlobalErrorHandler } from './global-error-handler';
import { EnhancedLogger } from './enhanced-logger';
import { AgentErrorTracker } from './main/agent-error-tracker';
import { AppError } from './errors';

/**
 * Initialize error tracking for the main process
 * Call this early in src/main/index.ts
 */
export function initializeMainProcessErrorTracking(): void {
  // Initialize global error handlers
  GlobalErrorHandler.initializeMain();

  // Create a logger for the main process
  const logger = new EnhancedLogger('MainProcess', {
    trackErrors: true,
    trackWarnings: true,
  });

  logger.info('Agent error tracking initialized for main process');
}

/**
 * Initialize error tracking for the renderer process
 * Call this in src/routes/+layout.svelte or app initialization
 */
export function initializeRendererErrorTracking(): void {
  // Initialize global error handlers
  GlobalErrorHandler.initializeRenderer();

  // Create a logger for the renderer
  const logger = new EnhancedLogger('RendererProcess', {
    trackErrors: true,
    trackWarnings: false,
  });

  logger.info('Agent error tracking initialized for renderer process');
}

/**
 * Create a workspace-aware logger
 */
export function createWorkspaceLogger(component: string, workspaceId?: string): EnhancedLogger {
  return new EnhancedLogger(component, {
    trackErrors: true,
    trackWarnings: false,
    workspaceId,
  });
}

/**
 * Track a workspace operation error
 */
export function trackWorkspaceError(
  error: Error | AppError,
  workspaceId: string,
  operation: string,
  context?: Record<string, any>,
): string {
  const tracker = AgentErrorTracker.getInstance();

  const hints = {
    possibleCauses: [`Error during ${operation} operation`],
    suggestedFixes: ['Check space permissions', 'Verify space exists'],
    searchQueries: [operation, 'workspace', error.name],
    relatedFiles: ['src/features/workspace', 'src/shared/services/workspace-service.ts'],
  };

  if (error instanceof AppError) {
    return tracker.trackAppError(error, {
      workspaceId,
      operation,
      ...context,
    });
  }

  return tracker.trackError({
    source: 'app-error',
    level: 'error',
    message: error.message,
    stack: error.stack,
    component: 'WorkspaceOperation',
    workspaceId,
    context: {
      operation,
      ...context,
    },
    agentHints: hints,
  });
}

/**
 * Track an IPC communication error
 */
export function trackIPCError(
  error: Error,
  channel: string,
  direction: 'main-to-renderer' | 'renderer-to-main',
  payload?: any,
): string {
  const tracker = AgentErrorTracker.getInstance();

  return tracker.trackError({
    source: direction.includes('main') ? 'main' : 'renderer',
    level: 'error',
    message: `IPC error on channel ${channel}: ${error.message}`,
    stack: error.stack,
    component: 'IPC',
    context: {
      channel,
      direction,
      payload: payload ? JSON.stringify(payload).substring(0, 500) : undefined,
    },
    agentHints: {
      possibleCauses: [
        'IPC channel not registered',
        'Invalid payload format',
        'Process communication failure',
      ],
      suggestedFixes: [
        'Check IPC channel registration',
        'Verify payload structure',
        'Review preload script',
      ],
      searchQueries: ['IPC', channel, 'electron IPC'],
      relatedFiles: ['src/features/ipc', 'src/preload/index.ts', 'src/main/index.ts'],
    },
  });
}

/**
 * Example: Wrap an async operation with error tracking
 */
export async function withErrorTracking<T>(
  operation: () => Promise<T>,
  context: {
    component: string;
    operation: string;
    workspaceId?: string;
  },
): Promise<T> {
  const logger = new EnhancedLogger(context.component, {
    trackErrors: true,
    workspaceId: context.workspaceId,
  });

  try {
    logger.debug(`Starting ${context.operation}`);
    const result = await operation();
    logger.debug(`Completed ${context.operation}`);
    return result;
  } catch (error) {
    logger.error(`Failed ${context.operation}`, error);
    throw error;
  }
}
