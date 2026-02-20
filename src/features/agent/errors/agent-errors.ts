/**
 * Agent Error Classes
 *
 * Standardized error handling for the agent system.
 * Provides specific error types with context and recovery suggestions.
 */

import { Logger } from '../../../shared/logger';
import {
  getUserFriendlyMessage,
  getHelpLink,
  formatErrorMessage,
  getRecoverySuggestions,
} from '../../../shared/errors/index';

const logger = new Logger('AgentErrors');

export enum AgentErrorCode {
  // Creation errors
  AGENT_CREATION_FAILED = 'AGENT_CREATION_FAILED',
  AGENT_ALREADY_EXISTS = 'AGENT_ALREADY_EXISTS',
  INVALID_AGENT_CONFIG = 'INVALID_AGENT_CONFIG',
  INVALID_CONFIG = 'INVALID_CONFIG',

  // Session errors
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_ALREADY_ACTIVE = 'SESSION_ALREADY_ACTIVE',
  SESSION_INITIALIZATION_FAILED = 'SESSION_INITIALIZATION_FAILED',

  // Streaming errors
  STREAM_CONNECTION_FAILED = 'STREAM_CONNECTION_FAILED',
  STREAM_TIMEOUT = 'STREAM_TIMEOUT',
  STREAM_INTERRUPTED = 'STREAM_INTERRUPTED',
  STREAM_RECOVERY_FAILED = 'STREAM_RECOVERY_FAILED',

  // Message errors
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',
  MESSAGE_VALIDATION_FAILED = 'MESSAGE_VALIDATION_FAILED',
  MESSAGE_TOO_LONG = 'MESSAGE_TOO_LONG',

  // Provider errors
  PROVIDER_NOT_FOUND = 'PROVIDER_NOT_FOUND',
  PROVIDER_CONNECTION_FAILED = 'PROVIDER_CONNECTION_FAILED',
  PROVIDER_PROCESS_DIED = 'PROVIDER_PROCESS_DIED',
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR = 'PROVIDER_ERROR',

  // Storage errors
  STORAGE_READ_FAILED = 'STORAGE_READ_FAILED',
  STORAGE_WRITE_FAILED = 'STORAGE_WRITE_FAILED',
  STORAGE_CORRUPTED = 'STORAGE_CORRUPTED',
  STORAGE_ERROR = 'STORAGE_ERROR',
  STORAGE_QUOTA_EXCEEDED = 'STORAGE_QUOTA_EXCEEDED',

  // Resource errors
  MEMORY_LIMIT_EXCEEDED = 'MEMORY_LIMIT_EXCEEDED',
  RATE_LIMIT_EXCEEDED = 'RATE_LIMIT_EXCEEDED',
  CONCURRENT_LIMIT_EXCEEDED = 'CONCURRENT_LIMIT_EXCEEDED',
  RESOURCE_NOT_FOUND = 'RESOURCE_NOT_FOUND',
  RESOURCE_EXHAUSTED = 'RESOURCE_EXHAUSTED',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',

  // Permission errors
  PERMISSION_DENIED = 'PERMISSION_DENIED',

  // Operation errors
  OPERATION_FAILED = 'OPERATION_FAILED',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_RESPONSE = 'INVALID_RESPONSE',

  // State errors
  STATE_CORRUPTION = 'STATE_CORRUPTION',

  // Context errors
  CONTEXT_OVERFLOW = 'CONTEXT_OVERFLOW',
}

export interface AgentErrorContext {
  agentId?: string;
  sessionId?: string;
  workspaceId?: string;
  operation?: string;
  details?: Record<string, any>;
  timestamp?: Date;
  stackTrace?: string;
  currentSize?: number;
  chunkSize?: number;
  maxSize?: number;
  // Additional context fields for specific error types
  provider?: string;
  path?: string;
  currentUsage?: number;
  limit?: number;
  [key: string]: any; // Allow additional properties
}

export interface RecoverySuggestion {
  action: string;
  description: string;
  automatic?: boolean;
}

/**
 * Base class for all agent-related errors
 */
export class AgentError extends Error {
  public readonly code: AgentErrorCode;
  public readonly context: AgentErrorContext;
  public readonly recoverySuggestions: RecoverySuggestion[];
  public readonly userMessage: string;
  public readonly isRecoverable: boolean;
  public cause?: Error;

  constructor(
    message: string,
    code: AgentErrorCode,
    context: AgentErrorContext = {},
    options?: {
      userMessage?: string;
      recoverySuggestions?: RecoverySuggestion[];
      isRecoverable?: boolean;
      cause?: Error;
    },
  ) {
    super(message);
    this.name = 'AgentError';
    this.code = code;
    this.context = {
      ...context,
      timestamp: new Date(),
      stackTrace: this.stack,
    };
    this.userMessage = options?.userMessage || this.getDefaultUserMessage(code);
    this.recoverySuggestions =
      options?.recoverySuggestions || this.getDefaultRecoverySuggestions(code);
    this.isRecoverable = options?.isRecoverable ?? this.isErrorRecoverable(code);

    if (options?.cause) {
      this.cause = options.cause;
    }
  }

