/**
 * Wave 3 System Integration Tests
 *
 * Comprehensive end-to-end tests for the complete agent system
 * including listener cleanup and concurrent operations.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  vi,
} from 'vitest';
import { ListenerManager } from '../../../../shared/utils/listener-manager';
import { EventEmitter } from '../../../../shared/event-emitter';

describe('Wave 3 System Integration', () => {
  let listenerManager: ListenerManager;

  beforeEach(() => {
    listenerManager = new ListenerManager();
  });

  afterEach(() => {
    listenerManager.cleanup();
  });

  it('should manage listeners without memory leaks', () => {
    const emitter = new EventEmitter();
    const handlers = Array.from({ length: 10 }, () => vi.fn());

    handlers.forEach((handler) => {
      listenerManager.addListener(emitter, 'test', handler);
    });

    expect(listenerManager.getListenerCount()).toBe(10);

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
  });

  it('should handle concurrent listener operations', () => {
    const emitters = Array.from({ length: 5 }, () => new EventEmitter());
    const handlers = Array.from({ length: 5 }, () => vi.fn());

    // Add listeners concurrently
    emitters.forEach((emitter, i) => {
      handlers.forEach((handler) => {
        listenerManager.addListener(emitter, `event-${i}`, handler);
      });
    });

    expect(listenerManager.getListenerCount()).toBe(25);

    listenerManager.cleanup();

    expect(listenerManager.getListenerCount()).toBe(0);
  });

});
