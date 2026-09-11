import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { handleLink, createGlobalLinkClickHandler, createLinkClickHandler } from './link-handler';
import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';
import { setShowCreateModal } from '$store/renderer/slices/sidebar-nav/sidebar-nav-slice';
import { setWorkspaceInitializerPendingGitHubPrefill } from '$store/renderer/slices/workspace-initializer/workspace-initializer-slice';

const TEST_WORKSPACE_ID = 'ws-1' as WorkspaceId;
const TEST_WORKTREE_ROOT = '/repo/root';

const handleIntentLinkMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
// Mock the dynamic imports used by handleLink
vi.mock('$lib/utils/workspaces-link-handler', () => ({
  handleIntentLink: handleIntentLinkMock,
}));

const openBrowserPanelMock = vi.hoisted(() => vi.fn());
const getPanelLayoutManagerMock = vi.hoisted(() =>
  vi.fn().mockReturnValue({ openBrowserPanel: openBrowserPanelMock }),
);
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: getPanelLayoutManagerMock,
}));

const invokeIpcMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../shared/generated/ipc-client', () => ({
  invoke: invokeIpcMock,
}));

// Entry-point URL resolution (loopback rewrite/probe/tunnel); echoes by default
const resolveBrowserLinkForOpenMock = vi.hoisted(() => vi.fn(async (url: string) => ({ url })));
vi.mock('$lib/utils/browser-link-open', () => ({
  resolveBrowserLinkForOpen: resolveBrowserLinkForOpenMock,
}));

const showLinkActionMenuMock = vi.hoisted(() => vi.fn());
vi.mock('./link-action-menu-state.svelte', () => ({
  showLinkActionMenu: showLinkActionMenuMock,
  hideLinkActionMenu: vi.fn(),
}));

const writeTextToClipboardMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$lib/utils/clipboard', () => ({
  writeTextToClipboard: writeTextToClipboardMock,
}));

const gotoMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('$app/navigation', () => ({ goto: gotoMock }));

// Workspace entity lookup used to relativize absolute paths
vi.mock('$store/renderer/slices/workspace/workspace-selectors', () => ({
  selectWorkspaceById: {
    select: (_state: unknown, wsId: string) =>
      wsId === 'ws-1'
        ? ({ id: 'ws-1', worktreePath: '/repo/root' } as unknown as Workspace)
        : undefined,
  },
}));

// Mock the tooltip handler so createGlobalLinkClickHandler doesn't fail
vi.mock('$lib/components/ui/tooltip/link-tooltip-state.svelte', () => ({
  showLinkTooltip: vi.fn(),
  hideLinkTooltip: vi.fn(),
}));

const reduxDispatchMock = vi.hoisted(() => vi.fn());
vi.mock('$store/renderer/store', async () => {
  const { createAppStoreMockModule } =
    await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({
      panelLayout: {
        byWorkspaceId: {
          'ws-1': { panels: { 'panel-chat': { tabs: [] } } },
        },
      },
    }),
    dispatch: reduxDispatchMock,
  });
});

