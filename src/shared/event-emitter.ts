import { logger } from './logger';

/**
 * Browser-safe EventEmitter implementation
 *
 * Provides an EventEmitter that works in both Node.js and browser environments
 */

export interface EventListener {
  (...args: any[]): void;
}

/**
 * Browser-safe EventEmitter implementation
 * Compatible with Node.js EventEmitter API but works in browsers
 */
export class EventEmitter {
  private events: Map<string | symbol, EventListener[]> = new Map();
  private maxListeners: number = 10;

  /**
   * Adds a listener for the specified event
   */
  on(event: string | symbol, listener: EventListener): this {
    return this.addListener(event, listener);
  }

  /**
   * Adds a listener for the specified event
   */
  addListener(event: string | symbol, listener: EventListener): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    const listeners = this.events.get(event)!;
    listeners.push(listener);

    // Warn if we exceed max listeners (memory leak detection)
    if (listeners.length > this.maxListeners && this.maxListeners !== 0) {
      logger.warn(
        'MaxListenersExceededWarning: Possible EventEmitter memory leak detected. ' +
          `${listeners.length} ${String(event)} listeners added. Use emitter.setMaxListeners() to increase limit`,
      );
    }

    return this;
  }

  /**
   * Adds a one-time listener for the specified event
   */
  once(event: string | symbol, listener: EventListener): this {
    const onceWrapper = (...args: any[]) => {
      this.removeListener(event, onceWrapper);
      listener.apply(this, args);
    };

    // Store original listener for removeListener compatibility
    (onceWrapper as any).listener = listener;

    return this.on(event, onceWrapper);
  }

  /**
   * Removes a listener for the specified event
   */
  off(event: string | symbol, listener: EventListener): this {
    return this.removeListener(event, listener);
  }

  /**
   * Removes a listener for the specified event
   */
  removeListener(event: string | symbol, listener: EventListener): this {
    const listeners = this.events.get(event);

    if (!listeners) {
      return this;
    }

    const index = listeners.findIndex((l) => l === listener || (l as any).listener === listener);

    if (index !== -1) {
      listeners.splice(index, 1);

      if (listeners.length === 0) {
        this.events.delete(event);
      }
    }

    return this;
  }

  /**
   * Removes all listeners for the specified event, or all listeners if no event specified
   */
  removeAllListeners(event?: string | symbol): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }

    return this;
  }

  /**
   * Emits an event with the given arguments
   */
  emit(event: string | symbol, ...args: any[]): boolean {
    const listeners = this.events.get(event);

    if (!listeners || listeners.length === 0) {
      return false;
    }

    // Create a copy to avoid issues if listeners modify the array
    const listenersCopy = [...listeners];

    for (const listener of listenersCopy) {
      try {
        listener.apply(this, args);
      } catch (error) {
        logger.error(`Error in event listener for "${String(event)}":`, error);
      }
    }

    return true;
  }

  /**
   * Returns an array of listeners for the specified event
   */
  listeners(event: string | symbol): EventListener[] {
    return [...(this.events.get(event) || [])];
  }

  /**
   * Returns an array of event names that have listeners
   */
  eventNames(): (string | symbol)[] {
    return Array.from(this.events.keys());
  }

  /**
   * Returns the number of listeners for the specified event
   */
  listenerCount(event: string | symbol): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.length : 0;
  }

  /**
   * Sets the maximum number of listeners (for memory leak detection)
   */
  setMaxListeners(n: number): this {
    this.maxListeners = n;
    return this;
  }

  /**
   * Gets the maximum number of listeners
   */
  getMaxListeners(): number {
    return this.maxListeners;
  }

  /**
   * Prepends a listener to the beginning of the listeners array
   */
  prependListener(event: string | symbol, listener: EventListener): this {
    if (!this.events.has(event)) {
      this.events.set(event, []);
    }

    const listeners = this.events.get(event)!;
    listeners.unshift(listener);

    return this;
  }

  /**
   * Prepends a one-time listener to the beginning of the listeners array
   */
  prependOnceListener(event: string | symbol, listener: EventListener): this {
    const onceWrapper = (...args: any[]) => {
      this.removeListener(event, onceWrapper);
      listener.apply(this, args);
    };

    // Store original listener for removeListener compatibility
    (onceWrapper as any).listener = listener;

    return this.prependListener(event, onceWrapper);
  }

  /**
   * Returns a copy of the array of listeners for the specified event,
   * including any wrappers (such as those created by .once())
   */
  rawListeners(event: string | symbol): EventListener[] {
    return this.listeners(event);
  }
}

// Export a default instance for convenience
export default EventEmitter;
