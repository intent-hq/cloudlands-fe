/**
 * Memory Manager Service
 *
 * Centralized memory management and leak prevention.
 * Tracks all resources and ensures proper cleanup.
 *
 * Key features:
 * - Automatic cleanup on disposal
 * - WeakMap/WeakSet for automatic GC
 * - Resource tracking
 * - Memory monitoring
 * - Leak detection
 */

import { Logger } from '$shared/logger';

const logger = new Logger('MemoryManager');

interface Resource {
  type: 'listener' | 'timer' | 'subscription' | 'stream';
  cleanup: () => void;
  created: number;
}

export class MemoryManager {
  private static instance: MemoryManager;

  // Use WeakMap for automatic garbage collection
  private resources = new WeakMap<object, Set<Resource>>();
  private globalResources = new Set<Resource>();

  // Memory monitoring
  private memoryCheckInterval: NodeJS.Timeout | null = null;
  private lastMemoryUsage = 0;

  // Throttle memory warnings to avoid log spam
  private lastMemoryWarningTime = 0;
  private readonly MEMORY_WARNING_INTERVAL = 60000; // 1 minute between warnings

  private constructor() {
    this.startMemoryMonitoring();
    logger.info('MemoryManager initialized');
  }

  /**
   * Add a resource to an owner
   */
  private addResourceToOwner(owner: object, resource: Resource): void {
    let ownerResources = this.resources.get(owner);
    if (!ownerResources) {
      ownerResources = new Set();
      this.resources.set(owner, ownerResources);
    }
    ownerResources.add(resource);
  }

  static getInstance(): MemoryManager {
    if (!MemoryManager.instance) {
      MemoryManager.instance = new MemoryManager();
    }
    return MemoryManager.instance;
  }

  /**
   * Reset memory tracking and cleanup
   */
  reset(): void {
    // Clear all global resources
    this.globalResources.forEach((resource) => {
      try {
        resource.cleanup();
      } catch (error) {
        logger.error('Error cleaning up resource during reset:', error);
      }
    });
    this.globalResources.clear();

    // Reset memory usage tracking
    this.lastMemoryUsage = 0;

    // Restart memory monitoring
    if (this.memoryCheckInterval) {
      clearInterval(this.memoryCheckInterval);
    }
    this.startMemoryMonitoring();
  }

  /**
   * Get memory report
   */
  getMemoryReport(): {
    currentUsage: number;
    peakUsage: number;
    resourceCount: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
    collections?: number;
    } {
    const memUsage = process.memoryUsage();

    return {
      currentUsage: memUsage.heapUsed,
      peakUsage: Math.max(this.lastMemoryUsage * 1024 * 1024, memUsage.heapUsed),
      resourceCount: this.globalResources.size,
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      rss: memUsage.rss,
      collections: 0, // Placeholder for GC collections count
    };
  }

  /**
   * Force cleanup of all resources
   */
  forceCleanup(): void {
    this.globalResources.forEach((resource) => {
      try {
        resource.cleanup();
      } catch (error) {
        logger.error('Error during force cleanup:', error);
      }
    });
    this.globalResources.clear();

    // NOTE: Do NOT call global.gc() here. Multiple independent GC call sites
    // can trigger V8 garbage collection at unsafe moments while async resources
    // (child processes, streams) are being torn down, causing native SIGSEGV crashes
    // in AsyncWrap::~AsyncWrap(). GC is centralized in shared/main/memory-monitor.ts.
  }

  /**
   * Start memory monitoring
   */
  private startMemoryMonitoring(): void {
    // Monitor memory usage every 30 seconds
    this.memoryCheckInterval = setInterval(() => {
      this.checkMemoryUsage();
    }, 30000);
  }

