import { describe, expect, it } from 'vitest';
import { isPRMergeable } from '../pr-status';

describe('isPRMergeable', () => {
  it('returns true when no PR', () => {
    expect(isPRMergeable(null)).toBe(true);
    expect(isPRMergeable(undefined)).toBe(true);
  });

  it('returns true for non-open PR', () => {
    expect(isPRMergeable({ status: 'Closed' })).toBe(true);
    expect(isPRMergeable({ status: 'Merged' })).toBe(true);
    expect(isPRMergeable({ status: 'Draft' })).toBe(true);
  });

  it('returns false when mergeable is false', () => {
    expect(isPRMergeable({ status: 'Open', mergeable: false })).toBe(false);
  });

  it('returns false when mergeConflicts is true', () => {
    expect(isPRMergeable({ status: 'Open', mergeConflicts: true })).toBe(false);
  });

  it('returns false when mergeableState is blocked', () => {
    expect(isPRMergeable({ status: 'Open', mergeableState: 'blocked' })).toBe(false);
  });

  it('returns false when mergeableState is behind', () => {
    expect(isPRMergeable({ status: 'Open', mergeableState: 'behind' })).toBe(false);
  });

  it('returns false when mergeableState is dirty', () => {
    expect(isPRMergeable({ status: 'Open', mergeableState: 'dirty' })).toBe(false);
  });

  it('returns false when mergeableState is unstable', () => {
    expect(isPRMergeable({ status: 'Open', mergeableState: 'unstable' })).toBe(false);
  });

  it('returns false when mergeableState is unknown', () => {
    expect(isPRMergeable({ status: 'Open', mergeableState: 'unknown' })).toBe(false);
  });

  it('returns false when ciStatus.failed > 0', () => {
    expect(isPRMergeable({ status: 'Open', ciStatus: { failed: 1, pending: 0 } })).toBe(false);
  });

  it('returns false when ciStatus.pending > 0', () => {
    expect(isPRMergeable({ status: 'Open', ciStatus: { failed: 0, pending: 1 } })).toBe(false);
  });

  it('returns false when reviewDecision is CHANGES_REQUESTED', () => {
    expect(isPRMergeable({ status: 'Open', reviewDecision: 'CHANGES_REQUESTED' })).toBe(false);
  });

  it('returns false when reviewDecision is REVIEW_REQUIRED', () => {
    expect(isPRMergeable({ status: 'Open', reviewDecision: 'REVIEW_REQUIRED' })).toBe(false);
  });

  it('returns false when PR has no enrichment data (unknown state)', () => {
    expect(isPRMergeable({ status: 'Open' })).toBe(false);
  });

  it('returns true when all checks pass', () => {
    expect(
      isPRMergeable({
        status: 'Open',
        mergeable: true,
        mergeConflicts: false,
        mergeableState: 'clean',
        ciStatus: { failed: 0, pending: 0 },
        reviewDecision: 'APPROVED',
      }),
    ).toBe(true);
  });
});
