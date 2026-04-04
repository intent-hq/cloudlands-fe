/**
 * Browser-compatible Event Emitter
 *
 * Provides a simple event emitter implementation that works in both
 * Node.js and browser environments, replacing the Node.js EventEmitter.
 */

import { Logger } from '../logger';

const logger = new Logger('EventEmitter');

 
type EventListener = (...args: any[]) => void;

export class EventEmitter {
  private listeners: Map<string, Set<EventListener>> = new Map();

  on(event: string, listener: EventListener): this {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(listener);
    return this;
  }

  once(event: string, listener: EventListener): this {
    const onceWrapper = (...args: any[]) => {
      listener(...args);
      this.off(event, onceWrapper);
    };
    return this.on(event, onceWrapper);
  }

  off(event: string, listener: EventListener): this {
    const listeners = this.listeners.get(event);
    if (listeners) {
      listeners.delete(listener);
    }
    return this;
  }

   
  emit(event: string, ...args: any[]): boolean {
    const listeners = this.listeners.get(event);
    if (listeners && listeners.size > 0) {
      listeners.forEach((listener) => {
        try {
          listener(...args);
        } catch (error) {
          logger.error(`Error in event listener for "${event}":`, error);
        }
      });
      return true;
    }
    return false;
  }

  removeAllListeners(event?: string): this {
    if (event) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
    return this;
  }

  listenerCount(event: string): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  eventNames(): string[] {
    return Array.from(this.listeners.keys());
  }

  getMaxListeners(): number {
    return 10;
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  setMaxListeners(_n: number): this {
    // No-op for compatibility
    return this;
  }
}
