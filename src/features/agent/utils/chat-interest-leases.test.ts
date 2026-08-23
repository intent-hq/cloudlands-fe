import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  acquireChatInterestLease,
  chatInterestLeaseCount,
  clearAllChatInterestLeases,
  hasChatInterestLease,
  onLastChatInterestLeaseReleased,
  releaseChatInterestLease,
} from './chat-interest-leases';

describe('chat-interest-leases', () => {
  beforeEach(() => {
    clearAllChatInterestLeases();
  });

  it('reports no lease for an unknown agent', () => {
    expect(hasChatInterestLease('agent-a')).toBe(false);
    expect(chatInterestLeaseCount('agent-a')).toBe(0);
  });

  it('acquire/release round-trips a single holder', () => {
    acquireChatInterestLease('agent-a', 'panel-1');
    expect(hasChatInterestLease('agent-a')).toBe(true);
    expect(chatInterestLeaseCount('agent-a')).toBe(1);

    releaseChatInterestLease('agent-a', 'panel-1');
    expect(hasChatInterestLease('agent-a')).toBe(false);
    expect(chatInterestLeaseCount('agent-a')).toBe(0);
  });

  it('re-acquiring the same (agentId, holderId) is idempotent', () => {
    acquireChatInterestLease('agent-a', 'panel-1');
    acquireChatInterestLease('agent-a', 'panel-1');
    expect(chatInterestLeaseCount('agent-a')).toBe(1);

    // One release fully clears the idempotent double-acquire.
    releaseChatInterestLease('agent-a', 'panel-1');
    expect(hasChatInterestLease('agent-a')).toBe(false);
  });

  it('releasing an unheld key is a no-op', () => {
    expect(() => releaseChatInterestLease('agent-a', 'panel-1')).not.toThrow();

    acquireChatInterestLease('agent-a', 'panel-1');
    releaseChatInterestLease('agent-a', 'panel-2');
    expect(hasChatInterestLease('agent-a')).toBe(true);
    expect(chatInterestLeaseCount('agent-a')).toBe(1);
  });

  it('tracks multiple panel instances per agent (double-mount)', () => {
    acquireChatInterestLease('agent-a', 'panel-1');
    acquireChatInterestLease('agent-a', 'panel-2');
    expect(chatInterestLeaseCount('agent-a')).toBe(2);

    // The agent stays leased until the LAST holder releases.
    releaseChatInterestLease('agent-a', 'panel-1');
    expect(hasChatInterestLease('agent-a')).toBe(true);
    expect(chatInterestLeaseCount('agent-a')).toBe(1);

    releaseChatInterestLease('agent-a', 'panel-2');
    expect(hasChatInterestLease('agent-a')).toBe(false);
  });

  it('keeps leases strictly per-agent', () => {
    acquireChatInterestLease('agent-a', 'panel-1');
    acquireChatInterestLease('agent-b', 'read-saga:1');

    releaseChatInterestLease('agent-a', 'panel-1');
    expect(hasChatInterestLease('agent-a')).toBe(false);
    expect(hasChatInterestLease('agent-b')).toBe(true);
  });

  it('clearAllChatInterestLeases drops every entry', () => {
    acquireChatInterestLease('agent-a', 'panel-1');
    acquireChatInterestLease('agent-a', 'panel-2');
    acquireChatInterestLease('agent-b', 'read-saga:1');

    clearAllChatInterestLeases();
    expect(hasChatInterestLease('agent-a')).toBe(false);
    expect(hasChatInterestLease('agent-b')).toBe(false);
    expect(chatInterestLeaseCount('agent-a')).toBe(0);
  });

  describe('onLastChatInterestLeaseReleased', () => {
    it('notifies exactly at the LAST-holder release, synchronously', () => {
      const listener = vi.fn();
      const unsubscribe = onLastChatInterestLeaseReleased(listener);
      try {
        acquireChatInterestLease('agent-a', 'panel-1');
        acquireChatInterestLease('agent-a', 'read-saga:1');

        releaseChatInterestLease('agent-a', 'panel-1');
        expect(listener).not.toHaveBeenCalled();

        releaseChatInterestLease('agent-a', 'read-saga:1');
        expect(listener).toHaveBeenCalledExactlyOnceWith('agent-a');
      } finally {
        unsubscribe();
      }
    });

    it('does not notify for an unheld release or after unsubscribe', () => {
      const listener = vi.fn();
      const unsubscribe = onLastChatInterestLeaseReleased(listener);

      // Releasing a never-held key must not fire (the holder set never
      // transitioned to empty — it never existed).
      releaseChatInterestLease('agent-a', 'panel-1');
      expect(listener).not.toHaveBeenCalled();

      unsubscribe();
      acquireChatInterestLease('agent-a', 'panel-1');
      releaseChatInterestLease('agent-a', 'panel-1');
      expect(listener).not.toHaveBeenCalled();
    });

    it('clearAllChatInterestLeases does not notify (dispose/reset semantics)', () => {
      const listener = vi.fn();
      const unsubscribe = onLastChatInterestLeaseReleased(listener);
      try {
        acquireChatInterestLease('agent-a', 'panel-1');
        clearAllChatInterestLeases();
        expect(listener).not.toHaveBeenCalled();
      } finally {
        unsubscribe();
      }
    });
  });
});
