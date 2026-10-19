import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup, within } from '@testing-library/svelte';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import LinkActionMenu from './LinkActionMenu.svelte';
import { m } from '$shared/paraglide/messages.js';
import type { PullRequestWorkspace } from '$lib/client/app-client';
import {
  showLinkActionMenu,
  hideLinkActionMenu,
  linkActionMenuState,
  setLinkActionMenuLinkedWorkspaces,
} from './link-action-menu-state.svelte';

const reduxDispatchMock = vi.hoisted(() => vi.fn());
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');
  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: reduxDispatchMock,
  });
});

const openInBrowserPanelMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const openInExternalBrowserMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const openLinkedWorkspaceMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
vi.mock('./link-handler', () => ({
  openInBrowserPanel: openInBrowserPanelMock,
  openInExternalBrowser: openInExternalBrowserMock,
  openLinkedWorkspace: openLinkedWorkspaceMock,
}));

const writeTextToClipboardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/utils/clipboard', () => ({ writeTextToClipboard: writeTextToClipboardMock }));

const TEST_WORKSPACE_ID = 'ws-1' as WorkspaceId;
const ISSUE_URL = 'https://github.com/acme/widgets/issues/42';

const PR_URL = 'https://github.com/acme/widgets/pull/7';
const linked = (id: string, title: string, archived = false): PullRequestWorkspace => ({
  id: id as WorkspaceId,
  title,
  archived,
  linkedAt: '2026-10-18T05:00:00.000Z',
});

/** Open the menu on a PR link, then deliver a lookup result the way the loader does. */
async function showPrMenu(workspaces: PullRequestWorkspace[], workspaceId = TEST_WORKSPACE_ID) {
  const openingId = showLinkActionMenu({
    url: PR_URL,
    gitHubRef: { owner: 'acme', repo: 'widgets', number: 7, kind: 'pr' },
    x: 10,
    y: 10,
    workspaceId,
  });
  await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
  setLinkActionMenuLinkedWorkspaces(openingId, workspaces);
}

const ORIGINAL = /open in original workspace/i;

