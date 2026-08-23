import { beforeEach, describe, expect, it } from 'vitest';
import {
  acquireChatInterestLease,
  chatInterestLeaseCount,
  clearAllChatInterestLeases,
  hasChatInterestLease,
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
});
