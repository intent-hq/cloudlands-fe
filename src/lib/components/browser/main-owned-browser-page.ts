/**
 * Renderer side of main-owned browser pages (Labs: "Browser pages in the
 * main process").
 *
 * With the setting on, main owns each browser tab's page as a
 * `WebContentsView` (BrowserViewService). The renderer only shows a box
 * (BrowserViewSlot) and drives the page by IPC.
 *
 * `attachMainOwnedPage` gives the slot's element the `<webview>` methods and
 * events that EmbeddedBrowser uses, so the browser tab's logic (address bar,
 * history, find, zoom, element picker, captures, shortcuts) is the same on
 * both paths. Main's page events arrive on one channel and are sent here as
 * the matching `<webview>` DOM events.
 *
 * Lives outside components per the no-component-async-data-fetch boundary.
 */
import { writable, type Readable } from 'svelte/store';
import { createLogger } from '$lib/utils/client-logger';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import type { BrowserViewShortcut } from '$shared/browser-view-shortcuts';
import type {
  BrowserViewCommand,
  BrowserViewCommandResult,
  BrowserViewEventMessage,
  BrowserViewPageEvent,
  BrowserViewRect,
  BrowserViewState,
} from '$shared/types/browser-view';
import { formatForwardedPanelShortcut } from './browser-keyboard-interceptor';
import type { BrowserCaptureRect } from './element-picker-coordinates';
import type { EmbeddedBrowserWebview } from './embedded-browser-webview';

const logger = createLogger('MainOwnedBrowserPage');
const CHANNELS = IPC_CHANNELS.BROWSER_VIEW;

/** Chromium's zoom step: factor = 1.2 ^ level. */
const ZOOM_LEVEL_BASE = 1.2;

// ---------------------------------------------------------------------------
// Labs setting
// ---------------------------------------------------------------------------

/** Which path shows browser pages in this run. `unknown` until main answers. */
export type BrowserPagesMode = 'unknown' | 'webview' | 'main';

export interface BrowserViewsLabState {
  /** The saved setting (what the next run uses). */
  enabled: boolean;
  /** The setting this run started with (what this run uses). */
  active: boolean;
}

type Bridge = NonNullable<Window['electronAPI']>;

function bridge(): Bridge | undefined {
  return typeof window === 'undefined' ? undefined : window.electronAPI;
}

const modeStore = writable<BrowserPagesMode>(bridge() ? 'unknown' : 'webview');
const labStore = writable<BrowserViewsLabState>({ enabled: false, active: false });
let modeValue: BrowserPagesMode = bridge() ? 'unknown' : 'webview';
let labLoad: Promise<void> | null = null;

/** The path browser tabs use in this run. */
export const browserPagesMode: Readable<BrowserPagesMode> = { subscribe: modeStore.subscribe };
/** The Labs setting (saved and active values). */
export const browserViewsLab: Readable<BrowserViewsLabState> = { subscribe: labStore.subscribe };

function applyLab(state: BrowserViewsLabState): void {
  labStore.set(state);
  if (modeValue === 'unknown') {
    modeValue = state.active ? 'main' : 'webview';
    modeStore.set(modeValue);
  }
}

/** Read the Labs setting once. A failed read keeps the `<webview>` path. */
export function loadBrowserViewsLab(): Promise<void> {
  if (labLoad) return labLoad;
  const api = bridge();
  if (!api) {
    applyLab({ enabled: false, active: false });
    labLoad = Promise.resolve();
    return labLoad;
  }
  labLoad = api
    .invoke(CHANNELS.GET_LAB)
    .then((result: Partial<BrowserViewsLabState> | undefined) => {
      applyLab({ enabled: result?.enabled === true, active: result?.active === true });
    })
    .catch((error: unknown) => {
      logger.warn('Could not read the browser pages Labs setting', { error });
      applyLab({ enabled: false, active: false });
    });
  return labLoad;
}

/** Save the Labs setting. It applies after a restart. */
export async function setBrowserViewsLabEnabled(enabled: boolean): Promise<void> {
  const api = bridge();
  if (!api) return;
  try {
    const result = (await api.invoke(CHANNELS.SET_LAB, { enabled })) as
      | Partial<BrowserViewsLabState>
      | undefined;
    labStore.set({ enabled: result?.enabled === true, active: result?.active === true });
  } catch (error) {
    logger.warn('Could not save the browser pages Labs setting', { error });
  }
}

// ---------------------------------------------------------------------------
// Pages this renderer knows main holds (tabId → workspaceId)
// ---------------------------------------------------------------------------

const knownPages = new Map<string, string>();

