import { describe, expect, it, vi } from 'vitest';

const { baselineRows } = vi.hoisted(() => ({
  baselineRows: [
    {
      row: 'WORKSPACE-36',
      states: [
        'mounted',
        'runtime-success',
        'edges',
        'cleanup',
        'runtime-error',
        'keyboard',
        'next',
        'previous',
        'nested',
      ],
      tests: ['navigation.test.ts'],
    },
  ],
}));

vi.mock('../test/current-main-baseline.matrix', () => ({ baselineRows }));

import { createEvidenceRows, createSemanticEvidence } from '../test/current-main-baseline.evidence';

const passingAssertions = new Map([
  [
    'navigation.test.ts',
    [
      'navigation > uses the edge panel when the layout has no valid focus',
      'navigation > skips empty workspaces and wraps in display order',
      'navigation > cycles through tabs backward',
      'navigation > returns the next local panel and hands off at the layout boundary',
      'navigation > expands horizontal ancestors in a nested layout',
    ],
  ],
]);

describe('manual evidence after removing appearance baselines', () => {
  it('records surviving behavior without claiming deleted layout coverage', () => {
    const semantic = createSemanticEvidence(passingAssertions);
    const [row] = createEvidenceRows(semantic);
    expect(row.verdict).toBe('UNVERIFIED');
    expect(row.stateEvidence.mounted).toEqual([]);
    expect(row.stateEvidence.cleanup).toEqual([]);
    expect(row.stateEvidence['runtime-success']).toEqual(['semantic:WORKSPACE-36']);
    expect(row.stateEvidence.edges).toEqual(['semantic:WORKSPACE-36']);
  });

  it('still refuses to claim behavior without a passing assertion', () => {
    expect(() => createSemanticEvidence(new Map())).toThrow();
  });

  it('rejects an uncovered behavioral state even when other states have evidence', () => {
    baselineRows[0].states.push('focus-restore');
    try {
      expect(() => createSemanticEvidence(passingAssertions)).toThrow(
        'WORKSPACE-36 semantic selectors do not exactly cover',
      );
    } finally {
      baselineRows[0].states.pop();
    }
  });

  it('rejects a behavioral row with no selectors', () => {
    baselineRows.push({
      row: 'UNCOVERED-BEHAVIOR',
      states: ['keyboard'],
      tests: ['navigation.test.ts'],
    });
    try {
      expect(() => createSemanticEvidence(passingAssertions)).toThrow(
        'UNCOVERED-BEHAVIOR semantic selectors do not exactly cover',
      );
    } finally {
      baselineRows.pop();
    }
  });
});
