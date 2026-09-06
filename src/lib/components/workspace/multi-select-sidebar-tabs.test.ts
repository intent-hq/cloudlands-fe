import { describe, expect, it } from 'vitest';
import {
  LAUNCHER_GRID_POSITIONS,
  normalizeSelectedTabs,
  TAB_DEFINITIONS,
} from './multi-select-sidebar-tabs';

describe('multi-select sidebar tabs', () => {
  it('keeps the canonical tab order and launcher grid', () => {
    expect(TAB_DEFINITIONS.map(({ id }) => id)).toEqual([
      'map',
      'overview',
      'agents',
      'context',
      'changes',
      'files',
      'browser',
      'shell',
    ]);
    expect(LAUNCHER_GRID_POSITIONS).toEqual({
      agents: { column: 0, row: 0 },
      context: { column: 1, row: 0 },
      changes: { column: 0, row: 1 },
      files: { column: 1, row: 1 },
      map: { column: 0, row: 2 },
    });
  });

  it('keeps only the first valid selection and defaults to overview', () => {
    expect([...normalizeSelectedTabs(['unknown', 'changes', 'files'])]).toEqual(['changes']);
    expect([...normalizeSelectedTabs(['browser', 'shell'])]).toEqual(['browser']);
    expect([...normalizeSelectedTabs(['unknown'])]).toEqual(['overview']);
  });
});
