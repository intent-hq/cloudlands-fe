import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { tick } from 'svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { m } from '$shared/paraglide/messages.js';
import BrowserViewerTab from './BrowserViewerTab.svelte';

const CANONICAL = 'https://intentapp.dev/docs';
const host = { name: 'office-linux', connected: true };

/** Mount the mirror over a jsdom `<webview>` stub whose guest methods are spies. */
function mountViewer() {
  const onNavigate = vi.fn().mockResolvedValue(undefined);
  const { container, rerender } = render(BrowserViewerTab, {
    props: { url: CANONICAL, host, onNavigate },
  });
  const guest = container.querySelector('webview') as HTMLElement & {
    loadURL: ReturnType<typeof vi.fn>;
  };
  const loadURL = vi.fn().mockResolvedValue(undefined);
  Object.assign(guest, {
    loadURL,
    canGoBack: () => false,
    canGoForward: () => false,
    setAudioMuted: vi.fn(),
  });
  const emit = async (type: string, detail: Record<string, unknown> = {}) => {
    guest.dispatchEvent(Object.assign(new Event(type), detail));
    await tick();
  };
  return { guest, loadURL, onNavigate, emit, rerender };
}

async function submitAddress(value: string) {
  await fireEvent.click(
    screen.getByRole('button', { name: m.browser_embedded_editAddress_ariaLabel() }),
  );
  const input = screen.getByRole('textbox', { name: m.browser_embedded_addressInput_ariaLabel() });
  await fireEvent.input(input, { target: { value } });
  await fireEvent.submit(input.closest('form')!);
}

describe('BrowserViewerTab', () => {
  afterEach(cleanup);

  it('requests an address-bar URL on the host even when the mirror cannot load it', async () => {
    const { loadURL, onNavigate, emit } = mountViewer();
    await emit('dom-ready');
    await emit('did-navigate', { url: CANONICAL });
    await emit('did-stop-loading');
    loadURL.mockRejectedValue(new Error('ERR_CONNECTION_REFUSED'));

    await submitAddress('localhost:9876/remote-only');
    await emit('did-fail-load', { isMainFrame: true });

    expect(loadURL).toHaveBeenCalledWith('http://localhost:9876/remote-only');
    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith('http://localhost:9876/remote-only');
  });

  it('does not forward the navigations of its own address-bar load', async () => {
    const { loadURL, onNavigate, emit } = mountViewer();
    await emit('dom-ready');
    await emit('did-navigate', { url: CANONICAL });
    await emit('did-stop-loading');
    // `loadURL` resolves on `did-finish-load`, after the load's navigations.
    let finishLoad!: () => void;
    loadURL.mockReturnValue(new Promise<void>((resolve) => (finishLoad = resolve)));

    await submitAddress('https://intentapp.dev/dashboard');
    await emit('did-navigate', { url: 'https://intentapp.dev/dashboard' });
    await emit('did-navigate', { url: 'https://intentapp.dev/login' });
    finishLoad();
    await tick();
    await emit('did-navigate', { url: 'https://intentapp.dev/account' });

    expect(onNavigate.mock.calls).toEqual([
      ['https://intentapp.dev/dashboard'],
      ['https://intentapp.dev/account'],
    ]);
  });

  it('returns to the canonical URL when the host rejects an address request before the mirror load committed', async () => {
    const { loadURL, onNavigate, emit } = mountViewer();
    await emit('dom-ready');
    await emit('did-navigate', { url: CANONICAL });
    await emit('did-stop-loading');
    // `loadURL` settles on `did-finish-load` / `did-fail-load`, after the navigations.
    let abortLoad!: (error: Error) => void;
    let finishRevert!: () => void;
    loadURL
      .mockReturnValueOnce(new Promise<void>((_, reject) => (abortLoad = reject)))
      .mockReturnValueOnce(new Promise<void>((resolve) => (finishRevert = resolve)));
    let rejectRequest!: (error: Error) => void;
    onNavigate.mockReturnValueOnce(new Promise<void>((_, reject) => (rejectRequest = reject)));

    await submitAddress('https://intentapp.dev/settings');
    rejectRequest(new Error('host refused'));
    await vi.waitFor(() => expect(loadURL).toHaveBeenLastCalledWith(CANONICAL));
    abortLoad(new Error('ERR_ABORTED'));
    await tick();
    await emit('did-navigate', { url: CANONICAL });
    finishRevert();
    await tick();

    expect(loadURL.mock.calls).toEqual([['https://intentapp.dev/settings'], [CANONICAL]]);
    expect(onNavigate).toHaveBeenCalledTimes(1);
  });

  it('asks the host for an address typed before the webview is ready and follows its echo once ready', async () => {
    const { loadURL, onNavigate, emit, rerender } = mountViewer();

    await submitAddress('https://intentapp.dev/settings');
    expect(onNavigate).toHaveBeenCalledWith('https://intentapp.dev/settings');
    expect(loadURL).not.toHaveBeenCalled();

    await rerender({ url: 'https://intentapp.dev/settings', host, onNavigate });
    await emit('did-navigate', { url: CANONICAL });
    await emit('dom-ready');
    await emit('did-stop-loading');

    expect(loadURL.mock.calls).toEqual([['https://intentapp.dev/settings']]);
  });

  it('does not forward guest navigations while the host is offline and returns to the canonical URL', async () => {
    const { loadURL, onNavigate, emit, rerender } = mountViewer();
    await emit('dom-ready');
    await emit('did-navigate', { url: CANONICAL });
    await emit('did-stop-loading');

    await rerender({ url: CANONICAL, host: { ...host, connected: false }, onNavigate });
    await emit('did-navigate-in-page', { url: `${CANONICAL}#keyboard`, isMainFrame: true });
    await emit('did-navigate', { url: 'https://intentapp.dev/elsewhere' });
    await tick();

    expect(onNavigate).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(loadURL).toHaveBeenCalledWith(CANONICAL));
  });

  it('forwards an in-page navigation the user makes while the initial load is still open', async () => {
    const { onNavigate, emit } = mountViewer();
    await emit('did-navigate', { url: CANONICAL });
    await emit('dom-ready');

    await emit('did-navigate-in-page', { url: `${CANONICAL}#install`, isMainFrame: true });
    await emit('did-navigate-in-page', { url: `${CANONICAL}#frame`, isMainFrame: false });
    await emit('did-stop-loading');

    expect(onNavigate).toHaveBeenCalledTimes(1);
    expect(onNavigate).toHaveBeenCalledWith(`${CANONICAL}#install`);
  });
});
