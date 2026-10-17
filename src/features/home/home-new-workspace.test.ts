/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { store } from '$store/renderer/store';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { closePanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { selectShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-selectors';
import { setWorkspaceInitializerLastSelectedRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import { selectWorkspaceInitializerLastSelectedRepo } from '$store/renderer/slices/workspace-initializer/workspace-initializer-selectors';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { resetHomeWorkspaceView, updateHomeWorkspaceView } from './home-workspaces-slice';
import HomePage from './HomePage.svelte';

// A "Pick a repo" workspace is cloned into its own folder: the daemon reports
// the clone as both repositoryPath and worktreePath.
const clone = '/workspaces/ideate-future/intent';
const clonedWorkspace: Workspace = {
  id: WorkspaceId('ideate-future'),
  title: 'Ideate',
  branch: 'ideate-future',
  status: WorkspaceStatusEnum.Active,
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  repositoryPath: clone,
  worktreePath: clone,
  repositoryOwner: 'intent-hq',
  repositoryName: 'intent',
};

beforeEach(() => {
  store.init();
  admitLegacyPrincipal();
  store.dispatch(closePanel());
  store.dispatch(resetHomeWorkspaceView());
  store.dispatch(setWorkspaceHasLoaded(true));
});

afterEach(() => {
  cleanup();
  store.dispose();
});

describe('Home New workspace', () => {
  it('opens New space without overwriting the last-used repository', async () => {
    const lastPick = {
      path: 'intent-hq/monorepo',
      type: 'github' as const,
      githubUrl: 'https://github.com/intent-hq/monorepo',
      isValidPath: true,
    };
    store.dispatch(setWorkspaceInitializerLastSelectedRepo(lastPick));
    store.dispatch(replaceWorkspaceList([clonedWorkspace]));
    store.dispatch(updateHomeWorkspaceView({ repoKey: 'intent-hq/intent' }));
    render(HomePage);

    await fireEvent.click(screen.getAllByRole('button', { name: m.home_new_workspace() })[0]);

    expect(selectShowCreateModal.select(store.state)).toBe(true);
    // New space resolves the sidebar repository itself; Home must not record
    // the clone folder as a "Copy local repo" choice for later restores.
    expect(selectWorkspaceInitializerLastSelectedRepo.select(store.state)).toEqual(lastPick);
  });
});
