import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  dispatch: vi.fn(),
  invoke: vi.fn().mockResolvedValue(undefined),
  writeTextToClipboard: vi.fn().mockResolvedValue(undefined),
  electronInvoke: vi.fn().mockResolvedValue(undefined),
  selectMostRecentAgentTab: vi.fn(),
}));

vi.mock('$lib/electron-bridge', () => ({ invoke: mocks.invoke }));
vi.mock('$lib/utils/clipboard', () => ({
  writeTextToClipboard: mocks.writeTextToClipboard,
}));

vi.mock('$store/renderer/slices/browser/browser-selectors', () => ({
  selectPendingBrowserZoom: () => null,
}));

vi.mock('$store/renderer/slices/panel-layout/panel-layout-selectors', () => ({
  selectMostRecentAgentTab: { select: mocks.selectMostRecentAgentTab },
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

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { error: vi.fn(), success: vi.fn() },
}));

import EmbeddedBrowser from './EmbeddedBrowser.svelte';
import { m } from '$shared/paraglide/messages.js';
import { notify } from '$lib/components/patterns/notify';
import { elementPickerScript } from './element-picker-script';
import { tabStateReducer } from '$store/renderer/slices/tab-state/tab-state-slice';

class ToolbarResizeObserver {
  static instances: ToolbarResizeObserver[] = [];
  target?: Element;

  constructor(private readonly callback: ResizeObserverCallback) {
    ToolbarResizeObserver.instances.push(this);
  }

  observe(target: Element) {
    this.target = target;
  }

  disconnect() {}

