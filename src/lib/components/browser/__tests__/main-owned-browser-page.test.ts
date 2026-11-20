import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { BrowserViewEventMessage } from '$shared/types/browser-view';

const CH = IPC_CHANNELS.BROWSER_VIEW;

type Invoke = (channel: string, payload?: any) => Promise<unknown>;

let invoke: ReturnType<typeof vi.fn<Invoke>>;
let emitEvent: (message: BrowserViewEventMessage) => void;
let pageState: Record<string, unknown> | null;

async function load() {
  vi.resetModules();
  return import('../main-owned-browser-page');
}

function flush() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

beforeEach(() => {
  pageState = null;
  invoke = vi.fn<Invoke>(async (channel, payload) => {
    switch (channel) {
      case CH.GET_LAB:
        return { enabled: true, active: true };
      case CH.STATE:
        return { state: pageState };
      case CH.CREATE:
        return pageState
          ? { webContentsId: pageState.webContentsId, existing: true }
          : { webContentsId: 41, existing: false };
      case CH.COMMAND:
        if (payload.command.type === 'execute-javascript') return { value: 'done' };
        if (payload.command.type === 'capture') return { dataUrl: 'data:image/png;base64,AA' };
        return {};
      default:
        return {};
    }
  });
  (window as unknown as { electronAPI: unknown }).electronAPI = {
    invoke,
    on: vi.fn((_channel: string, callback: (message: BrowserViewEventMessage) => void) => {
      emitEvent = callback;
      return 'listener-1';
    }),
    offById: vi.fn(),
  };
});

afterEach(() => {
  delete (window as { electronAPI?: unknown }).electronAPI;
});

const OPTIONS = { tabId: 'tab-1', workspaceId: 'ws-1', url: 'https://a.test/' };

describe('browser pages Labs mode', () => {
  it('stays on the <webview> path until main answers, then keeps the run value', async () => {
    const page = await load();
    const modes: string[] = [];
    page.browserPagesMode.subscribe((mode) => modes.push(mode));
    expect(modes).toEqual(['unknown']);

    await page.loadBrowserViewsLab();
    expect(modes.at(-1)).toBe('main');

    invoke.mockImplementationOnce(async () => ({ enabled: false, active: true }));
    await page.setBrowserViewsLabEnabled(false);
    // Saved for the next run; this run keeps main-owned pages.
    expect(modes.at(-1)).toBe('main');
  });

  it('uses <webview> when the setting cannot be read', async () => {
    invoke.mockRejectedValueOnce(new Error('no handler'));
    const page = await load();
    await page.loadBrowserViewsLab();
    let mode = '';
    page.browserPagesMode.subscribe((value) => (mode = value))();
    expect(mode).toBe('webview');
  });
});