describe('handleLink – devspace://terminal routing', () => {
  beforeEach(() => {
    reduxDispatchMock.mockClear();
  });

  it('should dispatch panel-layout openTab for devspace://terminal/{id}', async () => {
    const result = await handleLink('devspace://terminal/term-123', {
      workspaceId: TEST_WORKSPACE_ID,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledOnce();
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({
          wsId: TEST_WORKSPACE_ID,
          tab: expect.objectContaining({
            type: 'terminal',
            terminalId: 'term-123',
            closable: true,
          }),
        }),
      }),
    );
  });

  it('should decode URI-encoded terminal IDs', async () => {
    const result = await handleLink('devspace://terminal/terminal%20with%20spaces', {
      workspaceId: TEST_WORKSPACE_ID,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({
          wsId: TEST_WORKSPACE_ID,
          tab: expect.objectContaining({
            type: 'terminal',
            terminalId: 'terminal with spaces',
          }),
        }),
      }),
    );
  });

  it('should open the terminal beside the source panel on Cmd/Ctrl+Click', async () => {
    const result = await handleLink('devspace://terminal/term-123', {
      workspaceId: TEST_WORKSPACE_ID,
      sourcePanelId: 'panel-chat',
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTabInAdjacentOrSplit',
        payload: expect.objectContaining({
          wsId: TEST_WORKSPACE_ID,
          sourcePanelId: 'panel-chat',
          tab: expect.objectContaining({
            type: 'terminal',
            terminalId: 'term-123',
          }),
        }),
      }),
    );
  });

  it('should return false for unhandled devspace:// types', async () => {
    const result = await handleLink('devspace://unknown/some-id', {
      workspaceId: TEST_WORKSPACE_ID,
    });

    expect(result).toBe(false);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
  });

  it('should not interfere with intent:// links', async () => {
    const result = await handleLink('intent://local/note/spec', { workspaceId: TEST_WORKSPACE_ID });

    // intent:// links are handled by handleIntentLink (mocked to return true)
    expect(result).toBe(true);
    // No terminal action should be dispatched
    expect(reduxDispatchMock).not.toHaveBeenCalled();
  });

  it('forwards an explicit adjacent-panel preference for note links', async () => {
    await handleLink('intent://local/note/spec', {
      workspaceId: TEST_WORKSPACE_ID,
      sourcePanelId: 'panel-note',
      openInAdjacentPanel: true,
      openInNewAdjacentPanel: true,
    });

    expect(handleIntentLinkMock).toHaveBeenCalledWith('intent://local/note/spec', {
      workspaceId: TEST_WORKSPACE_ID,
      sourcePanelId: 'panel-note',
      openInAdjacentPanel: true,
      openInNewAdjacentPanel: true,
    });
  });
});

// ---------------------------------------------------------------------------
// Shared click-path regression tests
//
// These tests verify that the click wrappers (createGlobalLinkClickHandler,
// createLinkClickHandler) correctly extract the href from an <a> element and
// route it through handleLink.  A regression here would mean terminal links
// silently do nothing even though handleLink itself still supports them.
// ---------------------------------------------------------------------------

/** Helper: build a container with an <a> tag and simulate a click on it. */
function buildContainerWithLink(href: string): {
  container: HTMLDivElement;
  anchor: HTMLAnchorElement;
} {
  const container = document.createElement('div');
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = 'link';
  container.appendChild(anchor);
  document.body.appendChild(container);
  return { container, anchor };
}

/** Helper: create a MouseEvent that targets the given element. */
function clickOn(el: HTMLElement): MouseEvent {
  const event = new MouseEvent('click', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'target', { value: el, writable: false });
  return event;
}

describe('createGlobalLinkClickHandler – click-path regression', () => {
  beforeEach(() => {
    reduxDispatchMock.mockClear();
  });

  afterEach(() => {
    // Clean up any containers appended to body
    document.body.innerHTML = '';
  });

  it('should route devspace://terminal links to a panel-layout openTab via click', async () => {
    const { container, anchor } = buildContainerWithLink('devspace://terminal/abc-456');
    const cleanup = createGlobalLinkClickHandler(container, { workspaceId: TEST_WORKSPACE_ID });

    // Simulate a click on the anchor
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Allow the async handler to settle
    await vi.waitFor(() => {
      expect(reduxDispatchMock).toHaveBeenCalled();
    });

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({
          wsId: TEST_WORKSPACE_ID,
          tab: expect.objectContaining({ type: 'terminal', terminalId: 'abc-456' }),
        }),
      }),
    );

    cleanup();
  });

  it('should still route intent:// links without dispatching terminal events', async () => {
    const { container, anchor } = buildContainerWithLink('intent://local/note/spec');
    const cleanup = createGlobalLinkClickHandler(container, { workspaceId: TEST_WORKSPACE_ID });

    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Give async handler a tick
    await new Promise((r) => setTimeout(r, 20));
    // handleIntentLink mock resolves — no terminal action should fire
    expect(reduxDispatchMock).not.toHaveBeenCalled();

    cleanup();
  });

  it('should ignore clicks that do not land on an <a> element', async () => {
    const container = document.createElement('div');
    const span = document.createElement('span');
    span.textContent = 'not a link';
    container.appendChild(span);
    document.body.appendChild(container);

    const cleanup = createGlobalLinkClickHandler(container, { workspaceId: TEST_WORKSPACE_ID });

    span.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Give async handler a tick
    await new Promise((r) => setTimeout(r, 20));

    // Nothing should have been dispatched
    expect(reduxDispatchMock).not.toHaveBeenCalled();

    cleanup();
  });

  it('cleanup should remove the click listener', async () => {
    const { container, anchor } = buildContainerWithLink('devspace://terminal/cleanup-test');
    const cleanup = createGlobalLinkClickHandler(container, { workspaceId: TEST_WORKSPACE_ID });

    // Remove the handler
    cleanup();

    // Click after cleanup — should not route
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 20));

    expect(reduxDispatchMock).not.toHaveBeenCalled();
  });
});

