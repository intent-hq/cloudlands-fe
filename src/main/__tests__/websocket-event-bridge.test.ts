/**
 * WebSocket Event Bridge Tests
 *
 * Tests event subscription bridging via local filter engine to WebSocket clients.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock electron for Logger
vi.mock('electron', () => ({
  app: { getPath: vi.fn().mockReturnValue('/tmp'), isPackaged: false },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
}));

import {
  registerSendCallback,
  clearSendCallback,
  handleSubscribe,
  handleUnsubscribe,
  cleanupClient,
  cleanupAllClients,
  getClientSubscriptionCount,
  getTrackedClientCount,
  deliverEventToWebSocketSubscriptions,
} from '../websocket-event-bridge';

describe('WebSocket Event Bridge', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    clearSendCallback();
    cleanupAllClients();
  });

  describe('registerSendCallback()', () => {
    it('stores the callback without throwing', () => {
      const sendFn = vi.fn();
      expect(() => registerSendCallback(sendFn)).not.toThrow();
    });

    it('returns an idempotent unregister function that clears the callback', () => {
      const sendFn = vi.fn();
      const unregister = registerSendCallback(sendFn);
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });

      unregister();
      unregister();

      deliverEventToWebSocketSubscriptions({
        type: 'file:changed',
        workspaceId: 'ws-1',
        id: 'evt-unregistered',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: { path: '/test.ts' },
        metadata: {},
      });

      expect(sendFn).not.toHaveBeenCalled();
    });

    it('does not let an older unregister clear a newer callback', () => {
      const oldSendFn = vi.fn();
      const newSendFn = vi.fn();
      const unregisterOld = registerSendCallback(oldSendFn);
      registerSendCallback(newSendFn);
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });

      unregisterOld();

      deliverEventToWebSocketSubscriptions({
        type: 'file:changed',
        workspaceId: 'ws-1',
        id: 'evt-current-callback',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: { path: '/test.ts' },
        metadata: {},
      });

      expect(oldSendFn).not.toHaveBeenCalled();
      expect(newSendFn).toHaveBeenCalledTimes(1);
    });
  });

  describe('handleSubscribe()', () => {
    it('returns a subscriptionId', () => {
      const result = handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      expect(result).toHaveProperty('subscriptionId');
      expect(typeof result.subscriptionId).toBe('string');
    });

    it('tracks the subscription', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      expect(getClientSubscriptionCount('client-1')).toBe(1);
    });

    it('throws for empty eventTypes', () => {
      expect(() => handleSubscribe('client-1', { eventTypes: [] })).toThrow();
    });

    it('throws for missing eventTypes', () => {
      expect(() => handleSubscribe('client-1', {} as any)).toThrow();
    });

    it('accumulates subscriptions without replaceGroup', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      handleSubscribe('client-1', { eventTypes: ['agent:started'] });
      // Without replaceGroup, subscriptions accumulate
      expect(getClientSubscriptionCount('client-1')).toBe(2);
    });

    it('replaces existing subscription when replaceGroup matches', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'], replaceGroup: 'global' });
      handleSubscribe('client-1', { eventTypes: ['agent:started'], replaceGroup: 'global' });
      // replaceGroup deduplicates
      expect(getClientSubscriptionCount('client-1')).toBe(1);
    });
  });

  describe('handleUnsubscribe()', () => {
    it('removes a subscription and returns true', () => {
      const { subscriptionId } = handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      const result = handleUnsubscribe('client-1', { subscriptionId });
      expect(result).toBe(true);
      expect(getClientSubscriptionCount('client-1')).toBe(0);
    });

    it('returns false for unknown subscriptionId', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      const result = handleUnsubscribe('client-1', { subscriptionId: 'nonexistent' });
      expect(result).toBe(false);
    });

    it('returns false for unknown client', () => {
      const result = handleUnsubscribe('unknown-client', { subscriptionId: 'sub-1' });
      expect(result).toBe(false);
    });

    it('throws for missing subscriptionId', () => {
      expect(() => handleUnsubscribe('client-1', {} as any)).toThrow();
    });
  });

  describe('cleanupClient()', () => {
    it('removes all subscriptions for a client', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      // Without replaceGroup, subscriptions accumulate
      handleSubscribe('client-1', { eventTypes: ['agent:started'] });
      expect(getClientSubscriptionCount('client-1')).toBe(2);
      cleanupClient('client-1');
      expect(getClientSubscriptionCount('client-1')).toBe(0);
      expect(getTrackedClientCount()).toBe(0);
    });

    it('replaceGroup deduplicates subscriptions from the same client', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'], replaceGroup: 'global' });
      handleSubscribe('client-1', { eventTypes: ['agent:started'], replaceGroup: 'global' });
      expect(getClientSubscriptionCount('client-1')).toBe(1);
      cleanupClient('client-1');
      expect(getClientSubscriptionCount('client-1')).toBe(0);
    });

    it('does not throw for unknown client', () => {
      expect(() => cleanupClient('nonexistent')).not.toThrow();
    });

    it('removes delivery entries so cleaned-up clients receive no later events', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      cleanupClient('client-1');

      deliverEventToWebSocketSubscriptions({
        type: 'file:changed',
        workspaceId: 'ws-1',
        id: 'evt-cleanup-1',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: { path: '/test.ts' },
        metadata: {},
      });

      expect(sendFn).not.toHaveBeenCalled();
    });

    it('does not retain subscriptions across repeated subscribe, unsubscribe, and cleanup cycles', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      for (let cycle = 0; cycle < 25; cycle++) {
        const clientId = `client-${cycle}`;
        const { subscriptionId } = handleSubscribe(clientId, { eventTypes: ['file:changed'] });
        handleSubscribe(clientId, { eventTypes: ['agent:started'] });
        expect(getClientSubscriptionCount(clientId)).toBe(2);

        expect(handleUnsubscribe(clientId, { subscriptionId })).toBe(true);
        expect(getClientSubscriptionCount(clientId)).toBe(1);

        cleanupClient(clientId);
        expect(getClientSubscriptionCount(clientId)).toBe(0);
        expect(getTrackedClientCount()).toBe(0);

        deliverEventToWebSocketSubscriptions({
          type: 'agent:started',
          workspaceId: 'ws-1',
          id: `evt-cleaned-${cycle}`,
          timestamp: '2026-01-01T00:00:00Z',
          actor: { type: 'system', id: 'system' },
          data: { agentId: `agent-${cycle}` },
          metadata: {},
        });
      }

      expect(sendFn).not.toHaveBeenCalled();
      expect(getTrackedClientCount()).toBe(0);
    });

  });

  describe('cleanupAllClients()', () => {
    it('clears all transport-local subscription state', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      handleSubscribe('client-2', { eventTypes: ['agent:started'] });

      cleanupAllClients();

      expect(getTrackedClientCount()).toBe(0);
      expect(getClientSubscriptionCount('client-1')).toBe(0);
      deliverEventToWebSocketSubscriptions({
        type: 'file:changed',
        workspaceId: 'ws-1',
        id: 'evt-all-cleaned',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: { path: '/test.ts' },
        metadata: {},
      });
      expect(sendFn).not.toHaveBeenCalled();
    });
  });

  describe('event forwarding via deliverEventToWebSocketSubscriptions', () => {
    it('calls send callback with JSON-RPC notification for matching event', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['file:changed'] });

      // Deliver event via the exported delivery function (called by saga)
      deliverEventToWebSocketSubscriptions({
        type: 'file:changed',
        workspaceId: 'ws-1',
        id: 'evt-1',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: { path: '/test.ts' },
        metadata: {},
      });

      expect(sendFn).toHaveBeenCalledTimes(1);
      const [clientId, message] = sendFn.mock.calls[0];
      expect(clientId).toBe('client-1');
      const parsed = JSON.parse(message);
      expect(parsed.jsonrpc).toBe('2.0');
      expect(parsed.method).toBe('events.event');
      expect(parsed.params.event.type).toBe('file:changed');
    });

    it('does not forward non-matching events', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['file:changed'] });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:started',
        workspaceId: 'ws-1',
        id: 'evt-2',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: {},
        metadata: {},
      });

      expect(sendFn).not.toHaveBeenCalled();
    });

    it('uses shared mixed wildcard/exact and workspace filtering semantics', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', {
        eventTypes: ['agent:queue:*', 'file:changed'],
        workspaceId: 'ws-1',
      });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:queue:updated',
        workspaceId: 'ws-1',
        id: 'evt-match-1',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'system', id: 'system' },
        data: {},
        metadata: {},
      });
      deliverEventToWebSocketSubscriptions({
        type: 'file:changed',
        workspaceId: 'ws-2',
        id: 'evt-other-ws',
        timestamp: '2026-01-01T00:00:01Z',
        actor: { type: 'system', id: 'system' },
        data: {},
        metadata: {},
      });

      expect(sendFn).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(sendFn.mock.calls[0][1]);
      expect(parsed.params.event.type).toBe('agent:queue:updated');
    });
  });

  describe('diagnostics', () => {
    it('getClientSubscriptionCount returns 0 for unknown client', () => {
      expect(getClientSubscriptionCount('unknown')).toBe(0);
    });

    it('getTrackedClientCount returns number of clients with subscriptions', () => {
      handleSubscribe('client-1', { eventTypes: ['file:changed'] });
      handleSubscribe('client-2', { eventTypes: ['agent:started'] });
      expect(getTrackedClientCount()).toBe(2);
    });
  });

  // =========================================================================
  // Queue Workspace Event Forwarding
  // =========================================================================
  describe('queue workspace event forwarding', () => {
    it('forwards agent:queue:updated events to subscribers', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['agent:queue:*'] });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:queue:updated',
        workspaceId: 'ws-1',
        id: 'evt-queue-1',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'user', id: 'user' },
        data: { agentId: 'agent-1', queue: [] },
        metadata: {},
      });

      expect(sendFn).toHaveBeenCalledTimes(1);
      const [clientId, message] = sendFn.mock.calls[0];
      expect(clientId).toBe('client-1');
      const parsed = JSON.parse(message);
      expect(parsed.method).toBe('events.event');
      expect(parsed.params.event.type).toBe('agent:queue:updated');
      expect(parsed.params.event.data.agentId).toBe('agent-1');
    });

    it('forwards agent:queue:processing events to subscribers', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['agent:*'] });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:queue:processing',
        workspaceId: 'ws-1',
        id: 'evt-queue-2',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'user', id: 'user' },
        data: { agentId: 'agent-1', messageId: 'msg-1', content: 'test' },
        metadata: {},
      });

      expect(sendFn).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(sendFn.mock.calls[0][1]);
      expect(parsed.params.event.type).toBe('agent:queue:processing');
      expect(parsed.params.event.data.messageId).toBe('msg-1');
    });

    it('forwards agent:queue:processing-cancelled events to subscribers', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['agent:queue:processing-cancelled'] });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:queue:processing-cancelled',
        workspaceId: 'ws-1',
        id: 'evt-queue-3',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'user', id: 'user' },
        data: { agentId: 'agent-1', messageId: 'msg-1' },
        metadata: {},
      });

      expect(sendFn).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(sendFn.mock.calls[0][1]);
      expect(parsed.params.event.type).toBe('agent:queue:processing-cancelled');
    });

    // Audit 2 C3: stale-message used to be an IPC-only channel; the handler
    // now also routes it via `reduxEmitWorkspaceEvent` so WebSocket clients
    // subscribing to the `agent:queue:*` family receive it alongside the
    // three sibling events.
    it('forwards agent:queue:stale-message events to subscribers (Audit 2 C3)', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      handleSubscribe('client-1', { eventTypes: ['agent:queue:*'] });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:queue:stale-message',
        workspaceId: 'ws-1',
        id: 'evt-queue-stale-1',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'user', id: 'user' },
        data: {
          agentId: 'agent-1',
          messageId: 'msg-stale-1',
          ageMinutes: 75,
          queuedAt: '2025-12-31T22:45:00Z',
        },
        metadata: {},
      });

      expect(sendFn).toHaveBeenCalledTimes(1);
      const parsed = JSON.parse(sendFn.mock.calls[0][1]);
      expect(parsed.params.event.type).toBe('agent:queue:stale-message');
      expect(parsed.params.event.data.agentId).toBe('agent-1');
      expect(parsed.params.event.data.messageId).toBe('msg-stale-1');
      expect(parsed.params.event.data.ageMinutes).toBe(75);
    });

    it('does not forward queue events to non-subscribed clients', () => {
      const sendFn = vi.fn();
      registerSendCallback(sendFn);

      // Subscribe to file events only
      handleSubscribe('client-1', { eventTypes: ['file:*'] });

      deliverEventToWebSocketSubscriptions({
        type: 'agent:queue:updated',
        workspaceId: 'ws-1',
        id: 'evt-queue-4',
        timestamp: '2026-01-01T00:00:00Z',
        actor: { type: 'user', id: 'user' },
        data: { agentId: 'agent-1', queue: [] },
        metadata: {},
      });

      expect(sendFn).not.toHaveBeenCalled();
    });
  });
});