/** Open the "Open in Original Workspace" submenu by keyboard and return its entries in order. */
async function openOriginalSubmenu(): Promise<HTMLElement[]> {
  const trigger = await screen.findByRole('menuitem', { name: ORIGINAL });
  expect(trigger.getAttribute('aria-haspopup')).toBe('menu');
  trigger.focus();
  await fireEvent.keyDown(trigger, { key: 'ArrowRight' });
  const submenu = await waitFor(() => {
    const menus = screen.getAllByRole('menu');
    expect(menus).toHaveLength(2);
    return menus[1];
  });
  return within(submenu).getAllByRole('menuitem');
}

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

  it('start new workspace dispatches the prefill action and opens the create modal', async () => {
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
    expect(reduxDispatchMock).toHaveBeenCalledWith(setShowCreateModal(true));
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

  it('Escape dismisses the menu', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.keyDown(screen.getByRole('menu'), { key: 'Escape' });

    await waitFor(() => expect(linkActionMenuState.visible).toBe(false));
  });

  it('clicking outside the menu dismisses it', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.pointerDown(document.body, { pointerType: 'mouse' });
    await fireEvent.click(document.body);

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

  describe('Open in Original Workspace', () => {
    it('one linked workspace: a plain item that opens it and closes the menu', async () => {
      render(LinkActionMenu);
      await showPrMenu([linked('ws-origin', 'Origin')]);

      const item = await screen.findByRole('menuitem', { name: ORIGINAL });
      expect(item.getAttribute('aria-haspopup')).toBeNull();
      await fireEvent.click(item);

      expect(openLinkedWorkspaceMock).toHaveBeenCalledWith('ws-origin');
      expect(linkActionMenuState.visible).toBe(false);
    });

    it('shows only the label on the single item, without name or Archived tag', async () => {
      render(LinkActionMenu);
      await showPrMenu([linked('ws-origin', 'Origin project')]);
      const archivedTag = m.navigation_linkActionMenu_archivedWorkspace_label();
      const item = await screen.findByRole('menuitem', { name: ORIGINAL });
      expect(item.textContent).not.toContain('Origin project');

      hideLinkActionMenu();
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      await showPrMenu([linked('ws-origin', 'Origin project', true)]);
      const archived = await screen.findByRole('menuitem', { name: ORIGINAL });
      expect(archived).not.toBe(item);
      expect(archived.textContent).not.toContain('Origin project');
      expect(archived.textContent).not.toContain(archivedTag);
      await fireEvent.click(archived);
      expect(openLinkedWorkspaceMock).toHaveBeenCalledWith('ws-origin');
    });

    it('a late lookup result never moves the existing items', async () => {
      render(LinkActionMenu);
      const openingId = showLinkActionMenu({
        url: PR_URL,
        gitHubRef: { owner: 'acme', repo: 'widgets', number: 7, kind: 'pr' },
        x: 10,
        y: 10,
        workspaceId: TEST_WORKSPACE_ID,
      });
      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      const before = screen.getAllByRole('menuitem');

      setLinkActionMenuLinkedWorkspaces(openingId, [linked('ws-origin', 'Origin')]);
      await screen.findByRole('menuitem', { name: ORIGINAL });

      const after = screen.getAllByRole('menuitem');
      expect(after.slice(0, before.length)).toEqual(before);
      expect(after).toHaveLength(before.length + 1);
    });

    it('several linked workspaces: a submenu listing them in daemon order', async () => {
      render(LinkActionMenu);
      await showPrMenu([
        linked('ws-new', 'Newest'),
        linked('ws-mid', 'Middle'),
        linked('ws-old', 'Oldest'),
      ]);

      const entries = await openOriginalSubmenu();
      expect(entries.map((el) => el.textContent?.trim())).toEqual(['Newest', 'Middle', 'Oldest']);

      await fireEvent.click(entries[1]);

      expect(openLinkedWorkspaceMock).toHaveBeenCalledWith('ws-mid');
      expect(linkActionMenuState.visible).toBe(false);
    });

    it('marks archived workspaces in the submenu', async () => {
      render(LinkActionMenu);
      await showPrMenu([linked('ws-a', 'Alpha'), linked('ws-b', 'Beta', true)]);

      const [active, archived] = await openOriginalSubmenu();
      expect(active.textContent?.trim()).toBe('Alpha');
      expect(archived.textContent?.trim()).not.toBe('Beta');
      expect(archived.textContent).toContain('Beta');
    });

    it('leaves out the workspace the click came from', async () => {
      render(LinkActionMenu);
      await showPrMenu([linked(TEST_WORKSPACE_ID, 'Here'), linked('ws-other', 'Elsewhere')]);

      const item = await screen.findByRole('menuitem', { name: ORIGINAL });
      expect(item.getAttribute('aria-haspopup')).toBeNull();
      await fireEvent.click(item);
      expect(openLinkedWorkspaceMock).toHaveBeenCalledWith('ws-other');
    });

    it('is absent when only the current workspace, or no workspace, is linked', async () => {
      render(LinkActionMenu);
      await showPrMenu([linked(TEST_WORKSPACE_ID, 'Here')]);
      expect(screen.queryByRole('menuitem', { name: ORIGINAL })).toBeNull();
      expect(screen.getAllByRole('menuitem')).toHaveLength(4);

      hideLinkActionMenu();
      await showPrMenu([]);
      expect(screen.queryByRole('menuitem', { name: ORIGINAL })).toBeNull();
    });

    it('is absent for issue links even when given linked workspaces', async () => {
      render(LinkActionMenu);
      showIssueMenu(TEST_WORKSPACE_ID);
      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      setLinkActionMenuLinkedWorkspaces(linkActionMenuState.openingId, [linked('ws-x', 'X')]);

      expect(screen.queryByRole('menuitem', { name: ORIGINAL })).toBeNull();
    });
  });

  it('uses canonical arrow navigation and restores focus to the invoking element', async () => {
    const anchor = document.createElement('button');
    document.body.append(anchor);
    anchor.focus();
    render(LinkActionMenu);
    showLinkActionMenu({
      url: ISSUE_URL,
      gitHubRef: { owner: 'acme', repo: 'widgets', number: 42, kind: 'issue' },
      x: 50,
      y: 60,
      workspaceId: TEST_WORKSPACE_ID,
      anchorElement: anchor,
    });

    const menu = await screen.findByRole('menu');
    const items = screen.getAllByRole('menuitem');
    await waitFor(() => expect(document.activeElement).toBe(items[0]));
    await fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    await waitFor(() => expect(document.activeElement).toBe(items[1]));

    await fireEvent.keyDown(menu, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
    expect(document.activeElement).toBe(anchor);
  });
});
