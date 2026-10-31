import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render } from '@testing-library/svelte';
import {
  PullRequestStatus,
  WorkspaceStatus,
  type PullRequestInfo,
  type Workspace,
} from '$shared/types';
import { store } from '$store/renderer/store';
import HomeWorkspaceList from './HomeWorkspaceList.svelte';
import { createTestWorkspaceId } from '../../test/factories/workspace.factory';

beforeEach(() => store.init());
afterEach(() => cleanup());

function pull(number: number): PullRequestInfo {
  return {
    id: String(number),
    number,
    url: `https://github.com/intent-hq/cloudlands-fe/pull/${number}`,
    title: `PR ${number}`,
    status: PullRequestStatus.Open,
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
  };
}

function workspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: createTestWorkspaceId(),
    title: 'Row',
    branch: 'feat/row',
    status: WorkspaceStatus.Active,
    changesets: [],
    timeline: [],
    conversationInfo: [],
    createdAt: '2026-10-13T00:00:00Z',
    updatedAt: '2026-10-13T00:00:00Z',
    pullRequests: [pull(1), pull(2), pull(3)],
    ...overrides,
  };
}

function renderRow(item: Workspace) {
  return render(HomeWorkspaceList, {
    workspaces: [item],
    groups: [{ id: 'all', label: 'All', items: [item], expanded: true }],
    aside: [],
    asideExpanded: false,
    pinnedIds: [],
    selectedId: null,
    showRepository: false,
    showRepositoryOwner: false,
    menu: () => [],
    onopen: () => {},
    onmenu: () => {},
    onselect: () => {},
    ongroupexpanded: () => {},
    onasideexpanded: () => {},
    ontoggleaside: () => {},
  });
}

describe('Home workspace list PR count', () => {
  it('shows the extra-PR count for a git workspace', () => {
    const view = renderRow(workspace());
    expect(view.getByText('+2')).toBeTruthy();
  });

  it('hides the extra-PR count for a plain-folder workspace', () => {
    const view = renderRow(workspace({ plainFolder: true, branch: '' }));
    expect(view.queryByText('+2')).toBeNull();
    expect(view.getByText('Plain folder')).toBeTruthy();
  });
});
