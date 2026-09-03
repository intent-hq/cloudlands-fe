import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
  electronInvoke: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/clipboard', () => ({
  writeTextToClipboard: mocks.writeTextToClipboard,
}));

vi.mock('$store/renderer/slices/browser/browser-selectors', () => ({
  selectPendingBrowserZoom: () => null,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: mocks.dispatch },
}));

vi.mock('$store/renderer/slices/agent-session/agent-session-selectors', async () => {
  const { readable } = await import('svelte/store');
  return {
    selectAgentSession: () => readable(undefined),
    selectAgentIsResponding: () => readable(false),
    selectAgentIsWaiting: () => readable(false),
  };
});

vi.mock('$store/renderer/slices/permission/permission-selectors', async () => {
  const { readable } = await import('svelte/store');
  return { selectPendingCount: () => readable(0) };
});

vi.mock('$store/renderer/slices/workspace-agents/workspace-agents-slice', () => ({
  ensureAgentSessionLoaded: vi.fn(),
}));

vi.mock('$lib/components/ui/toast', () => ({
  toast: { error: vi.fn(), success: vi.fn() },
}));

// The owner-chip navigation helper transitively imports selector modules
// that register against the real store at load time.
vi.mock('$lib/utils/workspace-navigation', () => ({
  navigateToAgent: vi.fn(),
}));

