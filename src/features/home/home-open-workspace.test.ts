/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { store } from '$store/renderer/store';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { closePanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { resetHomeWorkspaceView } from './home-workspaces-slice';

const mocks = vi.hoisted(() => ({ show: vi.fn(async () => true) }));
vi.mock('$lib/utils/show-workspace', () => ({ openAndShowWorkspace: mocks.show }));

import HomePage from './HomePage.svelte';

const closedWorkspace: Workspace = {
  id: WorkspaceId('closed-ws'),
  title: 'Closed space',
  branch: 'closed-ws',
  status: WorkspaceStatusEnum.Active,
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
  repositoryPath: '/repos/intent',
  repositoryOwner: 'intent-hq',
  repositoryName: 'intent',
};

beforeEach(() => {
  mocks.show.mockClear();
  store.init();
  admitLegacyPrincipal();
  store.dispatch(closePanel());
  store.dispatch(resetHomeWorkspaceView());
  store.dispatch(setWorkspaceHasLoaded(true));
  store.dispatch(replaceWorkspaceList([closedWorkspace]));
});

afterEach(() => {
  cleanup();
  store.dispose();
});

describe('Home opening a workspace', () => {
  it('shows the workspace and opens its tab through the shared helper', async () => {
    const { container } = render(HomePage);

    expect(screen.getByRole('option', { name: /Closed space/ })).toBeTruthy();
    const row = container.querySelector<HTMLElement>('[data-home-workspace="closed-ws"]')!;
    await fireEvent.click(row, { metaKey: true, ctrlKey: true, button: 0 });

    expect(mocks.show).toHaveBeenCalledExactlyOnceWith('closed-ws');
  });
});