  fire(width: number) {
    if (!this.target) throw new Error('ResizeObserver target was not observed');
    this.callback(
      [{ target: this.target, contentRect: { width } } as unknown as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete (window as { electronAPI?: unknown }).electronAPI;
});

describe('EmbeddedBrowser', () => {
  const mountedLeases = () =>
    mocks.dispatch.mock.calls.reduce(
      (state, [action]) => tabStateReducer(state, action),
      tabStateReducer(undefined, { type: '@@INIT' }),
    ).mountedBrowserTabLeases;

  it('leases the live webview until unmount, not just while the panel is active', async () => {
    const { container, rerender, unmount } = render(EmbeddedBrowser, {
      props: { url: 'https://example.test/', workspaceId: 'workspace-1', tabId: 'tab-1' },
    });
    await waitFor(() => expect(Object.keys(mountedLeases()['tab-1'])).toHaveLength(1));
    const initialLeases = mountedLeases();
    const webview = container.querySelector('webview');
    const leaseCalls = () =>
      mocks.dispatch.mock.calls.filter(
        ([action]) =>
          action.type === 'tabState/acquireBrowserTabMount' ||
          action.type === 'tabState/releaseBrowserTabMount',
      );
    await rerender({ isActive: false });
    await rerender({ isActive: true });
    expect(container.querySelector('webview')).toBe(webview);
    expect(mountedLeases()).toEqual(initialLeases);
    expect(leaseCalls()).toHaveLength(1);

    unmount();
    await waitFor(() => expect(mountedLeases()).toEqual({}));
  });

  it('does not release another mounted instance when an older instance unmounts', async () => {
    const props = { url: 'about:blank', workspaceId: 'workspace-1', tabId: 'tab-1' };
    const older = render(EmbeddedBrowser, { props });
    const newer = render(EmbeddedBrowser, { props });
    await waitFor(() => expect(Object.keys(mountedLeases()['tab-1'])).toHaveLength(2));
    older.unmount();
    await waitFor(() => expect(Object.keys(mountedLeases()['tab-1'])).toHaveLength(1));
    newer.unmount();
    await waitFor(() => expect(mountedLeases()).toEqual({}));
  });

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

  describe('viewport modes', () => {
    const renderWithOwner = (extraProps: Record<string, unknown> = {}) =>
      render(EmbeddedBrowser, {
        props: {
          url: 'about:blank',
          workspaceId: 'workspace-1',
          ownerAgentId: 'agent-1',
          ...extraProps,
        },
      });

    it('defaults owned tabs to fit without a device frame or dimensions', () => {
      const { container } = renderWithOwner();

      expect(screen.getByTestId('browser-viewport-trigger').textContent).toContain('Fit');
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

    it('keeps the same webview mounted while switching viewport modes', async () => {
      const props = {
        url: 'about:blank',
        workspaceId: 'workspace-1',
        ownerAgentId: 'agent-1',
      };
      const rendered = render(EmbeddedBrowser, { props: { ...props, viewport: { mode: 'fit' } } });
      const webview = rendered.container.querySelector('webview');

      await rendered.rerender({
        ...props,
        viewport: { mode: 'preset', presetId: 'iphone-se', width: 375, height: 667 },
      });
      expect(rendered.container.querySelector('webview')).toBe(webview);
      await rendered.rerender({
        ...props,
        viewport: { mode: 'custom', width: 900, height: 700 },
      });
      expect(rendered.container.querySelector('webview')).toBe(webview);
      await rendered.rerender({ ...props, viewport: { mode: 'fit' } });
      expect(rendered.container.querySelectorAll('webview')).toHaveLength(1);
      expect(rendered.container.querySelector('webview')).toBe(webview);
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

    it('reports an unparsable address without navigating or recording it', async () => {
      const { container, getByRole, queryByText } = renderPage();
      const webview = container.querySelector('webview') as HTMLElement & {
        loadURL: ReturnType<typeof vi.fn>;
      };
      webview.loadURL = vi.fn().mockResolvedValue(undefined);
      mocks.dispatch.mockClear();
      const invalidFormatMessage = m.browser_embedded_invalidUrlFormat_error();
      expect(queryByText(invalidFormatMessage)).toBeNull();

      await fireEvent.click(getByRole('button', { name: 'Edit browser address' }));
      const input = getByRole('textbox', { name: 'Browser address' });
      await fireEvent.input(input, { target: { value: 'not a url' } });
      await fireEvent.submit(input.closest('form')!);

      expect(queryByText(invalidFormatMessage)).not.toBeNull();
      expect(webview.loadURL).not.toHaveBeenCalled();
      expect(mocks.dispatch).not.toHaveBeenCalled();
      expect(container.querySelector('input')).toBeNull();
    });

    describe('destroyed guest webContents', () => {
      type GuestWebview = HTMLElement & {
        getURL: () => string;
        getWebContentsId: () => number;
        reload: ReturnType<typeof vi.fn>;
        executeJavaScript: ReturnType<typeof vi.fn>;
      };

      const attachGuest = (container: HTMLElement, webContentsId: number) => {
        const webview = container.querySelector('webview') as GuestWebview;
        webview.reload = vi.fn();
        webview.executeJavaScript = vi.fn().mockResolvedValue(undefined);
        webview.getWebContentsId = () => webContentsId;
        webview.dispatchEvent(new Event('dom-ready'));
        webview.dispatchEvent(new Event('did-stop-loading'));
        return webview;
      };

      // A guest that closed itself: the element stays connected and keeps
      // reporting the id it had at dom-ready, while every guest method throws.
      const destroyGuest = async (container: HTMLElement) => {
        const webview = attachGuest(container, 10);
        webview.getURL = () => {
          throw new Error('The WebView must be attached to the DOM');
        };
        webview.dispatchEvent(new Event('destroyed'));
        await waitFor(() => expect(container.querySelector('webview')).toBeNull());
        return webview;
      };

      it('shows a page-closed error and drops the dead webview', async () => {
        const { container, queryByText } = renderPage();
        const pageClosedMessage = m.browser_embedded_pageClosed_error();
        expect(queryByText(pageClosedMessage)).toBeNull();

        await destroyGuest(container);

        expect(queryByText(pageClosedMessage)).not.toBeNull();
        expect(container.querySelector('webview')).toBeNull();
      });

      it('logs the closed page URL without userinfo, query or fragment', async () => {
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        const { container } = renderPage();
        const webview = attachGuest(container, 10);
        const closeUrl =
          'https://u:pw@auth.example.test/cb?code=SECRETCODE&state=s1#access_token=TOK';
        webview.dispatchEvent(Object.assign(new Event('did-navigate'), { url: closeUrl }));

        webview.dispatchEvent(new Event('destroyed'));
        await waitFor(() => expect(container.querySelector('webview')).toBeNull());

        const logged = warn.mock.calls.find(([msg]) => String(msg).includes('guest was destroyed'));
        expect(logged).toBeDefined();
        const data = logged![1] as { url: string };
        expect(data.url).toBe('https://auth.example.test/cb');
        for (const call of warn.mock.calls) {
          const serialized = JSON.stringify(call);
          expect(serialized).not.toContain('SECRETCODE');
          expect(serialized).not.toContain('TOK');
          expect(serialized).not.toContain('u:pw');
        }
        warn.mockRestore();
      });

      // Reparenting (panel drag) destroys and re-creates the guest; the old
      // guest's `destroyed` reaches the re-connected element before the new
      // guest attached (no id yet) or after (a new id). Neither is a close.
      it('keeps the webview when destroyed arrives mid-reparent before the new guest attaches', async () => {
        const { container, queryByText } = renderPage();
        const pageClosedMessage = m.browser_embedded_pageClosed_error();
        const webview = attachGuest(container, 10);

        // disconnectedCallback → reset() cleared guestInstanceId.
        webview.getWebContentsId = () => {
          throw new Error('The WebView must be attached to the DOM');
        };
        webview.dispatchEvent(new Event('destroyed'));

        // The replacement guest attaches and becomes ready.
        webview.getWebContentsId = () => 11;
        webview.dispatchEvent(new Event('dom-ready'));

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(queryByText(pageClosedMessage)).toBeNull();
        expect(container.querySelector('webview')).toBe(webview);
      });

      it('keeps the webview when destroyed arrives after the replacement guest attached', async () => {
        const { container, queryByText } = renderPage();
        const pageClosedMessage = m.browser_embedded_pageClosed_error();
        const webview = attachGuest(container, 10);

        // The new guest is attached (new id) but has not reached dom-ready.
        webview.getWebContentsId = () => 11;
        webview.dispatchEvent(new Event('destroyed'));
        webview.dispatchEvent(new Event('dom-ready'));

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(queryByText(pageClosedMessage)).toBeNull();
        expect(container.querySelector('webview')).toBe(webview);
      });

      it('does not reload the same URL on its own after the guest closes', async () => {
        const { container } = renderPage();
        await destroyGuest(container);

        await new Promise((resolve) => setTimeout(resolve, 20));
        expect(container.querySelector('webview')).toBeNull();
      });

      it('mounts a fresh webview and clears the banner on a new address', async () => {
        const { container, getByRole, queryByText } = renderPage();
        const pageClosedMessage = m.browser_embedded_pageClosed_error();
        const dead = await destroyGuest(container);

        await fireEvent.click(getByRole('button', { name: 'Edit browser address' }));
        const input = getByRole('textbox', { name: 'Browser address' });
        await fireEvent.input(input, { target: { value: 'https://example.test/next' } });
        await fireEvent.submit(input.closest('form')!);

        await waitFor(() => expect(container.querySelector('webview')).not.toBeNull());
        const fresh = container.querySelector('webview')!;
        expect(fresh).not.toBe(dead);
        expect(fresh.getAttribute('src')).toBe('https://example.test/next');
        expect(queryByText(pageClosedMessage)).toBeNull();
      });

      it('mounts a fresh webview for the same URL when the refresh button is used', async () => {
        const { container, queryByText } = renderPage();
        const pageClosedMessage = m.browser_embedded_pageClosed_error();
        const dead = await destroyGuest(container);

        await fireEvent.click(screen.getByRole('button', { name: 'Refresh page' }));

        await waitFor(() => expect(container.querySelector('webview')).not.toBeNull());
        const fresh = container.querySelector('webview')!;
        expect(fresh).not.toBe(dead);
        expect(fresh.getAttribute('src')).toBe('https://example.test/docs');
        // The dead element was never reloaded in place.
        expect(dead.reload).not.toHaveBeenCalled();
        expect(queryByText(pageClosedMessage)).toBeNull();
      });
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

    it('selects the full address when Ctrl+L is repeated in the input', async () => {
      const { getByRole } = renderPage({ isFocused: true });
      await fireEvent.keyDown(window, { key: 'l', ctrlKey: true });
      const input = (await waitFor(() =>
        getByRole('textbox', { name: 'Browser address' }),
      )) as HTMLInputElement;
      input.setSelectionRange(4, 11);
      const event = new KeyboardEvent('keydown', {
        key: 'l',
        ctrlKey: true,
        bubbles: true,
        cancelable: true,
      });

      input.dispatchEvent(event);

      expect(event.defaultPrevented).toBe(true);
      expect(input.selectionStart).toBe(0);
      expect(input.selectionEnd).toBe(input.value.length);
    });

    it.each([undefined, 'agent-owner'])(
      'updates page identity from webview events for owner %s',
      async (ownerAgentId) => {
        const { container, getByRole } = renderPage({ ownerAgentId });
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
      },
    );

    it('exposes the page title and distinct hostname together', async () => {
      const { container, getByRole } = renderPage({ url: 'https://app.example.com/dashboard' });
      const titleEvent = new Event('page-title-updated');
      Object.defineProperty(titleEvent, 'title', { value: 'Dashboard' });

      container.querySelector('webview')!.dispatchEvent(titleEvent);

      const identity = getByRole('button', { name: 'Edit browser address' });
      await waitFor(() => expect(identity.textContent).toContain('Dashboard'));
      expect(identity.textContent).toContain('app.example.com');
    });

    it('shows a hostname only once when the page has no title', () => {
      const { getByRole, getAllByText } = renderPage({ url: 'http://127.0.0.1:5173' });

      expect(getAllByText('127.0.0.1')).toHaveLength(1);
      expect(getByRole('button', { name: 'Edit browser address' }).textContent?.trim()).toBe(
        '127.0.0.1',
      );
    });

    it('omits the hostname separator when the URL has no hostname', async () => {
      const { container, getByRole } = renderPage({ url: 'file:///tmp/report.html' });
      const titleEvent = new Event('page-title-updated');
      Object.defineProperty(titleEvent, 'title', { value: 'Local report' });

      container.querySelector('webview')!.dispatchEvent(titleEvent);

      const identity = getByRole('button', { name: 'Edit browser address' });
      await waitFor(() => expect(identity.textContent?.trim()).toBe('Local report'));
    });

    it.each(['did-navigate', 'did-navigate-in-page'])(
      'persists %s without issuing another guest navigation',
      async (eventName) => {
        const onNavigate = vi.fn();
        const { container, getByRole, rerender } = renderPage({ onNavigate });
        const webview = container.querySelector('webview')!;
        const sourceWrites: MutationRecord[] = [];
        const observer = new MutationObserver((records) => sourceWrites.push(...records));
        observer.observe(webview, { attributes: true, attributeFilter: ['src'] });
        const loadURL = vi.fn().mockResolvedValue(undefined);
        Object.assign(webview, { loadURL });
        const navigate = new Event(eventName);
        Object.defineProperty(navigate, 'isMainFrame', { value: true });
        Object.defineProperty(navigate, 'url', { value: 'https://next.test/docs' });
        webview.dispatchEvent(navigate);
        await waitFor(() => expect(onNavigate).toHaveBeenCalledWith('https://next.test/docs'));
        await rerender({ url: 'https://next.test/docs' });
        await fireEvent.click(getByRole('button', { name: 'Edit browser address' }));
        expect((getByRole('textbox', { name: 'Browser address' }) as HTMLInputElement).value).toBe(
          'https://next.test/docs',
        );
        observer.disconnect();
        expect(sourceWrites).toHaveLength(0);
        expect(loadURL).not.toHaveBeenCalled();
        expect(container.querySelector('webview')).toBe(webview);
      },
    );

    // intent#4767: iframe history changes must not replace the tab's URL or src.
    it.each(['about:blank', 'https://iframe.test/widget#section'])(
      'ignores subframe in-page navigation to %s',
      async (url) => {
        const mainUrl = 'https://example.test/docs';
        const onNavigate = vi.fn();
        const { container } = renderPage({ url: mainUrl, onNavigate });
        const webview = container.querySelector('webview')!;

        await fireEvent(
          webview,
          Object.assign(new Event('did-navigate-in-page'), { url, isMainFrame: false }),
        );

        expect(onNavigate).not.toHaveBeenCalled();
        expect(webview.getAttribute('src')).toBe(mainUrl);

        await fireEvent(
          webview,
          Object.assign(new Event('did-navigate-in-page'), {
            url: `${mainUrl}#next`,
            isMainFrame: true,
          }),
        );
        expect(onNavigate).toHaveBeenCalledExactlyOnceWith(`${mainUrl}#next`);
        // Guest navigation must not be mirrored back as another application navigation.
        expect(webview.getAttribute('src')).toBe(mainUrl);
      },
    );

    it.each(['did-navigate', 'did-navigate-in-page'])(
      'preserves deliberate main-frame blank navigation via %s',
      async (eventType) => {
        const onNavigate = vi.fn();
        const { container } = renderPage({ onNavigate });
        const webview = container.querySelector('webview')!;
        const initialSrc = webview.getAttribute('src');

        await fireEvent(
          webview,
          Object.assign(new Event(eventType), { url: 'about:blank', isMainFrame: true }),
        );

        expect(onNavigate).toHaveBeenCalledExactlyOnceWith('about:blank');
        expect(webview.getAttribute('src')).toBe(initialSrc);
      },
    );

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
      mocks.selectMostRecentAgentTab.mockReturnValueOnce({
        type: 'agent',
        agentId: 'agent-focused',
      });
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

      await fireEvent.click(screen.getByTestId('browser-select-element'));
      await waitFor(() =>
        expect(screen.getByTestId('browser-select-element').getAttribute('aria-pressed')).toBe(
          'true',
        ),
      );
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
          targetAgentId: 'agent-focused',
          pageUrl: 'https://picked.test/settings',
          title: 'picked.test',
          viewport: { width: 1280, height: 800 },
          image: { data: 'cG5n', mimeType: 'image/png' },
          element,
        },
      });
      expect(captureActions()[0].payload.capture.image.data).not.toMatch(/^data:/);
      expect(atob(captureActions()[0].payload.capture.image.data)).toBe('png');
    });

    it('ignores a picked payload while the picker is inactive', async () => {
      const { webview } = await renderReadyBrowser();
      const element = {
        selector: '#save',
        domPath: 'html>body>button#save',
        tagName: 'button',
        id: 'save',
        className: '',
        textSnippet: 'Save',
        rect: { x: 10, y: 10, width: 100, height: 40 },
        pageUrl: 'https://picked.test/settings',
      };

      dispatchConsoleMessage(webview, 1, `__INTENT_ELEMENT_PICKED__:${JSON.stringify(element)}`);
      await Promise.resolve();

      expect(webview.capturePage).not.toHaveBeenCalled();
      expect(captureActions()).toHaveLength(0);
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

    it('makes collapsed controls reachable through overflow below 400px', async () => {
      ToolbarResizeObserver.instances = [];
      vi.stubGlobal('ResizeObserver', ToolbarResizeObserver);
      const onViewportChange = vi.fn();
      const { webview } = await renderReadyBrowser({ onViewportChange });
      const toolbarObserver = ToolbarResizeObserver.instances.find((observer) =>
        observer.target?.hasAttribute('data-browser-toolbar'),
      );

      toolbarObserver?.fire(399);
      await openOverflow();
      expect(screen.getByRole('menuitem', { name: 'Go back' })).toBeTruthy();
      expect(screen.getByRole('menuitem', { name: 'Go forward' })).toBeTruthy();
      const picker = screen.getByRole('menuitem', { name: 'Select an element from the page' });
      await fireEvent.click(picker);
      await waitFor(() =>
        expect(webview.executeJavaScript).toHaveBeenCalledWith(elementPickerScript),
      );

      await openOverflow();
      const viewportMenu = screen.getByRole('menuitem', { name: 'Viewport mode: Fit panel' });
      viewportMenu.focus();
      await fireEvent.keyDown(viewportMenu, { key: 'ArrowRight' });
      await fireEvent.click(await screen.findByRole('menuitemradio', { name: /iPhone SE/ }));
      expect(onViewportChange).toHaveBeenCalledWith({
        mode: 'preset',
        presetId: 'iphone-se',
        width: 375,
        height: 667,
      });
    });

    it('dispatches the visible page as a PNG capture without an element', async () => {
      const { webview } = await renderReadyBrowser({ ownerAgentId: 'agent-owner' });

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }));

      await waitFor(() => expect(webview.capturePage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(captureActions()).toHaveLength(1));
      const capture = captureActions()[0].payload.capture;
      expect(capture).toMatchObject({
        tabId: 'tab-1',
        targetAgentId: 'agent-owner',
        pageUrl: 'https://loaded.test/page',
        title: 'loaded.test',
        viewport: { width: 640, height: 400 },
        image: { data: 'cG5n', mimeType: 'image/png' },
      });
      expect(capture.image.data).not.toMatch(/^data:/);
      expect(atob(capture.image.data)).toBe('png');
      expect(capture).not.toHaveProperty('element');
    });

    it('shows an error and skips capture dispatch when no target agent exists', async () => {
      const { webview } = await renderReadyBrowser();

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }));

      await waitFor(() => expect(webview.capturePage).toHaveBeenCalledTimes(1));
      expect(captureActions()).toHaveLength(0);
      expect(notify.error).toHaveBeenCalledTimes(1);
    });

    it('targets the owner when no agent tab appears in focus history', async () => {
      const { webview } = await renderReadyBrowser({ ownerAgentId: 'agent-owner' });

      await openOverflow();
      await fireEvent.click(screen.getByRole('menuitem', { name: 'Screenshot' }));

      await waitFor(() => expect(webview.capturePage).toHaveBeenCalledTimes(1));
      await waitFor(() => expect(captureActions()).toHaveLength(1));
      expect(captureActions()[0].payload.capture).toMatchObject({
        ownerAgentId: 'agent-owner',
        targetAgentId: 'agent-owner',
      });
    });
  });
});