import EmbeddedBrowser from './EmbeddedBrowser.svelte';
import { navigateToAgent } from '$lib/utils/workspace-navigation';
import { elementPickerScript } from './element-picker-script';

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('EmbeddedBrowser', () => {
  it('mounts a blank webview for about:blank', () => {
    const { container } = render(EmbeddedBrowser, {
      props: { url: 'about:blank', workspaceId: 'workspace-1' },
    });

    expect(container.querySelector('webview')?.getAttribute('src')).toBe('about:blank');
  });

  // Regression (monorepo#3170): dragging a tab to another panel reparents
  // the <webview>, Electron recreates the guest webContents, and the new
  // guest fires dom-ready again — registration must follow the live guest
  // (once-per-guest, not once-per-component), or the tab loses CDP access
  // and viewport emulation.
  describe('CDP registration lifecycle', () => {
    const invokeMock = vi.fn().mockResolvedValue(undefined);

    const registerCalls = () =>
      invokeMock.mock.calls.filter(([channel]) => channel === 'browser:register-tab');

    const renderWithTab = () => {
      invokeMock.mockClear();
      (window as unknown as { electronAPI: { invoke: typeof invokeMock } }).electronAPI = {
        invoke: invokeMock,
      };
      const { container } = render(EmbeddedBrowser, {
        props: { url: 'https://example.test/', workspaceId: 'workspace-1', tabId: 'tab-1' },
      });
      const webview = container.querySelector('webview') as HTMLElement & {
        getWebContentsId?: () => number;
        executeJavaScript?: (script: string) => Promise<unknown>;
      };
      expect(webview).not.toBeNull();
      // dom-ready also injects the keyboard interceptor; jsdom's element
      // has no executeJavaScript.
      webview.executeJavaScript = vi.fn().mockResolvedValue(undefined);
      return webview;
    };

    afterEach(() => {
      delete (window as { electronAPI?: unknown }).electronAPI;
    });

    it('re-registers when a new guest webContents fires dom-ready (panel drag)', async () => {
      const webview = renderWithTab();
      webview.getWebContentsId = () => 10;
      webview.dispatchEvent(new Event('dom-ready'));
      await waitFor(() =>
        expect(registerCalls()).toEqual([
          ['browser:register-tab', { tabId: 'tab-1', webContentsId: 10 }],
        ]),
      );

      // Reparenting destroyed and recreated the guest: new webContentsId.
      webview.getWebContentsId = () => 11;
      webview.dispatchEvent(new Event('dom-ready'));
      await waitFor(() =>
        expect(registerCalls()).toEqual([
          ['browser:register-tab', { tabId: 'tab-1', webContentsId: 10 }],
          ['browser:register-tab', { tabId: 'tab-1', webContentsId: 11 }],
        ]),
      );
    });

    it('does not re-register the same guest on later dom-ready (navigation)', async () => {
      const webview = renderWithTab();
      webview.getWebContentsId = () => 10;
      webview.dispatchEvent(new Event('dom-ready'));
      await waitFor(() => expect(registerCalls()).toHaveLength(1));

      // dom-ready fires again on a top-level navigation — same guest.
      webview.dispatchEvent(new Event('dom-ready'));
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(registerCalls()).toHaveLength(1);
    });

    it('retries registration on a later dom-ready after the IPC rejects', async () => {
      const webview = renderWithTab();
      invokeMock.mockRejectedValueOnce(new Error('main process not ready'));
      webview.getWebContentsId = () => 10;
      webview.dispatchEvent(new Event('dom-ready'));
      await waitFor(() => expect(registerCalls()).toHaveLength(1));

      // The failed registration reset the gate: the same guest's next
      // dom-ready retries instead of staying unregistered.
      webview.dispatchEvent(new Event('dom-ready'));
      await waitFor(() =>
        expect(registerCalls()).toEqual([
          ['browser:register-tab', { tabId: 'tab-1', webContentsId: 10 }],
          ['browser:register-tab', { tabId: 'tab-1', webContentsId: 10 }],
        ]),
      );
    });
  });

  describe('panel bracket shortcuts', () => {
    it.each([
      ['macOS pane', '__INTENT_PANEL_BRACKET__:]:0:1:0', ']', false, true, false],
      ['macOS column', '__INTENT_PANEL_BRACKET__:{:1:1:0', '{', true, true, false],
      ['Windows/Linux pane', '__INTENT_PANEL_BRACKET__:[:0:0:1', '[', false, false, true],
      ['Windows/Linux column', '__INTENT_PANEL_BRACKET__:}:1:0:1', '}', true, false, true],
    ] as const)(
      'forwards one %s chord to the panel handler',
      async (_label, message, key, shiftKey, metaKey, ctrlKey) => {
        const { container } = render(EmbeddedBrowser, {
          props: { url: 'about:blank', workspaceId: 'workspace-1' },
        });
        const webview = container.querySelector('webview')!;
        const seen: KeyboardEvent[] = [];
        const listener = (event: KeyboardEvent) => seen.push(event);
        window.addEventListener('keydown', listener);

        const consoleEvent = new Event('console-message');
        Object.defineProperty(consoleEvent, 'message', { value: message });
        webview.dispatchEvent(consoleEvent);
        await Promise.resolve();
        window.removeEventListener('keydown', listener);

        expect(seen).toHaveLength(1);
        expect(seen[0].key).toBe(key);
        expect(seen[0].shiftKey).toBe(shiftKey);
        expect(seen[0].metaKey).toBe(metaKey);
        expect(seen[0].ctrlKey).toBe(ctrlKey);
      },
    );
  });

  describe('owner chip', () => {
    const renderWithOwner = (extraProps: Record<string, unknown> = {}) =>
      render(EmbeddedBrowser, {
        props: {
          url: 'about:blank',
          workspaceId: 'workspace-1',
          ownerAgentId: 'agent-1',
          ownerAgentName: 'Coordinator',
          ...extraProps,
        },
      });

    it('renders the owning agent avatar with its live state', () => {
      const { container } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip="agent-1"]');
      expect(chip).not.toBeNull();
      expect(chip!.querySelector('[data-agent-avatar-with-state]')).not.toBeNull();
      expect(chip!.querySelector('[data-avatar-state="idle"]')).not.toBeNull();
    });

    it('exposes the agent name for hover/assistive tech', () => {
      const { container } = renderWithOwner();

      const trigger = container.querySelector('[data-browser-owner-chip] button');
      expect(trigger!.getAttribute('aria-label')).toContain('Coordinator');
    });

    it('navigates to the owning agent on click', async () => {
      const { container } = renderWithOwner();

      await fireEvent.click(container.querySelector('[data-browser-owner-chip] button')!);
      expect(navigateToAgent).toHaveBeenCalledWith('agent-1');
    });

    it('is absent for unowned tabs', () => {
      const { container } = render(EmbeddedBrowser, {
        props: { url: 'about:blank', workspaceId: 'workspace-1' },
      });

      expect(container.querySelector('[data-browser-owner-chip]')).toBeNull();
    });

    it('shows no device frame or dimensions in fit mode', () => {
      const { container } = renderWithOwner({ viewport: { mode: 'fit' } });

      expect(screen.getByTestId('browser-viewport-trigger').textContent).toContain('Fit panel');
      expect(container.querySelector('[data-browser-device-frame]')).toBeNull();
      expect(container.querySelector('[data-browser-viewport-readout]')).toBeNull();
      expect(container.querySelector('webview')?.className).toContain('w-full');
    });

    it('wraps a fixed viewport in a device frame with exact dimensions', () => {
      const { container } = renderWithOwner({
        viewport: { mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 },
      });

      expect(screen.getByTestId('browser-viewport-trigger').textContent).toContain('iPhone SE');
      expect(
        container.querySelector('[data-browser-device-frame]')?.getAttribute('data-width'),
      ).toBe('375');
      expect(container.querySelector('[data-browser-viewport-readout]')?.textContent).toContain(
        '375 × 667',
      );
    });
  });

  describe('page identity address editing', () => {
    const renderPage = (extraProps: Record<string, unknown> = {}) =>
      render(EmbeddedBrowser, {
        props: {
          url: 'https://example.test/docs',
          workspaceId: 'workspace-1',
          ...extraProps,
        },
      });

    it('switches from page identity to a prefilled address input on click', async () => {
      const { getByRole } = renderPage();

      await fireEvent.click(getByRole('button', { name: 'Edit browser address' }));

      expect((getByRole('textbox', { name: 'Browser address' }) as HTMLInputElement).value).toBe(
        'https://example.test/docs',
      );
    });

    it('submits the edited address through the existing webview navigation path', async () => {
      const { container, getByRole } = renderPage();
      const webview = container.querySelector('webview') as HTMLElement & {
        loadURL: ReturnType<typeof vi.fn>;
        getURL: () => string;
      };
      webview.loadURL = vi.fn().mockResolvedValue(undefined);
      webview.getURL = () => 'http://localhost:4173/';

      await fireEvent.click(getByRole('button', { name: 'Edit browser address' }));
      const input = getByRole('textbox', { name: 'Browser address' });
      await fireEvent.input(input, { target: { value: 'localhost:4173' } });
      await fireEvent.submit(input.closest('form')!);

      await waitFor(() => expect(webview.loadURL).toHaveBeenCalledWith('http://localhost:4173'));
      expect(container.querySelector('input')).toBeNull();
    });

    it('discards an edited address on Escape or blur', async () => {
      const { getByRole, queryByRole } = renderPage();
      const edit = () => fireEvent.click(getByRole('button', { name: 'Edit browser address' }));

      await edit();
      let input = getByRole('textbox', { name: 'Browser address' });
      await fireEvent.input(input, { target: { value: 'https://discarded.test/' } });
      await fireEvent.keyDown(input, { key: 'Escape' });
      expect(queryByRole('textbox', { name: 'Browser address' })).toBeNull();

      await edit();
      input = getByRole('textbox', { name: 'Browser address' });
      await fireEvent.input(input, { target: { value: 'https://also-discarded.test/' } });
      await fireEvent.blur(input);
      expect(queryByRole('textbox', { name: 'Browser address' })).toBeNull();

      await edit();
      expect((getByRole('textbox', { name: 'Browser address' }) as HTMLInputElement).value).toBe(
        'https://example.test/docs',
      );
    });

    it('opens address editing with Ctrl+L while the panel is focused', async () => {
      const { getByRole } = renderPage({ isFocused: true });

      await fireEvent.keyDown(window, { key: 'l', ctrlKey: true });

      await waitFor(() =>
        expect((getByRole('textbox', { name: 'Browser address' }) as HTMLInputElement).value).toBe(
          'https://example.test/docs',
        ),
      );
    });

    it('updates the identity title and unowned favicon from webview events', async () => {
      const { container, getByRole } = renderPage();
      const webview = container.querySelector('webview')!;
      expect(getByRole('button', { name: 'Edit browser address' }).textContent).toContain(
        'example.test',
      );

      const titleEvent = new Event('page-title-updated');
      Object.defineProperty(titleEvent, 'title', { value: 'Reference docs' });
      webview.dispatchEvent(titleEvent);
      const faviconEvent = new Event('page-favicon-updated');
      Object.defineProperty(faviconEvent, 'favicons', {
        value: ['https://example.test/favicon.ico'],
      });
      webview.dispatchEvent(faviconEvent);

      await waitFor(() =>
        expect(getByRole('button', { name: 'Edit browser address' }).textContent).toContain(
          'Reference docs',
        ),
      );
      expect(container.querySelector('[data-browser-page-favicon]')?.getAttribute('src')).toBe(
        'https://example.test/favicon.ico',
      );
    });

    it('shows the URL placeholder for a blank page and edits its full URL', async () => {
      const { getByRole } = render(EmbeddedBrowser, {
        props: { url: 'about:blank', workspaceId: 'workspace-1' },
      });

      const identity = getByRole('button', { name: 'Edit browser address' });
      expect(identity.textContent).toContain('Enter URL...');
      await fireEvent.click(identity);
      expect((getByRole('textbox', { name: 'Browser address' }) as HTMLInputElement).value).toBe(
        'about:blank',
      );
    });
  });

  describe('element picker and overflow tools', () => {
    async function renderReadyBrowser(extraProps: Record<string, unknown> = {}) {
      (window as unknown as { electronAPI: { invoke: typeof mocks.electronInvoke } }).electronAPI =
        {
          invoke: mocks.electronInvoke,
        };
      const rendered = render(EmbeddedBrowser, {
        props: {
          url: 'https://example.test/docs',
          workspaceId: 'workspace-1',
          tabId: 'tab-1',
          ...extraProps,
        },
      });
      const webview = rendered.container.querySelector('webview') as HTMLElement & {
        executeJavaScript: ReturnType<typeof vi.fn>;
        getWebContentsId: () => number;
        getURL: () => string;
        capturePage: ReturnType<typeof vi.fn>;
        reloadIgnoringCache: ReturnType<typeof vi.fn>;
      };
      webview.executeJavaScript = vi.fn().mockResolvedValue(undefined);
      webview.getWebContentsId = () => 10;
      webview.getURL = () => 'https://loaded.test/page';
      webview.capturePage = vi.fn().mockResolvedValue({
        toDataURL: () => 'data:image/png;base64,cG5n',
      });
      Object.defineProperties(webview, {
        clientWidth: { configurable: true, value: 640 },
        clientHeight: { configurable: true, value: 400 },
      });
      webview.reloadIgnoringCache = vi.fn();
      webview.dispatchEvent(new Event('dom-ready'));
      await waitFor(() =>
        expect((screen.getByTestId('browser-overflow-trigger') as HTMLButtonElement).disabled).toBe(
          false,
        ),
      );
      return { ...rendered, webview };
    }

    async function openOverflow() {
      await fireEvent.click(screen.getByTestId('browser-overflow-trigger'));
      await screen.findByRole('menu');
    }

    function dispatchConsoleMessage(webview: Element, level: number, message = 'page message') {
      const event = new Event('console-message');
      Object.defineProperties(event, {
        level: { value: level },
        message: { value: message },
      });
      webview.dispatchEvent(event);
    }

    function captureActions() {
      return mocks.dispatch.mock.calls
        .map(([action]) => action)
        .filter((action) => action.type === 'browser/elementCaptured');
    }

    it('toggles the picker pressed state and exits when the guest reports Escape', async () => {
      const { webview } = await renderReadyBrowser();
      const picker = screen.getByTestId('browser-select-element');

      expect(picker.getAttribute('aria-pressed')).toBe('false');
      await fireEvent.click(picker);
      await waitFor(() =>
        expect(webview.executeJavaScript).toHaveBeenCalledWith(elementPickerScript),
      );
      expect(picker.getAttribute('aria-pressed')).toBe('true');

      dispatchConsoleMessage(webview, 1, '__INTENT_ELEMENT_PICK_CANCELLED__');
      await waitFor(() => expect(picker.getAttribute('aria-pressed')).toBe('false'));
    });

    it('captures a validated element using the fixed viewport scale', async () => {
      const { webview } = await renderReadyBrowser({
        ownerAgentId: 'agent-1',
        viewport: { mode: 'preset', presetId: 'desktop-1280x800', width: 1280, height: 800 },
      });
      const element = {
        selector: '#save',
        domPath: 'html>body>button#save.primary',
        tagName: 'button',
        id: 'save',
        className: 'primary',
        textSnippet: 'Save changes',
        rect: { x: 100, y: 50, width: 200, height: 100 },
        pageUrl: 'https://picked.test/settings',
        sourceRef: 'src/routes/settings/+page.svelte:42:2',
      };

      dispatchConsoleMessage(webview, 1, `__INTENT_ELEMENT_PICKED__:${JSON.stringify(element)}`);

      await waitFor(() =>
        expect(webview.capturePage).toHaveBeenCalledWith({ x: 50, y: 25, width: 100, height: 50 }),
      );
      await waitFor(() => expect(captureActions()).toHaveLength(1));
      expect(captureActions()[0].payload).toMatchObject({
        wsId: 'workspace-1',
        capture: {
          tabId: 'tab-1',
          ownerAgentId: 'agent-1',
          pageUrl: 'https://picked.test/settings',
          title: 'picked.test',
          image: { data: 'data:image/png;base64,cG5n', mimeType: 'image/png' },
          element,
        },
      });
    });

    it('ignores malformed element picker messages', async () => {
      const { webview } = await renderReadyBrowser();

      dispatchConsoleMessage(webview, 1, '__INTENT_ELEMENT_PICKED__:{"selector":42}');
      await Promise.resolve();

      expect(webview.capturePage).not.toHaveBeenCalled();
      expect(captureActions()).toHaveLength(0);
    });

    it('counts only error-level console messages and resets on top-level navigation', async () => {
      const { webview } = await renderReadyBrowser();

      dispatchConsoleMessage(webview, 2);
      dispatchConsoleMessage(webview, 3);
      dispatchConsoleMessage(webview, 3);

      await waitFor(() =>
        expect(screen.getByTestId('browser-console-error-badge').textContent?.trim()).toBe('2'),
      );
      expect(screen.getByTestId('browser-overflow-trigger').getAttribute('aria-label')).toContain(
        '2',
      );

      const navigation = new Event('did-navigate');
      Object.defineProperty(navigation, 'url', { value: 'https://next.test/' });
      webview.dispatchEvent(navigation);
      await waitFor(() => expect(screen.queryByTestId('browser-console-error-badge')).toBeNull());
      expect(
        screen.getByTestId('browser-overflow-trigger').getAttribute('aria-label'),
      ).not.toContain('2');
    });

    it('routes URL, reload, and DevTools menu actions to their expected APIs', async () => {
      const { webview } = await renderReadyBrowser();

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Open in external browser' }));
      expect(mocks.invoke).toHaveBeenCalledWith('shell:openExternal', {
        url: 'https://loaded.test/page',
      });

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Copy URL' }));
      expect(mocks.writeTextToClipboard).toHaveBeenCalledWith('https://loaded.test/page');

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Reload without cache' }));
      expect(webview.reloadIgnoringCache).toHaveBeenCalledTimes(1);

      for (const [name, panel] of [
        ['Console', 'console'],
        ['Source', 'sources'],
        ['Inspector', 'elements'],
      ] as const) {
        await openOverflow();
        await fireEvent.click(screen.getByRole('menuitem', { name }));
        expect(mocks.electronInvoke).toHaveBeenCalledWith('browser:open-devtools-panel', {
          tabId: 'tab-1',
          panel,
        });
      }
    });

    it('dispatches the visible page as a PNG capture without an element', async () => {
      const { webview } = await renderReadyBrowser();

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }));

      await waitFor(() => expect(webview.capturePage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(captureActions()).toHaveLength(1));
      const capture = captureActions()[0].payload.capture;
      expect(capture).toMatchObject({
        tabId: 'tab-1',
        pageUrl: 'https://loaded.test/page',
        title: 'loaded.test',
        image: { data: 'data:image/png;base64,cG5n', mimeType: 'image/png' },
      });
      expect(capture).not.toHaveProperty('element');
    });
  });
});