describe('createLinkClickHandler (deprecated) – click-path regression', () => {
  beforeEach(() => {
    reduxDispatchMock.mockClear();
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('should route devspace://terminal links through handleLink', async () => {
    const handler = createLinkClickHandler({ workspaceId: TEST_WORKSPACE_ID });

    const { anchor } = buildContainerWithLink('devspace://terminal/legacy-term');

    // createLinkClickHandler returns a raw handler — call it directly
    const event = clickOn(anchor);
    await handler(event);

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/openTab',
        payload: expect.objectContaining({
          wsId: TEST_WORKSPACE_ID,
          tab: expect.objectContaining({ type: 'terminal', terminalId: 'legacy-term' }),
        }),
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// Path-like link targets → workspace file viewer
// ---------------------------------------------------------------------------

describe('handleLink – path-like targets → workspace file viewer', () => {
  const resolvedUrl = (rawHref: string) => new URL(rawHref, window.location.href).href;

  beforeEach(() => {
    reduxDispatchMock.mockClear();
    openBrowserPanelMock.mockClear();
    invokeIpcMock.mockClear();
    getPanelLayoutManagerMock.mockClear();
    handleIntentLinkMock.mockClear();
    (window as unknown as { electronAPI?: object }).electronAPI = {};
  });

  it('should route a relative raw href to openWorkspaceFile', async () => {
    const rawHref = 'src/main.rs';
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/main.rs', {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('should relativize an absolute raw href under the worktree root', async () => {
    const rawHref = `${TEST_WORKTREE_ROOT}/src/lib.rs`;
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/lib.rs', {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );
  });

  it('keeps exact relative and absolute ignored artifact paths in the owning workspace', async () => {
    const relative = '.demo-artifacts/20260824T234627Z-frontend-preview/frontend-preview.webm';
    await handleLink(resolvedUrl(relative), { workspaceId: TEST_WORKSPACE_ID, rawHref: relative });
    await handleLink(`${TEST_WORKTREE_ROOT}/${relative}`, {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref: `${TEST_WORKTREE_ROOT}/${relative}`,
    });

    expect(reduxDispatchMock).toHaveBeenNthCalledWith(
      1,
      openWorkspaceFile(TEST_WORKSPACE_ID, relative, {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );
    expect(reduxDispatchMock).toHaveBeenNthCalledWith(
      2,
      openWorkspaceFile(TEST_WORKSPACE_ID, relative, {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );
  });

  it('relativizes an absolute path inside the frontend submodule', async () => {
    const rawHref = `${TEST_WORKTREE_ROOT}/packages/cloudlands-fe/src/app.html`;
    await handleLink(resolvedUrl(rawHref), { workspaceId: TEST_WORKSPACE_ID, rawHref });

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'packages/cloudlands-fe/src/app.html', {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );
  });

  it.each([
    '../outside.png',
    'src/../../outside.webm',
    `${TEST_WORKTREE_ROOT}/../outside.png`,
    `${TEST_WORKTREE_ROOT}/%2e%2e/outside.png`,
  ])('rejects traversal in workspace file links: %s', async (rawHref) => {
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(false);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });

  it('should open absolute paths outside the worktree root in the external editor', async () => {
    const rawHref = '/other/place/file.rs';
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', {
      url: 'vscode://file//other/place/file.rs',
    });
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it.each([
    ['/other/place/file.rs:17', 'vscode://file//other/place/file.rs:17'],
    ['/other/place/file.rs:17:4', 'vscode://file//other/place/file.rs:17:4'],
  ])('preserves locations on outside-worktree paths: %s', async (rawHref, expectedUrl) => {
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url: expectedUrl });
  });

  it('should route self-origin resolved URLs without rawHref to the file viewer, not the browser panel', async () => {
    const result = await handleLink(`${window.location.origin}/src/main.rs`, {
      workspaceId: TEST_WORKSPACE_ID,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/main.rs', {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('should map a trailing #L<n> fragment to the line option', async () => {
    const rawHref = 'src/main.rs#L42';
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/main.rs', {
        line: 42,
        openInAdjacentPanel: false,
      }),
    );
  });

  it('should map a trailing :<line> suffix to the line option', async () => {
    const rawHref = 'src/main.rs:17';
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/main.rs', {
        line: 17,
        openInAdjacentPanel: false,
      }),
    );
  });

  it('should map Cmd/Ctrl+Click to openInAdjacentPanel', async () => {
    const rawHref = 'src/main.rs';
    const result = await handleLink(resolvedUrl(rawHref), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref,
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/main.rs', {
        line: undefined,
        openInAdjacentPanel: true,
      }),
    );
  });

  it('carries the source panel from the click into workspace file navigation', async () => {
    const panel = document.createElement('div');
    panel.dataset.panelId = 'panel-chat';
    const anchor = document.createElement('a');
    panel.appendChild(anchor);
    const event = new MouseEvent('click');
    Object.defineProperty(event, 'target', { value: anchor });

    await handleLink(resolvedUrl('src/scoped.ts'), {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref: 'src/scoped.ts',
      event,
    });

    expect(reduxDispatchMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        type: 'panelLayout/focusPanel',
        payload: expect.objectContaining({ wsId: TEST_WORKSPACE_ID, panelId: 'panel-chat' }),
      }),
    );
    expect(reduxDispatchMock).toHaveBeenNthCalledWith(
      2,
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/scoped.ts', {
        line: undefined,
        openInAdjacentPanel: false,
        sourcePanelId: 'panel-chat',
      }),
    );
  });

  it('opens browser links in the current workspace and source panel', async () => {
    const panel = document.createElement('div');
    panel.dataset.panelId = 'panel-chat';
    const anchor = document.createElement('a');
    panel.appendChild(anchor);
    const event = new MouseEvent('click', { metaKey: true, ctrlKey: true });
    Object.defineProperty(event, 'target', { value: anchor });

    await handleLink('https://example.com/docs', {
      workspaceId: TEST_WORKSPACE_ID,
      event,
    });

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/focusPanel',
        payload: expect.objectContaining({ wsId: TEST_WORKSPACE_ID, panelId: 'panel-chat' }),
      }),
    );
    expect(getPanelLayoutManagerMock).toHaveBeenCalledWith('ws-1');
    expect(openBrowserPanelMock).toHaveBeenCalledWith(
      'https://example.com/docs',
      undefined,
      'panel-chat',
      undefined,
    );
  });

  it('passes the owning workspace and source panel to intent navigation', async () => {
    await handleLink('intent://local/note/spec', {
      workspaceId: TEST_WORKSPACE_ID,
      sourcePanelId: 'panel-chat',
    });

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'panelLayout/focusPanel',
        payload: expect.objectContaining({ wsId: TEST_WORKSPACE_ID, panelId: 'panel-chat' }),
      }),
    );
    expect(handleIntentLinkMock).toHaveBeenCalledWith('intent://local/note/spec', {
      workspaceId: TEST_WORKSPACE_ID,
      sourcePanelId: 'panel-chat',
      openInAdjacentPanel: false,
      openInNewAdjacentPanel: false,
    });
  });

  it('should return false without a workspaceId and never open the browser panel', async () => {
    const rawHref = 'src/main.rs';
    const result = await handleLink(resolvedUrl(rawHref), { rawHref });

    expect(result).toBe(false);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('should not capture in-page fragment-only hrefs', async () => {
    const result = await handleLink(`${window.location.href}#heading`, {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref: '#heading',
    });

    // Current behavior preserved: self-origin http URL is treated as a plain
    // http(s) link (flipped default → external browser)
    expect(result).toBe(true);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', {
      url: `${window.location.href}#heading`,
    });
  });

  it('should route plain-clicked external https links to the external browser', async () => {
    const url = 'https://example.com/docs';
    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref: url,
    });

    expect(result).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
    expect(reduxDispatchMock).not.toHaveBeenCalled();
  });

  it('should route relative hrefs through createGlobalLinkClickHandler clicks', async () => {
    const container = document.createElement('div');
    const anchor = document.createElement('a');
    anchor.setAttribute('href', 'src/main.rs');
    anchor.textContent = 'main.rs';
    container.appendChild(anchor);
    document.body.appendChild(container);

    const cleanup = createGlobalLinkClickHandler(container, { workspaceId: TEST_WORKSPACE_ID });
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    await vi.waitFor(() => {
      expect(reduxDispatchMock).toHaveBeenCalled();
    });
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openWorkspaceFile(TEST_WORKSPACE_ID, 'src/main.rs', {
        line: undefined,
        openInAdjacentPanel: false,
      }),
    );

    cleanup();
    document.body.innerHTML = '';
  });
});