/** Tabs whose page this renderer created or found alive in main. */
export function knownMainOwnedPages(): ReadonlyMap<string, string> {
  return knownPages;
}

// ---------------------------------------------------------------------------
// IPC
// ---------------------------------------------------------------------------

function invoke<T>(channel: string, payload: unknown): Promise<T> {
  const api = bridge();
  if (!api) return Promise.reject(new Error('Browser pages need the desktop app'));
  return api.invoke(channel, payload) as Promise<T>;
}

/** Create (or reuse) a tab's page in this window. */
export function createMainOwnedPage(request: {
  tabId: string;
  workspaceId: string;
  url: string;
  pinned?: boolean;
}): Promise<{ webContentsId: number }> {
  return invoke<{ webContentsId: number }>(CHANNELS.CREATE, request).then((result) => {
    knownPages.set(request.tabId, request.workspaceId);
    return result;
  });
}

/** Close a tab's page (the tab closed or left the off-screen set). */
export function destroyMainOwnedPage(tabId: string): Promise<void> {
  knownPages.delete(tabId);
  return invoke<unknown>(CHANNELS.DESTROY, { tabId }).then(() => undefined);
}

export function readMainOwnedPageState(
  tabId: string,
  workspaceId?: string,
): Promise<BrowserViewState | null> {
  return invoke<{ state: BrowserViewState | null } | undefined>(CHANNELS.STATE, { tabId }).then(
    (result) => {
      const state = result?.state ?? null;
      if (state && workspaceId) knownPages.set(tabId, workspaceId);
      return state;
    },
  );
}

export function setMainOwnedPagePlacement(
  tabId: string,
  rect: BrowserViewRect | null,
  visible: boolean,
): Promise<unknown> {
  return invoke(CHANNELS.SET_PLACEMENT, { tabId, rect, visible });
}

export function detachMainOwnedPage(tabId: string): Promise<unknown> {
  return invoke(CHANNELS.DETACH, { tabId });
}

export function commandMainOwnedPage(
  tabId: string,
  command: BrowserViewCommand,
): Promise<BrowserViewCommandResult> {
  return invoke<BrowserViewCommandResult | undefined>(CHANNELS.COMMAND, { tabId, command }).then(
    (result) => result ?? {},
  );
}

// ---------------------------------------------------------------------------
// Page events: one channel, keyed by tabId
// ---------------------------------------------------------------------------

type PageListener = (event: BrowserViewPageEvent) => void;
const listeners = new Map<string, Set<PageListener>>();
let channelListenerId: string | undefined;

function ensureChannel(): void {
  const api = bridge();
  if (channelListenerId || !api) return;
  channelListenerId = api.on(CHANNELS.EVENT, (message: BrowserViewEventMessage) => {
    if (!message || typeof message.tabId !== 'string') return;
    const type = message.event?.type;
    if (type === 'page-closed' || type === 'closed-offscreen') knownPages.delete(message.tabId);
    for (const listener of listeners.get(message.tabId) ?? []) {
      try {
        listener(message.event);
      } catch (error) {
        logger.warn('Browser page event handler failed', { tabId: message.tabId, error });
      }
    }
  });
}

/** Listen to one tab's page events. Returns the unsubscribe function. */
export function onMainOwnedPageEvent(tabId: string, listener: PageListener): () => void {
  ensureChannel();
  let set = listeners.get(tabId);
  if (!set) {
    set = new Set();
    listeners.set(tabId, set);
  }
  set.add(listener);
  return () => {
    const current = listeners.get(tabId);
    current?.delete(listener);
    if (current?.size === 0) listeners.delete(tabId);
  };
}

/**
 * @internal Test seam: deliver a page event as if main sent it.
 */
export function deliverMainOwnedPageEventForTest(message: BrowserViewEventMessage): void {
  for (const listener of listeners.get(message.tabId) ?? []) listener(message.event);
}

// ---------------------------------------------------------------------------
// The `<webview>`-shaped adapter
// ---------------------------------------------------------------------------

/** The `<webview>` console protocol message for an app shortcut typed in the page. */
export function shortcutConsoleMessage(shortcut: BrowserViewShortcut): string {
  switch (shortcut.action) {
    case 'close-tab':
      return '__INTENT_CLOSE_TAB__';
    case 'refresh':
      return '__INTENT_REFRESH__';
    case 'focus-url':
      return '__INTENT_FOCUS_URL__';
    case 'copy-url':
      return '__INTENT_COPY_URL__';
    case 'devtools':
      return '__INTENT_DEVTOOLS__';
    case 'forward':
      return formatForwardedPanelShortcut(shortcut);
  }
}

