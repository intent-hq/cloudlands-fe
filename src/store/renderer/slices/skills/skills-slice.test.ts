import { describe, it, expect } from 'vitest';
import {
  skillsReducer,
  initialState,
  loadSkillsFailed,
  loadSkillsRequested,
  setSkills,
} from './skills-slice';
import { workspaceUnmounted } from '../workspace-lifecycle/workspace-lifecycle-slice';

describe('skillsReducer', () => {
  it('makes loading and failure observable while preserving the last known roster', () => {
    const skills = [{ name: 'skill-1', description: 'desc' } as any];
    let state = skillsReducer(initialState, setSkills('ws-1', skills));

    state = skillsReducer(state, loadSkillsRequested('ws-1'));
    expect(state.byWorkspaceId['ws-1']).toEqual({ skills, loading: true, error: null });

    state = skillsReducer(state, loadSkillsFailed('ws-1', 'refresh failed'));
    expect(state.byWorkspaceId['ws-1']).toEqual({
      skills,
      loading: false,
      error: 'refresh failed',
    });

    state = skillsReducer(state, loadSkillsRequested('ws-1'));
    state = skillsReducer(state, setSkills('ws-1', []));
    expect(state.byWorkspaceId['ws-1']).toEqual({ skills: [], loading: false, error: null });
  });

  it('workspaceUnmounted clears workspace state', () => {
    let state = skillsReducer(
      initialState,
      setSkills('ws-1', [{ name: 'skill-1', description: 'desc' } as any]),
    );
    state = skillsReducer(
      state,
      setSkills('ws-2', [{ name: 'skill-2', description: 'desc' } as any]),
    );

    const nextState = skillsReducer(state, workspaceUnmounted('ws-1'));

    expect(nextState.byWorkspaceId['ws-1']).toBeUndefined();
    expect(nextState.byWorkspaceId['ws-2']).toBeDefined();
  });
});