  private getDefaultUserMessage(code: AgentErrorCode): string {
    // Use the centralized messages module with context
    return getUserFriendlyMessage(code, this.context);
  }

  private getDefaultRecoverySuggestions(code: AgentErrorCode): RecoverySuggestion[] {
    // Use the centralized recovery suggestions module
    return getRecoverySuggestions(code);
  }

  private isErrorRecoverable(code: AgentErrorCode): boolean {
    const recoverableErrors = [
      AgentErrorCode.STREAM_INTERRUPTED,
      AgentErrorCode.STREAM_TIMEOUT,
      AgentErrorCode.MESSAGE_SEND_FAILED,
      AgentErrorCode.PROVIDER_PROCESS_DIED,
      AgentErrorCode.STORAGE_READ_FAILED,
      AgentErrorCode.STORAGE_WRITE_FAILED,
    ];
    return recoverableErrors.includes(code);
  }

  /**
   * Get help link for this error
   */
  getHelpLink(): string | undefined {
    return getHelpLink(this.code);
  }

  /**
   * Format error message with context
   */
  formatMessage(template: string): string {
    return formatErrorMessage(template, this.context);
  }

  toJSON() {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      userMessage: this.userMessage,
      context: this.context,
      recoverySuggestions: this.recoverySuggestions,
      isRecoverable: this.isRecoverable,
      helpLink: this.getHelpLink(),
      stack: this.stack,
    };
  }
}

/**
 * Specific error classes for different scenarios
 */

export class AgentCreationError extends AgentError {
  constructor(message: string, context: AgentErrorContext, options?: any) {
    super(message, AgentErrorCode.AGENT_CREATION_FAILED, context, options);
    this.name = 'AgentCreationError';
  }
}

export class AgentSessionError extends AgentError {
  constructor(message: string, code: AgentErrorCode, context: AgentErrorContext, options?: any) {
    super(message, code, context, options);
    this.name = 'AgentSessionError';
  }
}

export class AgentStreamingError extends AgentError {
  constructor(message: string, code: AgentErrorCode, context: AgentErrorContext, options?: any) {
    super(message, code, context, options);
    this.name = 'AgentStreamingError';
  }
}

export class AgentProviderError extends AgentError {
  constructor(message: string, code: AgentErrorCode, context: AgentErrorContext, options?: any) {
    super(message, code, context, options);
    this.name = 'AgentProviderError';
  }
}

export class AgentStorageError extends AgentError {
  constructor(message: string, code: AgentErrorCode, context: AgentErrorContext, options?: any) {
    super(message, code, context, options);
    this.name = 'AgentStorageError';
  }
}

export class AgentResourceError extends AgentError {
  constructor(message: string, code: AgentErrorCode, context: AgentErrorContext, options?: any) {
    super(message, code, context, options);
    this.name = 'AgentResourceError';
  }
}

/**
 * Error handler utility
 */
export class AgentErrorHandler {
  private static errorHistory: AgentError[] = [];
  private static readonly MAX_ERROR_HISTORY = 100;

  static handle(error: Error | AgentError): void {
    if (error instanceof AgentError) {
      this.errorHistory.push(error);
      if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
        this.errorHistory.shift();
      }

      // Log structured error
      logger.error('AgentError', {
        code: error.code,
        message: error.message,
        context: error.context,
        recoverable: error.isRecoverable,
      });

      // Attempt automatic recovery if applicable
      if (error.isRecoverable) {
        const autoRecovery = error.recoverySuggestions.find((s) => s.automatic);
        if (autoRecovery) {
          logger.info(`Attempting automatic recovery: ${autoRecovery.description}`);
          // Recovery logic would be implemented here
        }
      }
    } else {
      // Convert regular errors to AgentError
      const agentError = new AgentError(
        error.message,
        AgentErrorCode.AGENT_CREATION_FAILED,
        {},
        { cause: error },
      );
      this.handle(agentError);
    }
  }

  static getErrorHistory(): AgentError[] {
    return [...this.errorHistory];
  }

  static clearErrorHistory(): void {
    this.errorHistory = [];
  }

  static getErrorStats(): Record<AgentErrorCode, number> {
    const stats: Partial<Record<AgentErrorCode, number>> = {};
    for (const error of this.errorHistory) {
      stats[error.code] = (stats[error.code] || 0) + 1;
    }
    return stats as Record<AgentErrorCode, number>;
  }
}
