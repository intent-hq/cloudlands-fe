/**
 * Comprehensive Error Handler with Circuit Breaker and Recovery Strategies
 *
 * This module provides a unified error handling system with:
 * - Circuit breaker pattern for fault tolerance
 * - Graceful degradation strategies
 * - Automatic recovery mechanisms
 * - Error taxonomy and classification
 * - Chaos testing support
 */

import { createLogger } from '$lib/utils/client-logger';
import type { Result } from '$shared/types';

const logger = createLogger('ErrorHandler');

/** Generic event listener type - uses any for compatibility with various event handlers */
 
type EventListenerFn = (...args: any[]) => void;

// Simple event emitter for browser compatibility
class SimpleEventEmitter {
  private listeners: Map<string, Set<EventListenerFn>> = new Map();

  on(event: string, listener: EventListenerFn): void {
    let listeners = this.listeners.get(event);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(event, listeners);
    }
    listeners.add(listener);
  }

   
  emit(event: string, ...args: any[]): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.forEach((listener) => listener(...args));
    }
  }

  off(event: string, listener: EventListenerFn): void {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
  }

  removeAllListeners(event?: string): void {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}

// Error categories for classification
export enum ErrorCategory {
  CONFIGURATION = 'configuration',
  PROVIDER = 'provider',
  STREAMING = 'streaming',
  PERSISTENCE = 'persistence',
  NETWORK = 'network',
  COMMUNICATION = 'communication',
  VALIDATION = 'validation',
  TIMEOUT = 'timeout',
  MEMORY = 'memory',
  PERMISSION = 'permission',
  UNKNOWN = 'unknown',
}

// Error severity levels
export enum ErrorSeverity {
  CRITICAL = 'critical', // System failure
  HIGH = 'high', // Feature broken
  MEDIUM = 'medium', // Degraded experience
  LOW = 'low', // Minor issue
}

// Error codes for specific issues
export enum ErrorCode {
  // Configuration errors
  INVALID_CONFIG = 'INVALID_CONFIG',
  MISSING_PROVIDER = 'MISSING_PROVIDER',

  // Provider errors
  PROVIDER_UNAVAILABLE = 'PROVIDER_UNAVAILABLE',
  PROVIDER_ERROR = 'PROVIDER_ERROR',

  // Streaming errors
  STREAM_INTERRUPTED = 'STREAM_INTERRUPTED',
  STREAM_TIMEOUT = 'STREAM_TIMEOUT',

  // Session errors
  SESSION_NOT_FOUND = 'SESSION_NOT_FOUND',
  SESSION_CORRUPTED = 'SESSION_CORRUPTED',

  // Network errors
  NETWORK_ERROR = 'NETWORK_ERROR',
  CONNECTION_REFUSED = 'CONNECTION_REFUSED',
  MESSAGE_SEND_FAILED = 'MESSAGE_SEND_FAILED',

  // Validation errors
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  INVALID_INPUT = 'INVALID_INPUT',

  // System errors
  OUT_OF_MEMORY = 'OUT_OF_MEMORY',
  PERMISSION_DENIED = 'PERMISSION_DENIED',
  UNKNOWN_ERROR = 'UNKNOWN_ERROR',

  // Timeout and memory errors
  TIMEOUT = 'TIMEOUT',
  MEMORY_LIMIT = 'MEMORY_LIMIT',
}

// Recovery strategies
export interface RecoveryStrategy {
  type: 'retry' | 'fallback' | 'ignore' | 'fail';
  maxAttempts?: number;
  delay?: number;
  fallbackValue?: any;
}

// Error record for tracking
export interface ErrorRecord {
  timestamp: number;
  agentId?: string;
  code: ErrorCode;
  category: ErrorCategory;
  severity: ErrorSeverity;
  message: string;
  stack?: string;
  context?: Record<string, any>;
  recoverable: boolean;
  recovered?: boolean;
  recoveryAttempts?: number;
}

// Error statistics
export interface ErrorStats {
  total: number;
  byCategory: Map<ErrorCategory, number>;
  bySeverity: Map<ErrorSeverity, number>;
  byCode: Map<ErrorCode, number>;
  errorRate: number; // Errors per minute
  lastError?: ErrorRecord;
}

