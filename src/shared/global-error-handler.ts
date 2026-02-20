/**
 * Global Error Handler for Intent App
 *
 * Catches and tracks unhandled errors across main and renderer processes
 */

import { AgentErrorTracker } from './main/agent-error-tracker';
import { EnhancedLogger } from './enhanced-logger';
import { logger } from './logger';

export class GlobalErrorHandler {
  private static isInitialized = false;
  private static tracker: AgentErrorTracker;
  private static logger: EnhancedLogger;

  /**
   * Initialize global error handlers for the main process
   */
  public static initializeMain(): void {
    // Only initialize in development mode
    if (process.env.NODE_ENV !== 'development') {
      logger.info('Global error tracking disabled in production');
      return;
    }

    if (this.isInitialized) {
      return;
    }

    this.tracker = AgentErrorTracker.getInstance();
    this.logger = new EnhancedLogger('GlobalErrorHandler', { trackErrors: true });

    // Handle uncaught exceptions
    process.on('uncaughtException', (error: Error, origin: string) => {
      this.logger.critical('Uncaught exception in main process', error, { origin });

      const errorId = this.tracker.trackError({
        source: 'uncaught-exception',
        level: 'critical',
        message: error.message,
        stack: error.stack,
        component: 'main-process',
        context: {
          origin,
          processInfo: {
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
            memoryUsage: typeof process.memoryUsage === 'function' ? process.memoryUsage() : null,
            uptime: typeof process.uptime === 'function' ? process.uptime() : 0,
          },
        },
        agentHints: {
          possibleCauses: [
            'Unhandled error in main process',
            'Missing try-catch block',
            'Critical system error',
          ],
          suggestedFixes: [
            'Add try-catch blocks around risky operations',
            'Review error handling in main process',
            'Check electron main process setup',
          ],
          searchQueries: ['uncaught exception', 'main process', error.name],
          relatedFiles: ['src/main/index.ts'],
        },
      });

      this.logger.error(`Tracked uncaught exception with ID: ${errorId}`);

      // Don't exit immediately to allow error tracking to complete
      setTimeout(() => {
        process.exit(1);
      }, 1000);
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason: any, promise: Promise<any>) => {
      const error = reason instanceof Error ? reason : new Error(String(reason));

      this.logger.error('Unhandled promise rejection in main process', error);

      const errorId = this.tracker.trackError({
        source: 'unhandled-rejection',
        level: 'error',
        message: error.message || String(reason),
        stack: error.stack,
        component: 'main-process',
        context: {
          reason: reason instanceof Error ? undefined : reason,
          processInfo: {
            pid: process.pid,
            platform: process.platform,
            nodeVersion: process.version,
            electronVersion: process.versions.electron,
          },
        },
        agentHints: {
          possibleCauses: [
            'Missing .catch() on promise',
            'Async function throwing without try-catch',
            'Promise rejection not handled',
          ],
          suggestedFixes: [
            'Add .catch() to promise chains',
            'Use try-catch with async/await',
            'Review async error handling',
          ],
          searchQueries: ['unhandled rejection', 'promise', 'async'],
        },
      });

      this.logger.info(`Tracked unhandled rejection with ID: ${errorId}`);
    });

    // Handle warnings
    process.on('warning', (warning: Error) => {
      this.logger.warn('Process warning', warning);

      this.tracker.trackError({
        source: 'main',
        level: 'warning',
        message: warning.message,
        stack: warning.stack,
        component: 'main-process',
        context: {
          name: warning.name,
        },
      });
    });

    this.isInitialized = true;
    this.logger.info('Global error handler initialized for main process');
  }

  /**
   * Initialize error handlers for the renderer process
   */
  public static initializeRenderer(): void {
    // Only initialize in development mode
    if (process.env.NODE_ENV !== 'development') {
      return;
    }

    if (typeof window === 'undefined') {
      logger.warn('initializeRenderer called outside of renderer process');
      return;
    }

    this.tracker = AgentErrorTracker.getInstance();
    this.logger = new EnhancedLogger('GlobalErrorHandler', { trackErrors: true });

    // Handle window errors
    window.addEventListener('error', (event: ErrorEvent) => {
      this.logger.error(
        'Uncaught error in renderer process',
        event.error || new Error(event.message),
      );

      const errorId = this.tracker.trackError({
        source: 'renderer',
        level: 'error',
        message: event.message,
        stack: event.error?.stack,
        component: 'renderer-process',
        context: {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          url: window.location.href,
          userAgent: navigator.userAgent,
        },
        agentHints: {
          possibleCauses: [
            'JavaScript error in renderer',
            'React component error',
            'DOM manipulation error',
          ],
          suggestedFixes: [
            'Check browser console for details',
            'Review component error boundaries',
            'Add error handling to event handlers',
          ],
          searchQueries: ['renderer error', event.message],
          relatedFiles: ['src/routes', 'src/lib/components'],
        },
      });

      this.logger.info(`Tracked renderer error with ID: ${errorId}`);
    });

    // Handle unhandled promise rejections in renderer
    window.addEventListener('unhandledrejection', (event: PromiseRejectionEvent) => {
      const error = event.reason instanceof Error ? event.reason : new Error(String(event.reason));

      this.logger.error('Unhandled promise rejection in renderer', error);

      const errorId = this.tracker.trackError({
        source: 'unhandled-rejection',
        level: 'error',
        message: error.message || String(event.reason),
        stack: error.stack,
        component: 'renderer-process',
        context: {
          reason: event.reason instanceof Error ? undefined : event.reason,
          url: window.location.href,
        },
        agentHints: {
          possibleCauses: [
            'Unhandled async error in component',
            'API call failure',
            'Missing error boundary',
          ],
          suggestedFixes: [
            'Add .catch() to promises',
            'Use error boundaries',
            'Handle async errors in components',
          ],
          searchQueries: ['promise rejection', 'async error'],
        },
      });

      this.logger.info(`Tracked unhandled rejection with ID: ${errorId}`);
    });

    this.logger.info('Global error handler initialized for renderer process');
  }

  /**
   * Manually track an error
   */
  public static trackError(error: Error, context?: Record<string, any>): string {
    if (!this.tracker) {
      this.tracker = AgentErrorTracker.getInstance();
    }

    return this.tracker.trackError({
      source: 'main',
      level: 'error',
      message: error.message,
      stack: error.stack,
      context,
    });
  }
}
