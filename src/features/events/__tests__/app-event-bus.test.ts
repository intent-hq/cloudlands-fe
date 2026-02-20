import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppEventBus, AppEventSchemas } from '../main/app-event-bus';

describe('AppEventBus', () => {
  beforeEach(() => {
    AppEventBus.resetInstance();
  });

  describe('singleton pattern', () => {
    it('should return the same instance', () => {
      const instance1 = AppEventBus.getInstance();
      const instance2 = AppEventBus.getInstance();
      expect(instance1).toBe(instance2);
    });

    it('should reset instance correctly', () => {
      const instance1 = AppEventBus.getInstance();
      AppEventBus.resetInstance();
      const instance2 = AppEventBus.getInstance();
      expect(instance1).not.toBe(instance2);
    });
  });

  describe('emitAppEvent', () => {
    it('should emit a valid app:startup event', () => {
      const bus = AppEventBus.getInstance();
      const listener = vi.fn();
      bus.onAppEvent('app:startup', listener);

      const event = bus.emitAppEvent('app:startup', {
        version: '1.0.0',
        environment: 'development',
      });

      expect(event.type).toBe('app:startup');
      expect(event.data.version).toBe('1.0.0');
      expect(event.id).toBeDefined();
      expect(event.timestamp).toBeDefined();
      expect(listener).toHaveBeenCalledWith(event);
    });

    it('should throw on invalid payload', () => {
      const bus = AppEventBus.getInstance();

      expect(() => {
        bus.emitAppEvent('app:startup', {
          version: 123, // Should be string
        } as any);
      }).toThrow();
    });

    it('should cache last event of each type', () => {
      const bus = AppEventBus.getInstance();

      bus.emitAppEvent('app:startup', { version: '1.0.0' });
      bus.emitAppEvent('auth:login', { userId: 'user-1' });

      expect(bus.getLastEvent('app:startup')?.data.version).toBe('1.0.0');
      expect(bus.getLastEvent('auth:login')?.data.userId).toBe('user-1');
    });

    it('should update last event when same type is emitted again', () => {
      const bus = AppEventBus.getInstance();

      bus.emitAppEvent('app:startup', { version: '1.0.0' });
      bus.emitAppEvent('app:startup', { version: '2.0.0' });

      expect(bus.getLastEvent('app:startup')?.data.version).toBe('2.0.0');
    });
  });

  describe('onAnyAppEvent', () => {
    it('should receive all app events', () => {
      const bus = AppEventBus.getInstance();
      const listener = vi.fn();
      bus.onAnyAppEvent(listener);

      bus.emitAppEvent('app:startup', { version: '1.0.0' });
      bus.emitAppEvent('auth:login', { userId: 'user-1' });

      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('onceAppEvent', () => {
    it('should only receive the first event', () => {
      const bus = AppEventBus.getInstance();
      const listener = vi.fn();
      bus.onceAppEvent('app:startup', listener);

      bus.emitAppEvent('app:startup', { version: '1.0.0' });
      bus.emitAppEvent('app:startup', { version: '2.0.0' });

      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0].data.version).toBe('1.0.0');
    });
  });

  describe('offAppEvent', () => {
    it('should remove listener', () => {
      const bus = AppEventBus.getInstance();
      const listener = vi.fn();
      bus.onAppEvent('app:startup', listener);
      bus.offAppEvent('app:startup', listener);

      bus.emitAppEvent('app:startup', { version: '1.0.0' });

      expect(listener).not.toHaveBeenCalled();
    });
  });

  describe('isAppEventType', () => {
    it('should return true for valid app event types', () => {
      expect(AppEventBus.isAppEventType('app:startup')).toBe(true);
      expect(AppEventBus.isAppEventType('auth:login')).toBe(true);
      expect(AppEventBus.isAppEventType('system:error')).toBe(true);
    });

    it('should return false for invalid event types', () => {
      expect(AppEventBus.isAppEventType('invalid:event')).toBe(false);
      expect(AppEventBus.isAppEventType('workspace:created')).toBe(false);
    });
  });

  describe('AppEventSchemas', () => {
    it('should have all expected event types', () => {
      const expectedTypes = [
        'app:startup',
        'app:shutdown',
        'app:settings-changed',
        'app:update-available',
        'auth:login',
        'auth:logout',
        'auth:token-refreshed',
        'auth:required',
        'system:memory-warning',
        'system:disk-space-low',
        'system:error',
      ];

      for (const type of expectedTypes) {
        expect(AppEventSchemas[type as keyof typeof AppEventSchemas]).toBeDefined();
      }
    });
  });
});