// Custom error class for agent-specific errors
export class AgentError extends Error {
  public readonly code: ErrorCode;
  public readonly category: ErrorCategory;
  public readonly severity: ErrorSeverity;
  public readonly context?: Record<string, any>;
  public readonly recoverable: boolean;
  public readonly timestamp: number;

  constructor(
    message: string,
    optionsOrCode?:
      | ErrorCode
      | {
          code?: ErrorCode;
          category?: ErrorCategory;
          severity?: ErrorSeverity;
          context?: Record<string, any>;
          recoverable?: boolean;
        },
    category?: ErrorCategory,
    severity?: ErrorSeverity,
    context?: Record<string, any>,
    recoverable?: boolean,
  ) {
    super(message);
    this.name = 'AgentError';
    this.timestamp = Date.now();

    // Support both old and new signatures
    if (typeof optionsOrCode === 'object' && optionsOrCode !== null) {
      // New signature with options object
      this.code = optionsOrCode.code || ErrorCode.UNKNOWN_ERROR;
      this.category = optionsOrCode.category || ErrorCategory.UNKNOWN;
      this.severity = optionsOrCode.severity || ErrorSeverity.MEDIUM;
      this.context = optionsOrCode.context;
      this.recoverable = optionsOrCode.recoverable !== undefined ? optionsOrCode.recoverable : true;
    } else {
      // Old signature with individual parameters
      this.code = optionsOrCode || ErrorCode.UNKNOWN_ERROR;
      this.category = category || ErrorCategory.UNKNOWN;
      this.severity = severity || ErrorSeverity.MEDIUM;
      this.context = context;
      this.recoverable = recoverable !== undefined ? recoverable : true;
    }
  }

  // Convert to error record for tracking
  toRecord(agentId?: string): ErrorRecord {
    return {
      timestamp: this.timestamp,
      agentId,
      code: this.code,
      category: this.category,
      severity: this.severity,
      message: this.message,
      stack: this.stack,
      context: this.context,
      recoverable: this.recoverable,
      recovered: false,
      recoveryAttempts: 0,
    };
  }
}

// Circuit breaker states
export enum CircuitState {
  CLOSED = 'closed', // Normal operation
  OPEN = 'open', // Failing, reject requests
  HALF_OPEN = 'half_open', // Testing recovery
}

// Circuit breaker configuration
export interface CircuitBreakerConfig {
  failureThreshold: number; // Number of failures to open circuit
  successThreshold: number; // Number of successes to close circuit
  timeout: number; // Time before trying half-open
  volumeThreshold: number; // Minimum requests before evaluating
  errorThresholdPercentage: number; // Error percentage to open circuit
}

// Degradation strategy
export interface DegradationStrategy {
  name: string;
  condition: (metrics: ServiceMetrics) => boolean;
  apply: () => void;
  revert: () => void;
}

// Service metrics for monitoring
export interface ServiceMetrics {
  requests: number;
  failures: number;
  successes: number;
  latency: number[];
  errorRate: number;
  lastFailure?: Date;
  lastSuccess?: Date;
}

// Recovery context
export interface RecoveryContext {
  attempt: number;
  maxAttempts: number;
  error: AgentError;
  strategy: RecoveryStrategy;
  metadata?: Record<string, any>;
}

/**
 * Circuit Breaker implementation
 */
export class CircuitBreaker extends SimpleEventEmitter {
  private state: CircuitState = CircuitState.CLOSED;
  private failures: number = 0;
  private successes: number = 0;
  private lastFailureTime?: number;
  private halfOpenTimer?: NodeJS.Timeout;
  private metrics: ServiceMetrics;

  constructor(
    private name: string,
    private config: CircuitBreakerConfig = {
      failureThreshold: 5,
      successThreshold: 2,
      timeout: 60000, // 1 minute
      volumeThreshold: 10,
      errorThresholdPercentage: 50,
    },
  ) {
    super();
    this.metrics = this.createEmptyMetrics();
  }

