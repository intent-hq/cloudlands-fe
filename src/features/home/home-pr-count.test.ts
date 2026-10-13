/** @vitest-environment jsdom */
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { tick } from 'svelte';
import { appClient } from '$lib/client';
import { store } from '$store/renderer/store';
import {
  replaceWorkspaceList,
  setWorkspaceHasLoaded,
} from '$store/renderer/slices/workspace/workspace-slice';
import { closePanel } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { selectWorkspaceById } from '$store/renderer/slices/workspace/workspace-selectors';
import { PullRequestStatus, WorkspaceStatusEnum, type Workspace } from '$shared/types';
import { WorkspaceId } from '$shared/types/branded-ids';
import { m } from '$shared/paraglide/messages.js';
import { admitLegacyPrincipal } from '../../test/fixtures/principal-state';
import { resetHomeWorkspaceView } from './home-workspaces-slice';
import HomePage from './HomePage.svelte';

const pulls = Array.from({ length: 20 }, (_, index) => ({
  id: `pr-${index + 1}`,
  number: index + 1,
  url: `https://github.com/example/repo/pull/${index + 1}`,
  title: `PR ${index + 1}`,
  status: PullRequestStatus.Open,
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
}));
const workspace: Workspace = {
  id: WorkspaceId('home-pr-count'),
  title: 'Remote Agents',
  branch: 'main',
  status: WorkspaceStatusEnum.Active,
  changesets: [],
  timeline: [],
  conversationInfo: [],
  createdAt: '2026-10-01T00:00:00Z',
  updatedAt: '2026-10-01T00:00:00Z',
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
  vi.restoreAllMocks();
  store.dispose();
});

describe('Home workspace PR count', () => {
  it('keeps the full total through selection, reselection, and a capped list refresh', async () => {
    const capped = { ...workspace, pullRequests: pulls.slice(0, 5), pullRequestsTotal: 20 };
    const get = vi.spyOn(appClient.workspaces, 'get').mockResolvedValue({
      ...workspace,
      pullRequests: pulls,
    });
    store.dispatch(replaceWorkspaceList([capped]));
    render(HomePage);
    const row = () => screen.getByRole('option', { name: /Remote Agents/ });
    const extraCount = () => within(row()).getByText('+19');

    expect(extraCount()).toBeTruthy();
    expect(get).not.toHaveBeenCalled();
    await fireEvent.click(row());
    await waitFor(() =>
      expect(selectWorkspaceById.select(store.state, workspace.id)?.pullRequests).toHaveLength(20),
    );
    expect(extraCount()).toBeTruthy();
    expect(get).toHaveBeenCalledExactlyOnceWith(workspace.id);

    await fireEvent.click(screen.getByRole('button', { name: m.home_close_preview() }));
    expect(extraCount()).toBeTruthy();
    await fireEvent.click(row());
    expect(extraCount()).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);

    store.dispatch(replaceWorkspaceList([capped]));
    await tick();
    expect(extraCount()).toBeTruthy();
    expect(selectWorkspaceById.select(store.state, workspace.id)?.pullRequests).toHaveLength(5);

    await fireEvent.click(screen.getByRole('button', { name: m.home_close_preview() }));
    await fireEvent.click(row());
    expect(extraCount()).toBeTruthy();
    expect(get).toHaveBeenCalledTimes(1);
  });

  it.each([
    [undefined, undefined, null],
    [[], undefined, null],
    [[], 0, null],
    [pulls.slice(0, 1), 1, null],
    [pulls.slice(0, 1), undefined, null],
    [pulls.slice(0, 5), undefined, '+4'],
  ] as const)('handles pool %j and total %j', (pool, total, expected) => {
    store.dispatch(
      replaceWorkspaceList([
        { ...workspace, pullRequests: pool ? [...pool] : undefined, pullRequestsTotal: total },
      ]),
    );
    render(HomePage, { preview: true });
    const count = within(screen.getByRole('option', { name: /Remote Agents/ })).queryByText(
      /^\+\d+$/,
    );
    expect(count?.textContent ?? null).toBe(expected);
  });
});
