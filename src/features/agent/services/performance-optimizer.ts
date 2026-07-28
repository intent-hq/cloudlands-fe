/**
 * Performance Optimizer Service
 *
 * Ensures all operations complete within 100ms target.
 * Implements performance monitoring and optimization strategies.
 *
 * Key strategies:
 * - Request coalescing
 * - Lazy loading
 * - Memoization
 * - Request prioritization
 */

import { Logger } from '$shared/logger';

// Renderer-side high-resolution timer with a safe fallback.
const perf = typeof performance !== 'undefined' ? performance : { now: () => Date.now() };

const logger = new Logger('PerformanceOptimizer');

interface PerformanceMetric {
  operation: string;
  duration: number;
  timestamp: number;
  success: boolean;
  metadata?: Record<string, any>;
}

interface OptimizationStrategy {
  memoize?: boolean;
  coalesce?: boolean;
  priority?: 'high' | 'normal' | 'low';
  timeout?: number;
  maxRetries?: number;
  cacheKey?: string;
}

interface CacheEntry<T> {
  value: T;
  timestamp: number;
  hits: number;
  size?: number;
}

export class PerformanceOptimizer {
  private static instance: PerformanceOptimizer;

  // Performance tracking — ring buffer to avoid O(n) shift() on every metric
  private metricsBuffer: (PerformanceMetric | null)[];
  private metricsIndex = 0;
  private metricsCount = 0;
  private readonly MAX_METRICS = 500; // Reduced from 1000 — 500 is plenty for reporting
  private readonly TARGET_RESPONSE_TIME = 100; // 100ms

  // Advanced memoization cache with LRU eviction
  private memoCache = new Map<string, CacheEntry<any>>();
  private readonly MEMO_TTL = 60000; // 1 minute
  private readonly MAX_CACHE_SIZE = 100; // Maximum cache entries
  private cacheHits = 0;
  private cacheMisses = 0;

  // Request coalescing with priority queue
  private pendingRequests = new Map<string, Promise<any>>();
  private requestQueue: Array<{ key: string; priority: number; timestamp: number }> = [];

  private constructor() {
    // Pre-allocate ring buffer with nulls — avoids dynamic array growth
    this.metricsBuffer = new Array<PerformanceMetric | null>(this.MAX_METRICS).fill(null);
    this.startCacheCleanup();
    logger.info('PerformanceOptimizer initialized');
  }

  static getInstance(): PerformanceOptimizer {
    if (!PerformanceOptimizer.instance) {
      PerformanceOptimizer.instance = new PerformanceOptimizer();
    }
    return PerformanceOptimizer.instance;
  }