// ---------------------------------------------------------------------------
// Flipped http(s) routing + GitHub issue/PR link action menu
// ---------------------------------------------------------------------------

describe('handleLink – flipped http(s) routing and link action menu', () => {
  beforeEach(() => {
    reduxDispatchMock.mockClear();
    openBrowserPanelMock.mockClear();
    invokeIpcMock.mockClear();
    showLinkActionMenuMock.mockClear();
    writeTextToClipboardMock.mockClear();
    gotoMock.mockClear();
    resolveBrowserLinkForOpenMock.mockClear();
  });

  it('Cmd+Click routes http(s) links to the embedded browser panel', async () => {
    const url = 'https://example.com/docs';
    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(openBrowserPanelMock).toHaveBeenCalledWith(url, undefined, undefined, undefined);
    expect(invokeIpcMock).not.toHaveBeenCalled();
  });

  it('resolves the URL BEFORE opening the browser panel and opens the resolved URL', async () => {
    const url = 'http://localhost:5173/app';
    const resolvedUrl = 'http://10.0.0.5:5173/app';
    resolveBrowserLinkForOpenMock.mockResolvedValueOnce({ url: resolvedUrl, requestedUrl: url });

    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(resolveBrowserLinkForOpenMock).toHaveBeenCalledWith(url);
    expect(openBrowserPanelMock).toHaveBeenCalledWith(resolvedUrl, undefined, undefined, url);
  });

  it('opens the URL unresolved when entry-point resolution throws', async () => {
    const url = 'http://localhost:5173/app';
    resolveBrowserLinkForOpenMock.mockRejectedValueOnce(new Error('ipc unavailable'));

    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(openBrowserPanelMock).toHaveBeenCalledWith(url, undefined, undefined, undefined);
  });

  it('Cmd+Click without a workspaceId falls back to the external browser', async () => {
    const url = 'https://example.com/docs';
    const result = await handleLink(url, { modifiers: { metaKey: true, ctrlKey: true } });

    expect(result).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('forceExternal routes to the external browser even with Cmd held', async () => {
    const url = 'https://example.com/docs';
    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      forceExternal: true,
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('auth URLs always open in the external browser, even Cmd+Clicked', async () => {
    const url = 'https://example.com/oauth/authorize';
    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      modifiers: { metaKey: true, ctrlKey: true },
    });

    expect(result).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('plain click on a GitHub issue link with an event shows the action menu', async () => {
    const url = 'https://github.com/acme/widgets/issues/42';
    const event = new MouseEvent('click', { clientX: 100, clientY: 200 });
    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      event,
      githubLinkDefaultAction: 'show-choices',
    });

    expect(result).toBe(true);
    expect(showLinkActionMenuMock).toHaveBeenCalledWith({
      url,
      gitHubRef: { owner: 'acme', repo: 'widgets', number: 42, kind: 'issue' },
      x: 100,
      y: 200,
      workspaceId: TEST_WORKSPACE_ID,
      anchorElement: null,
    });
    expect(invokeIpcMock).not.toHaveBeenCalled();
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it('keyboard activation (0,0 click) anchors the menu to the link element rect', async () => {
    const url = 'https://github.com/acme/widgets/issues/42';
    const { container, anchor } = buildContainerWithLink(url);
    anchor.getBoundingClientRect = () =>
      ({ left: 40, bottom: 90, top: 70, right: 120, width: 80, height: 20 }) as DOMRect;
    const event = new MouseEvent('click', { clientX: 0, clientY: 0 });
    Object.defineProperty(event, 'target', { value: anchor });

    const result = await handleLink(url, { workspaceId: TEST_WORKSPACE_ID, event });

    expect(result).toBe(true);
    expect(showLinkActionMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({ x: 40, y: 90, anchorElement: anchor }),
    );
    container.remove();
  });

  it('plain click on a GitHub PR link shows the menu with kind pr', async () => {
    const url = 'https://github.com/acme/widgets/pull/7';
    const event = new MouseEvent('click', { clientX: 10, clientY: 20 });
    const result = await handleLink(url, { event, githubLinkDefaultAction: 'show-choices' });

    expect(result).toBe(true);
    expect(showLinkActionMenuMock).toHaveBeenCalledWith(
      expect.objectContaining({
        gitHubRef: { owner: 'acme', repo: 'widgets', number: 7, kind: 'pr' },
        workspaceId: undefined,
      }),
    );
  });

  it('GitHub issue link without a MouseEvent falls back to the external browser', async () => {
    const url = 'https://github.com/acme/widgets/issues/42';
    const result = await handleLink(url, { workspaceId: TEST_WORKSPACE_ID });

    expect(result).toBe(true);
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
  });

  it.each([
    ['issue', 'https://github.com/acme/widgets/issues/42'],
    ['PR', 'https://github.com/acme/widgets/pull/7'],
  ])('opens a GitHub %s externally when configured', async (_kind, url) => {
    const event = new MouseEvent('click');

    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      event,
      githubLinkDefaultAction: 'open-in-browser',
    });

    expect(result).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
  });

  it.each([
    ['issue', 'https://github.com/acme/widgets/issues/42'],
    ['PR', 'https://github.com/acme/widgets/pull/7'],
  ])('opens a GitHub %s in the app when configured', async (_kind, url) => {
    const event = new MouseEvent('click');

    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      event,
      githubLinkDefaultAction: 'open-in-app',
    });

    expect(result).toBe(true);
    expect(openBrowserPanelMock).toHaveBeenCalledWith(url, undefined, undefined, undefined);
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
  });

  it('open-in-app falls back to the external browser without a workspace', async () => {
    const url = 'https://github.com/acme/widgets/issues/42';

    const result = await handleLink(url, {
      event: new MouseEvent('click'),
      githubLinkDefaultAction: 'open-in-app',
    });

    expect(result).toBe(true);
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
    expect(openBrowserPanelMock).not.toHaveBeenCalled();
  });

  it.each([
    ['issue', 'https://github.com/acme/widgets/issues/42'],
    ['PR', 'https://github.com/acme/widgets/pull/7'],
  ])('copies a GitHub %s link when configured', async (_kind, url) => {
    const result = await handleLink(url, {
      event: new MouseEvent('click'),
      githubLinkDefaultAction: 'copy-link',
    });

    expect(result).toBe(true);
    expect(writeTextToClipboardMock).toHaveBeenCalledWith(url);
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
  });

  it.each([
    [
      'issue',
      'https://github.com/acme/widgets/issues/42',
      { owner: 'acme', repo: 'widgets', number: 42, kind: 'issue' },
    ],
    [
      'PR',
      'https://github.com/acme/widgets/pull/7',
      { owner: 'acme', repo: 'widgets', number: 7, kind: 'pr' },
    ],
  ] as const)('starts a workspace from a GitHub %s when configured', async (_kind, url, ref) => {
    const result = await handleLink(url, {
      event: new MouseEvent('click'),
      githubLinkDefaultAction: 'start-workspace',
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      setWorkspaceInitializerPendingGitHubPrefill({ ...ref, url }),
    );
    expect(reduxDispatchMock).toHaveBeenCalledWith(setShowCreateModal(true));
    expect(gotoMock).not.toHaveBeenCalled();
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
  });

  it('Cmd+Click on a GitHub issue link bypasses the menu → browser panel', async () => {
    const url = 'https://github.com/acme/widgets/issues/42';
    const event = new MouseEvent('click', { clientX: 5, clientY: 5, metaKey: true, ctrlKey: true });
    const result = await handleLink(url, { workspaceId: TEST_WORKSPACE_ID, event });

    expect(result).toBe(true);
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
    expect(openBrowserPanelMock).toHaveBeenCalledWith(url, undefined, undefined, undefined);
  });

  it('non-issue/PR GitHub links plain-click to the external browser (no menu)', async () => {
    const url = 'https://github.com/acme/widgets';
    const event = new MouseEvent('click', { clientX: 1, clientY: 1 });
    const result = await handleLink(url, { workspaceId: TEST_WORKSPACE_ID, event });

    expect(result).toBe(true);
    expect(showLinkActionMenuMock).not.toHaveBeenCalled();
    expect(invokeIpcMock).toHaveBeenCalledWith('shell:openExternal', { url });
  });
});
