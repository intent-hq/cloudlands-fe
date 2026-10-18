import { describe, expect, it } from 'vitest';
import { getAgentAttentionRequest, getAgentStopReasonTimestamp } from '../agent-attention';

describe('getAgentAttentionRequest', () => {
  it('derives a discussion request from top-level session fields', () => {
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: 'discussion',
        attentionRequestReason: 'Need input on the API shape',
        attentionRequestTimestamp: '2026-07-30T10:00:00Z',
      }),
    ).toEqual({
      kind: 'discussion',
      reason: 'Need input on the API shape',
      timestamp: '2026-07-30T10:00:00Z',
    });
  });

  it('derives a blocker request from top-level session fields', () => {
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'CI credentials expired',
        attentionRequestTimestamp: '2026-07-30T11:00:00Z',
      }),
    ).toEqual({
      kind: 'blocker',
      reason: 'CI credentials expired',
      timestamp: '2026-07-30T11:00:00Z',
    });
  });

  it('falls back to AgentLite metadata fields', () => {
    expect(
      getAgentAttentionRequest({
        metadata: {
          attentionRequestKind: 'discussion',
          attentionRequestReason: 'From metadata',
          attentionRequestTimestamp: '2026-07-30T12:00:00Z',
        },
      }),
    ).toEqual({
      kind: 'discussion',
      reason: 'From metadata',
      timestamp: '2026-07-30T12:00:00Z',
    });
  });

  // PROTOCOL §5.5 truncation flags: an agent.list row marks a reason the
  // list cap shortened; the derivation surfaces it only for that copy.
  it('marks a metadata reason the list cap shortened', () => {
    expect(
      getAgentAttentionRequest({
        metadata: {
          attentionRequestKind: 'blocker',
          attentionRequestReason: 'Provider stal',
          attentionRequestReasonTruncated: true,
          attentionRequestTimestamp: '2026-10-18T00:00:00Z',
        },
      }),
    ).toStrictEqual({
      kind: 'blocker',
      reason: 'Provider stal',
      timestamp: '2026-10-18T00:00:00Z',
      reasonTruncated: true,
    });
  });

  it('does not mark an unflagged metadata reason or a full top-level reason', () => {
    expect(
      getAgentAttentionRequest({
        metadata: { attentionRequestKind: 'blocker', attentionRequestReason: 'Complete' },
      }),
    ).not.toHaveProperty('reasonTruncated');
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'Full reason from the live event',
        metadata: {
          attentionRequestKind: 'blocker',
          attentionRequestReason: 'Full rea',
          attentionRequestReasonTruncated: true,
        },
      }),
    ).toStrictEqual({
      kind: 'blocker',
      reason: 'Full reason from the live event',
      timestamp: undefined,
    });
  });

  it('prefers top-level fields over metadata', () => {
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: 'blocker',
        attentionRequestReason: 'top-level',
        metadata: {
          attentionRequestKind: 'discussion',
          attentionRequestReason: 'metadata',
        },
      }),
    ).toEqual({ kind: 'blocker', reason: 'top-level', timestamp: undefined });
  });

  it('returns null when no request is pending (retired / cleared fields)', () => {
    expect(getAgentAttentionRequest({})).toBeNull();
    expect(getAgentAttentionRequest({ metadata: {} })).toBeNull();
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: undefined,
        attentionRequestReason: undefined,
        attentionRequestTimestamp: undefined,
      }),
    ).toBeNull();
  });

  it('returns null for null/undefined sessions', () => {
    expect(getAgentAttentionRequest(null)).toBeNull();
    expect(getAgentAttentionRequest(undefined)).toBeNull();
  });

  it('treats unknown kinds as no pending request', () => {
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: 'escalation',
        attentionRequestReason: 'unknown kind',
      }),
    ).toBeNull();
  });

  it('omits empty reason/timestamp strings', () => {
    expect(
      getAgentAttentionRequest({
        attentionRequestKind: 'discussion',
        attentionRequestReason: '',
        attentionRequestTimestamp: '',
      }),
    ).toEqual({ kind: 'discussion', reason: undefined, timestamp: undefined });
  });

  describe('attention trumps a live turn (no live-turn gate)', () => {
    const pending = {
      attentionRequestKind: 'blocker',
      attentionRequestReason: 'CI credentials expired',
    } as const;
    const expected = { kind: 'blocker', reason: 'CI credentials expired', timestamp: undefined };

    it.each([
      ['turnInFlight', { turnInFlight: true }],
      ['liveTurnOpen', { liveTurnOpen: true }],
      ['isStreaming', { isStreaming: true }],
      ['isProcessing', { isProcessing: true }],
      ['isResponding', { isResponding: true }],
      ['isWaitingOnTool', { isWaitingOnTool: true }],
      ['running lastToolUse', { lastToolUse: { status: 'running' } }],
    ])('returns the pending request while the turn is live (%s)', (_label, activity) => {
      expect(getAgentAttentionRequest({ ...pending, status: 'active', ...activity })).toEqual(
        expected,
      );
    });

    it('returns the request once the turn ends (flags cleared)', () => {
      expect(getAgentAttentionRequest({ ...pending, status: 'idle', isResponding: false })).toEqual(
        expected,
      );
    });

    it('returns the request on a bare active status without turn evidence', () => {
      expect(getAgentAttentionRequest({ ...pending, status: 'active' })).toEqual(expected);
    });

    it('returns the request on a terminal status with stale activity flags', () => {
      expect(getAgentAttentionRequest({ ...pending, status: 'error', isResponding: true })).toEqual(
        expected,
      );
    });
  });
});

describe('getAgentStopReasonTimestamp', () => {
  it('reads the top-level session field', () => {
    expect(getAgentStopReasonTimestamp({ stopReasonTimestamp: '2026-07-30T10:00:00Z' })).toBe(
      '2026-07-30T10:00:00Z',
    );
  });

  it('defensively falls back to a metadata-nested field (not part of the documented wire contract)', () => {
    expect(
      getAgentStopReasonTimestamp({
        metadata: { stopReasonTimestamp: '2026-07-30T11:00:00Z' },
      }),
    ).toBe('2026-07-30T11:00:00Z');
  });

  it('prefers top-level over metadata', () => {
    expect(
      getAgentStopReasonTimestamp({
        stopReasonTimestamp: '2026-07-30T10:00:00Z',
        metadata: { stopReasonTimestamp: '2026-07-30T11:00:00Z' },
      }),
    ).toBe('2026-07-30T10:00:00Z');
  });

  it('returns null when unknown, empty, or non-string', () => {
    expect(getAgentStopReasonTimestamp({})).toBeNull();
    expect(getAgentStopReasonTimestamp({ stopReasonTimestamp: '' })).toBeNull();
    expect(getAgentStopReasonTimestamp({ stopReasonTimestamp: 123 })).toBeNull();
    expect(getAgentStopReasonTimestamp(null)).toBeNull();
    expect(getAgentStopReasonTimestamp(undefined)).toBeNull();
  });
});
