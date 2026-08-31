import { describe, expect, it } from 'vitest';
import type { StoreState } from '../../types';
import { selectSkills, selectSkillsError, selectSkillsLoading } from './skills-selectors';

describe('skills selectors', () => {
  it('selects loading and failure state for only the requested workspace', () => {
    const state = {
      skills: {
        byWorkspaceId: {
          loading: { skills: [], loading: true, error: null },
          failed: { skills: [], loading: false, error: 'skill load failed' },
        },
      },
    } as unknown as StoreState;

    expect(selectSkillsLoading.select(state, 'loading')).toBe(true);
    expect(selectSkillsError.select(state, 'loading')).toBeNull();
    expect(selectSkillsLoading.select(state, 'failed')).toBe(false);
    expect(selectSkillsError.select(state, 'failed')).toBe('skill load failed');
  });

  it('keeps an actual empty roster distinct from loading or failure', () => {
    const state = { skills: { byWorkspaceId: {} } } as unknown as StoreState;

    expect(selectSkills.select(state, 'empty')).toEqual([]);
    expect(selectSkillsLoading.select(state, 'empty')).toBe(false);
    expect(selectSkillsError.select(state, 'empty')).toBeNull();
  });
});
