import { describe, expect, it, vi } from 'vitest';

vi.mock('../test/current-main-baseline.matrix', () => ({
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

import { createEvidenceRows, createSemanticEvidence } from '../test/current-main-baseline.evidence';

describe('manual evidence after removing appearance baselines', () => {
  it('records surviving behavior without claiming deleted layout coverage', () => {
    const semantic = createSemanticEvidence(
      new Map([
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
      ]),
    );
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
});
