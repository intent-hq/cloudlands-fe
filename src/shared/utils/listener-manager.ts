/**
 * Listener Manager
 *
 * Unified event listener management with automatic cleanup.
 * Supports both DOM EventTarget and Node.js EventEmitter patterns.
 */

import { EventEmitter } from '../event-emitter';
import { logger } from '../logger';

export interface ListenerEntry {
  target: EventTarget | EventEmitter;
  event: string;
  handler: EventListener | ((...args: any[]) => void);
  cleanup: () => void;
}

/**
 * Manages event listeners with automatic cleanup
 */
export class ListenerManager {
  private listeners = new Map<string, ListenerEntry>();
  private cleanupFunctions = new Set<() => void>();
  private id = 0;

  /**
   * Add a listener and return cleanup function
   */
  addListener(
    target: EventTarget | EventEmitter,
    event: string,
    handler: EventListener | ((...args: any[]) => void),
  ): () => void {
    const listenerId = `listener-${++this.id}`;

    let cleanup: () => void;

    if (target instanceof EventTarget) {
      target.addEventListener(event, handler as any);
      cleanup = () => {
        target.removeEventListener(event, handler as any);
        this.listeners.delete(listenerId);
        this.cleanupFunctions.delete(cleanup);
      };
    } else if (target instanceof EventEmitter) {
      target.on(event, handler as any);
      cleanup = () => {
        target.off(event, handler as any);
        this.listeners.delete(listenerId);
        this.cleanupFunctions.delete(cleanup);
      };
    } else {
      logger.warn('Unknown target type for listener');
      return () => {};
    }

    this.listeners.set(listenerId, {
      target,
      event,
      handler,
      cleanup,
    });

    this.cleanupFunctions.add(cleanup);
    return cleanup;
  }

  /**
   * Add multiple listeners at once
   */
  addListeners(
    listeners: Array<{
      target: EventTarget | EventEmitter;
      event: string;
      handler: EventListener | ((...args: any[]) => void);
    }>,
  ): () => void {
    const cleanups = listeners.map((l) => this.addListener(l.target, l.event, l.handler));

    return () => {
      cleanups.forEach((cleanup) => cleanup());
    };
  }

  /**
   * Remove a specific listener
   */
  removeListener(listenerId: string): void {
    const entry = this.listeners.get(listenerId);
    if (entry) {
      entry.cleanup();
    }
  }

  /**
   * Get listener count
   */
  getListenerCount(): number {
    return this.listeners.size;
  }

  /**
   * Clean up all listeners
   */
  cleanup(): void {
    logger.debug(`Cleaning up ${this.cleanupFunctions.size} listeners`);

    for (const cleanup of this.cleanupFunctions) {
      try {
        cleanup();
      } catch (error) {
        logger.error('Error during listener cleanup', error as Error);
      }
    }

    this.cleanupFunctions.clear();
    this.listeners.clear();
  }

  /**
   * Get cleanup function for all listeners
   */
  getCleanupFunction(): () => void {
    return () => this.cleanup();
  }
}

/**
 * Create a new listener manager instance
 */
export function createListenerManager(): ListenerManager {
  return new ListenerManager();
}