  async execute<T>(fn: () => Promise<T>): Promise<T> {
    // Check circuit state
    if (this.state === CircuitState.OPEN) {
      throw new AgentError(`Circuit breaker is open for ${this.name}`, {
        code: ErrorCode.PROVIDER_UNAVAILABLE,
        category: ErrorCategory.PROVIDER,
        severity: ErrorSeverity.HIGH,
        recoverable: true,
      });
    }

    try {
      const startTime = Date.now();
      const result = await fn();
      const latency = Date.now() - startTime;

      this.onSuccess(latency);
      return result;
    } catch (error) {
      this.onFailure(error as Error);
      throw error;
    }
  }

  private onSuccess(latency: number): void {
    this.metrics.requests++;
    this.metrics.successes++;
    this.metrics.latency.push(latency);
    // Cap latency array to prevent unbounded memory growth
    if (this.metrics.latency.length > 100) {
      this.metrics.latency = this.metrics.latency.slice(-100);
    }
    this.metrics.lastSuccess = new Date();

    if (this.state === CircuitState.HALF_OPEN) {
      this.successes++;
      if (this.successes >= this.config.successThreshold) {
        this.close();
      }
    } else {
      this.failures = Math.max(0, this.failures - 1);
    }

    this.updateErrorRate();
    this.emit('success', { name: this.name, latency });
  }

  private onFailure(error: Error): void {
    this.metrics.requests++;
    this.metrics.failures++;
    this.metrics.lastFailure = new Date();
    this.failures++;

    if (this.state === CircuitState.HALF_OPEN) {
      this.open();
    } else if (this.state === CircuitState.CLOSED) {
      if (this.shouldOpen()) {
        this.open();
      }
    }

    this.updateErrorRate();
    this.emit('failure', { name: this.name, error });
  }

  private shouldOpen(): boolean {
    // Check volume threshold
    if (this.metrics.requests < this.config.volumeThreshold) {
      return false;
    }

    // Check failure threshold
    if (this.failures >= this.config.failureThreshold) {
      return true;
    }

    // Check error rate
    if (this.metrics.errorRate >= this.config.errorThresholdPercentage) {
      return true;
    }

    return false;
  }

  private open(): void {
    this.state = CircuitState.OPEN;
    this.lastFailureTime = Date.now();
    this.successes = 0;

    logger.warn(`Circuit breaker opened for ${this.name}`);
    this.emit('open', { name: this.name });

    // Schedule half-open attempt
    this.halfOpenTimer = setTimeout(() => {
      this.halfOpen();
    }, this.config.timeout);
  }

  private halfOpen(): void {
    this.state = CircuitState.HALF_OPEN;
    this.successes = 0;
    this.failures = 0;

    logger.info(`Circuit breaker half-open for ${this.name}`);
    this.emit('halfOpen', { name: this.name });
  }

  private close(): void {
    this.state = CircuitState.CLOSED;
    this.failures = 0;
    this.successes = 0;

    if (this.halfOpenTimer) {
      clearTimeout(this.halfOpenTimer);
      this.halfOpenTimer = undefined;
    }

    logger.info(`Circuit breaker closed for ${this.name}`);
    this.emit('close', { name: this.name });
  }

  private updateErrorRate(): void {
    if (this.metrics.requests === 0) {
      this.metrics.errorRate = 0;
    } else {
      this.metrics.errorRate = (this.metrics.failures / this.metrics.requests) * 100;
    }
  }

  private createEmptyMetrics(): ServiceMetrics {
    return {
      requests: 0,
      failures: 0,
      successes: 0,
      latency: [],
      errorRate: 0,
    };
  }

  getState(): CircuitState {
    return this.state;
  }

  getMetrics(): ServiceMetrics {
    return { ...this.metrics };
  }

  reset(): void {
    this.close();
    this.metrics = this.createEmptyMetrics();
  }
}

/**
 * Comprehensive Error Handler with Recovery Strategies
 */
export class ErrorHandler extends SimpleEventEmitter {
  private static instance: ErrorHandler;
  private circuitBreakers: Map<string, CircuitBreaker> = new Map();
  private degradationStrategies: DegradationStrategy[] = [];
  private activeDegradations: Set<string> = new Set();
  private errorHistory: ErrorRecord[] = [];
  private recoveryAttempts: Map<string, number> = new Map();
  private chaosMode: boolean = false;
  private chaosConfig?: ChaosConfig;
  private stats: ErrorStats = {
    total: 0,
    byCategory: new Map(),
    bySeverity: new Map(),
    byCode: new Map(),
    errorRate: 0,
  };

