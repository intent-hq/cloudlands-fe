import { createLogger } from './client-logger';

const logger = createLogger('BrowserEventEmitter');

/**
 * Browser-compatible EventEmitter
 *
 * A simple EventEmitter implementation that works in browser environments
 * without requiring Node.js 'events' module.
 */

 
type EventListener = (...args: any[]) => void;

export class EventEmitter {
  private events: Map<string | symbol, Set<EventListener>> = new Map();

  on(event: string | symbol, listener: EventListener): this {
    if (!this.events.has(event)) {
      this.events.set(event, new Set());
    }
    this.events.get(event)!.add(listener);
    return this;
  }

  once(event: string | symbol, listener: EventListener): this {
    const onceWrapper = (...args: any[]) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  off(event: string | symbol, listener: EventListener): this {
    const listeners = this.events.get(event);
    if (listeners) {
      listeners.delete(listener);
      if (listeners.size === 0) {
        this.events.delete(event);
      }
    }
    return this;
  }

   
  emit(event: string | symbol, ...args: any[]): boolean {
    const listeners = this.events.get(event);
    if (!listeners || listeners.size === 0) {
      return false;
    }

    listeners.forEach((listener) => {
      try {
        listener(...args);
      } catch (error) {
        logger.error(`Error in event listener for ${String(event)}:`, error);
      }
    });

    return true;
  }

  removeAllListeners(event?: string | symbol): this {
    if (event) {
      this.events.delete(event);
    } else {
      this.events.clear();
    }
    return this;
  }

  listenerCount(event: string | symbol): number {
    const listeners = this.events.get(event);
    return listeners ? listeners.size : 0;
  }

  eventNames(): (string | symbol)[] {
    return Array.from(this.events.keys());
  }

  // Aliases for compatibility
  addListener = this.on;
  removeListener = this.off;
}
