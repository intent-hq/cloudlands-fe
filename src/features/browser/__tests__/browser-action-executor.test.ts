/**
 * Tests for browser-action-executor.ts
 *
 * Covers:
 * - URL validation (validateBrowserUrl via openTab/navigate actions)
 * - Protocol enforcement using shared BROWSER_PROTOCOLS constants
 * - navigate action behavior
 * - openTab action behavior
 * - Action sequence validation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { BROWSER_PROTOCOLS } from '../../../shared/constants';

// Mock the CDP service before importing the executor
vi.mock('../main/embedded-browser-cdp-service', () => ({
  DEFAULT_AGENT_VIEWPORT: { width: 1280, height: 800 },
  embeddedBrowserCdp: {
    findModelTabByExactUrl: vi.fn().mockResolvedValue(undefined),
    findModelTabByRequestedUrl: vi.fn().mockResolvedValue(undefined),
    getFirstTab: vi.fn().mockReturnValue(null),
    evaluate: vi.fn().mockResolvedValue(undefined),
    focusTab: vi.fn().mockResolvedValue(true),
    waitForTabRegistration: vi.fn().mockResolvedValue(true),
    closeTab: vi.fn().mockResolvedValue({ tabId: 'tab-1' }),
    notifyTabNavigated: vi.fn(),
    notifyTabOwnerChanged: vi.fn(),
    setTabOwner: vi.fn(),
    getTabOwner: vi.fn().mockReturnValue(undefined),
    getTabEmulatedSize: vi.fn().mockReturnValue(undefined),
    clearTabOwnership: vi.fn(),
    claimTab: vi.fn().mockReturnValue({ status: 'claimed', alreadyOwned: false }),
    resizeTab: vi.fn().mockReturnValue(undefined),
    resolveTabOwner: vi.fn().mockResolvedValue(undefined),
    listAllTabs: vi.fn().mockResolvedValue({ tabs: [], stale: false }),
    screenshot: vi.fn().mockResolvedValue({ base64: '', width: 0, height: 0 }),
    getAccessibilityTree: vi.fn().mockResolvedValue(''),
    snapshot: vi.fn().mockResolvedValue(''),
  },
}));

vi.mock('../main/browser-capture-service', () => ({
  browserCapture: {
    snapshot: vi.fn(),
    startSession: vi.fn(),
    endSession: vi.fn(),
    startCapture: vi.fn(),
    endCapture: vi.fn(),
    captureStep: vi.fn(),
    startTrace: vi.fn(),
    stopTrace: vi.fn(),
    getSummary: vi.fn(),
  },
}));

import { executeActions } from '../main/browser-action-executor';
import { browserCapture } from '../main/browser-capture-service';

describe('browser-action-executor', () => {
  const mockOpenTabFn = vi.fn().mockReturnValue({ success: true, message: 'opened' });

  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // URL Validation via openTab
  // =========================================================================
  describe('openTab URL validation', () => {
    it('accepts an explicit pin request and forwards it to the opener', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'https://example.com', pin: true }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(true);
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'https://example.com',
        undefined,
        undefined,
        undefined,
        true,
        undefined,
      );
    });

    it('rejects a non-boolean pin request before opening a tab', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'https://example.com', pin: 'yes' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(false);
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('should allow http:// URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(true);
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://localhost:3000',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('should allow https:// URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'https://example.com' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(true);
    });

    it('should allow file:// URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'file:///Users/me/index.html' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(true);
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'file:///Users/me/index.html',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('should reject javascript: URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'javascript:alert(1)' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('not allowed');
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('should reject data: URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'data:text/html,<h1>hi</h1>' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('not allowed');
    });

    it('should reject invalid URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'not a url at all' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('Invalid URL');
    });

    it('should reject blob: URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'blob:http://example.com/uuid' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(false);
    });
  });

  // =========================================================================
  // URL Validation via navigate
  // =========================================================================
  describe('navigate URL validation', () => {
    it('should reject javascript: URLs', async () => {
      const result = await executeActions({
        actions: [{ action: 'navigate', url: 'javascript:void(0)' }],
      });
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('not allowed');
    });

    it('should allow http:// URLs', async () => {
      // Will fail because no tab is available, but URL validation should pass
      const result = await executeActions({
        actions: [{ action: 'navigate', url: 'http://localhost:8080' }],
      });
      // navigate with no tabs returns an error about no tabs, not about URL
      expect(result.results[0]?.error).toContain('No browser tabs');
    });

    it('should allow file:// URLs', async () => {
      const result = await executeActions({
        actions: [{ action: 'navigate', url: 'file:///tmp/test.html' }],
      });
      // Should fail because no tabs, not because of URL validation
      expect(result.results[0]?.error).toContain('No browser tabs');
    });
  });

  // =========================================================================
  // Action sequence validation
  // =========================================================================
  describe('action sequence validation', () => {
    it('should reject empty input', async () => {
      const result = await executeActions({});
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action sequence');
    });

    it('should reject unknown actions', async () => {
      const result = await executeActions({
        actions: [{ action: 'deleteEverything' }],
      });
      expect(result.success).toBe(false);
    });

    it('should stop on first failure', async () => {
      const result = await executeActions(
        {
          actions: [
            { action: 'openTab', url: 'javascript:alert(1)' },
            { action: 'openTab', url: 'http://example.com' },
          ],
        },
        mockOpenTabFn,
      );
      expect(result.success).toBe(false);
      expect(result.results).toHaveLength(1);
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('should execute multiple valid actions sequentially', async () => {
      const result = await executeActions(
        {
          actions: [{ action: 'openTab', url: 'http://localhost:3000' }, { action: 'listTabs' }],
        },
        mockOpenTabFn,
      );
      expect(result.success).toBe(true);
      expect(result.results).toHaveLength(2);
    });

    it('routes listTabs through the explicit workspace context', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

      const result = await executeActions(
        { actions: [{ action: 'listTabs' }] },
        undefined,
        undefined,
        'workspace-a',
      );

      expect(result.success).toBe(true);
      expect(result.results[0]).toEqual({ action: 'listTabs', success: true, result: [] });
      expect(embeddedBrowserCdp.listAllTabs).toHaveBeenCalledWith('workspace-a');
    });

    // RC4 (monorepo#2756): a renderer that never answered used to be
    // indistinguishable from a workspace with zero tabs.
    it('flags a stale cached listTabs result with a warning instead of passing it off as fresh', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      const cachedTabs = [
        { tabId: 'tab-1', webContentsId: -1, url: 'http://a/', title: 'A', mounted: false },
      ];
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({
        tabs: cachedTabs,
        stale: true,
      });

      const result = await executeActions(
        { actions: [{ action: 'listTabs' }] },
        undefined,
        undefined,
        'ws-slow',
      );

      expect(result.success).toBe(true);
      expect(result.results[0]).toEqual({
        action: 'listTabs',
        success: true,
        result: cachedTabs,
        warning:
          'The renderer did not answer the tab list request for workspace ws-slow; this list is from a cached snapshot and may be outdated.',
      });
    });

    it('surfaces "tab list unavailable" as a listTabs error instead of a silent empty list', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockRejectedValueOnce(
        new Error(
          'Tab list for workspace ws-silent is unavailable: the renderer did not respond and no cached tab list exists.',
        ),
      );

      const result = await executeActions(
        { actions: [{ action: 'listTabs' }] },
        undefined,
        undefined,
        'ws-silent',
      );

      expect(result.success).toBe(false);
      expect(result.results[0]).toMatchObject({
        action: 'listTabs',
        success: false,
        error:
          'Tab list for workspace ws-silent is unavailable: the renderer did not respond and no cached tab list exists.',
      });
    });

    it('surfaces the closeTab tab-list-unavailable error instead of "already closed"', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.closeTab).mockRejectedValueOnce(
        new Error(
          'Cannot close tab tab-x: the tab list for workspace ws-silent is unavailable (the renderer did not respond), so whether the tab exists cannot be determined.',
        ),
      );

      const result = await executeActions(
        { actions: [{ action: 'closeTab', tabId: 'tab-x' }] },
        undefined,
        undefined,
        'ws-silent',
      );

      expect(result.success).toBe(false);
      expect(result.results[0]).toMatchObject({
        action: 'closeTab',
        success: false,
        error:
          'Cannot close tab tab-x: the tab list for workspace ws-silent is unavailable (the renderer did not respond), so whether the tab exists cannot be determined.',
      });
    });

    // Regression (intent-hq/monorepo#2602): zero-delivery failures used to be
    // invisible — focusTab returned success and openTab produced a
    // sequence-level "failed: undefined".
    it('surfaces a descriptive focusTab error when the tab never mounts', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.focusTab).mockResolvedValue(false);

      const result = await executeActions(
        { actions: [{ action: 'focusTab', tabId: 'tab-9' }] },
        undefined,
        undefined,
        'ws-closed',
      );

      expect(result.success).toBe(false);
      expect(result.results[0]).toMatchObject({
        action: 'focusTab',
        success: false,
        error:
          'Could not focus tab tab-9: the tab never mounted. Either workspace ws-closed is not open in any window, or no tab with this id exists — check { action: "listTabs" }.',
      });
      expect(result.error).toBe(
        "Action 'focusTab' failed: Could not focus tab tab-9: the tab never mounted. " +
          'Either workspace ws-closed is not open in any window, or no tab with this id exists — check { action: "listTabs" }.',
      );
    });

    it('surfaces the openTab failure message as the action and sequence error', async () => {
      const failingOpenTabFn = vi.fn().mockReturnValue({
        success: false,
        message: 'Cannot open browser tab: workspace ws-closed is not open in any window.',
      });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com' }] },
        failingOpenTabFn,
        undefined,
        'ws-closed',
      );

      expect(result.success).toBe(false);
      expect(result.results[0]).toMatchObject({
        action: 'openTab',
        success: false,
        error: 'Cannot open browser tab: workspace ws-closed is not open in any window.',
      });
      expect(result.error).toBe(
        "Action 'openTab' failed: Cannot open browser tab: workspace ws-closed is not open in any window.",
      );
    });
  });

  // ===========================================================================
  // openTab registration await (RC3, intent-hq/monorepo#2756)
  // ===========================================================================
  describe('openTab registration await', () => {
    it('awaits registration of the returned tabId before reporting success', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.waitForTabRegistration).mockResolvedValueOnce(true);
      const openTabWithId = vi
        .fn()
        .mockReturnValue({ success: true, message: 'opened', tabId: 'tab-new' });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com' }] },
        openTabWithId,
        undefined,
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.waitForTabRegistration).toHaveBeenCalledWith('tab-new');
      expect(result.results[0]?.result).toMatchObject({ tabId: 'tab-new' });
    });

    it('fails the action truthfully when the webview never registers in time', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.waitForTabRegistration).mockResolvedValueOnce(false);
      const openTabWithId = vi
        .fn()
        .mockReturnValue({ success: true, message: 'opened', tabId: 'tab-slow' });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com' }] },
        openTabWithId,
        undefined,
        'ws-1',
      );

      expect(result.success).toBe(false);
      expect(result.results[0]?.action).toBe('openTab');
      expect(result.results[0]?.error).toContain('did not mount in time');
      expect(result.results[0]?.error).toContain('tab-slow');
    });

    it('does not wait when openTabFn reports failure or returns no tabId', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.waitForTabRegistration).mockClear();

      await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com' }] },
        vi.fn().mockReturnValue({ success: true, message: 'opened' }),
        undefined,
        'ws-1',
      );
      await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com' }] },
        vi.fn().mockReturnValue({ success: false, message: 'nope', tabId: 'tab-x' }),
        undefined,
        'ws-1',
      );

      expect(embeddedBrowserCdp.waitForTabRegistration).not.toHaveBeenCalled();
    });

    // With position "replace" and an existing browser tab, the renderer
    // updates that tab in place and never creates the pre-generated tabId —
    // the executor must adopt the replaced tab's id, not wait on a phantom.
    it('adopts the existing tab id on position replace instead of waiting on the phantom id', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({
        tabs: [
          { tabId: 'tab-existing', url: 'http://old.example', title: 'Old', mounted: true },
        ] as any,
        stale: false,
      });
      // The agent owns the tab it is replacing (ownership-enforced, #2857).
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');
      const openTabWithId = vi
        .fn()
        .mockReturnValue({ success: true, message: 'opened', tabId: 'tab-phantom' });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com', position: 'replace' }] },
        openTabWithId,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.listAllTabs).toHaveBeenCalledWith('ws-1');
      // The ownership-checked adoption target is bound into the open payload
      // so the renderer replaces exactly this tab (TOCTOU, monorepo#2857).
      expect(openTabWithId).toHaveBeenCalledExactlyOnceWith(
        'http://example.com',
        'replace',
        true,
        undefined,
        undefined,
        'agent-1',
        'tab-existing',
      );
      expect(embeddedBrowserCdp.waitForTabRegistration).toHaveBeenCalledExactlyOnceWith(
        'tab-existing',
      );
      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-existing', 'agent-1', null, {
        width: 1280,
        height: 800,
      });
      expect(embeddedBrowserCdp.setTabOwner).not.toHaveBeenCalledWith(
        'tab-phantom',
        'agent-1',
        null,
        expect.anything(),
      );
      expect(result.results[0]?.result).toMatchObject({ tabId: 'tab-existing', replaced: true });
    });

    it('waits on the pre-generated id for position replace when no browser tab exists', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({ tabs: [], stale: false });
      const openTabWithId = vi
        .fn()
        .mockReturnValue({ success: true, message: 'opened', tabId: 'tab-new' });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://example.com', position: 'replace' }] },
        openTabWithId,
        undefined,
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.waitForTabRegistration).toHaveBeenCalledExactlyOnceWith('tab-new');
      expect(result.results[0]?.result).toMatchObject({ tabId: 'tab-new' });
      expect(result.results[0]?.result).not.toMatchObject({ replaced: true });
    });
  });

  describe('capture workspace boundaries', () => {
    it('routes protocol-shaped snapshot requests through the trusted workspace context', async () => {
      vi.mocked(browserCapture.snapshot).mockResolvedValueOnce({
        captureId: 'example.test/snap',
      } as any);

      const result = await executeActions(
        { actions: [{ action: 'snapshot', name: 'snap' }] },
        undefined,
        'agent-1',
        'workspace-a',
      );

      expect(result.success).toBe(true);
      expect(browserCapture.snapshot).toHaveBeenCalledWith({
        workspaceId: 'workspace-a',
        tabId: undefined,
        name: 'snap',
        reload: undefined,
        waitFor: undefined,
      });
    });

    it('rejects action-level workspace overrides from protocol-shaped requests', async () => {
      const result = await executeActions(
        {
          actions: [{ action: 'startSession', workspaceId: 'workspace-b', name: 'foreign' }],
        },
        undefined,
        'agent-1',
        'workspace-a',
      );

      expect(result.success).toBe(false);
      expect(result.error).toContain('Unrecognized key');
      expect(browserCapture.startSession).not.toHaveBeenCalled();
    });

    it('resolves getSummary by capture ID within the trusted workspace', async () => {
      vi.mocked(browserCapture.getSummary).mockResolvedValueOnce(null);

      const result = await executeActions(
        { actions: [{ action: 'getSummary', captureId: 'example.test/snap' }] },
        undefined,
        'agent-1',
        'workspace-a',
      );

      expect(result.success).toBe(true);
      expect(browserCapture.getSummary).toHaveBeenCalledWith('workspace-a', 'example.test/snap');
    });

    it('requires trusted workspace context for session operations', async () => {
      const result = await executeActions({
        actions: [{ action: 'startCapture', sessionId: 'session-1' }],
      });

      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('requires workspace context');
      expect(browserCapture.startCapture).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // closeTab action (intent-hq/monorepo#1931)
  // =========================================================================
  describe('closeTab action', () => {
    it('should close the tab and return the tabId', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.closeTab).mockResolvedValue({ tabId: 'tab-1' });

      const result = await executeActions(
        { actions: [{ action: 'closeTab', tabId: 'tab-1' }] },
        undefined,
        undefined,
        'ws-1',
      );
      expect(result.success).toBe(true);
      expect(result.results[0]).toEqual({
        action: 'closeTab',
        success: true,
        result: { tabId: 'tab-1' },
      });
      expect(embeddedBrowserCdp.closeTab).toHaveBeenCalledWith('tab-1', 'ws-1');
    });

    it('should fail schema validation when tabId is missing', async () => {
      const result = await executeActions({ actions: [{ action: 'closeTab' }] });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action sequence');
    });

    it('should not fall back to the sequence-level default tabId', async () => {
      // tabId is required per-action for closeTab (destructive) — a default
      // tabId on the sequence must not satisfy the schema.
      const result = await executeActions({
        actions: [{ action: 'closeTab' }],
        tabId: 'tab-default',
      });
      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid action sequence');
    });

    it('should report failure for unknown/already-closed tabs without throwing', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.closeTab).mockRejectedValue(
        new Error('Tab tab-gone not found. It may already be closed.'),
      );

      const result = await executeActions({
        actions: [{ action: 'closeTab', tabId: 'tab-gone' }],
      });
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('not found');
    });

    it('should report failure for non-closable tabs', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.closeTab).mockRejectedValue(
        new Error('Tab tab-pinned is not closable.'),
      );

      const result = await executeActions({
        actions: [{ action: 'closeTab', tabId: 'tab-pinned' }],
      });
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('not closable');
    });
  });

  // =========================================================================
  // navigate action with tabs
  // =========================================================================
  describe('navigate action with available tab', () => {
    it('should navigate when a tab exists', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as any);

      const result = await executeActions({
        actions: [{ action: 'navigate', url: 'http://localhost:8080/page' }],
      });
      expect(result.success).toBe(true);
      expect(result.results[0]?.result).toEqual({
        tabId: 'tab-1',
        url: 'http://localhost:8080/page',
      });
    });
  });

  // =========================================================================
  // Loopback-hostname rewrite (intent-hq/monorepo#2323)
  // =========================================================================
  describe('loopback rewrite', () => {
    const remoteContext = () => ({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
    const localContext = () => ({ daemonIsRemote: false });

    // Remote rewrites trigger the reachability probe; stub it as reachable.
    beforeEach(() => {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, status: 200 }));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('openTab rewrites bare loopback to the daemon host with echo + warning in remote mode', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://127.0.0.1:3000/x?q=1' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(true);
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://10.0.0.5:3000/x?q=1',
        undefined,
        undefined,
        'http://127.0.0.1:3000/x?q=1',
        undefined,
        undefined,
      );
      expect(result.results[0]?.result).toMatchObject({
        requestedUrl: 'http://127.0.0.1:3000/x?q=1',
        finalUrl: 'http://10.0.0.5:3000/x?q=1',
        rewritten: true,
      });
      const payload = result.results[0]?.result as Record<string, unknown>;
      expect(payload.reason).toContain('10.0.0.5');
      expect(payload.warning).toContain('daemon.localhost');
      expect(payload.warning).toContain('client.localhost');
    });

    it('openTab rewrites daemon.localhost to the daemon host without a warning', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://daemon.localhost:3000/' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://10.0.0.5:3000/',
        undefined,
        undefined,
        'http://daemon.localhost:3000/',
        undefined,
        undefined,
      );
      const payload = result.results[0]?.result as Record<string, unknown>;
      expect(payload.rewritten).toBe(true);
      expect(payload.warning).toBeUndefined();
    });

    it('openTab rewrites client.localhost to 127.0.0.1 in remote mode', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://client.localhost:5173/' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://127.0.0.1:5173/',
        undefined,
        undefined,
        'http://client.localhost:5173/',
        undefined,
        undefined,
      );
      const payload = result.results[0]?.result as Record<string, unknown>;
      expect(payload.rewritten).toBe(true);
      expect(payload.warning).toBeUndefined();
    });

    it('agent openTab without a dedupe match opens a new tab (idle-lease reuse removed, #2857)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
      );
      expect(result.success).toBe(true);
      // No tab is navigated/repurposed — a genuinely new tab is opened.
      expect(embeddedBrowserCdp.evaluate).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://10.0.0.5:3000/',
        undefined,
        true,
        'http://localhost:3000/',
        undefined,
        'agent-1',
      );
    });

    it('navigate rewrites bare loopback and echoes the rewrite in remote mode', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as any);

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'http://[::1]:8080/page' }] },
        undefined,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.evaluate).toHaveBeenCalledWith(
        'tab-1',
        `window.location.href = ${JSON.stringify('http://10.0.0.5:8080/page')}`,
      );
      expect(result.results[0]?.result).toMatchObject({
        tabId: 'tab-1',
        url: 'http://10.0.0.5:8080/page',
        requestedUrl: 'http://[::1]:8080/page',
        finalUrl: 'http://10.0.0.5:8080/page',
        rewritten: true,
      });
    });

    it('keeps bare loopback unchanged with an unchanged result shape in local mode', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as any);

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'http://127.0.0.1:8080/page' }] },
        undefined,
        undefined,
        'workspace-a',
        localContext,
      );
      // Byte-identical result for non-rewritten URLs: no rewrite echo fields.
      expect(result.results[0]?.result).toEqual({
        tabId: 'tab-1',
        url: 'http://127.0.0.1:8080/page',
      });
    });

    it('rewrites daemon.localhost and client.localhost to 127.0.0.1 in local mode', async () => {
      for (const url of ['http://daemon.localhost:3000/', 'http://client.localhost:3000/']) {
        mockOpenTabFn.mockClear();
        const result = await executeActions(
          { actions: [{ action: 'openTab', url }] },
          mockOpenTabFn,
          undefined,
          'workspace-a',
          localContext,
        );
        expect(mockOpenTabFn).toHaveBeenCalledWith(
          'http://127.0.0.1:3000/',
          undefined,
          undefined,
          url,
          undefined,
          undefined,
        );
        expect(result.results[0]?.result).toMatchObject({
          requestedUrl: url,
          finalUrl: 'http://127.0.0.1:3000/',
          rewritten: true,
        });
      }
    });

    it('defaults to local-daemon behavior when no context getter is supplied', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/' }] },
        mockOpenTabFn,
      );
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://localhost:3000/',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(result.results[0]?.result).toEqual({ success: true, message: 'opened' });
    });

    it('leaves non-loopback URLs untouched in remote mode', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'https://example.com/x' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'https://example.com/x',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
      expect(result.results[0]?.result).toEqual({ success: true, message: 'opened' });
    });
  });

  // =========================================================================
  // Remote-rewrite reachability probe
  // =========================================================================
  describe('remote rewrite reachability probe', () => {
    const remoteContext = () => ({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
    const localContext = () => ({ daemonIsRemote: false });
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('openTab fails with an explanatory error and opens no tab when the rewritten origin is unreachable', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://127.0.0.1:3000/x' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.action).toBe('openTab');
      const error = result.results[0]?.error ?? '';
      expect(error).toContain('http://127.0.0.1:3000/x');
      expect(error).toContain('http://10.0.0.5:3000/x');
      expect(error).toContain('0.0.0.0');
      expect(error).toContain('firewall');
      expect(error).toContain('port 3000');
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('openTab probe failure also prevents any tab navigation or open', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://daemon.localhost:3000/' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
      );
      expect(result.success).toBe(false);
      expect(embeddedBrowserCdp.evaluate).not.toHaveBeenCalled();
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('navigate fails with an explanatory error and does not navigate when unreachable', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as any);
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'http://daemon.localhost:8080/page' }] },
        undefined,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.action).toBe('navigate');
      expect(result.results[0]?.error).toContain('http://daemon.localhost:8080/page');
      expect(result.results[0]?.error).toContain('http://10.0.0.5:8080/page');
      expect(embeddedBrowserCdp.evaluate).not.toHaveBeenCalled();
    });

    it('probes the rewritten origin with a timeout signal and proceeds on success', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://127.0.0.1:3000/x?q=1' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(true);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(fetchMock).toHaveBeenCalledWith('http://10.0.0.5:3000', {
        signal: expect.any(AbortSignal),
      });
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://10.0.0.5:3000/x?q=1',
        undefined,
        undefined,
        'http://127.0.0.1:3000/x?q=1',
        undefined,
        undefined,
      );
    });

    it('treats any HTTP response as reachable, including error statuses', async () => {
      fetchMock.mockResolvedValue({ ok: false, status: 502 });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://daemon.localhost:3000/' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(true);
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://10.0.0.5:3000/',
        undefined,
        undefined,
        'http://daemon.localhost:3000/',
        undefined,
        undefined,
      );
    });

    it('never probes non-rewritten URLs in remote mode', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'https://example.com/x' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('never probes local-mode rewrites (daemon.localhost → 127.0.0.1)', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://daemon.localhost:3000/' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        localContext,
      );
      expect(result.success).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/',
        undefined,
        undefined,
        'http://daemon.localhost:3000/',
        undefined,
        undefined,
      );
    });

    it('never probes client.localhost rewrites in remote mode (target is this machine)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as any);

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'http://client.localhost:5173/' }] },
        undefined,
        undefined,
        'workspace-a',
        remoteContext,
      );
      expect(result.success).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(embeddedBrowserCdp.evaluate).toHaveBeenCalledWith(
        'tab-1',
        `window.location.href = ${JSON.stringify('http://127.0.0.1:5173/')}`,
      );
    });
  });

  // =========================================================================
  // Probe-failure → tunnel fallback (intent-hq/monorepo#2323)
  // =========================================================================
  describe('probe-failure tunnel fallback', () => {
    const remoteContext = () => ({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
    const localContext = () => ({ daemonIsRemote: false });
    let fetchMock: ReturnType<typeof vi.fn>;
    let forwardPort: ReturnType<typeof vi.fn>;
    let tunnelProvider: () => { forwardPort: (port: number) => Promise<number> };

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
      forwardPort = vi.fn().mockResolvedValue(45678);
      tunnelProvider = () => ({ forwardPort });
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('openTab falls back to the tunnel when the probe fails and echoes tunneled', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://127.0.0.1:3000/x?q=1' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
        tunnelProvider,
      );
      expect(result.success).toBe(true);
      expect(forwardPort).toHaveBeenCalledWith(3000);
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://127.0.0.1:45678/x?q=1',
        undefined,
        undefined,
        'http://127.0.0.1:3000/x?q=1',
        undefined,
        undefined,
      );
      expect(result.results[0]?.result).toMatchObject({
        tunneled: true,
        requestedUrl: 'http://127.0.0.1:3000/x?q=1',
        finalUrl: 'http://127.0.0.1:45678/x?q=1',
        rewritten: true,
      });
      const payload = result.results[0]?.result as Record<string, unknown>;
      expect(payload.reason).toContain('tunnel');
      expect(payload.reason).toContain('127.0.0.1:45678');
      // Bare-loopback rewrites keep their ambiguity warning through the tunnel.
      expect(payload.warning).toContain('daemon.localhost');
    });

    it('navigate falls back to the tunnel when the probe fails and echoes tunneled', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as any);
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'http://daemon.localhost:8080/page' }] },
        undefined,
        undefined,
        'workspace-a',
        remoteContext,
        tunnelProvider,
      );
      expect(result.success).toBe(true);
      expect(forwardPort).toHaveBeenCalledWith(8080);
      expect(embeddedBrowserCdp.evaluate).toHaveBeenCalledWith(
        'tab-1',
        `window.location.href = ${JSON.stringify('http://127.0.0.1:45678/page')}`,
      );
      expect(result.results[0]?.result).toMatchObject({
        tabId: 'tab-1',
        url: 'http://127.0.0.1:45678/page',
        tunneled: true,
        requestedUrl: 'http://daemon.localhost:8080/page',
        finalUrl: 'http://127.0.0.1:45678/page',
        rewritten: true,
      });
      // daemon.localhost rewrites carry no bare-loopback warning.
      expect((result.results[0]?.result as Record<string, unknown>).warning).toBeUndefined();
    });

    it('keeps the explanatory probe error when the tunnel itself fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      forwardPort.mockRejectedValue(new Error('tunnel connect timed out after 10000ms'));

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://127.0.0.1:3000/x' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
        tunnelProvider,
      );
      expect(result.success).toBe(false);
      expect(forwardPort).toHaveBeenCalledWith(3000);
      const error = result.results[0]?.error ?? '';
      expect(error).toContain('http://10.0.0.5:3000/x');
      expect(error).toContain('0.0.0.0');
      expect(error).toContain('firewall');
      expect(error).toContain('port 3000');
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('never tunnels when the probe succeeds', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://daemon.localhost:3000/' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
        tunnelProvider,
      );
      expect(result.success).toBe(true);
      expect(forwardPort).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://10.0.0.5:3000/',
        undefined,
        undefined,
        'http://daemon.localhost:3000/',
        undefined,
        undefined,
      );
      expect(result.results[0]?.result).not.toHaveProperty('tunneled');
    });

    it('never tunnels in local mode (no probe, no forward)', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://daemon.localhost:3000/' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        localContext,
        tunnelProvider,
      );
      expect(result.success).toBe(true);
      expect(fetchMock).not.toHaveBeenCalled();
      expect(forwardPort).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/',
        undefined,
        undefined,
        'http://daemon.localhost:3000/',
        undefined,
        undefined,
      );
      expect(result.results[0]?.result).not.toHaveProperty('tunneled');
    });

    it('keeps the explanatory probe error when no tunnel provider is available (web context)', async () => {
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://127.0.0.1:3000/x' }] },
        mockOpenTabFn,
        undefined,
        'workspace-a',
        remoteContext,
        () => null,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('0.0.0.0');
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // Programmatic tunnel actions (intent-hq/monorepo#2537)
  // =========================================================================
  describe('tunnel actions (openTunnel / listTunnels / closeTunnel)', () => {
    let forwardPort: ReturnType<typeof vi.fn>;
    let activeForwards: ReturnType<typeof vi.fn>;
    let closeForward: ReturnType<typeof vi.fn>;
    let provider: {
      forwardPort: (port: number) => Promise<number>;
      activeForwards: () => Array<{ remotePort: number; localPort: number }>;
      closeForward: (port: number) => boolean;
      backend?: 'tunnel' | 'direct';
    };

    beforeEach(() => {
      forwardPort = vi.fn().mockResolvedValue(45678);
      activeForwards = vi.fn().mockReturnValue([]);
      closeForward = vi.fn().mockReturnValue(true);
      provider = { forwardPort, activeForwards, closeForward, backend: 'tunnel' };
    });

    it('openTunnel forwards the port and echoes { remotePort, localPort, backend, reused: false }', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(true);
      expect(forwardPort).toHaveBeenCalledWith(3000);
      expect(result.results[0]).toEqual({
        action: 'openTunnel',
        success: true,
        result: { remotePort: 3000, localPort: 45678, backend: 'tunnel', reused: false },
      });
    });

    it('openTunnel reports reused: true when a forward for the remote port already exists', async () => {
      activeForwards.mockReturnValue([{ remotePort: 3000, localPort: 45678 }]);

      const result = await executeActions(
        { actions: [{ action: 'openTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(true);
      expect(result.results[0]?.result).toEqual({
        remotePort: 3000,
        localPort: 45678,
        backend: 'tunnel',
        reused: true,
      });
    });

    it('openTunnel echoes the direct backend for local-transport providers', async () => {
      provider.backend = 'direct';

      const result = await executeActions(
        { actions: [{ action: 'openTunnel', remotePort: 8080 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(true);
      expect(result.results[0]?.result).toMatchObject({ backend: 'direct', reused: false });
    });

    it('openTunnel surfaces forward failures as action errors, not throws', async () => {
      forwardPort.mockRejectedValue(new Error('tunnel connect timed out after 10000ms'));

      const result = await executeActions(
        { actions: [{ action: 'openTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('timed out');
    });

    it('openTunnel fails with a clear error when no tunnel provider is available', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => null,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('no tunnel provider');
    });

    it('openTunnel surfaces a throwing provider getter as an action error (unreadable backend state)', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => {
          throw new Error(
            'Cannot select a tunnel backend: the backend connection state is unreadable.',
          );
        },
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('Cannot select a tunnel backend');
    });

    it('openTunnel rejects out-of-range and non-integer ports via schema validation', async () => {
      for (const remotePort of [0, 65536, 1.5, -1]) {
        const result = await executeActions(
          { actions: [{ action: 'openTunnel', remotePort }] },
          undefined,
          undefined,
          undefined,
          undefined,
          () => provider,
        );
        expect(result.success).toBe(false);
        expect(result.error).toContain('Invalid action sequence');
      }
      expect(forwardPort).not.toHaveBeenCalled();
    });

    it('listTunnels returns active forwards tagged with the backend', async () => {
      activeForwards.mockReturnValue([
        { remotePort: 3000, localPort: 45678 },
        { remotePort: 8080, localPort: 50123 },
      ]);

      const result = await executeActions(
        { actions: [{ action: 'listTunnels' }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(true);
      expect(result.results[0]?.result).toEqual({
        tunnels: [
          { remotePort: 3000, localPort: 45678, backend: 'tunnel' },
          { remotePort: 8080, localPort: 50123, backend: 'tunnel' },
        ],
      });
    });

    it('listTunnels returns an empty list when no provider is available', async () => {
      const result = await executeActions(
        { actions: [{ action: 'listTunnels' }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => null,
      );
      expect(result.success).toBe(true);
      expect(result.results[0]?.result).toEqual({ tunnels: [] });
    });

    it('closeTunnel closes an existing forward', async () => {
      const result = await executeActions(
        { actions: [{ action: 'closeTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(true);
      expect(closeForward).toHaveBeenCalledWith(3000);
      expect(result.results[0]?.result).toEqual({ remotePort: 3000, closed: true });
    });

    it('closeTunnel fails with a clear error when no such forward exists', async () => {
      closeForward.mockReturnValue(false);

      const result = await executeActions(
        { actions: [{ action: 'closeTunnel', remotePort: 9999 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => provider,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('No active tunnel forward for remote port 9999');
    });

    it('closeTunnel fails with a clear error when no tunnel provider is available', async () => {
      const result = await executeActions(
        { actions: [{ action: 'closeTunnel', remotePort: 3000 }] },
        undefined,
        undefined,
        undefined,
        undefined,
        () => null,
      );
      expect(result.success).toBe(false);
      expect(result.results[0]?.error).toContain('no tunnel provider');
    });
  });

  // =========================================================================
  // openTab exact-URL dedupe of model-opened tabs (#2541)
  // =========================================================================
  describe('openTab exact-URL dedupe of model-opened tabs (#2541)', () => {
    beforeEach(async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue(undefined);
    });

    it('reuses and focuses an existing model-opened tab with the same URL', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue('tab-dup');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.findModelTabByExactUrl).toHaveBeenCalledWith(
        'http://localhost:3000/board',
        'agent-1',
        'ws-1',
      );
      expect(embeddedBrowserCdp.focusTab).toHaveBeenCalledWith('tab-dup', 'ws-1');
      expect(mockOpenTabFn).not.toHaveBeenCalled();
      // No navigation needed — the tab is already on the exact URL
      expect(embeddedBrowserCdp.evaluate).not.toHaveBeenCalled();
      expect(result.results[0]?.result).toMatchObject({
        reused: true,
        tabId: 'tab-dup',
        url: 'http://localhost:3000/board',
      });
    });

    it('forwards pin intent when it reuses an exact-URL model tab', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue('tab-dup');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board', pin: true }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.focusTab).toHaveBeenCalledWith('tab-dup', 'ws-1', true);
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('allowDuplicate: true bypasses reuse entirely and opens a new tab', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue('tab-dup');

      const result = await executeActions(
        {
          actions: [
            { action: 'openTab', url: 'http://localhost:3000/board', allowDuplicate: true },
          ],
        },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.findModelTabByExactUrl).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://localhost:3000/board',
        undefined,
        true,
        undefined,
        undefined,
        'agent-1',
      );
    });

    it('does not dedupe when no agentId is provided (non-agent opens)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue('tab-dup');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board' }] },
        mockOpenTabFn,
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.findModelTabByExactUrl).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://localhost:3000/board',
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
      );
    });

    it('dedupes against the rewritten URL in remote mode and echoes the rewrite', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue('tab-dup');
      const remoteContext = () => ({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
      const fetchMock = vi.fn().mockResolvedValue({ ok: true });
      vi.stubGlobal('fetch', fetchMock);
      try {
        const result = await executeActions(
          { actions: [{ action: 'openTab', url: 'http://localhost:3000/' }] },
          mockOpenTabFn,
          'agent-1',
          'ws-1',
          remoteContext,
        );

        expect(result.success).toBe(true);
        expect(embeddedBrowserCdp.findModelTabByExactUrl).toHaveBeenCalledWith(
          'http://10.0.0.5:3000/',
          'agent-1',
          'ws-1',
        );
        expect(result.results[0]?.result).toMatchObject({
          reused: true,
          tabId: 'tab-dup',
          url: 'http://10.0.0.5:3000/',
          requestedUrl: 'http://localhost:3000/',
          finalUrl: 'http://10.0.0.5:3000/',
          rewritten: true,
        });
      } finally {
        vi.unstubAllGlobals();
      }
    });

    it('leases a newly opened agent tab so a repeat openTab dedupes onto it', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened', tabId: 'tab-new' });

      const first = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(first.success).toBe(true);
      // Agent opens force a genuinely new tab in the renderer — the executor
      // is the dedupe authority.
      expect(mockOpenTabFn).toHaveBeenCalledWith(
        'http://localhost:3000/board',
        undefined,
        true,
        undefined,
        undefined,
        'agent-1',
      );
      // The new tab is owned at open time so it counts as the agent's own; a
      // non-tunneled open clears any stale requested-URL identity, and the
      // default emulated viewport is recorded (monorepo#2857).
      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-new', 'agent-1', null, {
        width: 1280,
        height: 800,
      });

      // Second openTab for the same URL now finds the owned tab and reuses it.
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue('tab-new');
      mockOpenTabFn.mockClear();
      const second = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(second.results[0]?.result).toMatchObject({ reused: true, tabId: 'tab-new' });
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('does not record ownership when openTabFn reports failure or returns no tabId', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.setTabOwner).mockClear();
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened' });

      await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(embeddedBrowserCdp.setTabOwner).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // openTab tunnel dedupe (#2787)
  // =========================================================================
  describe('openTab tunnel dedupe (#2787)', () => {
    const remoteContext = () => ({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
    const REQUESTED = 'http://127.0.0.1:5190/';

    beforeEach(async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockResolvedValue(undefined);
      vi.mocked(embeddedBrowserCdp.findModelTabByRequestedUrl).mockResolvedValue(undefined);
      // The daemon-loopback target is never directly reachable — every
      // resolution takes the tunnel-fallback path.
      vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('fetch failed')));
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    /**
     * Tunnel provider mirroring the real ones (TunnelManager, DirectRelay):
     * forwardPort is idempotent — a repeat call for an already-forwarded
     * remote port returns the existing forward's local port — and minted
     * forwards are exposed through activeForwards.
     */
    function idempotentTunnelProvider() {
      const forwards = new Map<number, number>();
      let nextPort = 55001;
      const forwardPort = vi.fn(async (remotePort: number) => {
        let localPort = forwards.get(remotePort);
        if (localPort === undefined) {
          localPort = nextPort++;
          forwards.set(remotePort, localPort);
        }
        return localPort;
      });
      return {
        forwardPort,
        activeForwards: () =>
          [...forwards.entries()].map(([remotePort, localPort]) => ({ remotePort, localPort })),
      };
    }

    it('repeat identical openTab calls converge on one tab instead of minting duplicates', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      const provider = idempotentTunnelProvider();
      // Simulate the live tab registry: exact-URL dedupe matches once a tab
      // is open on that URL.
      const openedUrls: string[] = [];
      mockOpenTabFn.mockImplementation((url: string) => {
        openedUrls.push(url);
        return { success: true, message: 'opened', tabId: 'tab-1' };
      });
      vi.mocked(embeddedBrowserCdp.findModelTabByExactUrl).mockImplementation(async (url) =>
        openedUrls.includes(url) ? 'tab-1' : undefined,
      );

      const exec = () =>
        executeActions(
          { actions: [{ action: 'openTab', url: REQUESTED }] },
          mockOpenTabFn,
          'agent-1',
          'ws-1',
          remoteContext,
          () => provider,
        );

      const first = await exec();
      expect(first.success).toBe(true);
      expect(first.results[0]?.result).toMatchObject({
        tabId: 'tab-1',
        tunneled: true,
        finalUrl: 'http://127.0.0.1:55001/',
      });

      const second = await exec();
      expect(second.success).toBe(true);
      // The same requested URL resolves to the same tunnel URL (forwardPort
      // is idempotent), so the exact-URL dedupe finds the first tab instead
      // of opening another. forwardPort is called each time so the ownership
      // wrapper seam records the caller.
      expect(second.results[0]?.result).toMatchObject({
        reused: true,
        tabId: 'tab-1',
        url: 'http://127.0.0.1:55001/',
      });
      expect(provider.forwardPort).toHaveBeenCalledTimes(2);
      expect(mockOpenTabFn).toHaveBeenCalledTimes(1);
    });

    it('records the requested URL on the ownership of a newly opened tunneled tab', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      const provider = idempotentTunnelProvider();
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened', tabId: 'tab-new' });

      await executeActions(
        { actions: [{ action: 'openTab', url: REQUESTED }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-new', 'agent-1', REQUESTED, {
        width: 1280,
        height: 800,
      });
    });

    it('falls back to requestedUrl dedupe when the old forward died and a new port was minted', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      // The old forward is gone: activeForwards is empty, so a fresh port
      // is minted and the exact-URL match cannot hit.
      const forwardPort = vi.fn().mockResolvedValue(55002);
      const provider = { forwardPort, activeForwards: () => [] };
      vi.mocked(embeddedBrowserCdp.findModelTabByRequestedUrl).mockResolvedValue('tab-old');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: REQUESTED }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.findModelTabByRequestedUrl).toHaveBeenCalledWith(
        REQUESTED,
        'agent-1',
        'ws-1',
      );
      // The reused tab is re-pointed at the fresh tunnel URL and focused.
      expect(embeddedBrowserCdp.evaluate).toHaveBeenCalledWith(
        'tab-old',
        `window.location.href = ${JSON.stringify('http://127.0.0.1:55002/')}`,
      );
      expect(embeddedBrowserCdp.focusTab).toHaveBeenCalledWith('tab-old', 'ws-1');
      expect(result.results[0]?.result).toMatchObject({
        reused: true,
        tabId: 'tab-old',
        url: 'http://127.0.0.1:55002/',
        tunneled: true,
      });
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });

    it('opens a new tab when re-pointing the requestedUrl-matched tab fails', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      const provider = { forwardPort: vi.fn().mockResolvedValue(55002), activeForwards: () => [] };
      vi.mocked(embeddedBrowserCdp.findModelTabByRequestedUrl).mockResolvedValue('tab-old');
      vi.mocked(embeddedBrowserCdp.evaluate).mockRejectedValueOnce(new Error('tab gone'));
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened', tabId: 'tab-new' });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: REQUESTED }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(result.success).toBe(true);
      // The tab stays owned by the agent (ownership is persistent) — the
      // open just falls through to creating a new tab.
      expect(mockOpenTabFn).toHaveBeenCalledTimes(1);
      expect(result.results[0]?.result).toMatchObject({ tabId: 'tab-new' });
    });

    it('allowDuplicate: true bypasses the requestedUrl fallback too', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      const provider = idempotentTunnelProvider();
      vi.mocked(embeddedBrowserCdp.findModelTabByRequestedUrl).mockResolvedValue('tab-old');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: REQUESTED, allowDuplicate: true }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.findModelTabByExactUrl).not.toHaveBeenCalled();
      expect(embeddedBrowserCdp.findModelTabByRequestedUrl).not.toHaveBeenCalled();
      expect(mockOpenTabFn).toHaveBeenCalledTimes(1);
    });

    it('a tunneled navigate records the requested URL on the tab ownership', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      const provider = idempotentTunnelProvider();
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as never);
      // The agent owns the tab (ownership-enforced, #2857).
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: REQUESTED }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(result.success).toBe(true);
      // The tab's content changed to the tunneled target, so its ownership
      // identity is refreshed — a later openTab for the same requested URL
      // dedupes onto this tab instead of opening another.
      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-1', 'agent-1', REQUESTED);
    });

    it('a non-tunneled navigate clears any stale requested URL on the tab ownership', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as never);
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');
      vi.unstubAllGlobals(); // target reachable — no tunnel involved

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'http://localhost:3000/other' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      // The tab navigated away, so a stale requestedUrl from an earlier
      // tunneled open must not keep matching it.
      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-1', 'agent-1', null);
    });

    it('never consults the requestedUrl fallback for non-tunneled opens (#2541 unchanged)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened', tabId: 'tab-new' });

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/board' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.findModelTabByRequestedUrl).not.toHaveBeenCalled();
      // Non-tunneled opens clear the ownership's requested URL (null).
      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-new', 'agent-1', null, {
        width: 1280,
        height: 800,
      });
    });
  });

  // =========================================================================
  // Main-driven navigations persist the requested URL (monorepo#2789)
  // =========================================================================
  describe('notifyTabNavigated on main-driven navigations (#2789)', () => {
    const REQUESTED = 'http://daemon.localhost:8080/page';
    const remoteContext = () => ({ daemonIsRemote: true, daemonHost: '10.0.0.5' });
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal('fetch', fetchMock);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('a tunneled navigate notifies the renderer with the tunnel URL and requested URL', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as never);
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const provider = { forwardPort: vi.fn().mockResolvedValue(45678), activeForwards: () => [] };

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: REQUESTED }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(result.success).toBe(true);
      // The renderer persists the tunneled URL + requested URL with the tab
      // so a restart re-runs the rewrite instead of restoring the dead port.
      expect(embeddedBrowserCdp.notifyTabNavigated).toHaveBeenCalledWith(
        'tab-1',
        'ws-1',
        'http://127.0.0.1:45678/page',
        REQUESTED,
      );
    });

    it('a non-rewritten navigate notifies without a requested URL (clears it)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-1',
        webContentsId: 1,
      } as never);
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');

      const result = await executeActions(
        { actions: [{ action: 'navigate', url: 'https://example.test/' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.notifyTabNavigated).toHaveBeenCalledWith(
        'tab-1',
        'ws-1',
        'https://example.test/',
        undefined,
      );
    });

    it('an openTab requestedUrl-dedupe reuse notifies with the fresh tunnel URL', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      fetchMock.mockRejectedValue(new TypeError('fetch failed'));
      const provider = { forwardPort: vi.fn().mockResolvedValue(55002), activeForwards: () => [] };
      vi.mocked(embeddedBrowserCdp.findModelTabByRequestedUrl).mockResolvedValue('tab-old');

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: REQUESTED }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
        remoteContext,
        () => provider,
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.notifyTabNavigated).toHaveBeenCalledWith(
        'tab-old',
        'ws-1',
        'http://127.0.0.1:55002/page',
        REQUESTED,
      );
    });

  });

  // =========================================================================
  // Tab ownership enforcement + claimTab (monorepo#2857)
  // =========================================================================
  describe('tab ownership enforcement (#2857)', () => {
    const enforcedActions = [
      { action: 'focusTab', tabId: 'tab-x' },
      { action: 'getAccessibilityTree', tabId: 'tab-x' },
      { action: 'screenshot', tabId: 'tab-x' },
      { action: 'evaluate', tabId: 'tab-x', expression: '1 + 1' },
      { action: 'snapshot', tabId: 'tab-x' },
      { action: 'startSession', tabId: 'tab-x' },
      { action: 'resetTab', tabId: 'tab-x' },
      { action: 'resizeTab', tabId: 'tab-x', width: 1024 },
      { action: 'navigate', tabId: 'tab-x', url: 'https://example.test/' },
      { action: 'closeTab', tabId: 'tab-x' },
    ] as const;

    it.each(enforcedActions)(
      "$action by an agent on another agent's tab fails with a structured not-owner error",
      async (action) => {
        const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
        vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-owner');

        const result = await executeActions(
          { actions: [action] },
          mockOpenTabFn,
          'agent-intruder',
          'ws-1',
        );

        expect(result.success).toBe(false);
        expect(result.results[0]).toMatchObject({
          action: action.action,
          success: false,
          errorCode: 'not-owner',
          ownerAgentId: 'agent-owner',
        });
        expect(result.results[0]?.error).toContain('agent-owner');
      },
    );

    it.each(enforcedActions)(
      '$action by an agent on an unowned tab fails with not-owner (ownerAgentId null)',
      async (action) => {
        const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
        vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce(undefined);

        const result = await executeActions(
          { actions: [action] },
          mockOpenTabFn,
          'agent-1',
          'ws-1',
        );

        expect(result.results[0]).toMatchObject({
          action: action.action,
          success: false,
          errorCode: 'not-owner',
          ownerAgentId: null,
        });
        expect(result.results[0]?.error).toContain('claimTab');
      },
    );

    it('enforcement resolves the sequence-level default tabId, not just action.tabId', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-owner');

      const result = await executeActions(
        { actions: [{ action: 'screenshot' }], tabId: 'tab-default' },
        mockOpenTabFn,
        'agent-intruder',
        'ws-1',
      );

      expect(embeddedBrowserCdp.resolveTabOwner).toHaveBeenCalledWith('tab-default', 'ws-1');
      expect(result.results[0]).toMatchObject({ errorCode: 'not-owner' });
    });

    it('enforcement covers the first-tab fallback when no tabId is given', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.getFirstTab).mockReturnValue({
        tabId: 'tab-first',
        webContentsId: 1,
      } as never);
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-owner');

      const result = await executeActions(
        { actions: [{ action: 'screenshot' }] },
        mockOpenTabFn,
        'agent-intruder',
        'ws-1',
      );

      expect(embeddedBrowserCdp.resolveTabOwner).toHaveBeenCalledWith('tab-first', 'ws-1');
      expect(result.results[0]).toMatchObject({ errorCode: 'not-owner' });
    });

    it('the owner itself passes enforcement and the action executes', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');

      const result = await executeActions(
        { actions: [{ action: 'screenshot', tabId: 'tab-x' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.screenshot).toHaveBeenCalled();
    });

    it("user-initiated calls (no agentId) are unrestricted on any agent's tab", async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValue('agent-owner');
      vi.mocked(embeddedBrowserCdp.closeTab).mockResolvedValue({ tabId: 'tab-x' });

      const result = await executeActions(
        {
          actions: [
            { action: 'screenshot', tabId: 'tab-x' },
            { action: 'closeTab', tabId: 'tab-x' },
          ],
        },
        mockOpenTabFn,
        undefined,
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.resolveTabOwner).not.toHaveBeenCalled();
      expect(embeddedBrowserCdp.screenshot).toHaveBeenCalled();
      expect(embeddedBrowserCdp.closeTab).toHaveBeenCalled();
    });

    it('listTabs is not ownership-enforced for agents', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValue('agent-owner');

      const result = await executeActions(
        { actions: [{ action: 'listTabs' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.resolveTabOwner).not.toHaveBeenCalled();
    });

    it("agent openTab position replace on a tab it does not own fails with not-owner", async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({
        tabs: [{ tabId: 'tab-user', url: 'http://a/', title: 'A', mounted: true }] as any,
        stale: false,
      });
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce(undefined);

      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'https://example.test/', position: 'replace' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.results[0]).toMatchObject({
        action: 'openTab',
        errorCode: 'not-owner',
        ownerAgentId: null,
      });
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });
  });

  describe('claimTab action (#2857)', () => {
    async function mockTabExists(tabId: string) {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({
        tabs: [{ tabId, url: 'http://a/', title: 'A', mounted: true }] as any,
        stale: false,
      });
      return embeddedBrowserCdp;
    }

    it('claims an existing unowned tab and notifies the renderer to persist the owner', async () => {
      const embeddedBrowserCdp = await mockTabExists('tab-1');
      vi.mocked(embeddedBrowserCdp.claimTab).mockReturnValueOnce({
        status: 'claimed',
        alreadyOwned: false,
      });

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1', width: 1024, height: 768 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.claimTab).toHaveBeenCalledWith('tab-1', 'agent-1', {
        width: 1024,
        height: 768,
      });
      expect(embeddedBrowserCdp.notifyTabOwnerChanged).toHaveBeenCalledWith(
        'tab-1',
        'ws-1',
        'agent-1',
      );
      expect(result.results[0]?.result).toMatchObject({
        tabId: 'tab-1',
        ownerAgentId: 'agent-1',
        width: 1024,
        height: 768,
      });
    });

    it('defaults the claim height when omitted', async () => {
      const embeddedBrowserCdp = await mockTabExists('tab-1');

      await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1', width: 1024 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(embeddedBrowserCdp.claimTab).toHaveBeenCalledWith('tab-1', 'agent-1', {
        width: 1024,
        height: 800,
      });
    });

    it('a claim without width fails schema validation before any ownership change', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(false);
      expect(embeddedBrowserCdp.claimTab).not.toHaveBeenCalled();
      expect(embeddedBrowserCdp.notifyTabOwnerChanged).not.toHaveBeenCalled();
    });

    it("claiming another agent's tab returns a structured already-claimed error", async () => {
      const embeddedBrowserCdp = await mockTabExists('tab-1');
      vi.mocked(embeddedBrowserCdp.claimTab).mockReturnValueOnce({
        status: 'already-claimed',
        ownerAgentId: 'agent-owner',
      });

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1', width: 1024 }] },
        mockOpenTabFn,
        'agent-2',
        'ws-1',
      );

      expect(result.results[0]).toMatchObject({
        action: 'claimTab',
        success: false,
        errorCode: 'already-claimed',
        ownerAgentId: 'agent-owner',
      });
      expect(result.results[0]?.error).toContain('agent-owner');
      expect(embeddedBrowserCdp.notifyTabOwnerChanged).not.toHaveBeenCalled();
    });

    it('re-claiming an owned tab reports idempotent success', async () => {
      const embeddedBrowserCdp = await mockTabExists('tab-1');
      vi.mocked(embeddedBrowserCdp.claimTab).mockReturnValueOnce({
        status: 'claimed',
        alreadyOwned: true,
      });

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1', width: 800 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(result.results[0]?.result).toMatchObject({ alreadyOwned: true });
    });

    it('fails when the tab does not exist in the workspace', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({
        tabs: [] as any,
        stale: false,
      });

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-ghost', width: 1024 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.results[0]?.success).toBe(false);
      expect(result.results[0]?.error).toContain('not found');
      expect(embeddedBrowserCdp.claimTab).not.toHaveBeenCalled();
    });

    it('fails for user-initiated calls (no agentId)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1', width: 1024 }] },
        mockOpenTabFn,
        undefined,
        'ws-1',
      );

      expect(result.results[0]?.success).toBe(false);
      expect(embeddedBrowserCdp.claimTab).not.toHaveBeenCalled();
    });

    it('refuses to claim from a stale (cached) tab list — the tab may no longer exist', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({
        tabs: [{ tabId: 'tab-1', url: 'http://a/', title: 'A', mounted: false }] as any,
        stale: true,
      });

      const result = await executeActions(
        { actions: [{ action: 'claimTab', tabId: 'tab-1', width: 1024 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.results[0]?.success).toBe(false);
      expect(result.results[0]?.error).toContain('could not be refreshed');
      expect(embeddedBrowserCdp.claimTab).not.toHaveBeenCalled();
      expect(embeddedBrowserCdp.notifyTabOwnerChanged).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // resizeTab action (docs/protocol §5.9)
  // =========================================================================
  describe('resizeTab action (§5.9)', () => {
    it('resizes an owned tab and returns the recorded size', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');
      vi.mocked(embeddedBrowserCdp.resizeTab).mockReturnValueOnce({ width: 390, height: 844 });

      const result = await executeActions(
        { actions: [{ action: 'resizeTab', tabId: 'tab-1', width: 390, height: 844 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(true);
      expect(embeddedBrowserCdp.resizeTab).toHaveBeenCalledWith('tab-1', 390, 844);
      expect(result.results[0]?.result).toEqual({ tabId: 'tab-1', width: 390, height: 844 });
    });

    it('omitted height keeps the current emulated height', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resolveTabOwner).mockResolvedValueOnce('agent-1');
      vi.mocked(embeddedBrowserCdp.resizeTab).mockReturnValueOnce({ width: 390, height: 768 });

      const result = await executeActions(
        { actions: [{ action: 'resizeTab', tabId: 'tab-1', width: 390 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(embeddedBrowserCdp.resizeTab).toHaveBeenCalledWith('tab-1', 390, undefined);
      expect(result.results[0]?.result).toEqual({ tabId: 'tab-1', width: 390, height: 768 });
    });

    it('a resize without width fails schema validation before any state change', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

      const result = await executeActions(
        { actions: [{ action: 'resizeTab', tabId: 'tab-1' }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(false);
      expect(embeddedBrowserCdp.resizeTab).not.toHaveBeenCalled();
    });

    it.each([0, -100, 1.5, Number.NaN])(
      'rejects a non-positive-integer width via schema validation: %j',
      async (width) => {
        const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');

        const result = await executeActions(
          { actions: [{ action: 'resizeTab', tabId: 'tab-1', width }] },
          mockOpenTabFn,
          'agent-1',
          'ws-1',
        );

        expect(result.success).toBe(false);
        expect(embeddedBrowserCdp.resizeTab).not.toHaveBeenCalled();
      },
    );

    it('fails with a claimTab hint on an unowned tab reached by a user call', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      vi.mocked(embeddedBrowserCdp.resizeTab).mockReturnValueOnce(undefined);

      // No agentId: user calls skip ownership enforcement, but an unowned
      // tab has no emulated viewport to resize (§5.9: no size op for native
      // tabs).
      const result = await executeActions(
        { actions: [{ action: 'resizeTab', tabId: 'tab-user', width: 800 }] },
        mockOpenTabFn,
        undefined,
        'ws-1',
      );

      expect(result.results[0]?.success).toBe(false);
      expect(result.results[0]?.error).toContain('claimTab');
    });
  });

  // =========================================================================
  // openTab viewport size (docs/protocol §5.9)
  // =========================================================================
  describe('openTab viewport size (§5.9)', () => {
    it('records an explicit width/height on the new tab ownership', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened', tabId: 'tab-new' });

      await executeActions(
        {
          actions: [
            { action: 'openTab', url: 'http://localhost:3000/', width: 390, height: 844 },
          ],
        },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-new', 'agent-1', null, {
        width: 390,
        height: 844,
      });
    });

    it('defaults an omitted dimension per-axis (width→1280, height→800)', async () => {
      const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
      mockOpenTabFn.mockReturnValueOnce({ success: true, message: 'opened', tabId: 'tab-new' });

      await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/', width: 390 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(embeddedBrowserCdp.setTabOwner).toHaveBeenCalledWith('tab-new', 'agent-1', null, {
        width: 390,
        height: 800,
      });
    });

    it('rejects a fractional width via schema validation before opening', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000/', width: 100.5 }] },
        mockOpenTabFn,
        'agent-1',
        'ws-1',
      );

      expect(result.success).toBe(false);
      expect(mockOpenTabFn).not.toHaveBeenCalled();
    });
  });
});

// =============================================================================
// Shared BROWSER_PROTOCOLS constants
// =============================================================================
describe('BROWSER_PROTOCOLS shared constants', () => {
  it('should have consistent protocol lists', () => {
    // NAVIGATION_ALLOWED should be a subset of WEBVIEW_ALLOWED
    for (const proto of BROWSER_PROTOCOLS.NAVIGATION_ALLOWED) {
      expect(BROWSER_PROTOCOLS.WEBVIEW_ALLOWED).toContain(proto);
    }
  });

  it('should not have any overlap between BLOCKED and allowed lists', () => {
    for (const blocked of BROWSER_PROTOCOLS.BLOCKED) {
      expect(BROWSER_PROTOCOLS.WEBVIEW_ALLOWED).not.toContain(blocked);
      expect(BROWSER_PROTOCOLS.NAVIGATION_ALLOWED).not.toContain(blocked);
    }
  });

  it('should include http: and https: in all allowed lists', () => {
    expect(BROWSER_PROTOCOLS.WEBVIEW_ALLOWED).toContain('http:');
    expect(BROWSER_PROTOCOLS.WEBVIEW_ALLOWED).toContain('https:');
    expect(BROWSER_PROTOCOLS.NAVIGATION_ALLOWED).toContain('http:');
    expect(BROWSER_PROTOCOLS.NAVIGATION_ALLOWED).toContain('https:');
    expect(BROWSER_PROTOCOLS.EXTERNAL).toContain('http:');
    expect(BROWSER_PROTOCOLS.EXTERNAL).toContain('https:');
  });

  it('should include file: in navigation and webview allowed lists', () => {
    expect(BROWSER_PROTOCOLS.WEBVIEW_ALLOWED).toContain('file:');
    expect(BROWSER_PROTOCOLS.NAVIGATION_ALLOWED).toContain('file:');
  });

  it('should block dangerous protocols', () => {
    expect(BROWSER_PROTOCOLS.BLOCKED).toContain('javascript:');
    expect(BROWSER_PROTOCOLS.BLOCKED).toContain('data:');
    expect(BROWSER_PROTOCOLS.BLOCKED).toContain('vbscript:');
    expect(BROWSER_PROTOCOLS.BLOCKED).toContain('blob:');
  });

  it('should not include file: in EXTERNAL (system browser only needs http/https)', () => {
    expect(BROWSER_PROTOCOLS.EXTERNAL).not.toContain('file:');
  });
});
