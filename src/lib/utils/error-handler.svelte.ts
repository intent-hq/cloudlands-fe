import { Logger } from '$shared/logger';
import {
  shouldSuppressMonacoUnhandledRejection,
} from './monaco-error-suppression';
import {
  isSvelteErrorUrl,
  resolveSvelteError,
  formatSvelteError,
  type SvelteErrorInfo,
} from './svelte-error-resolver';

const logger = new Logger('ErrorHandler');

export interface AppError {
  id: string;
  type: 'error' | 'warning' | 'info';
  title: string;
  message: string;
  timestamp: Date;
  context?: Record<string, any>;
  stack?: string;
  recoverable: boolean;
  action?: {
    label: string;
    handler: () => void | Promise<void>;
  };
  // Enhanced Svelte error information
  svelteError?: SvelteErrorInfo;
  // Human-readable formatted message (includes debugging tips for Svelte errors)
  formattedMessage?: string;
}

class ErrorHandler {
  // NOTE: No $state runes in this class to avoid creating reactive dependencies
  // during module initialization, which can cause effect_update_depth_exceeded errors
  // when the ErrorHandler is first imported during an effect flush cycle.
  // Components should subscribe via onErrorsChange callback.
  #errors: AppError[] = [];
  #errorLog: AppError[] = [];
  #maxErrors = 100;
  #listeners: Set<() => void> = new Set();

  constructor() {
    this.setupGlobalHandlers();
  }

  // Subscribe to error changes - returns unsubscribe function
  subscribe(callback: () => void): () => void {
    this.#listeners.add(callback);
    return () => this.#listeners.delete(callback);
  }

