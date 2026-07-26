import { describe, expect, it } from 'vitest';
import { sortWorkingAgentsFirst } from './delegation-ordering';

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