  /**
   * Check current memory usage
   */
  private checkMemoryUsage(): void {
    if (typeof process !== 'undefined' && process.memoryUsage) {
      const usage = process.memoryUsage();
      const heapUsed = usage.heapUsed / 1024 / 1024; // Convert to MB

      if (heapUsed > this.lastMemoryUsage * 1.5 && heapUsed > 100) {
        // Throttle warnings to avoid log spam (once per minute max)
        const now = Date.now();
        if (now - this.lastMemoryWarningTime >= this.MEMORY_WARNING_INTERVAL) {
          this.lastMemoryWarningTime = now;
          logger.warn('Memory usage increased significantly', {
            current: `${heapUsed.toFixed(2)}MB`,
            previous: `${this.lastMemoryUsage.toFixed(2)}MB`,
          });
        }
        this.detectLeaks();
      }

      this.lastMemoryUsage = heapUsed;
    }
  }

  /**
   * Detect potential memory leaks
   */
  private detectLeaks(): number {
    const now = Date.now();
    const oldResources: Resource[] = [];

    this.globalResources.forEach((resource) => {
      if (now - resource.created > 300000) {
        // 5 minutes
        oldResources.push(resource);
      }
    });

    if (oldResources.length > 0) {
      logger.warn('Potential memory leak detected', {
        oldResourceCount: oldResources.length,
        types: oldResources.map((r) => r.type),
      });
    }

    return oldResources.length;
  }

  /**
   * Register an event listener with automatic cleanup
   */
  registerListener(
    target: EventTarget,
    event: string,
    handler: EventListener,
    owner?: object,
  ): () => void {
    target.addEventListener(event, handler);

    const cleanup = () => {
      target.removeEventListener(event, handler);
    };

    const resource: Resource = {
      type: 'listener',
      cleanup,
      created: Date.now(),
    };

    if (owner) {
      this.addResourceToOwner(owner, resource);
    } else {
      this.globalResources.add(resource);
    }

    logger.debug('Listener registered', { event, hasOwner: !!owner });
    return cleanup;
  }

  /**
   * Register a timer with automatic cleanup
   */
  registerTimer(
    callback: () => void,
    delay: number,
    type: 'timeout' | 'interval',
    owner?: object,
  ): () => void {
    const timerId = type === 'timeout' ? setTimeout(callback, delay) : setInterval(callback, delay);

    const cleanup = () => {
      if (type === 'timeout') {
        clearTimeout(timerId as NodeJS.Timeout);
      } else {
        clearInterval(timerId as NodeJS.Timeout);
      }
    };

    const resource: Resource = {
      type: 'timer',
      cleanup,
      created: Date.now(),
    };

    if (owner) {
      this.addResourceToOwner(owner, resource);
    } else {
      this.globalResources.add(resource);
    }

    logger.debug('Timer registered', { type, delay, hasOwner: !!owner });
    return cleanup;
  }

  /**
   * Register a subscription with automatic cleanup
   */
  registerSubscription(unsubscribe: () => void, owner?: object): void {
    const resource: Resource = {
      type: 'subscription',
      cleanup: unsubscribe,
      created: Date.now(),
    };

    if (owner) {
      this.addResourceToOwner(owner, resource);
    } else {
      this.globalResources.add(resource);
    }

    logger.debug('Subscription registered', { hasOwner: !!owner });
  }

  /**
   * Clean up all resources for an owner
   */
  cleanup(owner: object): void {
    const resources = this.resources.get(owner);
    if (!resources) return;

    let count = 0;
    resources.forEach((resource) => {
      resource.cleanup();
      count++;
    });

    this.resources.delete(owner);
    logger.debug('Resources cleaned up', { count });
  }

  /**
   * Clean up all global resources
   */
  cleanupGlobal(): void {
    let count = 0;
    this.globalResources.forEach((resource) => {
      resource.cleanup();
      count++;
    });

    this.globalResources.clear();
    logger.info('Global resources cleaned up', { count });
  }

  /**
   * Get memory statistics
   */
  getMemoryStats(): { heap: number; external: number; leaks: number } {
    const usage = process.memoryUsage();
    const leaks = this.detectLeaks();

    return {
      heap: usage.heapUsed,
      external: usage.external,
      leaks,
    };
  }

  // Private methods continue...
}

export const memoryManager = MemoryManager.getInstance();
