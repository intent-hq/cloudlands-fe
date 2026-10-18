import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PullRequestWorkspace } from '$lib/client/app-client';

const findByPullRequestMock = vi.hoisted(() => vi.fn());
vi.mock('$lib/client', () => ({
  appClient: { workspaces: { findByPullRequest: findByPullRequestMock } },
}));

const capabilities = vi.hoisted(() => ({ value: {} as Record<string, unknown> | null }));
vi.mock('$store/renderer/slices/principal/principal-selectors', () => ({
  selectPrincipalSnapshot: {
    select: () => (capabilities.value ? { capabilities: capabilities.value } : null),
  },
}));
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({ state: () => ({}), dispatch: vi.fn() });
});

import { loadLinkActionMenuLinkedWorkspaces } from './link-action-menu-linked-workspaces';
import {
  hideLinkActionMenu,
  linkActionMenuState,
  showLinkActionMenu,
} from './link-action-menu-state.svelte';

const PR_URL = 'https://github.com/acme/widgets/pull/7';
const ROWS: PullRequestWorkspace[] = [
  { id: 'ws-2', title: 'Newer', archived: false, linkedAt: '2026-10-18T05:00:00.000Z' },
  { id: 'ws-1', title: 'Older', archived: true, linkedAt: '2026-10-17T05:00:00.000Z' },
];

function openPrMenu(): number {
  return showLinkActionMenu({
    url: PR_URL,
    gitHubRef: { owner: 'acme', repo: 'widgets', number: 7, kind: 'pr' },
    x: 0,
    y: 0,
  });
}

describe('loadLinkActionMenuLinkedWorkspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capabilities.value = { prWorkspaceLookup: 1 };
  });
  afterEach(() => hideLinkActionMenu());

  it('asks the daemon for the clicked URL and fills the open menu', async () => {
    findByPullRequestMock.mockResolvedValueOnce(ROWS);
    const openingId = openPrMenu();

    await loadLinkActionMenuLinkedWorkspaces(openingId, PR_URL);

    expect(findByPullRequestMock).toHaveBeenCalledWith(PR_URL);
    expect(linkActionMenuState.linkedWorkspaces).toEqual(ROWS);
  });

  it.each([null, {}, { prWorkspaceLookup: 2 }])(
    'never calls a daemon without prWorkspaceLookup: 1 (%j)',
    async (bag) => {
      capabilities.value = bag;
      const openingId = openPrMenu();

      await loadLinkActionMenuLinkedWorkspaces(openingId, PR_URL);

      expect(findByPullRequestMock).not.toHaveBeenCalled();
      expect(linkActionMenuState.linkedWorkspaces).toEqual([]);
    },
  );

  it('drops a result that arrives after the menu closed or reopened', async () => {
    let resolve: (rows: PullRequestWorkspace[]) => void = () => {};
    findByPullRequestMock.mockReturnValueOnce(new Promise((r) => (resolve = r)));
    const staleOpening = openPrMenu();
    const pending = loadLinkActionMenuLinkedWorkspaces(staleOpening, PR_URL);

    hideLinkActionMenu();
    openPrMenu();
    resolve(ROWS);
    await pending;

    expect(linkActionMenuState.visible).toBe(true);
    expect(linkActionMenuState.linkedWorkspaces).toEqual([]);
  });

  it('leaves the menu unchanged when the lookup fails', async () => {
    findByPullRequestMock.mockRejectedValueOnce(new Error('daemon offline'));
    const openingId = openPrMenu();

    await expect(loadLinkActionMenuLinkedWorkspaces(openingId, PR_URL)).resolves.toBeUndefined();

    expect(linkActionMenuState.linkedWorkspaces).toEqual([]);
  });
});