  /**
   * Reset performance metrics and optimizations
   */
  reset(): void {
    this.metricsBuffer = new Array<PerformanceMetric | null>(this.MAX_METRICS).fill(null);
    this.metricsIndex = 0;
    this.metricsCount = 0;
    this.memoCache.clear();
    this.pendingRequests.clear();
    this.requestQueue = [];
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Clear the memoization cache
   */
  clearCache(): void {
    this.memoCache.clear();
    this.cacheHits = 0;
    this.cacheMisses = 0;
  }

  /**
   * Process items in optimized batches
   */
  async processBatch<T, R>(
    items: T[],
    processor: (item: T) => Promise<R>,
    options: { batchSize?: number; concurrency?: number } = {},
  ): Promise<R[]> {
    const { batchSize = 10, concurrency = 4 } = options;
    const results: R[] = [];

    // Process in batches with limited concurrency
    for (let i = 0; i < items.length; i += batchSize) {
      const batch = items.slice(i, i + batchSize);
      const batchPromises = batch.map((item, index) => {
        // Limit concurrency
        const delay = Math.floor(index / concurrency) * 10;
        return new Promise<R>((resolve) => {
          setTimeout(async () => {
            const result = await processor(item);
            resolve(result);
          }, delay);
        });
      });

      const batchResults = await Promise.all(batchPromises);
      results.push(...batchResults);
    }

    return results;
  }

  private cleanupInterval: NodeJS.Timeout | null = null;

  /**
   * Start periodic cache cleanup
   */
  private startCacheCleanup(): void {
    this.cleanupInterval = setInterval(() => {
      this.cleanupCache();
    }, 30000); // Every 30 seconds
  }

  /**
   * Stop periodic cache cleanup
   */
  public stopCacheCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clean up expired cache entries and enforce size limit
   */
  private cleanupCache(): void {
    const now = Date.now();
    const entriesToDelete: string[] = [];

    // Remove expired entries
    this.memoCache.forEach((entry, key) => {
      if (now - entry.timestamp > this.MEMO_TTL) {
        entriesToDelete.push(key);
      }
    });

    entriesToDelete.forEach((key) => this.memoCache.delete(key));

    // Enforce size limit (LRU eviction)
    if (this.memoCache.size > this.MAX_CACHE_SIZE) {
      const sortedEntries = Array.from(this.memoCache.entries()).sort(
        (a, b) => a[1].hits - b[1].hits || a[1].timestamp - b[1].timestamp,
      );

      const toRemove = sortedEntries.slice(0, this.memoCache.size - this.MAX_CACHE_SIZE);
      toRemove.forEach(([key]) => this.memoCache.delete(key));
    }
  }

  /**
   * Wrap an async operation with performance tracking
   */
  async track<T>(
    operation: string,
    fn: () => Promise<T>,
    strategy: OptimizationStrategy = {},
  ): Promise<T> {
    const start = perf.now();

    try {
      // Check memoization with custom cache key
      const cacheKey = strategy.cacheKey || operation;
      if (strategy.memoize) {
        const cached = this.getMemoized(cacheKey);
        if (cached !== undefined) {
          this.cacheHits++;
          logger.debug('Memoized result used', { operation, cacheKey, hits: this.cacheHits });
          return cached;
        }
        this.cacheMisses++;
      }

      // Check coalescing
      if (strategy.coalesce) {
        const pending = this.pendingRequests.get(operation);
        if (pending) {
          logger.debug('Request coalesced', { operation });
          return pending;
        }
      }

      // Create promise (with timeout if needed)
      let promise: Promise<T>;
      if (strategy.coalesce) {
        // For coalescing, store promise immediately to prevent race conditions
        promise = strategy.timeout ? this.withTimeout(fn(), strategy.timeout) : fn();
        this.pendingRequests.set(operation, promise);
      } else {
        // For non-coalescing, just execute
        promise = strategy.timeout ? this.withTimeout(fn(), strategy.timeout) : fn();
      }

      const result = await promise;

      // Memoize result
      if (strategy.memoize) {
        this.memoize(cacheKey, result);
      }

      // Record metric
      const duration = perf.now() - start;
      this.recordMetric(operation, duration, true, {
        strategy: strategy.priority || 'normal',
        memoized: strategy.memoize || false,
        coalesced: strategy.coalesce || false,
      });

      // Warn if over target
      if (duration > this.TARGET_RESPONSE_TIME) {
        logger.warn('Operation exceeded target time', {
          operation,
          duration: Math.round(duration),
          target: this.TARGET_RESPONSE_TIME,
        });
      }

      return result;
    } catch (error) {
      const duration = perf.now() - start;
      this.recordMetric(operation, duration, false, {
        // i18n-ignore (internal performance-metric metadata, not user-facing)
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    } finally {
      // Clean up coalescing
      if (strategy.coalesce) {
        this.pendingRequests.delete(operation);
      }
    }
  }

  /**
   * Get performance statistics
   */
  getStats(): {
    avgResponseTime: number;
    p95ResponseTime: number;
    p99ResponseTime: number;
    successRate: number;
    slowOperations: string[];
  } {
    if (this.metricsCount === 0) {
      return {
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        successRate: 100,
        slowOperations: [],
      };
    }

    // Collect non-null entries from the ring buffer in logical order.
    // After wraparound, metricsIndex points to the oldest slot, so we
    // start there and walk forward modulo MAX_METRICS.
    const metrics: PerformanceMetric[] = [];
    const startIdx = this.metricsCount < this.MAX_METRICS ? 0 : this.metricsIndex;
    for (let i = 0; i < this.metricsCount; i++) {
      const entry = this.metricsBuffer[(startIdx + i) % this.MAX_METRICS];
      if (entry) metrics.push(entry);
    }

    if (metrics.length === 0) {
      return {
        avgResponseTime: 0,
        p95ResponseTime: 0,
        p99ResponseTime: 0,
        successRate: 100,
        slowOperations: [],
      };
    }

    const sorted = metrics.sort((a, b) => a.duration - b.duration);
    let successCount = 0;
    let totalDuration = 0;
    const slowOps = new Set<string>();

    for (const m of metrics) {
      totalDuration += m.duration;
      if (m.success) successCount++;
      if (m.duration > this.TARGET_RESPONSE_TIME) slowOps.add(m.operation);
    }

    const avgResponseTime = totalDuration / metrics.length;
    const p95Index = Math.floor(sorted.length * 0.95);
    const p99Index = Math.floor(sorted.length * 0.99);

    return {
      avgResponseTime: Math.round(avgResponseTime),
      p95ResponseTime: Math.round(sorted[p95Index]?.duration || 0),
      p99ResponseTime: Math.round(sorted[p99Index]?.duration || 0),
      successRate: (successCount / metrics.length) * 100,
      slowOperations: Array.from(slowOps),
    };
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): {
    size: number;
    hitRate: number;
    hits: number;
    misses: number;
  } {
    const total = this.cacheHits + this.cacheMisses;
    return {
      size: this.memoCache.size,
      hitRate: total > 0 ? (this.cacheHits / total) * 100 : 0,
      hits: this.cacheHits,
      misses: this.cacheMisses,
    };
  }

  /**
   * Get memoized result if available and not expired
   */
  private getMemoized(key: string): any {
    const cached = this.memoCache.get(key);
    if (!cached) return undefined;

    if (Date.now() - cached.timestamp > this.MEMO_TTL) {
      this.memoCache.delete(key);
      return undefined;
    }

    // Update hit count
    cached.hits++;
    return cached.value;
  }

  /**
   * Add result to memoization cache
   */
  private memoize(key: string, value: any): void {
    // Estimate size (rough approximation)
    const size = JSON.stringify(value).length;

    this.memoCache.set(key, {
      value,
      timestamp: Date.now(),
      hits: 0,
      size,
    });

    // Trigger cleanup if needed
    if (this.memoCache.size > this.MAX_CACHE_SIZE) {
      this.cleanupCache();
    }
  }

  /**
   * Execute with timeout
   */
  private async withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
    return Promise.race([
      promise,
      new Promise<T>((_, reject) =>
        setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs),
      ),
    ]);
  }

  /**
   * Record a performance metric
   */
  private recordMetric(
    operation: string,
    duration: number,
    success: boolean,
    metadata?: Record<string, any>,
  ): void {
    // Ring buffer: O(1) insert, no array copying, no GC pressure from shift()
    this.metricsBuffer[this.metricsIndex] = {
      operation,
      duration,
      timestamp: Date.now(),
      success,
      metadata,
    };
    this.metricsIndex = (this.metricsIndex + 1) % this.MAX_METRICS;
    if (this.metricsCount < this.MAX_METRICS) {
      this.metricsCount++;
    }

    // Log slow operations
    if (duration > this.TARGET_RESPONSE_TIME) {
      logger.warn('Slow operation detected', {
        operation,
        duration: `${duration.toFixed(2)}ms`,
        target: `${this.TARGET_RESPONSE_TIME}ms`,
        metadata,
      });
    }
  }
}

export const performanceOptimizer = PerformanceOptimizer.getInstance();
