import { logger } from '../../../shared/logger';

/**
 * Browser-compatible EventEmitter
 *
 * A simple event emitter implementation that works in the browser
 * without requiring Node.js EventEmitter
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type EventListener = (...args: any[]) => void;

export class BrowserEventEmitter {
  private events: Map<string, Set<EventListener>> = new Map();
  private onceEvents: Map<string, Set<EventListener>> = new Map();

  /**
   * Register an event listener
   */
  on(event: string, listener: EventListener): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.add(listener);
    }
    return this;
  }

  /**
   * Register a one-time event listener
   */
  once(event: string, listener: EventListener): this {
    if (!this.onceEvents.has(event)) {
      this.onceEvents.set(event, new Set());
    }
    const listeners = this.onceEvents.get(event);
    if (listeners) {
      listeners.add(listener);
    }
    return this;
  }

  /**
   * Remove an event listener
   */
  off(event: string, listener: EventListener): this {
    this.events.get(event)?.delete(listener);
    this.onceEvents.get(event)?.delete(listener);
    return this;
  }

  /**
   * Emit an event
   */
  emit(event: string, ...args: any[]): boolean {
    let handled = false;

    // Call regular listeners
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
          handled = true;
        } catch (error) {
          logger.error(`Error in event listener for ${event}:`, error);
        }
      });
    }

    // Call once listeners and remove them
    const onceListeners = this.onceEvents.get(event);
    if (onceListeners) {
      onceListeners.forEach((listener) => {
        try {
          listener(...args);
          handled = true;
        } catch (error) {
          logger.error(`Error in once listener for ${event}:`, error);
        }
      });
      this.onceEvents.delete(event);
    }

    return handled;
  }

  /**
   * Remove all listeners for an event
   */
  removeAllListeners(event?: string): this {
    if (event) {
      this.events.delete(event);
      this.onceEvents.delete(event);
    } else {
      this.events.clear();
      this.onceEvents.clear();
    }
    return this;
  }

  /**
   * Get the number of listeners for an event
   */
  listenerCount(event: string): number {
    const regular = this.events.get(event)?.size || 0;
    const once = this.onceEvents.get(event)?.size || 0;
    return regular + once;
  }

  /**
   * Get all listener functions for an event
   */
  listeners(event: string): EventListener[] {
    const regular = Array.from(this.events.get(event) || []);
    const once = Array.from(this.onceEvents.get(event) || []);
    return [...regular, ...once];
  }

  /**
   * Get all event names
   */
  eventNames(): string[] {
    const regularEvents = Array.from(this.events.keys());
    const onceEvents = Array.from(this.onceEvents.keys());
    return [...new Set([...regularEvents, ...onceEvents])];
  }
}

// Alias for compatibility
export const EventEmitter = BrowserEventEmitter;
