import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  addMockIpcListener,
  emitMockIpcEvent,
  getRegisteredMockIpcChannels,
  hasMockIpcHandler,
  mockInvoke,
  mockIpcListenerCount,
  registerMockIpcHandler,
  resetMockIpcRouter,
  setMockIpcInvokeFallback,
  UNBRIDGED_INVOKE_ALLOWLIST,
  UnbridgedMockIpcChannelError,
  unregisterMockIpcHandler,
} from './ipc-mock-router';

describe('ipc-mock-router', () => {
  beforeEach(() => {
    resetMockIpcRouter();
  });

  describe('mockInvoke', () => {
    it('rejects unknown channels loudly with the channel name and a bridging hint', async () => {
      const promise = mockInvoke('unknown:channel');
      await expect(promise).rejects.toBeInstanceOf(UnbridgedMockIpcChannelError);
      await expect(mockInvoke('unknown:channel')).rejects.toThrow(
        /No mock IPC handler registered for channel 'unknown:channel'/,
      );
      await expect(mockInvoke('unknown:channel')).rejects.toThrow(/seeder/);
    });

    it('exposes the offending channel on the rejection error', async () => {
      const error = await mockInvoke('bogus:channel').catch((e: unknown) => e);
      expect(error).toBeInstanceOf(UnbridgedMockIpcChannelError);
      expect((error as UnbridgedMockIpcChannelError).channel).toBe('bogus:channel');
    });

    it('resolves allowlisted absence-tolerant channels to their mapped value', async () => {
      for (const [channel, value] of UNBRIDGED_INVOKE_ALLOWLIST) {
        expect(hasMockIpcHandler(channel)).toBe(false);
        expect(await mockInvoke(channel)).toBe(value);
      }
    });

    it('resolves unknown channels to a configured fallback value', async () => {
      setMockIpcInvokeFallback({ success: true, data: null });
      expect(await mockInvoke('unknown:channel')).toEqual({ success: true, data: null });
    });

    it('treats an explicitly configured undefined fallback as opting out of rejection', async () => {
      setMockIpcInvokeFallback(undefined);
      expect(await mockInvoke('unknown:channel')).toBeUndefined();
    });

    it('invokes a registered handler with the original args', async () => {
      const handler = vi.fn((...args: unknown[]) => ({ echoed: args }));
      registerMockIpcHandler('demo:echo', handler);

      const result = await mockInvoke('demo:echo', { id: '1' }, 42);

      expect(handler).toHaveBeenCalledWith({ id: '1' }, 42);
      expect(result).toEqual({ echoed: [{ id: '1' }, 42] });
    });

    it('awaits async handler results', async () => {
      registerMockIpcHandler('demo:async', async () => 'done');
      expect(await mockInvoke('demo:async')).toBe('done');
    });

    it('lets a later registration replace an earlier handler', async () => {
      registerMockIpcHandler('demo:dup', () => 'first');
      registerMockIpcHandler('demo:dup', () => 'second');
      expect(await mockInvoke('demo:dup')).toBe('second');
    });

    it('rejects again after a handler is unregistered', async () => {
      registerMockIpcHandler('demo:temp', () => 'value');
      expect(hasMockIpcHandler('demo:temp')).toBe(true);

      unregisterMockIpcHandler('demo:temp');

      expect(hasMockIpcHandler('demo:temp')).toBe(false);
      await expect(mockInvoke('demo:temp')).rejects.toBeInstanceOf(UnbridgedMockIpcChannelError);
    });

    it('lists registered channels for reconciliation', () => {
      registerMockIpcHandler('demo:b', () => null);
      registerMockIpcHandler('demo:a', () => null);
      expect(getRegisteredMockIpcChannels()).toEqual(['demo:a', 'demo:b']);
    });
  });

  describe('event listeners', () => {
    it('delivers emitted payloads to registered listeners', () => {
      const seen: unknown[] = [];
      addMockIpcListener('evt:ping', (payload) => seen.push(payload));

      emitMockIpcEvent('evt:ping', { value: 1 });
      emitMockIpcEvent('evt:ping', { value: 2 });

      expect(seen).toEqual([{ value: 1 }, { value: 2 }]);
    });

    it('does nothing when emitting on a channel with no listeners', () => {
      expect(() => emitMockIpcEvent('evt:nobody', 'x')).not.toThrow();
    });

    it('stops delivery and updates the count after unsubscribe', () => {
      const seen: unknown[] = [];
      const unsubscribe = addMockIpcListener('evt:counter', (payload) => seen.push(payload));

      expect(mockIpcListenerCount('evt:counter')).toBe(1);
      emitMockIpcEvent('evt:counter', 'a');

      unsubscribe();

      expect(mockIpcListenerCount('evt:counter')).toBe(0);
      emitMockIpcEvent('evt:counter', 'b');
      expect(seen).toEqual(['a']);
    });
  });

  describe('resetMockIpcRouter', () => {
    it('clears handlers, listeners, and the fallback (loud failure restored)', async () => {
      registerMockIpcHandler('demo:reset', () => 'value');
      addMockIpcListener('evt:reset', () => {});
      setMockIpcInvokeFallback('fallback');

      resetMockIpcRouter();

      expect(hasMockIpcHandler('demo:reset')).toBe(false);
      expect(mockIpcListenerCount('evt:reset')).toBe(0);
      await expect(mockInvoke('demo:reset')).rejects.toBeInstanceOf(UnbridgedMockIpcChannelError);
    });
  });
});
