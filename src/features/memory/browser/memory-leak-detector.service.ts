/**
 * Memory Leak Detector Service
 * Tracks and manages all event listeners, timers, and subscriptions to prevent memory leaks
 */

import { Logger } from '$lib/utils/logger';

const logger = new Logger({ category: 'MemoryLeakDetector' });

 
type EventHandler = (...args: any[]) => void;

interface TrackedResource {
  type: 'listener' | 'timer' | 'interval' | 'subscription' | 'stream';
  target?: EventTarget;
  event?: string;
  handler?: EventHandler;
  id?: NodeJS.Timeout | number;
  cleanup?: () => void;
  component?: string;
  timestamp: number;
}

class MemoryLeakDetectorService {
  private resources = new Map<string, TrackedResource>();
  private resourceCounter = 0;
  private warningThreshold = 100;
  private cleanupCallbacks = new Set<() => void>();
  private monitoringInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.startMonitoring();
  }

  /**
   * Track an event listener
   */
  trackEventListener(
    target: EventTarget,
    event: string,
    handler: EventHandler,
    component?: string,
  ): string {
    const id = this.generateId();

    this.resources.set(id, {
      type: 'listener',
      target,
      event,
      handler,
      component,
      timestamp: Date.now(),
    });

    this.checkThreshold();
    return id;
  }

  /**
   * Track a timer (setTimeout)
   */
  trackTimer(timerId: NodeJS.Timeout | number, component?: string): string {
    const id = this.generateId();

    this.resources.set(id, {
      type: 'timer',
      id: timerId,
      component,
      timestamp: Date.now(),
    });

    this.checkThreshold();
    return id;
  }

  /**
   * Track an interval (setInterval)
   */
  trackInterval(intervalId: NodeJS.Timeout | number, component?: string): string {
    const id = this.generateId();

    this.resources.set(id, {
      type: 'interval',
      id: intervalId,
      component,
      timestamp: Date.now(),
    });

    this.checkThreshold();
    return id;
  }

  /**
   * Track a subscription with cleanup function
   */
  trackSubscription(cleanup: () => void, component?: string): string {
    const id = this.generateId();

    this.resources.set(id, {
      type: 'subscription',
      cleanup,
      component,
      timestamp: Date.now(),
    });

    this.checkThreshold();
    return id;
  }

  /**
   * Track a stream handler
   */
  trackStreamHandler(cleanup: () => void, component?: string): string {
    const id = this.generateId();

    this.resources.set(id, {
      type: 'stream',
      cleanup,
      component,
      timestamp: Date.now(),
    });

    this.checkThreshold();
    return id;
  }

  /**
   * Untrack and cleanup a resource
   */
  untrack(id: string): void {
    const resource = this.resources.get(id);
    if (!resource) return;

    // Perform cleanup based on resource type
    switch (resource.type) {
      case 'listener':
        if (resource.target && resource.event && resource.handler) {
          resource.target.removeEventListener(resource.event, resource.handler as EventListener);
        }
        break;

      case 'timer':
        if (resource.id) {
          clearTimeout(resource.id as NodeJS.Timeout);
        }
        break;

      case 'interval':
        if (resource.id) {
          clearInterval(resource.id as NodeJS.Timeout);
        }
        break;

      case 'subscription':
      case 'stream':
        if (resource.cleanup) {
          try {
            resource.cleanup();
          } catch (error) {
            logger.error('Error during resource cleanup', error as Error);
          }
        }
        break;
    }

    this.resources.delete(id);
  }

  /**
   * Cleanup all resources for a specific component
   */
  cleanupComponent(component: string): void {
    const toCleanup: string[] = [];

    for (const [id, resource] of this.resources.entries()) {
      if (resource.component === component) {
        toCleanup.push(id);
      }
    }

    logger.info(`Cleaning up ${toCleanup.length} resources for component: ${component}`);

    for (const id of toCleanup) {
      this.untrack(id);
    }
  }

  /**
   * Register a cleanup callback to be called on disposal
   */
  registerCleanupCallback(callback: () => void): void {
    this.cleanupCallbacks.add(callback);
  }

  /**
   * Get current resource statistics
   */
  getStats(): Record<string, number> {
    const stats: Record<string, number> = {
      total: this.resources.size,
      listeners: 0,
      timers: 0,
      intervals: 0,
      subscriptions: 0,
      streams: 0,
    };

    for (const resource of this.resources.values()) {
      stats[`${resource.type}s`]++;
    }

    return stats;
  }

  /**
   * Get resources older than specified age (in ms)
   */
  getOldResources(maxAge: number): Array<{ id: string; resource: TrackedResource }> {
    const now = Date.now();
    const old: Array<{ id: string; resource: TrackedResource }> = [];

    for (const [id, resource] of this.resources.entries()) {
      if (now - resource.timestamp > maxAge) {
        old.push({ id, resource });
      }
    }

    return old;
  }

  /**
   * Cleanup old resources (older than 5 minutes by default)
   */
  cleanupOldResources(maxAge = 5 * 60 * 1000): void {
    const oldResources = this.getOldResources(maxAge);

    if (oldResources.length > 0) {
      logger.warn(`Cleaning up ${oldResources.length} old resources`);

      for (const { id, resource } of oldResources) {
        logger.debug(`Cleaning up old resource: ${resource.type} from ${resource.component}`);
        this.untrack(id);
      }
    }
  }

  /**
   * Start monitoring for potential leaks
   */
  private startMonitoring(): void {
    // Monitor every 30 seconds
    this.monitoringInterval = setInterval(() => {
      const stats = this.getStats();

      if (stats.total > this.warningThreshold) {
        logger.warn(`High resource count detected: ${stats.total}`, stats);
      }

      // Cleanup resources older than 10 minutes
      this.cleanupOldResources(10 * 60 * 1000);
    }, 30000);
  }

  /**
   * Check if we've exceeded the warning threshold
   */
  private checkThreshold(): void {
    if (this.resources.size > this.warningThreshold) {
      const stats = this.getStats();
      logger.warn(`Resource threshold exceeded: ${this.resources.size}`, stats);
    }
  }

  /**
   * Generate unique ID for tracking
   */
  private generateId(): string {
    return `resource_${++this.resourceCounter}_${Date.now()}`;
  }

  /**
   * Dispose of all resources and cleanup
   */
  dispose(): void {
    logger.info('Disposing MemoryLeakDetector', this.getStats());

    // Stop monitoring
    if (this.monitoringInterval) {
      clearInterval(this.monitoringInterval);
      this.monitoringInterval = null;
    }

    // Cleanup all tracked resources
    const allIds = Array.from(this.resources.keys());
    for (const id of allIds) {
      this.untrack(id);
    }

    // Call all registered cleanup callbacks
    for (const callback of this.cleanupCallbacks) {
      try {
        callback();
      } catch (error) {
        logger.error('Error during cleanup callback', error as Error);
      }
    }

    this.cleanupCallbacks.clear();
    this.resources.clear();
  }
}

// Export singleton instance
export const memoryLeakDetector = new MemoryLeakDetectorService();
