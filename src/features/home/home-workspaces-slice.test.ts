import { describe, expect, it } from 'vitest';
import type { StoreState } from '$store/renderer/types';
import { recentRepositoryRemovalFailed } from '$store/renderer/slices/known-repos/known-repos-slice';
import {
  homeRepositoryHidden,
  homeWorkspacesReducer,
  resetHomeWorkspaceView,
  setHomePreviewAgent,
  updateHomeWorkspaceView,
  type HomeWorkspacesState,
} from './home-workspaces-slice';
import { selectHomePreviewAgentId } from './home-workspaces-selectors';

const reduce = (
  state: HomeWorkspacesState | undefined,
  action: Parameters<typeof homeWorkspacesReducer>[1],
) => homeWorkspacesReducer(state, action);

const initial = () => reduce(undefined, { type: '@@init' });

describe('home workspaces preview agent picks', () => {
  it('starts with no picked preview agents', () => {
    expect(initial().previewAgentIds).toEqual({});
  });

  it('records one pick per workspace and replaces a later pick', () => {
    let state = reduce(initial(), setHomePreviewAgent('ws-1', 'agent-a'));
    state = reduce(state, setHomePreviewAgent('ws-2', 'agent-x'));
    state = reduce(state, setHomePreviewAgent('ws-1', 'agent-b'));

    expect(state.previewAgentIds).toEqual({ 'ws-1': 'agent-b', 'ws-2': 'agent-x' });
  });

  it('keeps picks across ordinary view updates', () => {
    let state = reduce(initial(), setHomePreviewAgent('ws-1', 'agent-a'));
    state = reduce(state, updateHomeWorkspaceView({ selectedId: 'ws-2' }));

    expect(state.previewAgentIds).toEqual({ 'ws-1': 'agent-a' });
  });

  it('clears picks when the view resets', () => {
    let state = reduce(initial(), setHomePreviewAgent('ws-1', 'agent-a'));
    state = reduce(state, resetHomeWorkspaceView());

    expect(state.previewAgentIds).toEqual({});
  });

  it('selects the pick for a workspace, or null when none is recorded', () => {
    const homeWorkspaces = reduce(initial(), setHomePreviewAgent('ws-1', 'agent-a'));
    const state = { homeWorkspaces } as unknown as StoreState;

    expect(selectHomePreviewAgentId.select(state, 'ws-1')).toBe('agent-a');
    expect(selectHomePreviewAgentId.select(state, 'ws-2')).toBeNull();
  });
});

describe('home workspaces hidden repositories', () => {
  it('unhides a deleted folder when the daemon refuses the removal', () => {
    const hidden = reduce(initial(), homeRepositoryHidden('/repos/tools', 5));
    expect(hidden.hiddenRepos).toEqual({ '/repos/tools': 5 });
    const restored = reduce(hidden, recentRepositoryRemovalFailed('/repos/tools', '/repos/tools'));
    expect(restored.hiddenRepos).toEqual({});
  });

  it('keeps hidden repositories when a refused removal hid nothing', () => {
    const hidden = reduce(initial(), homeRepositoryHidden('/repos/tools', 5));
    expect(reduce(hidden, recentRepositoryRemovalFailed('/repos/tools'))).toBe(hidden);
  });
});