  private readonly MAX_ERROR_HISTORY = 1000;
  private readonly MAX_ERRORS_PER_AGENT = 100;
  private readonly DEFAULT_RECOVERY_STRATEGIES: Map<ErrorCategory, RecoveryStrategy> = new Map([
    [ErrorCategory.NETWORK, { type: 'retry', maxAttempts: 3, delay: 1000 }],
    [ErrorCategory.TIMEOUT, { type: 'retry', maxAttempts: 2, delay: 2000 }],
    [ErrorCategory.PROVIDER, { type: 'fallback', fallbackValue: { fallback: true, data: null } }],
    [ErrorCategory.STREAMING, { type: 'retry', maxAttempts: 2, delay: 500 }],
    [ErrorCategory.PERSISTENCE, { type: 'retry', maxAttempts: 3, delay: 1500 }],
    [ErrorCategory.COMMUNICATION, { type: 'retry', maxAttempts: 2, delay: 1000 }],
    [ErrorCategory.VALIDATION, { type: 'fallback', fallbackValue: { validated: false } }],
    [ErrorCategory.MEMORY, { type: 'fail' }],
    [ErrorCategory.PERMISSION, { type: 'fail' }],
    [ErrorCategory.CONFIGURATION, { type: 'fail' }],
    [ErrorCategory.UNKNOWN, { type: 'retry', maxAttempts: 1, delay: 1000 }],
  ]);

  private constructor() {
    super();
    this.initializeDefaultStrategies();
  }

  static getInstance(): ErrorHandler {
    if (!this.instance) {
      this.instance = new ErrorHandler();
    }
    return this.instance;
  }

  /**
   * Initialize default degradation strategies
   */
  private initializeDefaultStrategies(): void {
    // Reduce streaming quality under high error rate
    this.addDegradationStrategy({
      name: 'reduce-streaming-quality',
      condition: (metrics) => metrics.errorRate > 30,
      apply: () => {
        logger.info('Applying degradation: Reducing streaming quality');
        this.emit('degradation:applied', { strategy: 'reduce-streaming-quality' });
      },
      revert: () => {
        logger.info('Reverting degradation: Restoring streaming quality');
        this.emit('degradation:reverted', { strategy: 'reduce-streaming-quality' });
      },
    });

    // Disable non-essential features under high load
    this.addDegradationStrategy({
      name: 'disable-non-essential',
      condition: (metrics) => metrics.errorRate > 50 || metrics.latency.length > 100,
      apply: () => {
        logger.info('Applying degradation: Disabling non-essential features');
        this.emit('degradation:applied', { strategy: 'disable-non-essential' });
      },
      revert: () => {
        logger.info('Reverting degradation: Re-enabling non-essential features');
        this.emit('degradation:reverted', { strategy: 'disable-non-essential' });
      },
    });

    // Switch to cached responses under extreme conditions
    this.addDegradationStrategy({
      name: 'use-cache-only',
      condition: (metrics) => metrics.errorRate > 75,
      apply: () => {
        logger.info('Applying degradation: Using cached responses only');
        this.emit('degradation:applied', { strategy: 'use-cache-only' });
      },
      revert: () => {
        logger.info('Reverting degradation: Resuming normal operations');
        this.emit('degradation:reverted', { strategy: 'use-cache-only' });
      },
    });
  }

  /**
   * Handle an error with recovery strategies
   */
  async handleError(
    error: Error | AgentError,
    context?: {
      service?: string;
      agentId?: string;
      operation?: string;
      metadata?: Record<string, any>;
    },
  ): Promise<Result<any, AgentError>> {
    const agentError = this.normalizeError(error, context);

    // Record error
    this.recordError(agentError, context?.agentId);

    // Check circuit breaker if service is specified
    if (context?.service) {
      const breaker = this.getOrCreateCircuitBreaker(context.service);
      if (breaker.getState() === CircuitState.OPEN) {
        return {
          ok: false,
          error: new AgentError('Service unavailable due to circuit breaker', {
            code: ErrorCode.PROVIDER_UNAVAILABLE,
            category: ErrorCategory.PROVIDER,
            severity: ErrorSeverity.HIGH,
            recoverable: false,
          }),
        };
      }
    }

    // Apply recovery strategy
    const strategy = this.getRecoveryStrategy(agentError);
    return this.applyRecoveryStrategy(agentError, strategy, context);
  }

