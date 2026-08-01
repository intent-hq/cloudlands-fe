import { describe, expect, it } from 'vitest';
import {
  groupDoneCount,
  isGroupDeliveryPending,
  sortWorkingAgentsFirst,
} from './delegation-ordering';

describe('sortWorkingAgentsFirst', () => {
  it('sorts still-working agents before finished ones', () => {
    const result = sortWorkingAgentsFirst(['a', 'b', 'c', 'd'], new Set(['a', 'c']));
    expect(result).toEqual(['b', 'd', 'a', 'c']);
  });

  it('preserves relative order within each bucket (stable)', () => {
    const result = sortWorkingAgentsFirst(
      ['w1', 'f1', 'w2', 'f2', 'w3'],
      new Set(['f1', 'f2']),
    );
    expect(result).toEqual(['w1', 'w2', 'w3', 'f1', 'f2']);
  });

  it('returns the original order when no agents are finished', () => {
    const result = sortWorkingAgentsFirst(['a', 'b', 'c'], new Set());
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('returns the original order when all agents are finished', () => {
    const result = sortWorkingAgentsFirst(['a', 'b', 'c'], new Set(['a', 'b', 'c']));
    expect(result).toEqual(['a', 'b', 'c']);
  });

  it('handles empty input', () => {
    expect(sortWorkingAgentsFirst([], new Set(['a']))).toEqual([]);
  });

  it('ignores completed ids not present in the list', () => {
    const result = sortWorkingAgentsFirst(['a', 'b'], new Set(['z', 'b']));
    expect(result).toEqual(['a', 'b']);
  });
});

const makeGroup = (
  overrides: Partial<{
    expectedAgentIds: string[];
    completedAgentIds: string[];
    deletedAgentIds: string[];
    delivered: boolean;
  }> = {},
) => ({
  expectedAgentIds: [],
  completedAgentIds: [],
  deletedAgentIds: [],
  delivered: false,
  ...overrides,
});

describe('groupDoneCount', () => {
  it('counts completed and deleted agents together', () => {
    const group = makeGroup({
      expectedAgentIds: ['a', 'b', 'c'],
      completedAgentIds: ['a'],
      deletedAgentIds: ['b'],
    });
    expect(groupDoneCount(group)).toBe(2);
  });

  it('returns 0 for a group with no finished agents', () => {
    expect(groupDoneCount(makeGroup({ expectedAgentIds: ['a', 'b'] }))).toBe(0);
  });
});

describe('isGroupDeliveryPending', () => {
  it('is true when all expected agents finished but the wake is undelivered', () => {
    const group = makeGroup({
      expectedAgentIds: ['a', 'b'],
      completedAgentIds: ['a'],
      deletedAgentIds: ['b'],
      delivered: false,
    });
    expect(isGroupDeliveryPending(group)).toBe(true);
  });

  it('is false while agents are still working', () => {
    const group = makeGroup({
      expectedAgentIds: ['a', 'b'],
      completedAgentIds: ['a'],
      delivered: false,
    });
    expect(isGroupDeliveryPending(group)).toBe(false);
  });

  it('is false once the wake has been delivered', () => {
    const group = makeGroup({
      expectedAgentIds: ['a'],
      completedAgentIds: ['a'],
      delivered: true,
    });
    expect(isGroupDeliveryPending(group)).toBe(false);
  });

  it('is false for an empty group (no expected agents)', () => {
    expect(isGroupDeliveryPending(makeGroup())).toBe(false);
  });
});
