import {
  describe,
  expect,
  it,
} from 'vitest';
import {
  isPRMergeable,
  getPRTooltipContent,
} from '../pr-status';

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

describe('getPRTooltipContent', () => {
  it('returns empty string when no PR', () => {
    expect(getPRTooltipContent(null)).toBe('');
    expect(getPRTooltipContent(undefined)).toBe('');
  });

  it('returns empty string for non-open PR', () => {
    expect(getPRTooltipContent({ status: 'Closed' })).toBe('');
    expect(getPRTooltipContent({ status: 'Merged' })).toBe('');
  });

  it('includes merge conflicts message', () => {
    const result = getPRTooltipContent({ status: 'Open', mergeConflicts: true });
    expect(result).toContain('Merge conflicts');
  });

  it('includes merge conflicts for dirty state', () => {
    const result = getPRTooltipContent({ status: 'Open', mergeableState: 'dirty' });
    expect(result).toContain('Merge conflicts');
  });

  it('includes branch behind base message', () => {
    const result = getPRTooltipContent({ status: 'Open', mergeableState: 'behind' });
    expect(result).toContain('Branch is behind base');
  });

  it('includes checks failing for unstable state', () => {
    const result = getPRTooltipContent({ status: 'Open', mergeableState: 'unstable' });
    expect(result).toContain('Some checks are failing');
  });

  it('includes mergeability unknown for unknown state', () => {
    const result = getPRTooltipContent({ status: 'Open', mergeableState: 'unknown' });
    expect(result).toContain('Mergeability unknown');
  });

  it('includes CI failing with running count', () => {
    const result = getPRTooltipContent({
      status: 'Open',
      ciStatus: { total: 10, passed: 5, failed: 3, pending: 2 },
    });
    expect(result).toContain('3/10 checks failing');
    expect(result).toContain('2 running');
  });

  it('includes CI all passing', () => {
    const result = getPRTooltipContent({
      status: 'Open',
      ciStatus: { total: 5, passed: 5, failed: 0, pending: 0 },
    });
    expect(result).toContain('5/5 checks passing');
  });

  it('includes CI pending only', () => {
    const result = getPRTooltipContent({
      status: 'Open',
      ciStatus: { total: 5, passed: 0, failed: 0, pending: 3 },
    });
    expect(result).toContain('3/5 checks running');
  });

  it('includes changes requested', () => {
    const result = getPRTooltipContent({ status: 'Open', reviewDecision: 'CHANGES_REQUESTED' });
    expect(result).toContain('Changes requested');
  });

  it('includes awaiting review for REVIEW_REQUIRED', () => {
    const result = getPRTooltipContent({ status: 'Open', reviewDecision: 'REVIEW_REQUIRED' });
    expect(result).toContain('Awaiting review');
  });

  it('includes awaiting review for blocked state without reviewDecision', () => {
    const result = getPRTooltipContent({ status: 'Open', mergeableState: 'blocked' });
    expect(result).toContain('Awaiting review');
  });

  it('includes review comments (singular)', () => {
    const result = getPRTooltipContent({ status: 'Open', reviewComments: 1 });
    expect(result).toContain('1 review comment');
    expect(result).not.toContain('comments');
  });

  it('includes review comments (plural)', () => {
    const result = getPRTooltipContent({ status: 'Open', reviewComments: 3 });
    expect(result).toContain('3 review comments');
  });

  it('includes approved by names', () => {
    const result = getPRTooltipContent({
      status: 'Open',
      reviewDecision: 'APPROVED',
      approvedBy: ['alice', 'bob'],
    });
    expect(result).toContain('Approved by alice, bob');
  });

  it('combines multiple issues and positives', () => {
    const result = getPRTooltipContent({
      status: 'Open',
      mergeConflicts: true,
      ciStatus: { total: 5, passed: 5, failed: 0, pending: 0 },
      reviewDecision: 'APPROVED',
      approvedBy: ['alice'],
    });
    expect(result).toContain('Merge conflicts');
    expect(result).toContain('checks passing');
    expect(result).toContain('Approved by alice');
  });

  it('returns empty string when no issues or positives', () => {
    expect(getPRTooltipContent({ status: 'Open' })).toBe('');
  });
});