export interface MainOwnedPageOptions {
  tabId: string;
  workspaceId: string;
  /** The URL a new page loads. A live page keeps its own URL. */
  url: string;
  pinned?: boolean;
}

export interface MainOwnedPageHandle {
  /** The element, now with the `<webview>` methods EmbeddedBrowser calls. */
  readonly webview: EmbeddedBrowserWebview;
  /** Whether main has a live page for the tab. */
  readonly ready: boolean;
  /** Stop listening and take the page off screen. The page stays alive in main. */
  dispose(): void;
}

interface CachedState {
  webContentsId: number | undefined;
  url: string;
  canGoBack: boolean;
  canGoForward: boolean;
  zoomFactor: number;
  loading: boolean;
  /** The page ended (window.close()): calls behave like a dead guest. */
  closed: boolean;
}

function emitDomEvent(node: HTMLElement, type: string, fields: Record<string, unknown> = {}): void {
  const event = new Event(type);
  Object.assign(event, fields);
  node.dispatchEvent(event);
}

/**
 * Give `node` the `<webview>` methods and events for the tab's main-owned
 * page, creating the page if main has none. Placement is the slot's job.
 */
export function attachMainOwnedPage(
  node: HTMLElement,
  options: MainOwnedPageOptions,
): MainOwnedPageHandle {
  const { tabId } = options;
  const state: CachedState = {
    webContentsId: undefined,
    url: options.url,
    canGoBack: false,
    canGoForward: false,
    zoomFactor: 1,
    loading: false,
    closed: false,
  };
  let disposed = false;
  let ready = false;
  /** Loads started by loadURL, settled when the page stops loading. */
  let pendingLoads: Array<{ resolve: () => void; reject: (error: Error) => void }> = [];

  let markReady: () => void = () => {};
  const whenReady = new Promise<void>((resolve) => (markReady = resolve));
  const send = (command: BrowserViewCommand): Promise<BrowserViewCommandResult> =>
    commandMainOwnedPage(tabId, command);
  /** Control commands wait for the page (mute, zoom, focus can come first). */
  const fireAndForget = (command: BrowserViewCommand): void => {
    void whenReady
      .then(() => (disposed ? {} : send(command)))
      .catch((error: unknown) =>
        logger.debug('Browser page command failed', { tabId, type: command.type, error }),
      );
  };
  const settleLoads = (error?: Error): void => {
    const loads = pendingLoads;
    pendingLoads = [];
    for (const load of loads) {
      if (error) load.reject(error);
      else load.resolve();
    }
  };

  const handleEvent = (event: BrowserViewPageEvent): void => {
    if (disposed) return;
    switch (event.type) {
      case 'loading':
        state.loading = event.loading;
        emitDomEvent(node, event.loading ? 'did-start-loading' : 'did-stop-loading');
        if (!event.loading) settleLoads();
        return;
      case 'navigated':
        state.url = event.url;
        state.canGoBack = event.canGoBack;
        state.canGoForward = event.canGoForward;
        if (event.inPage) {
          emitDomEvent(node, 'did-navigate-in-page', { url: event.url, isMainFrame: true });
        } else {
          emitDomEvent(node, 'did-navigate', { url: event.url });
        }
        return;
      case 'title':
        emitDomEvent(node, 'page-title-updated', { title: event.title });
        return;
      case 'favicon':
        emitDomEvent(node, 'page-favicon-updated', { favicons: event.favicons });
        return;
      case 'load-failed':
        emitDomEvent(node, 'did-fail-load', {
          errorCode: event.errorCode,
          errorDescription: event.errorDescription,
          validatedURL: event.url,
          isMainFrame: true,
        });
        settleLoads(new Error(event.errorDescription || 'The page did not load'));
        return;
      case 'crashed':
        logger.warn('Browser page process ended', { tabId, reason: event.reason });
        return;
      case 'focused':
        emitDomEvent(node, 'focus');
        return;
      case 'console-message':
        emitDomEvent(node, 'console-message', {
          level: event.level === 'error' ? 3 : 1,
          message: event.message,
        });
        return;
      case 'shortcut':
        emitDomEvent(node, 'console-message', {
          level: 1,
          message: shortcutConsoleMessage(event.shortcut),
        });
        return;
      case 'page-closed':
      case 'closed-offscreen':
        state.closed = true;
        ready = false;
        settleLoads(new Error('The page closed'));
        emitDomEvent(node, 'destroyed');
        return;
      case 'context-menu':
        return;
    }
  };
  const unsubscribe = onMainOwnedPageEvent(tabId, handleEvent);

  const requireLive = (): void => {
    if (state.closed) throw new Error('The page closed');
  };

  const methods: Partial<EmbeddedBrowserWebview> = {
    canGoBack: () => state.canGoBack,
    canGoForward: () => state.canGoForward,
    goBack: () => fireAndForget({ type: 'back' }),
    goForward: () => fireAndForget({ type: 'forward' }),
    reload: () => fireAndForget({ type: 'reload' }),
    reloadIgnoringCache: () => fireAndForget({ type: 'reload', ignoreCache: true }),
    stop: () => fireAndForget({ type: 'stop' }),
    loadURL: (url: string) => {
      requireLive();
      return new Promise<void>((resolve, reject) => {
        pendingLoads.push({ resolve, reject });
        send({ type: 'navigate', url }).catch((error: unknown) => {
          const index = pendingLoads.findIndex((load) => load.resolve === resolve);
          if (index >= 0) pendingLoads.splice(index, 1);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });
    },
    executeJavaScript: async (code: string) => {
      requireLive();
      const result = await send({ type: 'execute-javascript', code });
      return result.value;
    },
    openDevTools: () => fireAndForget({ type: 'open-devtools' }),
    closeDevTools: () => fireAndForget({ type: 'toggle-devtools' }),
    isDevToolsOpened: () => false,
    toggleDevTools: () => fireAndForget({ type: 'toggle-devtools' }),
    getURL: () => {
      requireLive();
      return state.url;
    },
    getWebContentsId: () => {
      if (state.webContentsId === undefined) throw new Error('The page is not ready');
      return state.webContentsId;
    },
    getZoomFactor: () => state.zoomFactor,
    setZoomFactor: (factor: number) => {
      state.zoomFactor = factor;
      fireAndForget({ type: 'set-zoom', factor });
    },
    getZoomLevel: () => Math.log(state.zoomFactor) / Math.log(ZOOM_LEVEL_BASE),
    setZoomLevel: (level: number) => {
      state.zoomFactor = Math.pow(ZOOM_LEVEL_BASE, level);
      fireAndForget({ type: 'set-zoom', factor: state.zoomFactor });
    },
    setAudioMuted: (muted: boolean) => fireAndForget({ type: 'set-audio-muted', muted }),
    capturePage: async (rect?: BrowserCaptureRect) => {
      requireLive();
      const result = await send(rect ? { type: 'capture', rect } : { type: 'capture' });
      const dataUrl = result.dataUrl ?? '';
      if (!dataUrl) throw new Error('The page drew nothing to capture');
      return { toDataURL: () => dataUrl };
    },
  };
  node.dataset.mainOwnedPage = tabId;
  for (const [name, value] of Object.entries(methods)) {
    Object.defineProperty(node, name, { value, configurable: true, writable: true });
  }
  // EmbeddedBrowser focuses the page with `webviewRef.focus()`.
  Object.defineProperty(node, 'focus', {
    value: () => fireAndForget({ type: 'focus' }),
    configurable: true,
    writable: true,
  });
  Object.defineProperty(node, 'src', {
    get: () => state.url,
    set: () => {},
    configurable: true,
  });

  void (async () => {
    try {
      const existing = await readMainOwnedPageState(tabId, options.workspaceId);
      if (disposed) return;
      if (existing) {
        state.webContentsId = existing.webContentsId;
        state.url = existing.url || state.url;
        state.canGoBack = existing.canGoBack;
        state.canGoForward = existing.canGoForward;
        state.zoomFactor = existing.zoomFactor;
        state.loading = existing.loading;
      } else {
        const created = await createMainOwnedPage({
          tabId,
          workspaceId: options.workspaceId,
          url: options.url,
          ...(options.pinned === undefined ? {} : { pinned: options.pinned }),
        });
        if (disposed) return;
        state.webContentsId = created.webContentsId;
      }
      ready = true;
      markReady();
      emitDomEvent(node, 'dom-ready');
      if (existing) {
        // A live page: replay what the tab's controls show.
        emitDomEvent(node, 'did-navigate-in-page', { url: state.url, isMainFrame: true });
        if (existing.title) emitDomEvent(node, 'page-title-updated', { title: existing.title });
        emitDomEvent(node, state.loading ? 'did-start-loading' : 'did-stop-loading');
      }
    } catch (error) {
      if (disposed) return;
      logger.warn('Could not open the browser page', { tabId, error });
      emitDomEvent(node, 'did-fail-load', {
        errorCode: -2,
        errorDescription: error instanceof Error ? error.message : String(error),
        validatedURL: options.url,
        isMainFrame: true,
      });
    }
  })();

  return {
    webview: node as EmbeddedBrowserWebview,
    get ready() {
      return ready && !state.closed;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      delete node.dataset.mainOwnedPage;
      settleLoads(new Error('The browser tab was closed'));
    },
  };
}
