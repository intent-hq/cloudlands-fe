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

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { BROWSER_PROTOCOLS } from '../../../shared/constants';

// Mock the CDP service before importing the executor
vi.mock('../main/embedded-browser-cdp-service', () => ({
  embeddedBrowserCdp: {
    findIdleTab: vi.fn().mockReturnValue(null),
    getFirstTab: vi.fn().mockReturnValue(null),
    evaluate: vi.fn().mockResolvedValue(undefined),
    focusTab: vi.fn(),
    closeTab: vi.fn().mockResolvedValue({ tabId: 'tab-1' }),
    touchLease: vi.fn(),
    releaseLease: vi.fn(),
    listAllTabs: vi.fn().mockResolvedValue([]),
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
    it('should allow http:// URLs', async () => {
      const result = await executeActions(
        { actions: [{ action: 'openTab', url: 'http://localhost:3000' }] },
        mockOpenTabFn,
      );
      expect(result.success).toBe(true);
      expect(mockOpenTabFn).toHaveBeenCalledWith('http://localhost:3000', undefined);
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
      expect(mockOpenTabFn).toHaveBeenCalledWith('file:///Users/me/index.html', undefined);
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