  #notifyListeners() {
    for (const listener of this.#listeners) {
      try {
        listener();
      } catch {
        // Ignore errors in listeners
      }
    }
  }

  private setupGlobalHandlers() {
    // Handle uncaught errors
    if (typeof window !== 'undefined') {
      window.addEventListener('error', (event) => {
        // Check if event has a message
        const errorMessage = event.message || event.error?.message || 'Unknown error';

        // Suppress non-critical ResizeObserver errors
        if (errorMessage.includes('ResizeObserver loop completed with undelivered notifications')) {
          return;
        }

        // Suppress Svelte effect depth errors to prevent infinite loops
        if (
          errorMessage.includes('effect_update_depth_exceeded') ||
          errorMessage.includes('svelte.dev/e/effect_update_depth_exceeded')
        ) {
          logger.warn(
            '[ErrorHandler] Suppressing Svelte effect depth error to prevent infinite loop:',
            errorMessage,
          );
          return;
        }

        // Suppress bits-ui cleanup errors during component unmount
        // These occur when bits-ui internal event handlers fire after component destruction
        // Known issue: https://github.com/huntabyte/bits-ui/discussions/1302
        // In production, stack traces are minified (no 'bits-ui' string), and Svelte 5
        // compiles {@render snippet()} to n.call(...), producing errors like:
        //   "n.call is not a function" (minified variable names)
        if (
          errorMessage.includes('is not a function') &&
          (event.error?.stack?.includes('bits-ui') ||
            errorMessage.includes('.current is not a function') ||
            /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(errorMessage))
        ) {
          logger.debug(
            '[ErrorHandler] Suppressing bits-ui cleanup error during component unmount:',
            errorMessage,
          );
          event.preventDefault();
          return;
        }

        // Create a more detailed error with context
        const error = event.error instanceof Error ? event.error : new Error(errorMessage);

        // Add source location information
        const context: Record<string, any> = {
          filename: event.filename,
          lineno: event.lineno,
          colno: event.colno,
          userAgent: navigator.userAgent,
          url: window.location.href,
          timestamp: new Date().toISOString(),
        };

        // Try to extract component information from the stack
        if (error.stack) {
          const componentMatch = error.stack.match(/at\s+(\w+Component|\w+\.svelte)/);
          if (componentMatch) {
            context.component = componentMatch[1];
          }
        }

        this.handleError(error, context);
      });

      // Handle unhandled promise rejections
      window.addEventListener('unhandledrejection', (event) => {
        // Suppress non-critical ResizeObserver errors
        if (
          event.reason?.message?.includes(
            'ResizeObserver loop completed with undelivered notifications',
          )
        ) {
          return;
        }

        // Suppress Svelte effect depth errors in unhandled rejections
        const errorMessage = event.reason?.message || String(event.reason);
        if (
          errorMessage?.includes('effect_update_depth_exceeded') ||
          errorMessage?.includes('svelte.dev/e/effect_update_depth_exceeded')
        ) {
          logger.warn(
            '[ErrorHandler] Suppressing Svelte effect depth error in unhandledrejection:',
            errorMessage,
          );
          event.preventDefault();
          return;
        }

        // Suppress known Monaco Editor errors (Canceled, TextModel disposed, inmemory TS, etc.)
        // Uses the robust utility that handles all known Monaco error patterns
        // without relying on fragile hardcoded chunk hashes
        if (shouldSuppressMonacoUnhandledRejection(event.reason)) {
          event.preventDefault();
          return;
        }

        // Suppress bits-ui cleanup errors during component unmount
        // These occur when bits-ui internal event handlers fire after component destruction
        // Known issue: https://github.com/huntabyte/bits-ui/discussions/1302
        // In production, stack traces are minified (no 'bits-ui' string), and Svelte 5
        // compiles {@render snippet()} to n.call(...), producing errors like:
        //   "n.call is not a function" (minified variable names)
        if (
          errorMessage?.includes('is not a function') &&
          (event.reason?.stack?.includes('bits-ui') ||
            errorMessage?.includes('.current is not a function') ||
            /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(errorMessage ?? ''))
        ) {
          logger.debug(
            '[ErrorHandler] Suppressing bits-ui cleanup error during component unmount:',
            errorMessage,
          );
          event.preventDefault();
          return;
        }

        this.handleError(
          event.reason instanceof Error ? event.reason : new Error(String(event.reason)),
          { promise: true },
        );
      });
    }
  }

  get errors() {
    return this.#errors;
  }

  handleError(error: Error | string, context?: Record<string, any>, recoverable = true): string {
    // Check if this is a Svelte effect depth error and suppress it
    const errorMessage = typeof error === 'string' ? error : error.message;
    if (
      errorMessage?.includes('effect_update_depth_exceeded') ||
      errorMessage?.includes('svelte.dev/e/effect_update_depth_exceeded')
    ) {
      logger.warn(
        '[ErrorHandler] Suppressing Svelte effect depth error in handleError:',
        errorMessage,
      );
      return 'suppressed-svelte-error';
    }

    // Suppress ResizeObserver loop errors - these are benign browser warnings
    if (errorMessage?.includes('ResizeObserver loop')) {
      return 'suppressed-resize-observer-error';
    }

    // Suppress known Monaco Editor errors (Canceled, TextModel disposed, inmemory TS, etc.)
    // Uses the robust utility that handles all known Monaco error patterns
    if (shouldSuppressMonacoUnhandledRejection(error)) {
      return 'suppressed-monaco-error';
    }

    // Suppress bits-ui cleanup errors during component unmount
    // These occur when bits-ui internal event handlers fire after component destruction
    // Known issue: https://github.com/huntabyte/bits-ui/discussions/1302
    // In production, stack traces are minified (no 'bits-ui' string), and Svelte 5
    // compiles {@render snippet()} to n.call(...), producing errors like:
    //   "n.call is not a function" (minified variable names)
    const errorStack = typeof error === 'object' ? (error as Error)?.stack : '';
    if (
      errorMessage?.includes('is not a function') &&
      (errorStack?.includes('bits-ui') ||
        errorMessage?.includes('.current is not a function') ||
        /^[a-zA-Z_$]{1,3}\.call is not a function$/.test(errorMessage ?? ''))
    ) {
      logger.debug(
        '[ErrorHandler] Suppressing bits-ui cleanup error during component unmount:',
        errorMessage,
      );
      return 'suppressed-bits-ui-cleanup-error';
    }

    // Enhanced error context
    const enhancedContext = {
      ...context,
      // Add browser information
      browser: {
        userAgent: typeof navigator !== 'undefined' ? navigator.userAgent : undefined,
        language: typeof navigator !== 'undefined' ? navigator.language : undefined,
        platform: typeof navigator !== 'undefined' ? navigator.platform : undefined,
        onLine: typeof navigator !== 'undefined' ? navigator.onLine : undefined,
      },
      // Add memory information if available
      memory:
        typeof performance !== 'undefined' && (performance as any).memory
          ? {
            usedJSHeapSize: (performance as any).memory.usedJSHeapSize,
            totalJSHeapSize: (performance as any).memory.totalJSHeapSize,
            jsHeapSizeLimit: (performance as any).memory.jsHeapSizeLimit,
          }
          : undefined,
      // Add timing information
      timing: {
        timestamp: new Date().toISOString(),
        timeFromPageLoad: typeof performance !== 'undefined' ? performance.now() : undefined,
      },
    };

    // Check if this is a Svelte error URL and resolve it
    let svelteErrorInfo: SvelteErrorInfo | undefined;
    let formattedMessage: string | undefined;

    if (isSvelteErrorUrl(errorMessage)) {
      svelteErrorInfo = resolveSvelteError(errorMessage) ?? undefined;
      formattedMessage = formatSvelteError(errorMessage);
    }

    const errorObj: AppError = {
      id: globalThis.crypto.randomUUID(),
      type: 'error',
      title: 'An error occurred',
      message: errorMessage,
      timestamp: new Date(),
      context: enhancedContext,
      stack: error instanceof Error ? this.enhanceStackTrace(error.stack) : undefined,
      recoverable,
      svelteError: svelteErrorInfo,
      formattedMessage,
    };

    // Categorize error - use Svelte error title if available
    if (svelteErrorInfo) {
      errorObj.title = svelteErrorInfo.title;
    } else if (error instanceof Error) {
      errorObj.title = this.categorizeError(error);
    }

    // Add to store and log
    this.addError(errorObj);

    // Log to console in development
    if (import.meta.env.DEV) {
      logger.error('Error handled', error instanceof Error ? error : undefined, { errorObj });
    }

    // Send to telemetry in production
    if (import.meta.env.PROD) {
      this.sendTelemetry(errorObj);
    }

    return errorObj.id;
  }

  private enhanceStackTrace(stack?: string): string | undefined {
    if (!stack) return undefined;

    // Add line numbers and make stack trace more readable
    const lines = stack.split('\n');
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const enhanced = lines.map((line, index) => {
      // Highlight important parts
      if (line.includes('.svelte')) {
        return `→ ${line} [SVELTE COMPONENT]`;
      }
      if (line.includes('node_modules')) {
        return `  ${line} [DEPENDENCY]`;
      }
      return `  ${line}`;
    });

    return enhanced.join('\n');
  }

  handleWarning(message: string, context?: Record<string, any>): string {
    const warning: AppError = {
      id: globalThis.crypto.randomUUID(),
      type: 'warning',
      title: 'Warning',
      message,
      timestamp: new Date(),
      context,
      recoverable: true,
    };

    this.addError(warning);
    return warning.id;
  }

  handleInfo(message: string, context?: Record<string, any>): string {
    const info: AppError = {
      id: globalThis.crypto.randomUUID(),
      type: 'info',
      title: 'Information',
      message,
      timestamp: new Date(),
      context,
      recoverable: true,
    };

    this.addError(info);
    return info.id;
  }

  private categorizeError(error: Error): string {
    const message = error.message.toLowerCase();

    // Check for Svelte errors first
    if (isSvelteErrorUrl(error.message)) {
      const svelteInfo = resolveSvelteError(error.message);
      if (svelteInfo) {
        return svelteInfo.title;
      }
      return 'Svelte Error';
    }

    if (message.includes('network') || message.includes('fetch')) {
      return 'Network Error';
    }
    if (message.includes('auth') || message.includes('unauthorized')) {
      return 'Authentication Error';
    }
    if (message.includes('permission') || message.includes('denied')) {
      return 'Permission Denied';
    }
    if (message.includes('file') || message.includes('directory')) {
      return 'File System Error';
    }
    if (message.includes('ssh') || message.includes('connection')) {
      return 'Connection Error';
    }
    if (message.includes('api') || message.includes('endpoint')) {
      return 'API Error';
    }

    return 'Application Error';
  }

  private addError(error: AppError) {
    this.#errorLog.push(error);

    if (this.#errorLog.length > this.#maxErrors) {
      this.#errorLog = this.#errorLog.slice(-this.#maxErrors);
    }

    this.#errors = [...this.#errors, error];
    this.#notifyListeners();

    // Show toast notification using the built-in toast system
    // Import dynamically to avoid circular dependencies
    import('./error-toast').then(({ showErrorToast }) => {
      showErrorToast(error);
    }).catch(() => {
      // Toast not available yet - might be during initial load
    });
  }

  dismiss(errorId: string) {
    this.#errors = this.#errors.filter((e) => e.id !== errorId);
    this.#notifyListeners();
  }

  dismissAll() {
    this.#errors = [];
    this.#notifyListeners();
  }

  getErrorLog(): AppError[] {
    return [...this.#errorLog];
  }

  clearErrorLog() {
    this.#errorLog = [];
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  private async sendTelemetry(error: AppError) {
    try {
      // Telemetry integration would go here
    } catch {
      // Silently fail telemetry
    }
  }

  async attemptRecovery(errorId: string): Promise<boolean> {
    const error = this.#errorLog.find((e) => e.id === errorId);
    if (!error || !error.recoverable) return false;

    const title = error.title.toLowerCase();

    if (title.includes('network')) {
      return await this.recoverFromNetworkError();
    }
    if (title.includes('auth')) {
      return await this.recoverFromAuthError();
    }
    if (title.includes('connection')) {
      return await this.recoverFromConnectionError();
    }

    return false;
  }

  private async recoverFromNetworkError(): Promise<boolean> {
    if (!navigator.onLine) {
      return new Promise((resolve) => {
        const handler = () => {
          window.removeEventListener('online', handler);
          resolve(true);
        };
        window.addEventListener('online', handler);

        setTimeout(() => {
          window.removeEventListener('online', handler);
          resolve(false);
        }, 30000);
      });
    }
    return true;
  }

  private async recoverFromAuthError(): Promise<boolean> {
    try {
      return true;
    } catch {
      return false;
    }
  }

  private async recoverFromConnectionError(): Promise<boolean> {
    try {
      return true;
    } catch {
      return false;
    }
  }
}

// Export singleton instance
export const errorHandler = new ErrorHandler();

// Expose on window for easy testing in dev tools
if (typeof window !== 'undefined') {
  (window as any).testError = () => errorHandler.handleError(new Error('Test error: Something went wrong'), { source: 'devtools' });
  (window as any).testWarning = () => errorHandler.handleWarning('Test warning: Rate limit approaching');
  (window as any).testInfo = () => errorHandler.handleInfo('Test info: Operation completed');
}

// Convenience functions
export function handleError(
  error: Error | string,
  context?: Record<string, any>,
  recoverable = true,
): string {
  return errorHandler.handleError(error, context, recoverable);
}

export function handleWarning(message: string, context?: Record<string, any>): string {
  return errorHandler.handleWarning(message, context);
}

export function handleInfo(message: string, context?: Record<string, any>): string {
  return errorHandler.handleInfo(message, context);
}
