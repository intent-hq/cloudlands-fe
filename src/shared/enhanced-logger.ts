/**
 * Enhanced Logger with Agent Error Tracking
 *
 * Extends the base Logger to automatically track errors for AI agents
 */

import { Logger, LogEntry, LoggerOptions } from './logger';
import { AgentErrorTracker } from './main/agent-error-tracker';
import { isAppError } from './errors';

export interface EnhancedLoggerOptions extends LoggerOptions {
  trackErrors?: boolean;
  trackWarnings?: boolean;
  workspaceId?: string;
}

export class EnhancedLogger extends Logger {
  private errorTracker: AgentErrorTracker;
  private trackErrors: boolean;
  private trackWarnings: boolean;
  private workspaceId?: string;

  constructor(context: string = 'App', options: EnhancedLoggerOptions = {}) {
    super(context, options);

    // Only enable tracking in development mode
    const isDevelopment = process.env.NODE_ENV === 'development';

    this.errorTracker = AgentErrorTracker.getInstance();
    this.trackErrors = isDevelopment && options.trackErrors !== false;
    this.trackWarnings = isDevelopment && (options.trackWarnings ?? false);
    this.workspaceId = options.workspaceId;
  }

  error(message: string, ...args: any[]): void {
    super.error(message, ...args);

    if (this.trackErrors) {
      const { context, error, tags } = this.extractMetadata(args);

      if (isAppError(error)) {
        // Track AppError with full details
        this.errorTracker.trackAppError(error, {
          message,
          context,
          tags,
          workspaceId: this.workspaceId,
        });
      } else {
        // Track regular error
        this.errorTracker.trackError({
          source: 'logger',
          level: 'error',
          message,
          component: this.context,
          stack: error?.stack,
          context: {
            ...context,
            tags,
            originalError: error?.message,
          },
          workspaceId: this.workspaceId,
        });
      }
    }
  }

  warn(message: string, ...args: any[]): void {
    super.warn(message, ...args);

    if (this.trackWarnings) {
      const { context, tags } = this.extractMetadata(args);

      this.errorTracker.trackError({
        source: 'logger',
        level: 'warning',
        message,
        component: this.context,
        context: {
          ...context,
          tags,
        },
        workspaceId: this.workspaceId,
      });
    }
  }

  critical(message: string, ...args: any[]): void {
    // Log as error but mark as critical
    super.error(`[CRITICAL] ${message}`, ...args);

    if (this.trackErrors) {
      const { context, error, tags } = this.extractMetadata(args);

      this.errorTracker.trackError({
        source: 'logger',
        level: 'critical',
        message,
        component: this.context,
        stack: error?.stack,
        context: {
          ...context,
          tags,
          severity: 'critical',
        },
        workspaceId: this.workspaceId,
      });
    }
  }

  // Track log entries for context
  protected addLogEntry(entry: LogEntry): void {
    super.addLogEntry(entry);

    // Send to error tracker for context
    this.errorTracker.trackLogEntry(entry);
  }

  private extractMetadata(args: any[]): {
    context?: Record<string, any>;
    error?: Error;
    tags?: string[];
  } {
    let context: Record<string, any> | undefined;
    let error: Error | undefined;
    let tags: string[] | undefined;

    for (const arg of args) {
      if (arg instanceof Error) {
        error = arg;
      } else if (Array.isArray(arg) && arg.every((item) => typeof item === 'string')) {
        tags = arg;
      } else if (typeof arg === 'object' && arg !== null && !Array.isArray(arg)) {
        context = { ...context, ...arg };
      }
    }

    return { context, error, tags };
  }

  // Override child method to return EnhancedLogger
  override child(childContext: string): EnhancedLogger {
    return this.enhancedChild(childContext);
  }

  // Create a child logger with the same tracking settings
  enhancedChild(childContext: string, options?: Partial<EnhancedLoggerOptions>): EnhancedLogger {
    return new EnhancedLogger(`${this.context}:${childContext}`, {
      ...options,
      trackErrors: options?.trackErrors ?? this.trackErrors,
      trackWarnings: options?.trackWarnings ?? this.trackWarnings,
      workspaceId: options?.workspaceId ?? this.workspaceId,
    });
  }

  // Set workspace context for all future logs
  setWorkspaceId(workspaceId: string): void {
    this.workspaceId = workspaceId;
  }
}
