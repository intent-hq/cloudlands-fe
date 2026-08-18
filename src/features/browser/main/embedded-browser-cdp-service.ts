/**
 * Embedded Browser CDP Service
 *
 * Provides CDP (Chrome DevTools Protocol) access to embedded browser webviews
 * via Electron's webContents.debugger API.
 *
 * This is a secure alternative to --remote-debugging-port as it doesn't expose
 * a network port - only the main process can access the debugger.
 */

import { webContents, ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('EmbeddedBrowserCdp');

/** How long (ms) before a tab lease is considered idle and the tab can be reused by another agent */
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

/**
 * How long (ms) to wait for a tab's webview to mount and register after an
 * openTab/focusTab request. Registration fires on the webview's dom-ready,
 * so slow page loads (e.g. dev servers over a tunnel) need a generous bound.
 */
const TAB_REGISTRATION_TIMEOUT_MS = 15_000;

interface TabInfo {
  tabId: string;
  webContentsId: number;
  url?: string;
  title?: string;
}

/** Browser tab info from panel layout (may not have webContentsId if unmounted) */
interface PanelBrowserTab {
  tabId: string;
  url: string;
  title: string;
  /** Whether the tab may be closed by the user/agent (defaults to true when absent) */
  closable?: boolean;
}

/** Tracks which agent is actively using a browser tab */
interface TabLease {
  agentId: string;
  lastUsedAt: number;
  /**
   * Original URL the agent asked to open, recorded when it differs from the
   * final URL (tunneled opens, where the final URL embeds an ephemeral
   * forward port). Backs the openTab requested-URL dedupe fallback
   * (intent-hq/monorepo#2787).
   */
  requestedUrl?: string;
}

/**
 * Service for managing CDP connections to embedded browser webviews.
 *
 * Responsibilities:
 * - Tab registry: tracks mounted webviews with live webContents
 * - Tab discovery: lists all browser tabs (mounted + unmounted) via panel layout
 * - CDP execution: runs scripts/commands on browser tabs via webContents.debugger
 * - Tab focus: brings unmounted tabs back to life by requesting UI switch
 */
class EmbeddedBrowserCdpService {
  /** Map of tabId -> webContentsId */
  private tabRegistry = new Map<string, number>();

  /** Set of webContentsIds that have debugger attached */
  private attachedDebuggers = new Set<number>();

  /**
   * Cache of browser tabs from panel layout (includes unmounted tabs),
   * keyed by the workspaceId the request targeted ('' for untargeted
   * broadcasts). Per-workspace keying keeps a timed-out request from
   * falling back to another workspace's tab list.
   */
  private panelBrowserTabsCache = new Map<string, PanelBrowserTab[]>();

  /** Pending resolvers for list-tabs requests, keyed by request ID */
  private pendingListTabsRequests = new Map<
    string,
    {
      workspaceId?: string;
      resolve: (tabs: PanelBrowserTab[]) => void;
      reject: (error: Error) => void;
    }
  >();

  /** Counter for generating unique request IDs */
  private listTabsRequestCounter = 0;

  /** Tracks which agent is using which tab. Key is tabId. */
  private tabLeases = new Map<string, TabLease>();

  /** Pending resolvers waiting for a tabId to register, keyed by tabId. */
  private registrationWaiters = new Map<string, Set<(registered: boolean) => void>>();

  constructor() {
    // Listen for browser tab list responses from renderer
    ipcMain.handle(
      IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE,
      (_event, data: { tabs?: PanelBrowserTab[]; requestId?: string; error?: string } | null) => {
        if (!data || typeof data !== 'object') return;
        logger.debug('Received browser tab list from renderer', {
          count: data.tabs?.length,
          requestId: data.requestId,
          error: data.error,
        });
        if (typeof data.error === 'string') {
          // Truthful error from the renderer (e.g. background layout
          // hydration failed, monorepo#2789): reject the matching request
          // instead of letting it time out as "renderer did not respond".
          // The cache is left untouched. Unlike the resolve path below, an
          // error without a requestId is deliberately dropped (no
          // reject-all-pending semantics): one window's hydration failure
          // must not fail other windows' healthy pending requests.
          if (data.requestId) {
            const pending = this.pendingListTabsRequests.get(data.requestId);
            if (pending) {
              this.pendingListTabsRequests.delete(data.requestId);
              pending.reject(new Error(data.error));
            }
          }
          return;
        }
        if (!Array.isArray(data.tabs)) return;
        const tabs = data.tabs;
        if (data.requestId) {
          // Resolve only the request this reply answers, so concurrent
          // requests for different workspaces never consume each other's
          // tab lists.
          const pending = this.pendingListTabsRequests.get(data.requestId);
          if (pending) {
            this.pendingListTabsRequests.delete(data.requestId);
            this.panelBrowserTabsCache.set(pending.workspaceId ?? '', tabs);
            pending.resolve(tabs);
          }
        } else {
          // Reply without a requestId — resolve all pending requests
          for (const [requestId, pending] of this.pendingListTabsRequests) {
            this.pendingListTabsRequests.delete(requestId);
            this.panelBrowserTabsCache.set(pending.workspaceId ?? '', tabs);
            pending.resolve(tabs);
          }
        }
      },
    );
  }

  /**
   * Request browser tab list from renderer and wait for response.
   *
   * Requires a workspaceId: an untargeted request used to broadcast to ALL
   * windows, letting a caller enumerate tabs in unrelated workspaces'
   * windows (intent-hq/monorepo#2602).
   *
   * Resolves `{ tabs, stale: false }` on a fresh renderer reply. When no
   * reply is coming (nothing received the request, or it timed out), the
   * same-workspace cache answers with `stale: true`; with no cache entry
   * either, this REJECTS instead of fabricating an empty list — "renderer
   * never answered" and "zero tabs" are different answers
   * (intent-hq/monorepo#2756 RC4).
   */
  async requestPanelBrowserTabs(
    workspaceId?: string,
  ): Promise<{ tabs: PanelBrowserTab[]; stale: boolean }> {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error('workspaceId is required to list browser tabs');
    }

    // Generate unique request ID to avoid race conditions
    const requestId = `req-${++this.listTabsRequestCounter}-${Date.now()}`;

    // Create promise that will be resolved when response arrives (or
    // rejected when the renderer reports a truthful error, monorepo#2789).
    const requestPromise = new Promise<{ tabs: PanelBrowserTab[]; stale: boolean }>(
      (resolve, reject) => {
        this.pendingListTabsRequests.set(requestId, {
          workspaceId,
          resolve: (tabs) => resolve({ tabs, stale: false }),
          reject,
        });
      },
    );

    // Send only to windows displaying the requested workspace. The renderer
    // echoes requestId back so the reply resolves this request specifically,
    // not whichever request happens to be pending.
    const delivery = sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST, {
      requestId,
      workspaceId,
    });
    if (!delivery.delivered) {
      // Nothing received the request, so no reply is coming — answer from the
      // same-workspace cache right away instead of waiting for the timeout.
      this.pendingListTabsRequests.delete(requestId);
      const cached = this.panelBrowserTabsCache.get(workspaceId);
      if (!cached) {
        throw new Error(
          // i18n-ignore (agent-facing protocol error, not user-facing)
          `Cannot list browser tabs: workspace ${workspaceId} is not open in any window.`,
        );
      }
      logger.warn('LIST_TABS_REQUEST reached no window; using cached data', {
        workspaceId,
        requestId,
      });
      return { tabs: cached, stale: true };
    }
    logger.debug('Sent LIST_TABS_REQUEST', { workspaceId, requestId });

    // Create per-request timeout promise. The fallback only consults the
    // cache entry for the SAME workspace target, so a timed-out request
    // never answers with another workspace's tab list; without a cache
    // entry it rejects instead of fabricating an empty list.
    const timeoutPromise = new Promise<{ tabs: PanelBrowserTab[]; stale: boolean }>(
      (resolve, reject) => {
        setTimeout(() => {
          if (!this.pendingListTabsRequests.has(requestId)) return;
          this.pendingListTabsRequests.delete(requestId);
          const cached = this.panelBrowserTabsCache.get(workspaceId);
          if (cached) {
            logger.warn('Browser tab list request timed out, using cached data', {
              requestId,
              workspaceId,
            });
            resolve({ tabs: cached, stale: true });
            return;
          }
          logger.warn('Browser tab list request timed out with no cached data', {
            requestId,
            workspaceId,
          });
          reject(
            new Error(
              // i18n-ignore (agent-facing protocol error, not user-facing)
              `Tab list for workspace ${workspaceId} is unavailable: the renderer did not respond and no cached tab list exists.`,
            ),
          );
        }, 500);
      },
    );

    // Race between response and timeout - each request gets independent timeout
    return Promise.race([requestPromise, timeoutPromise]);
  }

  /**
   * Register a browser tab for CDP access
   */
  registerTab(tabId: string, webContentsId: number): void {
    logger.info('Registering browser tab', { tabId, webContentsId });
    this.tabRegistry.set(tabId, webContentsId);

    // Resolve any callers waiting for this tab to mount (openTab/focusTab).
    const waiters = this.registrationWaiters.get(tabId);
    if (waiters) {
      this.registrationWaiters.delete(tabId);
      for (const resolve of waiters) resolve(true);
    }

    // Automatically clean up when webContents is destroyed. Only drop the
    // registry entry/lease if the tab still points at THIS webContents — a
    // tab handed off between hosts (offscreen keep-alive ↔ visible panel,
    // monorepo#2789) re-registers with a new webContentsId before the old
    // guest's destroyed event fires, and that newer mapping must survive.
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      wc.once('destroyed', () => {
        logger.info('WebContents destroyed, cleaning up tab registry', { tabId, webContentsId });
        if (this.tabRegistry.get(tabId) === webContentsId) {
          this.tabRegistry.delete(tabId);
          this.tabLeases.delete(tabId);
        }
        this.attachedDebuggers.delete(webContentsId);
      });
    }
  }

  /**
   * Wait for a tabId to register (its webview to mount and fire dom-ready).
   *
   * Resolves immediately when the tab is already registered with a live
   * webContents. Otherwise resolves `true` on the next `registerTab(tabId)`
   * call, or `false` after `timeoutMs` — never rejects, so callers can
   * degrade to a truthful failure message.
   */
  waitForTabRegistration(
    tabId: string,
    timeoutMs: number = TAB_REGISTRATION_TIMEOUT_MS,
  ): Promise<boolean> {
    if (this.resolveTabId(tabId) !== undefined) {
      return Promise.resolve(true);
    }
    return new Promise<boolean>((resolve) => {
      let waiters = this.registrationWaiters.get(tabId);
      if (!waiters) {
        waiters = new Set();
        this.registrationWaiters.set(tabId, waiters);
      }
      const settle = (registered: boolean) => {
        clearTimeout(timer);
        resolve(registered);
      };
      const timer = setTimeout(() => {
        const pending = this.registrationWaiters.get(tabId);
        if (pending) {
          pending.delete(settle);
          if (pending.size === 0) this.registrationWaiters.delete(tabId);
        }
        logger.warn('Timed out waiting for browser tab registration', { tabId, timeoutMs });
        settle(false);
      }, timeoutMs);
      waiters.add(settle);
    });
  }

  /**
   * Unregister a browser tab (called when tab is closed)
   */
  unregisterTab(tabId: string): void {
    const webContentsId = this.tabRegistry.get(tabId);
    if (webContentsId !== undefined) {
      logger.info('Unregistering browser tab', { tabId, webContentsId });
      this.detachDebugger(webContentsId);
      this.tabRegistry.delete(tabId);
      this.tabLeases.delete(tabId);
    }
  }

  /**
   * Get all browser tabs (discovers all webviews, not just registered ones)
   *
   * This uses webContents.getAllWebContents() to find all webviews dynamically,
   * which is more robust than relying on registration since tabs may be
   * unmounted/remounted by the panel caching system.
   */
  listTabs(): TabInfo[] {
    const tabs: TabInfo[] = [];
    const allWebContents = webContents.getAllWebContents();

    for (const wc of allWebContents) {
      // Only include webviews (not the main window or other webContents)
      if (wc.getType() === 'webview' && !wc.isDestroyed()) {
        const webContentsId = wc.id;

        // Try to find the registered tabId, or generate a fallback
        let tabId = this.findTabIdByWebContentsId(webContentsId);
        if (!tabId) {
          // Use a consistent fallback ID based on webContentsId
          tabId = `webview-${webContentsId}`;
        }

        tabs.push({
          tabId,
          webContentsId,
          url: wc.getURL(),
          title: wc.getTitle(),
        });
      }
    }
    return tabs;
  }

  /**
   * Find tabId by webContentsId (reverse lookup)
   */
  private findTabIdByWebContentsId(webContentsId: number): string | undefined {
    for (const [tabId, wcId] of this.tabRegistry) {
      if (wcId === webContentsId) {
        return tabId;
      }
    }
    return undefined;
  }

  /**
   * Get all browser tabs including unmounted ones from panel layout.
   * This is the preferred method for agents as it shows all tabs the user has open.
   *
   * The panel layout is the single source of truth for which tabs exist —
   * the same source closeTab() validates against — so every listed tab is a
   * valid closeTab target. Live webviews whose tabId is not in the panel
   * list (e.g. a tab closed in the UI whose webContents hasn't been torn
   * down yet, or a webview belonging to another workspace's layout) are NOT
   * listed: appending them used to resurrect UI-closed tabs as
   * `mounted: true` entries that closeTab then rejected as not found.
   *
   * Returns `{ tabs, stale }`: `stale: true` means the renderer did not
   * answer and the tabs came from the same-workspace cache. Rejects when
   * the tab list is unavailable (no reply AND no cache) — callers must not
   * treat that as "zero tabs" (intent-hq/monorepo#2756 RC4).
   *
   * Each tab carries:
   * - webContentsId: number if mounted (can run CDP commands)
   * - webContentsId: -1 if unmounted (need to focusTab first)
   */
  async listAllTabs(
    workspaceId?: string,
  ): Promise<{ tabs: (TabInfo & { mounted: boolean })[]; stale: boolean }> {
    // Get panel layout tabs (includes unmounted)
    const { tabs: panelTabs, stale } = await this.requestPanelBrowserTabs(workspaceId);

    // Get mounted webviews
    const mountedTabs = this.listTabs();

    const orphaned = mountedTabs.filter((t) => !panelTabs.some((p) => p.tabId === t.tabId));
    if (orphaned.length > 0) {
      logger.debug('Ignoring live webviews not present in panel layout', {
        tabIds: orphaned.map((t) => t.tabId),
        workspaceId,
      });
    }

    // Panel tabs only, marking whether each is backed by a live webview
    const tabs = panelTabs.map((panelTab) => {
      const mounted = mountedTabs.find((t) => t.tabId === panelTab.tabId);
      if (mounted) {
        return { ...mounted, mounted: true };
      }
      return {
        tabId: panelTab.tabId,
        webContentsId: -1, // Not mounted
        url: panelTab.url,
        title: panelTab.title,
        mounted: false,
      };
    });
    return { tabs, stale };
  }

  /**
   * Get the first available tab
   */
  getFirstTab(): TabInfo | null {
    const tabs = this.listTabs();
    return tabs.length > 0 ? tabs[0] : null;
  }

  /**
   * Focus a browser tab (bring it to the front in the UI) and wait for its
   * webview to actually mount and register.
   *
   * This sends an IPC message to the renderer to activate the tab, then
   * awaits the tab's `registerTab` (fired on the webview's dom-ready) so a
   * successful focus means the tab is genuinely addressable — remounting
   * unmounted tabs is the whole point of focusTab() (RC3,
   * intent-hq/monorepo#2756).
   *
   * Note: We don't validate the tabId here because the renderer's panel
   * layout knows about all tabs (including unmounted ones), so unknown tabs
   * simply never register and resolve false after the bounded wait.
   *
   * Requires a workspaceId: an untargeted focus used to broadcast to ALL
   * windows, so any window whose layout knew the tabId acted on it
   * regardless of the calling agent's workspace (intent-hq/monorepo#2602).
   *
   * @returns true when the tab is mounted and registered; false when the
   *          message reached no window or the tab never mounted within the
   *          bounded wait; throws when workspaceId is missing
   */
  async focusTab(tabId: string, workspaceId?: string): Promise<boolean> {
    if (!tabId) {
      logger.warn('Cannot focus tab - no tabId provided');
      return false;
    }
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error('workspaceId is required to focus a browser tab');
    }

    // Send only to windows displaying the requested workspace. Include
    // workspaceId so the renderer focuses the tab in the owning workspace's
    // panel layout, not whichever workspace is currently visible.
    const delivery = sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.FOCUS_TAB, {
      tabId,
      workspaceId,
    });
    if (!delivery.delivered) {
      logger.warn('Focus request for browser tab reached no window', { tabId, workspaceId });
      return false;
    }
    logger.info('Sent focus request for browser tab', { tabId, workspaceId });

    // Success means "the tab is now addressable": already-mounted tabs
    // resolve immediately, unmounted-but-listed tabs resolve when the
    // remounted webview registers, and nonexistent tabs time out to false.
    return this.waitForTabRegistration(tabId);
  }

  /**
   * Tell the renderer that main navigated an existing tab (agent `navigate`
   * or an openTab reuse branch) so the panel layout persists the new URL and
   * its pre-rewrite requested URL — otherwise only the webview's
   * `did-navigate` fires and a rewritten navigation would persist just the
   * ephemeral tunneled URL, restoring a dead port after restart
   * (monorepo#2789). Fire-and-forget: an undelivered event only means the
   * layout keeps the webview-reported URL, matching pre-notify behavior.
   */
  notifyTabNavigated(
    tabId: string,
    workspaceId?: string,
    url?: string,
    requestedUrl?: string,
  ): void {
    if (!tabId || typeof workspaceId !== 'string' || workspaceId.length === 0 || !url) return;
    sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.TAB_NAVIGATED, {
      tabId,
      workspaceId,
      url,
      ...(requestedUrl === undefined ? {} : { requestedUrl }),
    });
  }

  /**
   * Close a browser tab (remove it from the panel layout in the UI).
   *
   * Validates against the panel layout's tab list first so unknown /
   * already-closed tabs and non-closable tabs fail with a descriptive error
   * instead of silently no-oping, then confirms the renderer actually removed
   * the tab before reporting success — the renderer intentionally ignores
   * closes for tabs that vanished or became non-closable after the pre-check,
   * and no window may receive the event at all. On success the renderer
   * removes the tab; unmounting the webview fires the `destroyed` hook from
   * registerTab, which cleans the registry, debugger attachment, and lease —
   * we also clean up proactively here for the unmounted-tab case.
   *
   * @returns the closed tabId on success; throws on unknown or non-closable
   *          tabs, or when the close could not be confirmed
   */
  async closeTab(tabId: string, workspaceId?: string): Promise<{ tabId: string }> {
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      throw new Error('workspaceId is required to close a browser tab');
    }
    const { tabs: panelTabs, stale } = await this.requestPanelBrowserTabs(workspaceId);
    const tab = panelTabs.find((t) => t.tabId === tabId);
    if (!tab) {
      if (stale) {
        // A stale cache that lacks the tab proves nothing about whether it
        // is closed — only a fresh renderer reply can (monorepo#2756 RC4).
        throw new Error(
          // i18n-ignore (agent-facing protocol error, not user-facing)
          `Cannot close tab ${tabId}: the tab list for workspace ${workspaceId} is unavailable (the renderer did not respond), so whether the tab exists cannot be determined.`,
        );
      }
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error(`Tab ${tabId} not found. It may already be closed.`);
    }
    if (tab.closable === false) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error(`Tab ${tabId} is not closable.`);
    }

    // Send only to windows displaying the requested workspace. Include
    // workspaceId so the renderer closes the tab in the owning workspace's
    // panel layout, not whichever workspace is currently visible.
    const delivery = sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.CLOSE_TAB, {
      tabId,
      workspaceId,
    });
    if (!delivery.delivered) {
      throw new Error(
        `Cannot close tab ${tabId}: workspace ${workspaceId} is not open in any window.`, // i18n-ignore (agent-facing protocol error, not user-facing)
      );
    }
    logger.info('Sent close request for browser tab', { tabId, workspaceId });

    // Confirm the renderer removed the tab. If no window received the event,
    // the fresh list request times out to the (still-uncleaned) cache; if the
    // renderer ignored the close, the tab is still in the reply — either way
    // the tab remains listed and we fail instead of claiming success. Only a
    // fresh (non-stale) reply without the tab counts as confirmation.
    let confirmed = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const after = await this.requestPanelBrowserTabs(workspaceId);
      if (!after.stale && !after.tabs.some((t) => t.tabId === tabId)) {
        confirmed = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    if (!confirmed) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error(`Tab ${tabId} could not be closed (the UI did not confirm the close).`);
    }

    // Proactive CDP cleanup: detach debugger, drop registry entry and lease.
    // For mounted tabs the webContents `destroyed` hook covers this too, but
    // unmounted tabs have no webContents to fire it.
    this.unregisterTab(tabId);
    for (const [key, tabs] of this.panelBrowserTabsCache) {
      this.panelBrowserTabsCache.set(
        key,
        tabs.filter((t) => t.tabId !== tabId),
      );
    }

    return { tabId };
  }

  /**
   * Resolve a tabId to webContentsId, using both registry and discovery
   */
  private resolveTabId(tabId: string): number | undefined {
    // First try the registry (for registered tabs)
    const fromRegistry = this.tabRegistry.get(tabId);
    if (fromRegistry !== undefined) {
      const wc = webContents.fromId(fromRegistry);
      if (wc && !wc.isDestroyed()) {
        return fromRegistry;
      }
    }

    // Fall back to discovery (for tabs like "webview-5")
    if (tabId.startsWith('webview-')) {
      const webContentsId = parseInt(tabId.replace('webview-', ''), 10);
      const wc = webContents.fromId(webContentsId);
      if (wc && !wc.isDestroyed() && wc.getType() === 'webview') {
        return webContentsId;
      }
    }

    return undefined;
  }

  /**
   * Attach debugger to a webContents if not already attached.
   * Handles the case where another service (e.g., BrowserCaptureService) already attached.
   */
  private async attachDebugger(webContentsId: number): Promise<void> {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`WebContents ${webContentsId} not found or destroyed`);
    }

    // Check both our tracking AND the actual debugger state
    // Another service might have attached without us knowing
    if (this.attachedDebuggers.has(webContentsId)) {
      return;
    }

    // Check if already attached by someone else (e.g., BrowserCaptureService)
    if (wc.debugger.isAttached()) {
      // Just update our tracking - the debugger is already usable
      this.attachedDebuggers.add(webContentsId);
      logger.info('Debugger already attached (by another service), tracking it', { webContentsId });
      return;
    }

    try {
      // Wrap attach operation with timeout to prevent indefinite blocking
      await Promise.race([
        new Promise<void>((resolve) => {
          wc.debugger.attach('1.3');
          resolve();
        }),
        new Promise<void>((_, reject) =>
          setTimeout(() => reject(new Error('Debugger attach timeout')), 5000),
        ),
      ]);

      this.attachedDebuggers.add(webContentsId);
      logger.info('Attached debugger', { webContentsId });

      // Clean up when debugger detaches
      wc.debugger.on('detach', (_event, reason) => {
        logger.info('Debugger detached', { webContentsId, reason });
        this.attachedDebuggers.delete(webContentsId);
      });
    } catch (error) {
      // Handle race condition: debugger might have been attached between our check and attach
      const errMsg = (error as Error).message || '';
      if (errMsg.includes('already attached')) {
        // That's fine - just track it
        this.attachedDebuggers.add(webContentsId);
        logger.info('Debugger attached by another service (race), tracking it', { webContentsId });
        return;
      }
      logger.error('Failed to attach debugger', { webContentsId, error });
      throw error;
    }
  }

  /**
   * Detach debugger from a webContents
   */
  private detachDebugger(webContentsId: number): void {
    if (!this.attachedDebuggers.has(webContentsId)) {
      return;
    }

    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      try {
        wc.debugger.detach();
      } catch {
        // Ignore errors during detach
      }
    }
    this.attachedDebuggers.delete(webContentsId);
  }

  /**
   * Force detach debugger from a webContents, regardless of our tracking state.
   * Use this to recover from stale CDP connections.
   * Returns true if a detach was attempted.
   */
  forceDetachDebugger(webContentsId: number): boolean {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      // Still clear our tracking state
      this.attachedDebuggers.delete(webContentsId);
      return false;
    }

    let didDetach = false;

    // Always try to detach, regardless of isAttached() or our tracking
    try {
      wc.debugger.detach();
      didDetach = true;
      logger.info('Force detached debugger', { webContentsId });
    } catch (err) {
      // May fail if not attached, that's fine
      logger.debug('Force detach failed (may not be attached)', {
        webContentsId,
        error: (err as Error).message,
      });
    }

    // Clear our tracking state
    this.attachedDebuggers.delete(webContentsId);

    return didDetach;
  }

  // ============================================================
  // TAB LEASE MANAGEMENT - Tracks which agent is using which tab
  // ============================================================

  /**
   * Record that an agent is actively using a tab.
   * Call this on every action that targets a tab to keep the lease fresh.
   *
   * `requestedUrl` records the agent's original requested URL (tunneled
   * opens): a string sets it, `null` clears it (the tab was repurposed for a
   * new non-tunneled target, so a stale identity must not linger), and
   * omitting it preserves a previously recorded value so plain refreshes
   * (screenshots, evaluates) don't erase it.
   */
  touchLease(tabId: string, agentId: string, requestedUrl?: string | null): void {
    const recorded =
      requestedUrl === null ? undefined : (requestedUrl ?? this.tabLeases.get(tabId)?.requestedUrl);
    this.tabLeases.set(tabId, {
      agentId,
      lastUsedAt: Date.now(),
      ...(recorded !== undefined ? { requestedUrl: recorded } : {}),
    });
  }

  /**
   * Release a tab lease (e.g., when an agent is done with a tab).
   */
  releaseLease(tabId: string): void {
    this.tabLeases.delete(tabId);
  }

  /**
   * Check if a tab is currently leased by an active agent.
   * A lease is considered active if it was touched within IDLE_TIMEOUT_MS.
   */
  private isTabLeased(tabId: string): boolean {
    const lease = this.tabLeases.get(tabId);
    if (!lease) return false;
    return Date.now() - lease.lastUsedAt < IDLE_TIMEOUT_MS;
  }

  /**
   * Find a mounted browser tab that is idle (not actively leased by any agent)
   * and atomically claim it for the requesting agent.
   *
   * Returns the tabId if found, undefined otherwise.
   *
   * The lease is touched immediately so that concurrent callers won't
   * get the same tab (avoids race conditions across async boundaries).
   *
   * Only considers tabs that have a previous lease entry (i.e., were previously
   * used by an agent). Tabs opened manually by the user are never reused.
   *
   * Prefers tabs previously used by the requesting agent, then falls back to
   * any other agent's expired-lease tab.
   */
  findIdleTab(requestingAgentId: string): string | undefined {
    const mountedTabs = this.listTabs();
    if (mountedTabs.length === 0) return undefined;

    // First pass: find a tab previously used by this agent (expired lease = idle)
    for (const tab of mountedTabs) {
      const lease = this.tabLeases.get(tab.tabId);
      if (lease && lease.agentId === requestingAgentId && !this.isTabLeased(tab.tabId)) {
        logger.info('Claiming idle tab previously used by requesting agent', {
          tabId: tab.tabId,
          agentId: requestingAgentId,
        });
        this.touchLease(tab.tabId, requestingAgentId);
        return tab.tabId;
      }
    }

    // Second pass: find any agent-opened tab with an expired lease.
    // Tabs without a lease entry (user-opened) are never reused.
    for (const tab of mountedTabs) {
      const lease = this.tabLeases.get(tab.tabId);
      if (lease && !this.isTabLeased(tab.tabId)) {
        logger.info('Claiming idle tab for reuse (previously used by another agent)', {
          tabId: tab.tabId,
          previousAgentId: lease.agentId,
          requestingAgentId,
        });
        this.touchLease(tab.tabId, requestingAgentId);
        return tab.tabId;
      }
    }

    return undefined;
  }

  /**
   * Find a mounted, model-opened tab whose current URL exactly matches the
   * requested URL, and claim it for the requesting agent.
   *
   * Used by openTab dedupe (intent-hq/monorepo#2541): opening a URL the
   * model already has open focuses the existing tab instead of creating a
   * duplicate.
   *
   * Candidates are restricted to tabs present in the requesting workspace's
   * panel layout (the same source of truth listAllTabs/closeTab use), so a
   * matching tab in another workspace is never reused or focused. Only tabs
   * with a lease entry (i.e. opened or used by an agent) are considered —
   * tabs the user opened are never returned, so the model can never hijack
   * a user tab. A tab actively leased by a different agent is skipped so
   * one agent never steals another's in-use tab. Matching is exact string
   * equality on the live webview URL — no normalization.
   */
  async findModelTabByExactUrl(
    url: string,
    requestingAgentId: string,
    workspaceId?: string,
  ): Promise<string | undefined> {
    // Dedupe is best-effort: an unavailable tab list just means no reusable
    // tab was found — it must not fail the enclosing openTab.
    let tabs: (TabInfo & { mounted: boolean })[];
    try {
      ({ tabs } = await this.listAllTabs(workspaceId));
    } catch (error) {
      logger.debug('Tab list unavailable during openTab dedupe; skipping reuse', {
        workspaceId,
        error: (error as Error).message,
      });
      return undefined;
    }
    for (const tab of tabs) {
      if (!tab.mounted || tab.url !== url) continue;
      const lease = this.tabLeases.get(tab.tabId);
      if (!lease) continue; // user-opened tab — never reuse
      if (lease.agentId !== requestingAgentId && this.isTabLeased(tab.tabId)) continue;
      logger.info('Found model-opened tab with exact URL match', {
        tabId: tab.tabId,
        url,
        previousAgentId: lease.agentId,
        requestingAgentId,
        workspaceId,
      });
      this.touchLease(tab.tabId, requestingAgentId);
      return tab.tabId;
    }
    return undefined;
  }

  /**
   * Find a mounted, model-opened tab whose lease recorded the given
   * requested URL, and claim it for the requesting agent.
   *
   * Fallback for openTab dedupe on tunneled opens (intent-hq/monorepo#2787):
   * when the tunnel forward was re-minted, the final URL differs per call and
   * {@link findModelTabByExactUrl} can never match — but the agent's original
   * requested URL is stable, so the lease-recorded requestedUrl identifies
   * the logical duplicate. Same safety rules as the exact-URL variant:
   * candidates come from the requesting workspace's panel layout only,
   * user-opened tabs (no lease) are never returned, and a tab actively
   * leased by a different agent is skipped.
   */
  async findModelTabByRequestedUrl(
    requestedUrl: string,
    requestingAgentId: string,
    workspaceId?: string,
  ): Promise<string | undefined> {
    // Dedupe is best-effort: an unavailable tab list just means no reusable
    // tab was found — it must not fail the enclosing openTab.
    let tabs: (TabInfo & { mounted: boolean })[];
    try {
      ({ tabs } = await this.listAllTabs(workspaceId));
    } catch (error) {
      logger.debug('Tab list unavailable during requestedUrl dedupe; skipping reuse', {
        workspaceId,
        error: (error as Error).message,
      });
      return undefined;
    }
    for (const tab of tabs) {
      if (!tab.mounted) continue;
      const lease = this.tabLeases.get(tab.tabId);
      if (!lease || lease.requestedUrl !== requestedUrl) continue;
      if (lease.agentId !== requestingAgentId && this.isTabLeased(tab.tabId)) continue;
      logger.info('Found model-opened tab with matching requested URL', {
        tabId: tab.tabId,
        requestedUrl,
        previousAgentId: lease.agentId,
        requestingAgentId,
        workspaceId,
      });
      this.touchLease(tab.tabId, requestingAgentId);
      return tab.tabId;
    }
    return undefined;
  }

  // ============================================================
  // PUBLIC CDP API - Use these instead of accessing wc.debugger directly
  // ============================================================

  /**
   * Ensure debugger is attached to a webContents.
   * Safe to call multiple times - will only attach once.
   */
  async ensureAttached(webContentsId: number): Promise<void> {
    await this.attachDebugger(webContentsId);
  }

  /**
   * Send a CDP command to a webContents.
   * Automatically attaches debugger if needed.
   */
  async sendCdpCommand(
    webContentsId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    return this.sendCommand(webContentsId, method, params);
  }

  /**
   * Subscribe to CDP messages from a webContents.
   * Returns a cleanup function to unsubscribe.
   */
  onCdpMessage(
    webContentsId: number,
    handler: (method: string, params: unknown) => void,
  ): () => void {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`WebContents ${webContentsId} not found or destroyed`);
    }

    const wrappedHandler = (_event: Electron.Event, method: string, params: unknown) => {
      handler(method, params);
    };

    wc.debugger.on('message', wrappedHandler);

    return () => {
      if (!wc.isDestroyed()) {
        wc.debugger.off('message', wrappedHandler);
      }
    };
  }

  /**
   * Check if debugger is currently attached to a webContents.
   */
  isDebuggerAttached(webContentsId: number): boolean {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      return false;
    }
    return wc.debugger.isAttached();
  }

  /**
   * Send a CDP command to a webContents
   */
  private async sendCommand(
    webContentsId: number,
    method: string,
    params?: Record<string, unknown>,
  ): Promise<unknown> {
    await this.attachDebugger(webContentsId);

    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`WebContents ${webContentsId} not found or destroyed`);
    }

    return wc.debugger.sendCommand(method, params);
  }

  /**
   * Get the accessibility tree for a tab
   */
  async getAccessibilityTree(tabId?: string): Promise<string> {
    const webContentsId = tabId ? this.resolveTabId(tabId) : this.getFirstTab()?.webContentsId;

    if (webContentsId === undefined) {
      throw new Error(
        tabId
          ? `Tab ${tabId} is not mounted. If it exists (check { action: "listTabs" }), { action: "focusTab", tabId: "${tabId}" } will remount it; if focusTab also fails, no tab with this id exists.` // i18n-ignore (agent-facing protocol error, not user-facing)
          : 'No browser tabs available. Open a browser tab in the app first.', // i18n-ignore (agent-facing protocol error, not user-facing)
      );
    }

    // Enable accessibility domain
    await this.sendCommand(webContentsId, 'Accessibility.enable');

    // Get the full accessibility tree
    const result = (await this.sendCommand(webContentsId, 'Accessibility.getFullAXTree')) as {
      nodes: Array<{
        nodeId: string;
        role?: { value: string };
        name?: { value: string };
        childIds?: string[];
      }>;
    };

    // Convert to a simple YAML-like format (similar to uisnap)
    return this.formatAccessibilityTree(result.nodes);
  }

  /**
   * Format accessibility nodes as YAML-like string
   */
  private formatAccessibilityTree(
    nodes: Array<{
      nodeId: string;
      role?: { value: string };
      name?: { value: string };
      childIds?: string[];
    }>,
  ): string {
    // Build a map for quick lookup
    const nodeMap = new Map(nodes.map((n) => [n.nodeId, n]));

    // Find root nodes (nodes that aren't children of any other node)
    const childIds = new Set(nodes.flatMap((n) => n.childIds || []));
    const rootNodes = nodes.filter((n) => !childIds.has(n.nodeId));

    const lines: string[] = [];

    const formatNode = (node: (typeof nodes)[0], indent: number): void => {
      const role = node.role?.value || 'unknown';
      const name = node.name?.value || '';
      const prefix = '  '.repeat(indent);

      if (name) {
        lines.push(`${prefix}- ${role}: "${name}"`);
      } else {
        lines.push(`${prefix}- ${role}`);
      }

      // Process children
      for (const childId of node.childIds || []) {
        const child = nodeMap.get(childId);
        if (child) {
          formatNode(child, indent + 1);
        }
      }
    };

    for (const root of rootNodes) {
      formatNode(root, 0);
    }

    return lines.join('\n');
  }

  /**
   * Take a screenshot of a tab
   */
  async screenshot(tabId?: string): Promise<{ base64: string; width: number; height: number }> {
    const webContentsId = tabId ? this.resolveTabId(tabId) : this.getFirstTab()?.webContentsId;

    if (webContentsId === undefined) {
      throw new Error(
        tabId
          ? `Tab ${tabId} is not mounted. If it exists (check { action: "listTabs" }), { action: "focusTab", tabId: "${tabId}" } will remount it; if focusTab also fails, no tab with this id exists.` // i18n-ignore (agent-facing protocol error, not user-facing)
          : 'No browser tabs available. Open a browser tab in the app first.', // i18n-ignore (agent-facing protocol error, not user-facing)
      );
    }

    // Get layout metrics to determine viewport size.
    // layoutViewport reflects the page's internal layout (may exceed visible area
    // if the page sets min-width larger than the panel).
    // cssVisualViewport reflects the actual visible area the user sees.
    // We cap to whichever is smaller so screenshots match the panel bounds.
    const layoutMetrics = (await this.sendCommand(webContentsId, 'Page.getLayoutMetrics')) as {
      layoutViewport: { clientWidth: number; clientHeight: number };
      cssVisualViewport?: {
        clientWidth: number;
        clientHeight: number;
        pageX: number;
        pageY: number;
      };
    };

    const layoutW = layoutMetrics.layoutViewport.clientWidth;
    const layoutH = layoutMetrics.layoutViewport.clientHeight;
    const visualW = layoutMetrics.cssVisualViewport?.clientWidth;
    const visualH = layoutMetrics.cssVisualViewport?.clientHeight;

    // Use scroll offsets from cssVisualViewport so the screenshot captures
    // what the user currently sees, not the document origin.
    const scrollX = layoutMetrics.cssVisualViewport?.pageX ?? 0;
    const scrollY = layoutMetrics.cssVisualViewport?.pageY ?? 0;

    // Use the smaller of layout vs visual viewport so a narrow panel
    // produces a narrow screenshot instead of capturing off-screen content.
    const width = visualW && visualW > 0 ? Math.min(layoutW, visualW) : layoutW;
    const height = visualH && visualH > 0 ? Math.min(layoutH, visualH) : layoutH;

    const result = (await this.sendCommand(webContentsId, 'Page.captureScreenshot', {
      format: 'jpeg',
      quality: 80,
      clip: {
        x: scrollX,
        y: scrollY,
        width,
        height,
        scale: 1,
      },
    })) as { data: string };

    return {
      base64: result.data,
      width,
      height,
    };
  }

  /**
   * Evaluate JavaScript in a tab
   */
  async evaluate(tabId: string | undefined, expression: string): Promise<unknown> {
    const webContentsId = tabId ? this.resolveTabId(tabId) : this.getFirstTab()?.webContentsId;

    if (webContentsId === undefined) {
      throw new Error(
        tabId
          ? `Tab ${tabId} is not mounted. If it exists (check { action: "listTabs" }), { action: "focusTab", tabId: "${tabId}" } will remount it; if focusTab also fails, no tab with this id exists.` // i18n-ignore (agent-facing protocol error, not user-facing)
          : 'No browser tabs available. Open a browser tab in the app first.', // i18n-ignore (agent-facing protocol error, not user-facing)
      );
    }

    const result = (await this.sendCommand(webContentsId, 'Runtime.evaluate', {
      expression,
      returnByValue: true,
    })) as { result: { value: unknown } };

    return result.result.value;
  }
}

// Singleton instance
export const embeddedBrowserCdp = new EmbeddedBrowserCdpService();