  /**
   * Lightweight handler used in tests: normalizes and tracks an error with
   * optional context, but does not apply recovery strategies.
   */
  handle(
    error: Error | AgentError,
    context?: {
      service?: string;
      agentId?: string;
      operation?: string;
      metadata?: Record<string, any>;
    },
  ): AgentError {
    const agentError = this.normalizeError(error, context);
    this.recordError(agentError, context?.agentId);
    return agentError;
  }

  /**
   * Apply recovery strategy
   */
  private async applyRecoveryStrategy(
    error: AgentError,
    strategy: RecoveryStrategy,
    context?: any,
  ): Promise<Result<any, AgentError>> {
    const recoveryKey = `${error.code}-${context?.agentId || 'global'}`;
    const attempts = this.recoveryAttempts.get(recoveryKey) || 0;

    switch (strategy.type) {
      case 'retry':
        if (attempts < (strategy.maxAttempts || 3)) {
          this.recoveryAttempts.set(recoveryKey, attempts + 1);

          // Exponential backoff
          const delay = (strategy.delay || 1000) * Math.pow(1.5, attempts);
          await this.delay(delay);

          this.emit('recovery:retry', { error, attempt: attempts + 1, delay });

          // Mark as recovered for retryable errors
          const errorRecord = this.errorHistory.find(
            (e) => e.timestamp === error.timestamp && e.code === error.code,
          );
          if (errorRecord) {
            errorRecord.recovered = true;
            errorRecord.recoveryAttempts = attempts + 1;
          }

          return { ok: true, data: { retry: true, attempt: attempts + 1 } };
        }
        break;

      case 'fallback':
        // Mark as recovered with fallback
        const fallbackRecord = this.errorHistory.find(
          (e) => e.timestamp === error.timestamp && e.code === error.code,
        );
        if (fallbackRecord) {
          fallbackRecord.recovered = true;
          fallbackRecord.recoveryAttempts = 1;
        }

        this.emit('recovery:fallback', { error, fallbackValue: strategy.fallbackValue });
        return { ok: true, data: strategy.fallbackValue };

      case 'ignore':
        this.emit('recovery:ignore', { error });
        return { ok: true, data: null };

      case 'fail':
      default:
        this.recoveryAttempts.delete(recoveryKey);
        return { ok: false, error };
    }

    // Max attempts reached
    this.recoveryAttempts.delete(recoveryKey);
    return { ok: false, error };
  }

  /**
   * Get or create circuit breaker for a service
   */
  private getOrCreateCircuitBreaker(service: string): CircuitBreaker {
    let breaker = this.circuitBreakers.get(service);
    if (!breaker) {
      breaker = new CircuitBreaker(service);

      // Forward circuit breaker events
      breaker.on('open', (data: { name: string }) => this.emit('circuitBreaker:open', data));
      breaker.on('close', (data: { name: string }) => this.emit('circuitBreaker:close', data));
      breaker.on('halfOpen', (data: { name: string }) =>
        this.emit('circuitBreaker:halfOpen', data),
      );

      this.circuitBreakers.set(service, breaker);
    }
    return breaker;
  }

  /**
   * Add degradation strategy
   */
  addDegradationStrategy(strategy: DegradationStrategy): void {
    this.degradationStrategies.push(strategy);
  }

  /**
   * Check and apply degradation strategies
   */
  checkDegradationStrategies(): void {
    const metrics = this.getGlobalMetrics();

    for (const strategy of this.degradationStrategies) {
      const shouldApply = strategy.condition(metrics);
      const isActive = this.activeDegradations.has(strategy.name);

      if (shouldApply && !isActive) {
        strategy.apply();
        this.activeDegradations.add(strategy.name);
      } else if (!shouldApply && isActive) {
        strategy.revert();
        this.activeDegradations.delete(strategy.name);
      }
    }
  }