describe('attachMainOwnedPage', () => {
  it('creates a page and fires dom-ready with the new webContents id', async () => {
    const page = await load();
    const node = document.createElement('div');
    const domReady = vi.fn();
    node.addEventListener('dom-ready', domReady);

    const handle = page.attachMainOwnedPage(node, OPTIONS);
    expect(() => handle.webview.getWebContentsId()).toThrow();
    await flush();

    expect(invoke).toHaveBeenCalledWith(CH.CREATE, OPTIONS);
    expect(domReady).toHaveBeenCalledTimes(1);
    expect(handle.webview.getWebContentsId()).toBe(41);
    expect(handle.ready).toBe(true);
    expect(page.knownMainOwnedPages().get('tab-1')).toBe('ws-1');
  });

  it('reuses a live page and replays its state without loading it again', async () => {
    pageState = {
      webContentsId: 7,
      url: 'https://live.test/b',
      title: 'Live',
      loading: false,
      canGoBack: true,
      canGoForward: false,
      zoomFactor: 1.2,
    };
    const page = await load();
    const node = document.createElement('div');
    const seen: string[] = [];
    for (const type of ['did-navigate-in-page', 'page-title-updated', 'did-stop-loading']) {
      node.addEventListener(type, () => seen.push(type));
    }

    const handle = page.attachMainOwnedPage(node, OPTIONS);
    await flush();

    // The create call claims the live page for this window; it does not load it.
    expect(invoke).toHaveBeenCalledWith(CH.CREATE, OPTIONS);
    expect(handle.webview.getWebContentsId()).toBe(7);
    expect(handle.webview.getURL?.()).toBe('https://live.test/b');
    expect(handle.webview.canGoBack()).toBe(true);
    expect(handle.webview.getZoomLevel()).toBeCloseTo(1);
    expect(seen).toEqual(['did-navigate-in-page', 'page-title-updated', 'did-stop-loading']);
  });

  it('turns page events into the <webview> events EmbeddedBrowser reads', async () => {
    const page = await load();
    const node = document.createElement('div');
    const events: Array<Record<string, unknown>> = [];
    for (const type of [
      'did-navigate',
      'did-navigate-in-page',
      'did-fail-load',
      'console-message',
      'destroyed',
    ]) {
      node.addEventListener(type, (event) => events.push({ ...(event as object), type }));
    }
    const handle = page.attachMainOwnedPage(node, OPTIONS);
    await flush();
    const send = (event: BrowserViewEventMessage['event']) =>
      emitEvent({ tabId: 'tab-1', workspaceId: 'ws-1', event });

    send({ type: 'navigated', url: 'https://a.test/x', canGoBack: true, canGoForward: false });
    send({
      type: 'navigated',
      url: 'https://a.test/x#y',
      canGoBack: true,
      canGoForward: false,
      inPage: true,
    });
    send({ type: 'load-failed', url: 'https://b.test/', errorCode: -105, errorDescription: 'DNS' });
    send({ type: 'console-message', level: 'error', message: '' });
    send({
      type: 'shortcut',
      shortcut: {
        action: 'forward',
        key: ']',
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      },
    });
    send({
      type: 'shortcut',
      shortcut: {
        action: 'refresh',
        key: 'r',
        shiftKey: false,
        metaKey: true,
        ctrlKey: false,
        altKey: false,
      },
    });
    // Another tab's events are not ours.
    emitEvent({ tabId: 'tab-2', workspaceId: 'ws-1', event: { type: 'page-closed' } });
    send({ type: 'page-closed' });

    expect(events).toEqual([
      expect.objectContaining({ type: 'did-navigate', url: 'https://a.test/x' }),
      expect.objectContaining({
        type: 'did-navigate-in-page',
        url: 'https://a.test/x#y',
        isMainFrame: true,
      }),
      expect.objectContaining({
        type: 'did-fail-load',
        errorCode: -105,
        validatedURL: 'https://b.test/',
        isMainFrame: true,
      }),
      expect.objectContaining({ type: 'console-message', level: 3 }),
      expect.objectContaining({
        type: 'console-message',
        message: '__INTENT_PANEL_BRACKET__:]:0:1:0:0',
      }),
      expect.objectContaining({ type: 'console-message', message: '__INTENT_REFRESH__' }),
      expect.objectContaining({ type: 'destroyed' }),
    ]);
    expect(handle.webview.canGoBack()).toBe(true);
    // A closed page behaves like a dead guest for EmbeddedBrowser's probe.
    expect(() => handle.webview.getURL?.()).toThrow();
    expect(handle.ready).toBe(false);
    expect(page.knownMainOwnedPages().has('tab-1')).toBe(false);
  });

  it('drives the page by command, holding control commands until it is ready', async () => {
    const page = await load();
    const node = document.createElement('div');
    const handle = page.attachMainOwnedPage(node, OPTIONS);
    // Before the page exists: queued, not lost.
    handle.webview.setAudioMuted?.(true);
    expect(invoke).not.toHaveBeenCalledWith(CH.COMMAND, expect.anything());
    await flush();
    await flush();
    expect(invoke).toHaveBeenCalledWith(CH.COMMAND, {
      tabId: 'tab-1',
      command: { type: 'set-audio-muted', muted: true },
    });

    await expect(handle.webview.executeJavaScript('1')).resolves.toBe('done');
    const image = await handle.webview.capturePage?.({ x: 0, y: 0, width: 5, height: 5 });
    expect(image?.toDataURL()).toBe('data:image/png;base64,AA');
    handle.webview.setZoomLevel(1);
    node.focus();
    await flush();
    expect(invoke).toHaveBeenCalledWith(CH.COMMAND, {
      tabId: 'tab-1',
      command: { type: 'set-zoom', factor: 1.2 },
    });
    expect(invoke).toHaveBeenCalledWith(CH.COMMAND, { tabId: 'tab-1', command: { type: 'focus' } });
  });

  it('settles loadURL when the page stops loading, and rejects on a failed load', async () => {
    const page = await load();
    const node = document.createElement('div');
    const handle = page.attachMainOwnedPage(node, OPTIONS);
    await flush();
    const send = (event: BrowserViewEventMessage['event']) =>
      emitEvent({ tabId: 'tab-1', workspaceId: 'ws-1', event });

    const ok = handle.webview.loadURL('https://a.test/next');
    send({ type: 'loading', loading: true });
    send({ type: 'loading', loading: false });
    await expect(ok).resolves.toBeUndefined();

    const failed = handle.webview.loadURL('https://down.test/');
    send({
      type: 'load-failed',
      url: 'https://down.test/',
      errorCode: -102,
      errorDescription: 'Refused',
    });
    await expect(failed).rejects.toThrow('Refused');
    expect(invoke).toHaveBeenCalledWith(CH.COMMAND, {
      tabId: 'tab-1',
      command: { type: 'navigate', url: 'https://down.test/' },
    });
  });

  it('leaves a page another window drives alone when it only keeps pages alive', async () => {
    invoke.mockImplementation(async (channel) =>
      channel === CH.CREATE ? { webContentsId: 9, existing: true, elsewhere: true } : {},
    );
    const page = await load();
    const node = document.createElement('div');
    const domReady = vi.fn();
    node.addEventListener('dom-ready', domReady);
    const handle = page.attachMainOwnedPage(node, { ...OPTIONS, keepAlive: true });
    await flush();

    expect(invoke).toHaveBeenCalledWith(CH.CREATE, { ...OPTIONS, keepAlive: true });
    expect(invoke).not.toHaveBeenCalledWith(CH.STATE, expect.anything());
    expect(domReady).not.toHaveBeenCalled();
    expect(handle.elsewhere).toBe(true);
    expect(handle.ready).toBe(false);
    expect(page.knownMainOwnedPages().has('tab-1')).toBe(false);
  });

  it('reports a create failure as a failed load', async () => {
    invoke.mockImplementation(async () => {
      throw new Error('Browser views in main are off');
    });
    const page = await load();
    const node = document.createElement('div');
    const failed = vi.fn();
    node.addEventListener('did-fail-load', failed);
    page.attachMainOwnedPage(node, OPTIONS);
    await flush();
    expect(failed).toHaveBeenCalledWith(
      expect.objectContaining({ errorDescription: 'Browser views in main are off' }),
    );
  });
});
