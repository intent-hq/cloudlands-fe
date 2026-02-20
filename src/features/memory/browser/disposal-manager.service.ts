/**
 * Disposal Manager Service
 * Provides a centralized way to manage disposable resources and ensure proper cleanup
 */

import { Logger } from '$lib/utils/logger';
import { memoryLeakDetector } from './memory-leak-detector.service';
import type { IDisposable } from '$shared/types/disposable';

// Re-export for convenience
export type { IDisposable };

const logger = new Logger({ category: 'DisposalManager' });

export class DisposableStore implements IDisposable {
  private disposables = new Set<IDisposable | (() => void)>();
  private isDisposed = false;

  /**
   * Add a disposable resource
   */
  add<T extends IDisposable | (() => void)>(disposable: T): T {
    if (this.isDisposed) {
      logger.warn('Cannot add to disposed store');
      // Dispose immediately if store is already disposed
      if (typeof disposable === 'function') {
        disposable();
      } else {
        disposable.dispose();
      }
      return disposable;
    }

    this.disposables.add(disposable);
    return disposable;
  }

  /**
   * Add an event listener and automatically handle cleanup
   */
  addEventListener(
    target: EventTarget,
    event: string,
    handler: EventListener,
    options?: AddEventListenerOptions,
    component?: string,
  ): void {
    if (this.isDisposed) {
      logger.warn('Cannot add listener to disposed store');
      return;
    }

    target.addEventListener(event, handler, options);

    const trackingId = memoryLeakDetector.trackEventListener(target, event, handler, component);

    this.add(() => {
      target.removeEventListener(event, handler, options);
      memoryLeakDetector.untrack(trackingId);
    });
  }

  /**
   * Add an Electron IPC listener and automatically handle cleanup
   */
  addElectronListener(event: string, handler: (...args: any[]) => void, component?: string): void {
    if (this.isDisposed) {
      logger.warn('Cannot add Electron listener to disposed store');
      return;
    }

    if (typeof window !== 'undefined' && window.electronAPI) {
      // Use ID-based listener removal for reliable cleanup with context isolation
      const listenerId = window.electronAPI.on(event, handler);

      // Track cleanup state to avoid double-removal warnings
      let cleaned = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (window.electronAPI && listenerId) {
          window.electronAPI.offById(event, listenerId);
        }
      };

      const trackingId = memoryLeakDetector.trackSubscription(cleanup, component);

      this.add(() => {
        cleanup();
        memoryLeakDetector.untrack(trackingId);
      });
    }
  }

  /**
   * Add a timer and automatically handle cleanup
   */
  setTimeout(callback: () => void, delay: number, component?: string): NodeJS.Timeout {
    if (this.isDisposed) {
      logger.warn('Cannot add timer to disposed store');
      return null as any;
    }

    const timer = setTimeout(() => {
      this.disposables.delete(cleanup);
      memoryLeakDetector.untrack(trackingId);
      callback();
    }, delay);

    const trackingId = memoryLeakDetector.trackTimer(timer, component);

    const cleanup = () => {
      clearTimeout(timer);
      memoryLeakDetector.untrack(trackingId);
    };

    this.add(cleanup);
    return timer;
  }

  /**
   * Add an interval and automatically handle cleanup
   */
  setInterval(callback: () => void, delay: number, component?: string): NodeJS.Timeout {
    if (this.isDisposed) {
      logger.warn('Cannot add interval to disposed store');
      return null as any;
    }

    const interval = setInterval(callback, delay);
    const trackingId = memoryLeakDetector.trackInterval(interval, component);

    this.add(() => {
      clearInterval(interval);
      memoryLeakDetector.untrack(trackingId);
    });

    return interval;
  }

  /**
   * Clear all disposables without disposing the store
   */
  clear(): void {
    if (this.isDisposed) {
      return;
    }

    for (const disposable of this.disposables) {
      try {
        if (typeof disposable === 'function') {
          disposable();
        } else {
          disposable.dispose();
        }
      } catch (error) {
        logger.error('Error during disposal', error as Error);
      }
    }

    this.disposables.clear();
  }

  /**
   * Dispose of all resources and mark as disposed
   */
  dispose(): void {
    if (this.isDisposed) {
      return;
    }

    this.clear();
    this.isDisposed = true;
  }
}

/**
 * Component Disposal Manager
 * Manages disposal for Svelte components
 */
export class ComponentDisposalManager {
  private componentStores = new Map<string, DisposableStore>();

  /**
   * Get or create a disposal store for a component
   */
  getStore(componentId: string): DisposableStore {
    if (!this.componentStores.has(componentId)) {
      this.componentStores.set(componentId, new DisposableStore());
    }
    return this.componentStores.get(componentId)!;
  }

  /**
   * Dispose of a component's resources
   */
  disposeComponent(componentId: string): void {
    const store = this.componentStores.get(componentId);
    if (store) {
      store.dispose();
      this.componentStores.delete(componentId);
      memoryLeakDetector.cleanupComponent(componentId);
    }
  }

  /**
   * Dispose of all components
   */
  disposeAll(): void {
    for (const [componentId, store] of this.componentStores.entries()) {
      store.dispose();
      memoryLeakDetector.cleanupComponent(componentId);
    }
    this.componentStores.clear();
  }

  /**
   * Get statistics about managed components
   */
  getStats(): { componentCount: number; components: string[] } {
    return {
      componentCount: this.componentStores.size,
      components: Array.from(this.componentStores.keys()),
    };
  }
}

/**
 * Create a disposal helper for use in Svelte components
 */
export function createDisposalHelper(componentName: string) {
  const store = new DisposableStore();

  return {
    store,

    // Helper methods for common patterns
    addEventListener(
      target: EventTarget,
      event: string,
      handler: EventListener,
      options?: AddEventListenerOptions,
    ) {
      store.addEventListener(target, event, handler, options, componentName);
    },

    addElectronListener(event: string, handler: (...args: any[]) => void) {
      store.addElectronListener(event, handler, componentName);
    },

    setTimeout(callback: () => void, delay: number) {
      return store.setTimeout(callback, delay, componentName);
    },

    setInterval(callback: () => void, delay: number) {
      return store.setInterval(callback, delay, componentName);
    },

    // Cleanup function to be called in component's onDestroy or $effect cleanup
    dispose() {
      store.dispose();
      memoryLeakDetector.cleanupComponent(componentName);
    },
  };
}

// Export singleton instance
export const componentDisposalManager = new ComponentDisposalManager();