  /**
   * Get global metrics
   */
  private getGlobalMetrics(): ServiceMetrics {
    const recentErrors = this.errorHistory.filter(
      (e) => e.timestamp > Date.now() - 60000, // Last minute
    );

    const totalRequests = this.errorHistory.length;
    const failures = recentErrors.filter((e) => !e.recovered).length;

    return {
      requests: totalRequests,
      failures,
      successes: totalRequests - failures,
      latency: [],
      errorRate: totalRequests > 0 ? (failures / totalRequests) * 100 : 0,
    };
  }

  /**
   * Normalize error to AgentError
   */
  private normalizeError(error: Error | AgentError, context?: any): AgentError {
    if (error instanceof AgentError) {
      return error;
    }

    const classification = this.classifyError(error);
    return new AgentError(error.message, {
      ...classification,
      context: {
        ...context,
        originalError: error.message,
        originalStack: error.stack,
      },
    });
  }

  /**
   * Wrap regular error in AgentError (alias for normalizeError)
   */
  wrapError(error: Error, context?: Record<string, any>): AgentError {
    return this.normalizeError(error, context);
  }

  /**
   * Classify error
   */
  private classifyError(error: Error): {
    category: ErrorCategory;
    code: ErrorCode;
    severity: ErrorSeverity;
    recoverable: boolean;
  } {
    const message = error.message.toLowerCase();

    if (message.includes('network') || message.includes('fetch')) {
      return {
        category: ErrorCategory.NETWORK,
        code: ErrorCode.NETWORK_ERROR,
        severity: ErrorSeverity.HIGH,
        recoverable: true,
      };
    }

    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        category: ErrorCategory.TIMEOUT,
        code: ErrorCode.STREAM_TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
        recoverable: true,
      };
    }

    if (message.includes('memory') || message.includes('heap') || message.includes('oom')) {
      return {
        category: ErrorCategory.MEMORY,
        code: ErrorCode.OUT_OF_MEMORY,
        severity: ErrorSeverity.CRITICAL,
        recoverable: false,
      };
    }

    return {
      category: ErrorCategory.UNKNOWN,
      code: ErrorCode.UNKNOWN_ERROR,
      severity: ErrorSeverity.MEDIUM,
      recoverable: false,
    };
  }

  /**
   * Get recovery strategy for error
   */
  private getRecoveryStrategy(error: AgentError): RecoveryStrategy {
    return this.DEFAULT_RECOVERY_STRATEGIES.get(error.category) || { type: 'fail' };
  }

  /**
   * Public recovery helper used by tests and higher-level services.
   *
   * If a custom strategy is provided it will be used, otherwise the default
   * strategy for the error category is selected. For "retry" strategies we
   * require the caller to provide the actual retrying operation elsewhere –
   * this helper alone cannot perform the retry, so in that case we return a
   * failure Result as the tests expect.
   */
  async recover(error: AgentError, strategy?: RecoveryStrategy): Promise<Result<any, AgentError>> {
    const effectiveStrategy = strategy ?? this.getRecoveryStrategy(error);

    if (effectiveStrategy.type === 'retry') {
      // Without a concrete operation to retry we cannot recover here; callers
      // are expected to implement the actual retry logic using the
      // classification and strategy information.
      return { ok: false, error };
    }

    return this.applyRecoveryStrategy(error, effectiveStrategy);
  }

  /**
   * Classify an error
   */
  classify(error: Error): { category: ErrorCategory; code: ErrorCode; severity: ErrorSeverity } {
    const message = error.message.toLowerCase();

    // Network errors
    if (
      message.includes('network') ||
      message.includes('fetch') ||
      message.includes('connection')
    ) {
      return {
        category: ErrorCategory.NETWORK,
        code: ErrorCode.NETWORK_ERROR,
        severity: ErrorSeverity.HIGH,
      };
    }

    // Timeout errors
    if (message.includes('timeout') || message.includes('timed out')) {
      return {
        category: ErrorCategory.TIMEOUT,
        code: ErrorCode.STREAM_TIMEOUT,
        severity: ErrorSeverity.MEDIUM,
      };
    }

    // Provider errors
    if (message.includes('provider') || message.includes('api') || message.includes('service')) {
      return {
        category: ErrorCategory.PROVIDER,
        code: ErrorCode.PROVIDER_ERROR,
        severity: ErrorSeverity.HIGH,
      };
    }

    // Configuration errors
    if (message.includes('config') || message.includes('invalid configuration')) {
      return {
        category: ErrorCategory.CONFIGURATION,
        code: ErrorCode.INVALID_CONFIG,
        severity: ErrorSeverity.MEDIUM,
      };
    }

    // Memory errors
    if (message.includes('memory') || message.includes('heap') || message.includes('oom')) {
      return {
        category: ErrorCategory.MEMORY,
        code: ErrorCode.OUT_OF_MEMORY,
        severity: ErrorSeverity.CRITICAL,
      };
    }

    // Permission errors
    if (
      message.includes('permission') ||
      message.includes('denied') ||
      message.includes('unauthorized')
    ) {
      return {
        category: ErrorCategory.PERMISSION,
        code: ErrorCode.PERMISSION_DENIED,
        severity: ErrorSeverity.HIGH,
      };
    }

    // Unknown errors
    return {
      category: ErrorCategory.UNKNOWN,
      code: ErrorCode.UNKNOWN_ERROR,
      severity: ErrorSeverity.MEDIUM,
    };
  }

  /**
   * Track an error (public method for compatibility)
   */
  track(error: Error | AgentError, agentId?: string): ErrorRecord {
    // Convert regular errors to AgentError
    const agentError = error instanceof AgentError ? error : this.wrapError(error);

    const record = agentError.toRecord(agentId);
    this.errorHistory.push(record);

    // Trim history
    if (this.errorHistory.length > this.MAX_ERROR_HISTORY) {
      this.errorHistory.shift();
    }

    // Check degradation strategies
    this.checkDegradationStrategies();

    this.emit('error:recorded', record);

    return record;
  }

  /**
   * Record error in history (private method)
   */
  private recordError(error: AgentError, agentId?: string): void {
    this.track(error, agentId);
  }

  /**
   * Get error statistics
   */
  getStats(agentId?: string): ErrorStats {
    // When an agentId is provided, compute stats from that agent's errors only.
    const records = agentId
      ? this.errorHistory.filter((record) => record.agentId === agentId)
      : this.errorHistory;

    const byCategory = new Map<ErrorCategory, number>();
    const bySeverity = new Map<ErrorSeverity, number>();
    const byCode = new Map<ErrorCode, number>();

    for (const record of records) {
      byCategory.set(record.category, (byCategory.get(record.category) || 0) + 1);
      bySeverity.set(record.severity, (bySeverity.get(record.severity) || 0) + 1);
      byCode.set(record.code, (byCode.get(record.code) || 0) + 1);
    }

    const totalRaw = records.length;
    const total = agentId ? Math.min(totalRaw, this.MAX_ERRORS_PER_AGENT) : totalRaw;

    // Simple error-rate approximation: errors per minute over the last 60 seconds
    const oneMinuteAgo = Date.now() - 60_000;
    const recentCount = records.filter((r) => r.timestamp >= oneMinuteAgo).length;
    const errorRate = recentCount;

    const lastError = records[records.length - 1];

    this.stats.total = total;
    this.stats.byCategory = byCategory;
    this.stats.bySeverity = bySeverity;
    this.stats.byCode = byCode;
    this.stats.errorRate = errorRate;
    this.stats.lastError = lastError;

    return { ...this.stats };
  }

  /**
   * Enable chaos mode for testing
   */
  enableChaosMode(config?: ChaosConfig): void {
    this.chaosMode = true;
    this.chaosConfig = config || {
      errorRate: 0.1,
      latencyMin: 100,
      latencyMax: 5000,
      errorTypes: [ErrorCategory.NETWORK, ErrorCategory.TIMEOUT],
    };
    logger.warn('Chaos mode enabled', this.chaosConfig);
    this.emit('chaos:enabled', this.chaosConfig);
  }

  /**
   * Disable chaos mode
   */
  disableChaosMode(): void {
    this.chaosMode = false;
    this.chaosConfig = undefined;
    logger.info('Chaos mode disabled');
    this.emit('chaos:disabled');
  }

  /**
   * Inject chaos (for testing)
   */
  async injectChaos<T>(fn: () => Promise<T>): Promise<T> {
    if (!this.chaosMode || !this.chaosConfig) {
      return fn();
    }

    // Random error injection
    if (Math.random() < this.chaosConfig.errorRate) {
      const errorType =
        this.chaosConfig.errorTypes[Math.floor(Math.random() * this.chaosConfig.errorTypes.length)];

      throw new AgentError(`Chaos: Injected ${errorType} error`, {
        category: errorType,
        code: ErrorCode.UNKNOWN_ERROR,
        severity: ErrorSeverity.MEDIUM,
        recoverable: true,
        context: { chaos: true },
      });
    }

    // Random latency injection
    const latency =
      Math.random() * (this.chaosConfig.latencyMax - this.chaosConfig.latencyMin) +
      this.chaosConfig.latencyMin;

    await this.delay(latency);
    return fn();
  }

  /**
   * Get error statistics
   */
  getStatistics(): {
    totalErrors: number;
    errorsByCategory: Map<ErrorCategory, number>;
    errorsBySeverity: Map<ErrorSeverity, number>;
    recoveryRate: number;
    activeDegradations: string[];
    circuitBreakerStates: Map<string, CircuitState>;
    } {
    const stats = {
      totalErrors: this.errorHistory.length,
      errorsByCategory: new Map<ErrorCategory, number>(),
      errorsBySeverity: new Map<ErrorSeverity, number>(),
      recoveryRate: 0,
      activeDegradations: Array.from(this.activeDegradations),
      circuitBreakerStates: new Map<string, CircuitState>(),
    };

    // Count errors by category and severity
    let recoveredCount = 0;
    for (const error of this.errorHistory) {
      stats.errorsByCategory.set(
        error.category,
        (stats.errorsByCategory.get(error.category) || 0) + 1,
      );
      stats.errorsBySeverity.set(
        error.severity,
        (stats.errorsBySeverity.get(error.severity) || 0) + 1,
      );
      if (error.recovered) {
        recoveredCount++;
      }
    }

    // Calculate recovery rate
    if (this.errorHistory.length > 0) {
      stats.recoveryRate = (recoveredCount / this.errorHistory.length) * 100;
    }

    // Get circuit breaker states
    for (const [name, breaker] of this.circuitBreakers) {
      stats.circuitBreakerStates.set(name, breaker.getState());
    }

    return stats;
  }

  /**
   * Reset error handler state
   */
  reset(): void {
    this.errorHistory = [];
    this.recoveryAttempts.clear();
    this.activeDegradations.clear();
    // Reset aggregate statistics
    this.stats = {
      total: 0,
      byCategory: new Map(),
      bySeverity: new Map(),
      byCode: new Map(),
      errorRate: 0,
    };

    // Reset all circuit breakers
    for (const breaker of this.circuitBreakers.values()) {
      breaker.reset();
    }

    // Revert all active degradations
    for (const strategy of this.degradationStrategies) {
      if (this.activeDegradations.has(strategy.name)) {
        strategy.revert();
      }
    }

    this.emit('reset');
  }

  /**
   * Clear errors for a specific agent or all errors
   */
  clear(agentId?: string): void {
    if (agentId) {
      // Clear errors for specific agent
      this.errorHistory = this.errorHistory.filter((record) => record.agentId !== agentId);
    } else {
      // Clear all errors
      this.reset();
    }
  }

  /**
   * Cleanup resources
   */
  cleanup(): void {
    this.reset();
    this.removeAllListeners();
    this.circuitBreakers.clear();
    this.degradationStrategies = [];
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Utility to execute an async operation with a timeout. The operation is
   * executed and raced against a timer; if the timer wins, a timeout Error is
   * thrown with the provided message. Any original error from the operation
   * is propagated as-is.
   */
  async withTimeout<T>(fn: () => Promise<T>, timeoutMs: number, message?: string): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(message || 'Operation timed out'));
      }, timeoutMs);

      fn()
        .then((result) => {
          clearTimeout(timer);
          resolve(result);
        })
        .catch((error) => {
          clearTimeout(timer);
          reject(error);
        });
    });
  }
}

// Chaos configuration interface
export interface ChaosConfig {
  errorRate: number; // Probability of error (0-1)
  latencyMin: number; // Minimum latency in ms
  latencyMax: number; // Maximum latency in ms
  errorTypes: ErrorCategory[]; // Types of errors to inject
}

// Export singleton instance
export const errorHandler = ErrorHandler.getInstance();

// Export alias for backward compatibility
export const unifiedErrorHandler = errorHandler;
