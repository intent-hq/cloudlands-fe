import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/svelte';
import type { WorkspaceId } from '$shared/types/branded-ids';
import LinkActionMenu from './LinkActionMenu.svelte';
import {
  showLinkActionMenu,
  hideLinkActionMenu,
  linkActionMenuState,
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
vi.mock('./link-handler', () => ({
  openInBrowserPanel: openInBrowserPanelMock,
  openInExternalBrowser: openInExternalBrowserMock,
}));

const writeTextToClipboardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/utils/clipboard', () => ({ writeTextToClipboard: writeTextToClipboardMock }));
const navigateToNewWorkspaceMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$features/new-workspace/route/new-workspace-navigation', () => ({
  navigateToNewWorkspace: navigateToNewWorkspaceMock,
}));

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

  it('starts a new workspace with the GitHub prefill', async () => {
    render(LinkActionMenu);
    showIssueMenu(TEST_WORKSPACE_ID);
    await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());

    await fireEvent.click(screen.getAllByRole('menuitem')[0]);

    expect(navigateToNewWorkspaceMock).toHaveBeenCalledWith({
      prefill: {
        owner: 'acme',
        repo: 'widgets',
        number: 42,
        kind: 'issue',
        url: ISSUE_URL,
      },
    });
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

  describe('batched positioning', () => {
    let rafCallbacks: FrameRequestCallback[];
    let rafSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
      rafCallbacks = [];
      rafSpy = vi
        .spyOn(globalThis, 'requestAnimationFrame')
        .mockImplementation((cb: FrameRequestCallback) => {
          rafCallbacks.push(cb);
          return rafCallbacks.length;
        });
    });

    afterEach(() => {
      // Drain the shared layout-phases queue so state does not leak.
      flushFrames();
      rafSpy.mockRestore();
    });

    function flushFrames() {
      let guard = 0;
      while (rafCallbacks.length > 0 && guard < 10) {
        const batch = rafCallbacks;
        rafCallbacks = [];
        for (const cb of batch) cb(performance.now());
        guard += 1;
      }
    }

    it('measures the menu through the layout-read phase and focuses the first item', async () => {
      render(LinkActionMenu);
      showIssueMenu(TEST_WORKSPACE_ID);
      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      const menu = screen.getByRole('menu');
      const rectSpy = vi.spyOn(menu, 'getBoundingClientRect');

      // Nothing measured synchronously; the adjustment waits for the frame.
      expect(rectSpy).not.toHaveBeenCalled();
      flushFrames();

      expect(rectSpy).toHaveBeenCalledTimes(1);
      expect(document.activeElement).toBe(screen.getAllByRole('menuitem')[0]);
    });

    it('coalesces rapid coordinate updates into one measurement', async () => {
      render(LinkActionMenu);
      showIssueMenu(TEST_WORKSPACE_ID);
      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      const menu = screen.getByRole('menu');
      const rectSpy = vi.spyOn(menu, 'getBoundingClientRect');

      // Re-show at new coordinates before the first frame flushes: the
      // pending task is cancelled and replaced, not stacked.
      showIssueMenu(TEST_WORKSPACE_ID);
      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      flushFrames();

      expect(rectSpy).toHaveBeenCalledTimes(1);
    });

    it('cancels the pending measurement when the menu is hidden before the frame', async () => {
      render(LinkActionMenu);
      showIssueMenu(TEST_WORKSPACE_ID);
      await waitFor(() => expect(screen.getByRole('menu')).toBeTruthy());
      const menu = screen.getByRole('menu');
      const rectSpy = vi.spyOn(menu, 'getBoundingClientRect');

      hideLinkActionMenu();
      await waitFor(() => expect(screen.queryByRole('menu')).toBeNull());
      flushFrames();

      expect(rectSpy).not.toHaveBeenCalled();
    });
  });
});
