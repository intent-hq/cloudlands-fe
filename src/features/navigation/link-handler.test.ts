import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
} from 'vitest';
import {
  handleLink,
  createGlobalLinkClickHandler,
  createLinkClickHandler,
} from './link-handler';
import { openTerminalTabRequested } from '$store/renderer/slices/app-layout/app-layout-slice';
import { openWorkspaceFile } from '$store/renderer/slices/workspace-navigation/workspace-navigation-slice';
import type { WorkspaceId } from '$shared/types/branded-ids';
import type { Workspace } from '$shared/types';

const TEST_WORKSPACE_ID = 'ws-1' as WorkspaceId;
const TEST_WORKTREE_ROOT = '/repo/root';

// Mock the dynamic imports used by handleLink
vi.mock('$lib/utils/workspaces-link-handler', () => ({
  handleIntentLink: vi.fn().mockResolvedValue(true),
}));

const openBrowserPanelMock = vi.hoisted(() => vi.fn());
vi.mock('$features/layout/panel-layout-adapter', () => ({
  getPanelLayoutManager: vi.fn().mockReturnValue({
    openBrowserPanel: openBrowserPanelMock,
  }),
}));

const invokeIpcMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));
vi.mock('../../shared/generated/ipc-client', () => ({
  invoke: invokeIpcMock,
}));

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
  const { createAppStoreMockModule } = await import('$store/renderer/utils/test-helpers/store-mock');

  return createAppStoreMockModule({
    state: () => ({}),
    dispatch: reduxDispatchMock,
  });
});

describe('handleLink – devspace://terminal routing', () => {
  beforeEach(() => {
    reduxDispatchMock.mockClear();
  });

  it('should dispatch openTerminalTabRequested for devspace://terminal/{id}', async () => {
    const result = await handleLink('devspace://terminal/term-123', { workspaceId: TEST_WORKSPACE_ID });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledOnce();
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openTerminalTabRequested(TEST_WORKSPACE_ID, { terminalId: 'term-123' }),
    );
  });

  it('should decode URI-encoded terminal IDs', async () => {
    const result = await handleLink('devspace://terminal/terminal%20with%20spaces', {
      workspaceId: TEST_WORKSPACE_ID,
    });

    expect(result).toBe(true);
    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openTerminalTabRequested(TEST_WORKSPACE_ID, { terminalId: 'terminal with spaces' }),
    );
  });

  it('should return false for unhandled devspace:// types', async () => {
    const result = await handleLink('devspace://unknown/some-id', { workspaceId: TEST_WORKSPACE_ID });

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
function buildContainerWithLink(href: string): { container: HTMLDivElement; anchor: HTMLAnchorElement } {
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

  it('should route devspace://terminal links to openTerminalTabRequested via click', async () => {
    const { container, anchor } = buildContainerWithLink('devspace://terminal/abc-456');
    const cleanup = createGlobalLinkClickHandler(container, { workspaceId: TEST_WORKSPACE_ID });

    // Simulate a click on the anchor
    anchor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    // Allow the async handler to settle
    await vi.waitFor(() => {
      expect(reduxDispatchMock).toHaveBeenCalled();
    });

    expect(reduxDispatchMock).toHaveBeenCalledWith(
      openTerminalTabRequested(TEST_WORKSPACE_ID, { terminalId: 'abc-456' }),
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
      openTerminalTabRequested(TEST_WORKSPACE_ID, { terminalId: 'legacy-term' }),
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

    // Current behavior preserved: self-origin http URL goes to the browser panel
    expect(result).toBe(true);
    expect(reduxDispatchMock).not.toHaveBeenCalled();
    expect(openBrowserPanelMock).toHaveBeenCalled();
  });

  it('should keep external https links routed to the browser panel', async () => {
    const url = 'https://example.com/docs';
    const result = await handleLink(url, {
      workspaceId: TEST_WORKSPACE_ID,
      rawHref: url,
    });

    expect(result).toBe(true);
    expect(openBrowserPanelMock).toHaveBeenCalledWith(url);
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
