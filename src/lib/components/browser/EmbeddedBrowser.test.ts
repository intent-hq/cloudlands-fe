import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('$store/renderer/slices/browser/browser-selectors', () => ({
  selectPendingBrowserZoom: () => null,
}));

vi.mock('$store/renderer/store', () => ({
  store: { dispatch: vi.fn() },
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

afterEach(cleanup);

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

    it('renders icon-only with no name text and no pill background', () => {
      const { container } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip="agent-1"]');
      expect(chip).not.toBeNull();
      expect(chip!.textContent?.trim()).toBe('');
      expect(chip!.querySelector('svg')).not.toBeNull();
      expect(chip!.classList.contains('bg-muted')).toBe(false);
      expect(chip!.classList.contains('rounded-full')).toBe(false);
    });

    it('exposes the agent name for hover/assistive tech', () => {
      const { container } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip]');
      expect(chip!.getAttribute('aria-label')).toContain('Coordinator');
    });

    it('sits in the actions group before the devtools toggle', () => {
      const { container, getByLabelText } = renderWithOwner();

      const chip = container.querySelector('[data-browser-owner-chip]')!;
      const devtools = getByLabelText('Toggle developer tools');
      const actions = devtools.closest('.gap-0\\.5');
      expect(actions?.contains(chip)).toBe(true);
      expect(
        chip.compareDocumentPosition(devtools) & Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    });

    it('navigates to the owning agent on click', async () => {
      const { container } = renderWithOwner();

      await fireEvent.click(container.querySelector('[data-browser-owner-chip]')!);
      expect(navigateToAgent).toHaveBeenCalledWith('agent-1');
    });

    it('is absent for unowned tabs', () => {
      const { container } = render(EmbeddedBrowser, {
        props: { url: 'about:blank', workspaceId: 'workspace-1' },
      });

      expect(container.querySelector('[data-browser-owner-chip]')).toBeNull();
    });

    it('keeps the viewport indicator pill unchanged', () => {
      const { container } = renderWithOwner({ emulatedSize: { width: 1280, height: 800 } });

      const indicator = container.querySelector('[data-browser-viewport-indicator]');
      expect(indicator).not.toBeNull();
      expect(indicator!.textContent).toContain('1280×800');
      expect(indicator!.className).toContain('bg-muted');
      expect(indicator!.className).toContain('rounded-full');
    });
  });
});
