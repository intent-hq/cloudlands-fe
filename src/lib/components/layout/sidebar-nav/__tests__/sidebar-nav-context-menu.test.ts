import { describe, it, expect, beforeEach } from 'vitest';
import {
  sidebarNavReducer,
  initialState,
  setChiefActiveAgentId,
  hydrateSidebarNav,
} from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import type { SidebarNavState } from '$store/renderer/slices/sidebar-nav/sidebar-nav-types';

describe('Chief active thread persistence', () => {
  let state: SidebarNavState;

  beforeEach(() => {
    state = { ...initialState };
  });

  describe('Chief active thread persistence state', () => {
    it('stores the active Chief agent id', () => {
      state = sidebarNavReducer(state, setChiefActiveAgentId('agent-chief-current'));

      expect(state.chiefActiveAgentId).toBe('agent-chief-current');
    });

    it('hydrates the active Chief agent id', () => {
      state = sidebarNavReducer(
        state,
        hydrateSidebarNav({ chiefActiveAgentId: 'agent-chief-saved' }),
      );

      expect(state.chiefActiveAgentId).toBe('agent-chief-saved');
    });
  });
});
