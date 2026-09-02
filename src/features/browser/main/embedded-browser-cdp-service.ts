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
import {
  isBrowserEmulatedSize,
  isBrowserTabViewport,
  type BrowserTabViewport,
} from '../../../shared/ipc/workspace-command-payloads';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('EmbeddedBrowserCdp');

/**
 * Default emulated viewport for agent-owned tabs whose size is unknown
 * (agent openTab without an explicit width, or ownership rehydrated from a
 * persisted layout after restart) — the standard desktop viewport
 * (monorepo#2857).
 */
export const DEFAULT_AGENT_VIEWPORT = { width: 1280, height: 800 } as const;

/**
 * Emulated viewport dimension bounds for agent-owned tabs (docs/protocol
 * §5.9). Live openTab/claimTab/resizeTab requests are validated against
 * these by the action schema; rehydration from a persisted layout clamps
 * into the same range so a hand-edited/corrupt layout file cannot replay
 * extreme sizes into CDP emulation (monorepo#2857).
 */
export const AGENT_VIEWPORT_MIN_PX = 320;
export const AGENT_VIEWPORT_MAX_PX = 3840;

function clampViewportDimension(px: number): number {
  return Math.min(AGENT_VIEWPORT_MAX_PX, Math.max(AGENT_VIEWPORT_MIN_PX, Math.round(px)));
}

/**
 * How long (ms) to wait for a tab's webview to mount and register after an
 * openTab/focusTab request. Registration fires on the webview's dom-ready,
 * so slow page loads (e.g. dev servers over a tunnel) need a generous bound.
 */
const TAB_REGISTRATION_TIMEOUT_MS = 15_000;

/**
 * How long (ms) to wait for the Page-domain screenshot CDP commands
 * (Page.getLayoutMetrics / Page.captureScreenshot) before falling back to
 * webContents.capturePage(). On some guests the debugger's Page domain never
 * answers even while Runtime/Accessibility commands work, hanging screenshot
 * until the caller's budget kills it (intent-hq/monorepo#3154).
 */
const SCREENSHOT_CDP_TIMEOUT_MS = 5_000;

/**
 * How long (ms) to wait for the webContents.capturePage() fallback. On a
 * guest whose compositor produces no frames (e.g. viewport-culled or
 * occluded surfaces) capturePage() never settles, so an unbounded fallback
 * would eat the caller's whole reverse-request budget after the CDP path
 * already burned its timeouts (intent-hq/monorepo#3366).
 */
const SCREENSHOT_CAPTURE_PAGE_TIMEOUT_MS = 5_000;

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
  /** Persisted owner when the tab is agent-owned (monorepo#2857); null/absent = unowned. */
  ownerAgentId?: string | null;
  /**
   * Persisted emulated viewport when the tab is agent-owned (monorepo#2857);
   * absent on unowned tabs and on layouts persisted before sizes were
   * recorded (those rehydrate at the default viewport).
   */
  emulatedSize?: { width: number; height: number };
  /** Persisted viewport mode; absent legacy values default to fit. */
  viewport?: BrowserTabViewport;
  /**
   * The tab is in the workspace's hidden set (monorepo#3045): alive and
   * CDP-addressable offscreen, but not mounted into any panel. Only
   * agent-owned tabs can be hidden; absent = visible.
   */
  hidden?: boolean;
}

/**
 * Persistent ownership record for an agent-owned tab (monorepo#2857).
 * Replaces the former time-based TabLease: ownership never expires and is
 * never transferred — it ends only when the tab is genuinely closed (or the
 * owning agent is deleted; lifecycle handled separately).
 */
interface TabOwnership {
  ownerAgentId: string;
  /**
   * Original URL the agent asked to open, recorded when it differs from the
   * final URL (tunneled opens, where the final URL embeds an ephemeral
   * forward port). Backs the openTab requested-URL dedupe fallback
   * (intent-hq/monorepo#2787).
   */
  requestedUrl?: string;
  /** Emulated viewport size (owned tabs are always emulated, monorepo#2857). */
  emulatedSize: { width: number; height: number };
}

