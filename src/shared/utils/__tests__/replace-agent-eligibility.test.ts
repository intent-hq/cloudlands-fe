import { describe, expect, it } from 'vitest';

import { isReplaceAgentEligible, type ReplaceAgentSessionLike } from '../replace-agent-eligibility';

function eligibleSession(
  overrides: Partial<ReplaceAgentSessionLike> = {},
): ReplaceAgentSessionLike {
  return {
    harnessFeatures: { peerAgents: true },
    metadata: {},
    ...overrides,
  };
}

describe('isReplaceAgentEligible', () => {
  it('is eligible when all gates pass', () => {
    expect(isReplaceAgentEligible(eligibleSession())).toBe(true);
  });

  it('is ineligible without a session', () => {
    expect(isReplaceAgentEligible(undefined)).toBe(false);
    expect(isReplaceAgentEligible(null)).toBe(false);
  });

  describe('harness gate', () => {
    it('is ineligible when the harnessFeatures snapshot is absent', () => {
      expect(isReplaceAgentEligible(eligibleSession({ harnessFeatures: undefined }))).toBe(false);
      expect(isReplaceAgentEligible(eligibleSession({ harnessFeatures: null }))).toBe(false);
    });

    it('is ineligible when the snapshot lacks peerAgents', () => {
      expect(isReplaceAgentEligible(eligibleSession({ harnessFeatures: {} }))).toBe(false);
    });

    it('is ineligible when peerAgents is false', () => {
      expect(
        isReplaceAgentEligible(eligibleSession({ harnessFeatures: { peerAgents: false } })),
      ).toBe(false);
    });
  });

  describe('top-level gate', () => {
    it('is ineligible for delegated agents (metadata.createdByAgentId)', () => {
      expect(
        isReplaceAgentEligible(eligibleSession({ metadata: { createdByAgentId: 'agent-1' } })),
      ).toBe(false);
    });

    it('is ineligible for child agents (metadata.parentAgentId)', () => {
      expect(
        isReplaceAgentEligible(eligibleSession({ metadata: { parentAgentId: 'agent-1' } })),
      ).toBe(false);
    });

    it('is ineligible when the delegation markers live under agentMetadata', () => {
      expect(
        isReplaceAgentEligible(eligibleSession({ agentMetadata: { createdByAgentId: 'agent-1' } })),
      ).toBe(false);
      expect(
        isReplaceAgentEligible(eligibleSession({ agentMetadata: { parentAgentId: 'agent-1' } })),
      ).toBe(false);
    });
  });

  describe('non-background gate', () => {
    it('is ineligible when the session isBackground flag is true', () => {
      expect(isReplaceAgentEligible(eligibleSession({ isBackground: true }))).toBe(false);
    });

    it('is ineligible when metadata.isBackground is true', () => {
      expect(isReplaceAgentEligible(eligibleSession({ metadata: { isBackground: true } }))).toBe(
        false,
      );
    });

    it('is ineligible when agentMetadata.isBackground is true', () => {
      expect(
        isReplaceAgentEligible(eligibleSession({ agentMetadata: { isBackground: true } })),
      ).toBe(false);
    });

    it('stays eligible when isBackground is explicitly false', () => {
      expect(
        isReplaceAgentEligible(
          eligibleSession({
            isBackground: false,
            metadata: { isBackground: false },
            agentMetadata: { isBackground: false },
          }),
        ),
      ).toBe(true);
    });
  });

  describe('not-retired gate', () => {
    it('is ineligible once retiredAt is set', () => {
      expect(isReplaceAgentEligible(eligibleSession({ retiredAt: '2026-08-27T00:00:00Z' }))).toBe(
        false,
      );
    });
  });
});
