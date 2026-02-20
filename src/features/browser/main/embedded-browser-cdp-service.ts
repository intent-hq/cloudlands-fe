/**
 * Embedded Browser CDP Service
 *
 * Provides CDP (Chrome DevTools Protocol) access to embedded browser webviews
 * via Electron's webContents.debugger API.
 *
 * This is a secure alternative to --remote-debugging-port as it doesn't expose
 * a network port - only the main process can access the debugger.
 */

import { webContents, BrowserWindow, ipcMain } from 'electron';
import { Logger } from '../../../shared/logger';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';
import { sendToWorkspaceWindows } from '../../system/main/system.ipc';

const logger = new Logger('EmbeddedBrowserCdp');

/** How long (ms) before a tab lease is considered idle and the tab can be reused by another agent */
const IDLE_TIMEOUT_MS = 3 * 60 * 1000; // 3 minutes

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
}

/** Tracks which agent is actively using a browser tab */
interface TabLease {
  agentId: string;
  lastUsedAt: number;
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

  /** Cache of browser tabs from panel layout (includes unmounted tabs) */
  private panelBrowserTabs: PanelBrowserTab[] = [];

  /** Pending resolvers for list-tabs requests, keyed by request ID */
  private pendingListTabsRequests = new Map<string, (tabs: PanelBrowserTab[]) => void>();

  /** Counter for generating unique request IDs */
  private listTabsRequestCounter = 0;

  /** Tracks which agent is using which tab. Key is tabId. */
  private tabLeases = new Map<string, TabLease>();

  constructor() {
    // Listen for browser tab list responses from renderer
    ipcMain.handle(
      IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE,
      (_event, data: { tabs: PanelBrowserTab[] }) => {
        logger.debug('Received browser tab list from renderer', { count: data.tabs.length });
        this.panelBrowserTabs = data.tabs;
        // Resolve ALL pending requests with the same data
        for (const [requestId, resolver] of this.pendingListTabsRequests) {
          resolver(data.tabs);
          this.pendingListTabsRequests.delete(requestId);
        }
      },
    );
  }

  /**
   * Request browser tab list from renderer and wait for response
   */
  async requestPanelBrowserTabs(workspaceId?: string): Promise<PanelBrowserTab[]> {
    // Generate unique request ID to avoid race conditions
    const requestId = `req-${++this.listTabsRequestCounter}-${Date.now()}`;

    // Create promise that will be resolved when response arrives
    const requestPromise = new Promise<PanelBrowserTab[]>((resolve) => {
      this.pendingListTabsRequests.set(requestId, resolve);
    });

    // Send to workspace windows (falls back to all windows if no workspaceId)
    sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST, undefined);
    logger.debug('Sent LIST_TABS_REQUEST', { workspaceId });

    // Create per-request timeout promise
    const timeoutPromise = new Promise<PanelBrowserTab[]>((resolve) => {
      setTimeout(() => {
        if (this.pendingListTabsRequests.has(requestId)) {
          logger.warn('Browser tab list request timed out, using cached data', { requestId });
          this.pendingListTabsRequests.delete(requestId);
          resolve(this.panelBrowserTabs);
        }
      }, 500);
    });

    // Race between response and timeout - each request gets independent timeout
    return Promise.race([requestPromise, timeoutPromise]);
  }

  /**
   * Register a browser tab for CDP access
   */
  registerTab(tabId: string, webContentsId: number): void {
    logger.info('Registering browser tab', { tabId, webContentsId });
    this.tabRegistry.set(tabId, webContentsId);

    // Automatically clean up when webContents is destroyed
    const wc = webContents.fromId(webContentsId);
    if (wc && !wc.isDestroyed()) {
      wc.once('destroyed', () => {
        logger.info('WebContents destroyed, cleaning up tab registry', { tabId, webContentsId });
        this.tabRegistry.delete(tabId);
        this.attachedDebuggers.delete(webContentsId);
        this.tabLeases.delete(tabId);
      });
    }
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
   * Returns tabs with:
   * - webContentsId: number if mounted (can run CDP commands)
   * - webContentsId: -1 if unmounted (need to focusTab first)
   */
  async listAllTabs(workspaceId?: string): Promise<(TabInfo & { mounted: boolean })[]> {
    // Get panel layout tabs (includes unmounted)
    const panelTabs = await this.requestPanelBrowserTabs(workspaceId);

    // Get mounted webviews
    const mountedTabs = this.listTabs();
    const mountedTabIds = new Set(mountedTabs.map((t) => t.tabId));

    // Build combined list
    const result: (TabInfo & { mounted: boolean })[] = [];

    // Add all panel tabs, marking whether they're mounted
    for (const panelTab of panelTabs) {
      const mounted = mountedTabs.find((t) => t.tabId === panelTab.tabId);
      if (mounted) {
        result.push({
          ...mounted,
          mounted: true,
        });
      } else {
        result.push({
          tabId: panelTab.tabId,
          webContentsId: -1, // Not mounted
          url: panelTab.url,
          title: panelTab.title,
          mounted: false,
        });
      }
    }

    // Add any mounted tabs not in panel layout (shouldn't happen, but be safe)
    for (const mounted of mountedTabs) {
      if (!panelTabs.some((p) => p.tabId === mounted.tabId)) {
        result.push({
          ...mounted,
          mounted: true,
        });
      }
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
   * Focus a browser tab (bring it to the front in the UI)
   *
   * This sends an IPC message to the renderer to activate the tab.
   * Useful when a tab's webContents has been garbage collected and
   * needs to be remounted.
   *
   * Note: We don't validate the tabId here because the renderer's panel
   * layout knows about all tabs (including unmounted ones). The whole point
   * of focusTab() is to remount unmounted tabs that aren't in our registry.
   *
   * @returns true if the message was sent to at least one window
   */
  focusTab(tabId: string, workspaceId?: string): boolean {
    if (!tabId) {
      logger.warn('Cannot focus tab - no tabId provided');
      return false;
    }

    // Send to workspace windows (falls back to all windows if no workspaceId)
    sendToWorkspaceWindows(workspaceId, IPC_CHANNELS.BROWSER.FOCUS_TAB, { tabId });
    logger.info('Sent focus request for browser tab', { tabId, workspaceId });
    return true;
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
   */
  touchLease(tabId: string, agentId: string): void {
    this.tabLeases.set(tabId, { agentId, lastUsedAt: Date.now() });
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
          ? `Tab ${tabId} not found. The tab may have been garbage collected. Try { action: "focusTab", tabId: "${tabId}" } to remount it.`
          : 'No browser tabs available. Open a browser tab in the app first.',
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
          ? `Tab ${tabId} not found. The tab may have been garbage collected. Try { action: "focusTab", tabId: "${tabId}" } to remount it.`
          : 'No browser tabs available. Open a browser tab in the app first.',
      );
    }

    // Get layout metrics to determine viewport size
    const layoutMetrics = (await this.sendCommand(webContentsId, 'Page.getLayoutMetrics')) as {
      layoutViewport: { clientWidth: number; clientHeight: number };
    };

    const result = (await this.sendCommand(webContentsId, 'Page.captureScreenshot', {
      format: 'png',
    })) as { data: string };

    return {
      base64: result.data,
      width: layoutMetrics.layoutViewport.clientWidth,
      height: layoutMetrics.layoutViewport.clientHeight,
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
          ? `Tab ${tabId} not found. The tab may have been garbage collected. Try { action: "focusTab", tabId: "${tabId}" } to remount it.`
          : 'No browser tabs available. Open a browser tab in the app first.',
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