/** Result of an atomic claim attempt (monorepo#2857). */
type ClaimTabResult =
  | { status: 'claimed'; alreadyOwned: boolean }
  | { status: 'already-claimed'; ownerAgentId: string };

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

  /**
   * Persistent tab ownership registry (monorepo#2857). Key is tabId. Main is
   * the atomic claim arbiter; the renderer persists `ownerAgentId` on the
   * panel-layout tab, and {@link hydrateOwnershipFromPanelTabs} re-seeds this
   * map from renderer replies after a restart.
   */
  private tabOwnership = new Map<string, TabOwnership>();

  /** Per-tab viewport mode for owned and unowned tabs. */
  private tabViewports = new Map<string, BrowserTabViewport>();

  /**
   * Agents whose owned tabs were destroyed via {@link clearAgentTabs}
   * (deletion committed, monorepo#2857). An in-flight LIST_TABS_RESPONSE
   * produced before the renderer purge could otherwise re-hydrate their
   * ownership records; hydration skips tombstoned owners.
   */
  private clearedAgentTombstones = new Set<string>();

  /** Pending resolvers waiting for a tabId to register, keyed by tabId. */
  private registrationWaiters = new Map<string, Set<(registered: boolean) => void>>();

  /**
   * Renderer-reported bounds (CSS px) of each tab's visible webview element,
   * keyed by tabId. Used to scale-to-fit emulated (agent-owned) tabs when
   * they are visible in a panel — the emulated viewport keeps its size, only
   * the displayed image is scaled (docs/protocol §5.9). Entries are dropped
   * with the registration when the backing webContents is destroyed and
   * re-reported on remount.
   */
  private tabViewBounds = new Map<string, { width: number; height: number }>();

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
        // Drop tabs owned by tombstoned (deletion-committed) agents: a
        // reply produced before the renderer purge must not re-enter the
        // cache or re-hydrate ownership (monorepo#2857).
        const tabs = data.tabs.filter(
          (tab) =>
            typeof tab.ownerAgentId !== 'string' ||
            !this.clearedAgentTombstones.has(tab.ownerAgentId),
        );
        // Re-seed the ownership registry from the renderer's persisted
        // layout so ownership survives an app restart (monorepo#2857).
        this.hydrateOwnershipFromPanelTabs(tabs);
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

    // Owned tabs are always emulated (docs/protocol §5.9): (re)apply the
    // recorded viewport on every registration so emulation survives
    // unmount/remount and offscreen↔visible host handoffs.
    this.applyViewportEmulation(tabId);

    // Resolve any callers waiting for this tab to mount (openTab/focusTab).
    const waiters = this.registrationWaiters.get(tabId);
    if (waiters) {
      this.registrationWaiters.delete(tabId);
      for (const resolve of waiters) resolve(true);
    }

    // Automatically clean up when webContents is destroyed. Only drop the
    // registry entry if the tab still points at THIS webContents — a tab
    // handed off between hosts (offscreen keep-alive ↔ visible panel,
    // monorepo#2789) re-registers with a new webContentsId before the old
    // guest's destroyed event fires, and that newer mapping must survive.
    // Ownership is deliberately NOT cleared here: a destroyed webContents
    // also happens on unmount (panel caching), and ownership is persistent —
    // it ends only on a confirmed tab close (monorepo#2857).
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      wc.once('destroyed', () => {
        logger.info('WebContents destroyed, cleaning up tab registry', { tabId, webContentsId });
        if (this.tabRegistry.get(tabId) === webContentsId) {
          this.tabRegistry.delete(tabId);
          // Bounds belong to the destroyed webview element; a remount
          // re-reports them.
          this.tabViewBounds.delete(tabId);
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
   * Whether a tab currently has a live, CDP-addressable webContents
   * (registered, or discoverable via a `webview-<id>` fallback id). Capture
   * ops consult this before deciding to mount the tab on demand
   * (intent-hq/monorepo#4103).
   */
  isTabMounted(tabId: string): boolean {
    return this.resolveTabId(tabId) !== undefined;
  }

  /**
   * Unregister a browser tab (called when tab is closed).
   * Ownership is NOT cleared here — unregistration also covers unmounts;
   * use {@link clearTabOwnership} on a genuine close (monorepo#2857).
   */
  unregisterTab(tabId: string): void {
    const webContentsId = this.tabRegistry.get(tabId);
    if (webContentsId !== undefined) {
      logger.info('Unregistering browser tab', { tabId, webContentsId });
      this.detachDebugger(webContentsId);
      this.tabRegistry.delete(tabId);
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
  async listAllTabs(workspaceId?: string): Promise<{
    tabs: (TabInfo & {
      mounted: boolean;
      ownerAgentId?: string;
      emulatedSize?: { width: number; height: number };
      viewport: BrowserTabViewport;
      hidden?: boolean;
    })[];
    stale: boolean;
  }> {
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

    // Panel tabs only, marking whether each is backed by a live webview.
    // Each tab is annotated with its owner from the ownership registry
    // (rehydrated from the panel reply above) so agents can see which tabs
    // they may manipulate (monorepo#2857), and with `hidden` when the tab
    // sits in the workspace's hidden set (monorepo#3045).
    const tabs = panelTabs.map((panelTab) => {
      const ownership = this.tabOwnership.get(panelTab.tabId);
      const owner = ownership
        ? { ownerAgentId: ownership.ownerAgentId, emulatedSize: ownership.emulatedSize }
        : {};
      const hidden = panelTab.hidden === true ? { hidden: true } : {};
      const viewport = this.tabViewports.get(panelTab.tabId) ?? { mode: 'fit' as const };
      const mounted = mountedTabs.find((t) => t.tabId === panelTab.tabId);
      if (mounted) {
        return { ...mounted, mounted: true, ...owner, viewport, ...hidden };
      }
      return {
        tabId: panelTab.tabId,
        webContentsId: -1, // Not mounted
        url: panelTab.url,
        title: panelTab.title,
        mounted: false,
        viewport,
        ...owner,
        ...hidden,
      };
    });
    return { tabs, stale };
  }

  /**
   * Agent-owned tabs across ALL workspaces, answered purely from main-process
   * state (ownership registry + mounted webviews + per-workspace tab cache) —
   * no renderer round-trip, so it never blocks and never throws. Used by the
   * quit-confirmation flow to tell the user which agent browser sessions
   * quitting would destroy; title/url/workspaceId are best-effort enrichment
   * and may be absent for tabs the caches have not seen.
   */
  listAgentOwnedTabs(): {
    tabId: string;
    ownerAgentId: string;
    title?: string;
    url?: string;
    workspaceId?: string;
  }[] {
    const mountedById = new Map(this.listTabs().map((tab) => [tab.tabId, tab]));
    const result: {
      tabId: string;
      ownerAgentId: string;
      title?: string;
      url?: string;
      workspaceId?: string;
    }[] = [];
    for (const [tabId, ownership] of this.tabOwnership) {
      let title: string | undefined;
      let url: string | undefined;
      let workspaceId: string | undefined;
      for (const [cacheWorkspaceId, tabs] of this.panelBrowserTabsCache) {
        const cached = tabs.find((t) => t.tabId === tabId);
        if (cached) {
          title = cached.title;
          url = cached.url;
          if (cacheWorkspaceId.length > 0) workspaceId = cacheWorkspaceId;
          break;
        }
      }
      // A live webview beats the cache for title/url freshness.
      const mounted = mountedById.get(tabId);
      if (mounted) {
        title = mounted.title ?? title;
        url = mounted.url ?? url;
      }
      result.push({
        tabId,
        ownerAgentId: ownership.ownerAgentId,
        ...(title !== undefined ? { title } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
    }
    return result;
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
  async focusTab(tabId: string, workspaceId?: string, pin?: boolean): Promise<boolean> {
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
      ...(pin === undefined ? {} : { pin }),
    });
    if (!delivery.delivered) {
      logger.warn('Focus request for browser tab reached no window', { tabId, workspaceId });
      return false;
    }
    logger.info('Sent focus request for browser tab', { tabId, workspaceId, pin });

    // Success means "the tab is now addressable": already-mounted tabs
    // resolve immediately, unmounted-but-listed tabs resolve when the
    // remounted webview registers, and nonexistent tabs time out to false.
    return this.waitForTabRegistration(tabId);
  }

  /**
   * Reveal a hidden agent-owned tab into a panel (monorepo#3045). With
   * `focus: false` (the default) the tab is mounted into a panel's tab list
   * WITHOUT becoming active and without moving panel focus; `focus: true`
   * reveals and activates. The renderer treats an already-visible tab as
   * idempotent: a no-op for `focus: false`, activate-and-focus for
   * `focus: true`.
   *
   * The reveal is confirmed against a fresh renderer tab list (the same
   * confirm-by-list discipline closeTab uses): only a fresh reply that lists
   * the tab as not hidden counts. Existence/ownership validation lives in
   * the action executor — this method only delivers and confirms.
   *
   * @returns void on success; throws when no window received the request or
   *          the reveal could not be confirmed
   */
  async showTab(tabId: string, workspaceId?: string, focus?: boolean): Promise<void> {
    if (!tabId) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error('showTab requires a tabId.');
    }
    if (typeof workspaceId !== 'string' || workspaceId.length === 0) {
      // i18n-ignore (agent-facing protocol error, not user-facing)
      throw new Error('workspaceId is required to show a browser tab');
    }

    const delivery = sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.SHOW_TAB, {
      tabId,
      workspaceId,
      ...(focus === undefined ? {} : { focus }),
    });
    if (!delivery.delivered) {
      throw new Error(
        `Cannot show tab ${tabId}: workspace ${workspaceId} is not open in any window.`, // i18n-ignore (agent-facing protocol error, not user-facing)
      );
    }
    logger.info('Sent show request for browser tab', { tabId, workspaceId, focus });

    // Confirm the renderer revealed the tab: only a fresh (non-stale) reply
    // listing the tab without the hidden marker counts.
    for (let attempt = 0; attempt < 3; attempt++) {
      const after = await this.requestPanelBrowserTabs(workspaceId);
      if (!after.stale) {
        const tab = after.tabs.find((t) => t.tabId === tabId);
        if (tab && tab.hidden !== true) return;
      }
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    // i18n-ignore (agent-facing protocol error, not user-facing)
    throw new Error(`Tab ${tabId} could not be shown (the UI did not confirm the reveal).`);
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

    // Proactive CDP cleanup: detach debugger, drop registry entry and
    // ownership (the close is confirmed, so the tab is genuinely gone).
    // For mounted tabs the webContents `destroyed` hook covers the registry
    // too, but unmounted tabs have no webContents to fire it.
    this.unregisterTab(tabId);
    this.clearTabOwnership(tabId);
    this.tabViewBounds.delete(tabId);
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
  // TAB OWNERSHIP - Persistent agent ownership registry (monorepo#2857)
  // ============================================================

  /**
   * Record that an agent owns a tab (agent openTab, or a successful claim).
   * Ownership is persistent: it never expires and is never reassigned to a
   * different agent through this method — callers must consult
   * {@link getTabOwner} / {@link claimTab} first.
   *
   * `requestedUrl` records the agent's original requested URL (tunneled
   * opens): a string sets it, `null` clears it (the tab was repurposed for a
   * new non-tunneled target, so a stale identity must not linger), and
   * omitting it preserves a previously recorded value.
   *
   * `size` sets the tab's emulated viewport; omitting it preserves a
   * previously recorded size, defaulting to {@link DEFAULT_AGENT_VIEWPORT}.
   */
  setTabOwner(
    tabId: string,
    ownerAgentId: string,
    requestedUrl?: string | null,
    size?: { width: number; height: number },
  ): void {
    const previous = this.tabOwnership.get(tabId);
    const recorded = requestedUrl === null ? undefined : (requestedUrl ?? previous?.requestedUrl);
    this.tabOwnership.set(tabId, {
      ownerAgentId,
      ...(recorded !== undefined ? { requestedUrl: recorded } : {}),
      emulatedSize: size ?? previous?.emulatedSize ?? { ...DEFAULT_AGENT_VIEWPORT },
    });
    if (size) {
      this.tabViewports.set(tabId, { mode: 'custom', ...size });
    } else if (!this.tabViewports.has(tabId)) {
      this.tabViewports.set(tabId, { mode: 'fit' });
    }
    // Owned tabs are always emulated (docs/protocol §5.9): apply the size
    // right away when the tab is mounted (claims/adoptions of live tabs);
    // unmounted tabs get it on their next registerTab.
    this.applyViewportEmulation(tabId);
  }

  /**
   * The agent owning a tab, or undefined when the tab is unowned/unknown.
   */
  getTabOwner(tabId: string): string | undefined {
    return this.tabOwnership.get(tabId)?.ownerAgentId;
  }

  /** A tab's emulated viewport size, when it is agent-owned. */
  getTabEmulatedSize(tabId: string): { width: number; height: number } | undefined {
    return this.tabOwnership.get(tabId)?.emulatedSize;
  }

  /** Set a tab's renderer-selected viewport mode and apply it immediately. */
  setTabViewport(tabId: string, viewport: BrowserTabViewport): void {
    this.tabViewports.set(tabId, { ...viewport });
    this.applyViewportEmulation(tabId);
  }

  /** Effective emulated size exposed by listTabs; undefined means native sizing. */
  getTabEffectiveViewportSize(tabId: string): { width: number; height: number } | undefined {
    const viewport = this.tabViewports.get(tabId) ?? { mode: 'fit' as const };
    if (viewport.mode !== 'fit') return { width: viewport.width, height: viewport.height };
    const ownership = this.tabOwnership.get(tabId);
    if (!ownership) return undefined;
    const bounds = this.tabViewBounds.get(tabId);
    return bounds
      ? {
          width: Math.max(1, Math.round(bounds.width)),
          height: Math.max(1, Math.round(bounds.height)),
        }
      : { ...ownership.emulatedSize };
  }

  /**
   * Change an owned tab's emulated viewport (docs/protocol §5.9 resizeTab).
   * Omitted `height` keeps the tab's current emulated height. The caller
   * (executor) enforces ownership; this records the new size and re-applies
   * emulation to the mounted webview (an unmounted tab picks the size up on
   * its next registration).
   *
   * @returns the recorded size, or undefined when the tab is not agent-owned
   *          (unowned tabs are always native — there is no size op for them).
   */
  resizeTab(
    tabId: string,
    width: number,
    height?: number,
  ): { width: number; height: number } | undefined {
    const ownership = this.tabOwnership.get(tabId);
    if (!ownership) return undefined;
    const size = { width, height: height ?? ownership.emulatedSize.height };
    ownership.emulatedSize = size;
    this.tabViewports.set(tabId, { mode: 'custom', ...size });
    logger.info('Resized agent tab viewport', { tabId, ...size });
    this.applyViewportEmulation(tabId);
    return size;
  }

  /**
   * Record the on-screen bounds (CSS px) of a tab's visible webview element,
   * reported by the renderer, and re-fit the emulation scale. Scale-to-fit
   * only shrinks (docs/protocol §5.9): an emulated viewport smaller than the
   * element renders 1:1.
   */
  reportTabViewBounds(tabId: string, width: number, height: number): void {
    if (!(width > 0) || !(height > 0)) return;
    const previous = this.tabViewBounds.get(tabId);
    if (previous && previous.width === width && previous.height === height) return;
    this.tabViewBounds.set(tabId, { width, height });
    this.applyViewportEmulation(tabId);
  }

  /**
   * Explicitly drop a tab's recorded view bounds and re-apply emulation at
   * scale 1. Sent by the renderer when the visible element stops displaying
   * the tab: a visible→offscreen handoff re-registers the tab with a new
   * webContents BEFORE the old guest's destroyed event fires, so the
   * destroyed-hook cleanup (guarded on the registry still pointing at the
   * destroyed webContents) cannot cover it — without this the offscreen host
   * would inherit a stale visible-panel scale.
   */
  clearTabViewBounds(tabId: string): void {
    if (!this.tabViewBounds.delete(tabId)) return;
    this.applyViewportEmulation(tabId);
  }

  /**
   * Apply CDP device-metrics viewport emulation to a mounted tab. Fit follows
   * visible bounds for owned tabs and stays native for unowned tabs;
   * preset/custom use exact dimensions with scale-to-fit. Fire-and-forget:
   * unmounted tabs are skipped (registerTab
   * re-applies on mount) and CDP failures are logged, never thrown — sizing
   * must not fail the ownership bookkeeping that triggered it.
   */
  private applyViewportEmulation(tabId: string): void {
    const ownership = this.tabOwnership.get(tabId);
    const explicitViewport = this.tabViewports.get(tabId);
    if (!ownership && !explicitViewport && !this.tabViewBounds.has(tabId)) return;
    const webContentsId = this.resolveTabId(tabId);
    if (webContentsId === undefined) return;
    const viewport = explicitViewport ?? { mode: 'fit' as const };
    if (viewport.mode === 'fit' && !ownership) {
      void this.sendCommand(webContentsId, 'Emulation.clearDeviceMetricsOverride').catch(
        (error) => {
          logger.warn('Failed to clear viewport emulation', {
            tabId,
            webContentsId,
            error: (error as Error).message,
          });
        },
      );
      return;
    }
    const bounds = this.tabViewBounds.get(tabId);
    const size =
      viewport.mode === 'fit'
        ? bounds
          ? {
              width: Math.max(1, Math.round(bounds.width)),
              height: Math.max(1, Math.round(bounds.height)),
            }
          : (ownership?.emulatedSize ?? DEFAULT_AGENT_VIEWPORT)
        : { width: viewport.width, height: viewport.height };
    const scale =
      viewport.mode === 'fit' || !bounds
        ? 1
        : Math.min(1, bounds.width / size.width, bounds.height / size.height);
    void this.sendCommand(webContentsId, 'Emulation.setDeviceMetricsOverride', {
      width: size.width,
      height: size.height,
      // 0 preserves the display's native device scale factor.
      deviceScaleFactor: 0,
      mobile: false,
      scale,
    }).catch((error) => {
      logger.warn('Failed to apply viewport emulation', {
        tabId,
        webContentsId,
        ...size,
        scale,
        error: (error as Error).message,
      });
    });
  }

  /**
   * Drop a tab's ownership record. Only for genuinely closed/destroyed tabs
   * (confirmed closeTab, agent deletion) — there is no release-to-unowned
   * path (monorepo#2857).
   */
  clearTabOwnership(tabId: string): void {
    this.tabOwnership.delete(tabId);
    this.tabViewports.delete(tabId);
  }

  /**
   * Destroy-side cleanup for ALL tabs owned by an agent whose deletion
   * committed (monorepo#2857): detach debuggers, drop registry + ownership
   * records, and purge the tabs from the per-workspace tab cache so a stale
   * reply cannot resurrect them. The renderer removes the layout/hidden
   * entries itself (destroyTabsByOwnerAgent) and calls this over IPC.
   */
  clearAgentTabs(agentId: string): string[] {
    // Tombstone BEFORE clearing so an in-flight LIST_TABS_RESPONSE produced
    // pre-purge can never re-hydrate this agent's ownership records.
    this.clearedAgentTombstones.add(agentId);
    const tabIds: string[] = [];
    for (const [tabId, ownership] of this.tabOwnership) {
      if (ownership.ownerAgentId === agentId) tabIds.push(tabId);
    }
    for (const tabId of tabIds) {
      this.unregisterTab(tabId);
      this.clearTabOwnership(tabId);
      for (const [key, tabs] of this.panelBrowserTabsCache) {
        this.panelBrowserTabsCache.set(
          key,
          tabs.filter((t) => t.tabId !== tabId),
        );
      }
    }
    if (tabIds.length > 0) {
      logger.info('Cleared owned tabs for deleted agent', { agentId, tabIds });
    }
    return tabIds;
  }

  /**
   * Atomically claim an unowned tab for an agent (monorepo#2857).
   *
   * First claim wins: main's single-threaded event loop makes the
   * check-and-set below atomic — two concurrent claimants can never both
   * succeed. There is no stealing: a tab owned by another agent returns
   * `already-claimed` naming the owner; the current owner re-claiming its
   * own tab is an idempotent success (`alreadyOwned: true`, size updated).
   *
   * The caller (executor) validates the required `width` and verifies the
   * tab exists in the workspace's panel layout BEFORE calling this — the
   * check-and-set itself must stay synchronous so no await can interleave
   * a competing claim between check and set.
   */
  claimTab(
    tabId: string,
    agentId: string,
    size: { width: number; height: number },
  ): ClaimTabResult {
    const existing = this.tabOwnership.get(tabId);
    if (existing) {
      if (existing.ownerAgentId === agentId) {
        this.setTabOwner(tabId, agentId, undefined, size);
        return { status: 'claimed', alreadyOwned: true };
      }
      return { status: 'already-claimed', ownerAgentId: existing.ownerAgentId };
    }
    this.setTabOwner(tabId, agentId, undefined, size);
    logger.info('Tab claimed by agent', { tabId, agentId, ...size });
    return { status: 'claimed', alreadyOwned: false };
  }

  /**
   * Re-seed the ownership registry from a renderer tab-list reply so
   * persisted ownership survives an app restart (monorepo#2857). Existing
   * in-memory records win (they may carry a requestedUrl / size the layout
   * does not); rehydrated records restore the layout's persisted emulated
   * size, falling back to the default viewport when none was persisted
   * (pre-size layouts).
   */
  private hydrateOwnershipFromPanelTabs(tabs: PanelBrowserTab[]): void {
    for (const tab of tabs) {
      const viewport = isBrowserTabViewport(tab.viewport)
        ? tab.viewport.mode === 'fit'
          ? ({ mode: 'fit' } as const)
          : {
              ...tab.viewport,
              width: clampViewportDimension(tab.viewport.width),
              height: clampViewportDimension(tab.viewport.height),
            }
        : ({ mode: 'fit' } as const);
      this.tabViewports.set(tab.tabId, viewport);
      if (typeof tab.ownerAgentId !== 'string' || tab.ownerAgentId.length === 0) {
        this.applyViewportEmulation(tab.tabId);
        continue;
      }
      // A stale renderer reply may still list tabs of an agent whose
      // deletion already committed — never resurrect those (monorepo#2857).
      if (this.clearedAgentTombstones.has(tab.ownerAgentId)) continue;
      if (this.tabOwnership.has(tab.tabId)) {
        this.applyViewportEmulation(tab.tabId);
        continue;
      }
      // The persisted layout file is user-editable on disk, so clamp the
      // restored size into the same bounds the live action schema enforces —
      // a corrupt/hand-edited value must not replay an extreme viewport
      // into CDP emulation.
      const emulatedSize = isBrowserEmulatedSize(tab.emulatedSize)
        ? {
            width: clampViewportDimension(tab.emulatedSize.width),
            height: clampViewportDimension(tab.emulatedSize.height),
          }
        : { ...DEFAULT_AGENT_VIEWPORT };
      this.tabOwnership.set(tab.tabId, {
        ownerAgentId: tab.ownerAgentId,
        emulatedSize,
      });
      logger.info('Rehydrated tab ownership from panel layout', {
        tabId: tab.tabId,
        ownerAgentId: tab.ownerAgentId,
        ...emulatedSize,
      });
      // The tab may have registered before its ownership was known (restart
      // races dom-ready against the first tab-list reply) — apply now.
      this.applyViewportEmulation(tab.tabId);
    }
  }

  /**
   * Resolve a tab's owner, hydrating from the renderer's panel layout when
   * the tab is unknown to the in-memory registry (e.g. an enforcement check
   * right after a restart, before any tab list crossed the IPC boundary).
   * Best-effort: an unavailable tab list resolves to the in-memory answer.
   */
  async resolveTabOwner(tabId: string, workspaceId?: string): Promise<string | undefined> {
    const known = this.tabOwnership.get(tabId);
    if (known) return known.ownerAgentId;
    try {
      // listAllTabs → requestPanelBrowserTabs → LIST_TABS_RESPONSE hydrates
      // the ownership registry as a side effect.
      await this.listAllTabs(workspaceId);
    } catch {
      // Tab list unavailable — answer from what we know.
    }
    return this.tabOwnership.get(tabId)?.ownerAgentId;
  }

  /**
   * Notify the renderer that a tab's owner changed (successful claim) or its
   * emulated viewport changed (resizeTab) so the panel layout persists
   * `ownerAgentId` and `emulatedSize` with the tab (monorepo#2857).
   * Fire-and-forget, mirroring notifyTabNavigated. The tab's current
   * emulated size from the ownership registry rides along so the size
   * survives restart.
   */
  notifyTabOwnerChanged(
    tabId: string,
    workspaceId: string | undefined,
    ownerAgentId: string,
    ownerAgentName?: string,
  ): void {
    if (!tabId || typeof workspaceId !== 'string' || workspaceId.length === 0) {
      // Without a workspaceId there is no target window to notify, so the
      // owner/size change stays in-memory only and will not survive a
      // restart — log it so the gap is diagnosable (the caller's action
      // still reports success).
      logger.debug('Skipping tab owner/size persistence notification (no workspaceId)', {
        tabId,
      });
      return;
    }
    const emulatedSize = this.tabOwnership.get(tabId)?.emulatedSize;
    const viewport = this.tabViewports.get(tabId) ?? { mode: 'fit' as const };
    sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.TAB_OWNER_CHANGED, {
      tabId,
      workspaceId,
      ownerAgentId,
      // Best-effort display name so the sidebar owner group can label the
      // tab without an agent-store lookup (monorepo#3438).
      ...(ownerAgentName === undefined ? {} : { ownerAgentName }),
      ...(emulatedSize === undefined ? {} : { emulatedSize: { ...emulatedSize } }),
      viewport: { ...viewport },
    });
  }

  /**
   * Find a mounted tab OWNED BY THE REQUESTING AGENT whose current URL
   * exactly matches the requested URL.
   *
   * Used by openTab dedupe (intent-hq/monorepo#2541): opening a URL the
   * agent already has open focuses the existing tab instead of creating a
   * duplicate. Dedupe is strictly per-agent (monorepo#2857): another
   * agent's matching tab is never reused — across agents a new tab is
   * opened — and user-opened (unowned) tabs are never returned, so an
   * agent can never hijack a user tab.
   *
   * Candidates are restricted to tabs present in the requesting workspace's
   * panel layout (the same source of truth listAllTabs/closeTab use), so a
   * matching tab in another workspace is never reused or focused. Matching
   * is exact string equality on the live webview URL — no normalization.
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
      const ownership = this.tabOwnership.get(tab.tabId);
      if (ownership?.ownerAgentId !== requestingAgentId) continue;
      logger.info('Found own tab with exact URL match', {
        tabId: tab.tabId,
        url,
        requestingAgentId,
        workspaceId,
      });
      return tab.tabId;
    }
    return undefined;
  }

  /**
   * Find a mounted tab OWNED BY THE REQUESTING AGENT whose ownership record
   * carries the given requested URL.
   *
   * Fallback for openTab dedupe on tunneled opens (intent-hq/monorepo#2787):
   * when the tunnel forward was re-minted, the final URL differs per call and
   * {@link findModelTabByExactUrl} can never match — but the agent's original
   * requested URL is stable, so the recorded requestedUrl identifies the
   * logical duplicate. Same safety rules as the exact-URL variant: candidates
   * come from the requesting workspace's panel layout only, and dedupe is
   * strictly per-agent — unowned and other agents' tabs are never returned
   * (monorepo#2857).
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
      const ownership = this.tabOwnership.get(tab.tabId);
      if (ownership?.ownerAgentId !== requestingAgentId) continue;
      if (ownership.requestedUrl !== requestedUrl) continue;
      logger.info('Found own tab with matching requested URL', {
        tabId: tab.tabId,
        requestedUrl,
        requestingAgentId,
        workspaceId,
      });
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
   * Race a Page-domain screenshot command against a bounded timeout. The
   * command promise is returned as-is when it settles first; on timeout the
   * caller falls back to webContents.capturePage() (monorepo#3154).
   * Rejections are prefixed with the command label so the fallback's warn
   * log always identifies which CDP command failed.
   */
  private async withScreenshotCdpTimeout<T>(promise: Promise<T>, label: string): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(`${label} timed out after ${SCREENSHOT_CDP_TIMEOUT_MS}ms`)),
            SCREENSHOT_CDP_TIMEOUT_MS,
          );
        }),
      ]);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw message.startsWith(label) ? error : new Error(`${label} failed: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }

  /**
   * Fallback capture via webContents.capturePage(): works without the
   * debugger's Page domain (which on some guests never answers even while
   * Runtime/Accessibility commands work, monorepo#3154) and honors
   * offscreen painting. Captures the full visible view (no scroll clip).
   *
   * Fidelity caveats versus the CDP path: on viewport-emulated tabs whose
   * displayed image is scaled to fit the hosting view (scale < 1), this
   * captures the scaled-down composited view, so width/height can differ
   * from the tab's emulated size; and getSize() reports DIP dimensions
   * while toJPEG() encodes the physical-pixel bitmap, so on HiDPI displays
   * the encoded image can exceed the reported width/height by the display
   * scale factor. Acceptable degradation versus hanging the action.
   *
   * Bounded: on a guest whose compositor produces no frames capturePage()
   * never settles either, so it is raced against a timeout — failing fast
   * with a clear error beats eating the caller's 30s budget (#3366).
   * stayHidden/stayAwake keep the capture from perturbing visibility state
   * on hidden or occluded views.
   */
  private async capturePageFallback(
    webContentsId: number,
  ): Promise<{ base64: string; width: number; height: number }> {
    const wc = webContents.fromId(webContentsId);
    if (!wc || wc.isDestroyed()) {
      throw new Error(`WebContents ${webContentsId} not found or destroyed`);
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const image = await Promise.race([
        wc.capturePage(undefined, { stayHidden: true, stayAwake: true }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(
                  // i18n-ignore (agent-facing protocol error, not user-facing)
                  `capturePage timed out after ${SCREENSHOT_CAPTURE_PAGE_TIMEOUT_MS}ms: the tab is not painting (its surface may be hidden or occluded).`,
                ),
              ),
            SCREENSHOT_CAPTURE_PAGE_TIMEOUT_MS,
          );
        }),
      ]);
      const size = image.getSize();
      return {
        base64: image.toJPEG(80).toString('base64'),
        width: size.width,
        height: size.height,
      };
    } finally {
      clearTimeout(timer);
    }
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

    try {
      return await this.screenshotViaCdp(webContentsId);
    } catch (cdpError) {
      // The Page domain can hang (or fail) on some guests while the rest of
      // the debugger session works; degrade to capturePage() instead of
      // hanging the action until the caller's budget kills it (#3154).
      logger.warn('CDP screenshot failed; falling back to webContents.capturePage()', {
        webContentsId,
        error: cdpError instanceof Error ? cdpError.message : String(cdpError),
      });
      try {
        return await this.capturePageFallback(webContentsId);
      } catch (fallbackError) {
        const cdpMessage = cdpError instanceof Error ? cdpError.message : String(cdpError);
        const fallbackMessage =
          fallbackError instanceof Error ? fallbackError.message : String(fallbackError);
        throw new Error(
          // i18n-ignore (agent-facing operational diagnostic, not user-facing)
          `Screenshot capture failed: CDP stage: ${cdpMessage}; Electron fallback stage: ${fallbackMessage}`,
        );
      }
    }
  }

  /** Page-domain screenshot with per-command timeouts (see screenshot()). */
  private async screenshotViaCdp(
    webContentsId: number,
  ): Promise<{ base64: string; width: number; height: number }> {
    // Get layout metrics to determine viewport size.
    // layoutViewport reflects the page's internal layout (may exceed visible area
    // if the page sets min-width larger than the panel).
    // cssVisualViewport reflects the actual visible area the user sees.
    // We cap to whichever is smaller so screenshots match the panel bounds.
    const layoutMetrics = (await this.withScreenshotCdpTimeout(
      this.sendCommand(webContentsId, 'Page.getLayoutMetrics'),
      'Page.getLayoutMetrics',
    )) as {
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

    const result = (await this.withScreenshotCdpTimeout(
      this.sendCommand(webContentsId, 'Page.captureScreenshot', {
        format: 'jpeg',
        quality: 80,
        clip: {
          x: scrollX,
          y: scrollY,
          width,
          height,
          scale: 1,
        },
      }),
      'Page.captureScreenshot',
    )) as { data: string };

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
