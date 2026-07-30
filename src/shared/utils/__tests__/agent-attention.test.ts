import { describe, expect, it } from 'vitest';
import { getAgentAttentionRequest } from '../agent-attention';

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
});
