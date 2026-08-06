import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import LinkActionMenu from './LinkActionMenu.svelte';
import { showLinkActionMenu, hideLinkActionMenu, linkActionMenuState } from './link-action-menu-state.svelte';

const gotoMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

const reduxDispatchMock = vi.hoisted(() => vi.fn());
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: reduxDispatchMock,
  });
});

const openInBrowserPanelMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const openInExternalBrowserMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('./link-handler', () => ({
  openInBrowserPanel: openInBrowserPanelMock,
  openInExternalBrowser: openInExternalBrowserMock,
}));

const writeTextToClipboardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/utils/clipboard', () => ({ writeTextToClipboard: writeTextToClipboardMock }));

const TEST_WORKSPACE_ID = 'ws-1' as WorkspaceId;
const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';

function showIssueMenu(workspaceId?: WorkspaceId) {
  showLinkActionMenu({
    url: ISSUE_URL,
    gitHubRef: { owner: 'acme', repo: 'widgets', number: 42, kind: 'issue' },
    x: 50,
    y: 60,
    workspaceId,
  });
}

describe('LinkActionMenu', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    hideLinkActionMenu();
    cleanup();
    document.body.innerHTML = '';
  });

  it('renders all four actions when a workspaceId is present', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(screen.getAllByRole('menuitem')).toHaveLength(4);
  });

  it('hides the in-app action without a workspaceId', async () => {
    render(LinkActionMenu);
    showIssueMenu(undefined);

    await waitFor(() => {
      expect(screen.getByRole('menu')).toBeTruthy();
    });
    expect(screen.getAllByRole('menuitem')).toHaveLength(3);
  });

  it('start new workspace dispatches the prefill action and navigates home', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.click(screen.getAllByRole('menuitem')[0]);

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      setWorkspaceInitializerPendingGitHubPrefill({
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        kind: 'issue',
        url: ISSUE_URL,
      }),
    );
    expect(gotoMock).toHaveBeenCalledWith('/');
    expect(linkActionMenuState.visible).toBe(false);
  });

  it('open in browser routes to the external browser', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.click(screen.getAllByRole('menuitem')[1]);

    expect(openInExternalBrowserMock).toHaveBeenCalledWith(ISSUE_URL);
    expect(linkActionMenuState.visible).toBe(false);
  });

  it('open in app routes to the embedded browser panel', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.click(screen.getAllByRole('menuitem')[2]);

    expect(openInBrowserPanelMock).toHaveBeenCalledWith(ISSUE_URL, TEST_WORKSPACE_ID);
    expect(linkActionMenuState.visible).toBe(false);
  });

  it('copy link writes the URL to the clipboard', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.click(screen.getAllByRole('menuitem')[3]);

    expect(writeTextToClipboardMock).toHaveBeenCalledWith(ISSUE_URL);
    expect(linkActionMenuState.visible).toBe(false);
  });

  it('Escape dismisses the menu via the escape-layer stack', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.keyDown(window, { key: 'Escape' });

    await waitFor(() => expect(linkActionMenuState.visible).toBe(false));
  });

  it('clicking outside the menu dismisses it', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.mouseDown(document.body);

    await waitFor(() => expect(linkActionMenuState.visible).toBe(false));
  });

  it('shows a PR label when the ref kind is pr', async () => {
    render(LinkActionMenu);
    showLinkActionMenu({
      url: 'https://github.com/acme/widgets/pull/7',
      gitHubRef: { owner: 'acme', repo: 'widgets', number: 7, kind: 'pr' },
      x: 10,
      y: 10,
      workspaceId: TEST_WORKSPACE_ID,
    });
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    expect(screen.getAllByRole('menuitem')[0].textContent).toContain('PR #7');
  });
});
