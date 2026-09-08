import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cdpMessageHandler: ((method: string, params: unknown) => void) | undefined;

const electronMocks = vi.hoisted(() => ({ getPath: vi.fn() }));

vi.mock('electron', () => ({
  app: { getPath: electronMocks.getPath },
  webContents: { fromId: vi.fn(() => undefined) },
}));

// The action executor imports the workspace-visibility probe from system.ipc
// (workspace-inactive warning, monorepo#3045), which pulls in Electron app
// lifecycle hooks this suite's minimal electron mock does not provide.
vi.mock('../../system/main/system.ipc', () => ({
  getWindowIdForWorkspace: vi.fn(() => 1),
}));

vi.mock('../main/embedded-browser-cdp-service', () => ({
  DEFAULT_AGENT_VIEWPORT: { width: 1280, height: 800 },
  AGENT_VIEWPORT_MIN_PX: 320,
  AGENT_VIEWPORT_MAX_PX: 3840,
  embeddedBrowserCdp: {
    ensureAttached: vi.fn(),
    evaluate: vi.fn(),
    getFirstTab: vi.fn(() => undefined),
    // The capture flows under test run as the tab's owner (#2857).
    resolveTabOwner: vi.fn().mockResolvedValue('agent-1'),
    setTabOwner: vi.fn(),
    getAccessibilityTree: vi.fn().mockResolvedValue(''),
    listAllTabs: vi.fn().mockResolvedValue({
      tabs: [
        {
          tabId: 'tab-1',
          webContentsId: 1,
          mounted: true,
          url: 'https://example.test/page',
          title: 'Example',
        },
      ],
      stale: false,
    }),
    onCdpMessage: vi.fn((_: number, handler: (method: string, params: unknown) => void) => {
      cdpMessageHandler = handler;
      return () => {
        cdpMessageHandler = undefined;
      };
    }),
    screenshot: vi.fn().mockResolvedValue({
      base64: Buffer.from('jpeg-bytes').toString('base64'),
      width: 1280,
      height: 800,
    }),
    sendCdpCommand: vi.fn(async (_: number, method: string) => {
      if (method === 'Tracing.end') {
        queueMicrotask(() => {
          cdpMessageHandler?.('Tracing.dataCollected', { value: [{ name: 'event' }] });
          cdpMessageHandler?.('Tracing.tracingComplete', {});
        });
      }
    }),
  },
}));

import { browserCapture } from '../main/browser-capture-service';
import { executeActions } from '../main/browser-action-executor';
import { embeddedBrowserCdp } from '../main/embedded-browser-cdp-service';
import type { CaptureSession } from '../main/browser-capture-types';

describe('BrowserCaptureService path boundaries', () => {
  let tempRoot: string;
  let previousWorkspaceRoot: string | undefined;

  beforeEach(async () => {
    previousWorkspaceRoot = process.env.WORKSPACES_BASE_DIR;
    tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'browser-capture-'));
    electronMocks.getPath.mockReturnValue(tempRoot);
    process.env.WORKSPACES_BASE_DIR = tempRoot;
    await Promise.all([
      fs.mkdir(path.join(tempRoot, 'workspaces', 'workspace-a'), { recursive: true }),
      fs.mkdir(path.join(tempRoot, 'workspaces', 'workspace-b'), { recursive: true }),
    ]);
  });

  afterEach(async () => {
    if (previousWorkspaceRoot === undefined) delete process.env.WORKSPACES_BASE_DIR;
    else process.env.WORKSPACES_BASE_DIR = previousWorkspaceRoot;
    await fs.rm(tempRoot, { recursive: true, force: true });
    vi.clearAllMocks();
  });

  it('rejects an empty snapshot screenshot before creating screenshot.jpg', async () => {
    vi.mocked(embeddedBrowserCdp.screenshot).mockResolvedValueOnce({
      base64: '',
      width: 1,
      height: 1,
    });
    const outputDir = path.join(
      tempRoot,
      'workspace-state',
      'local',
      'workspace-a',
      'browser-snapshots',
      'example.test',
      'empty-snapshot',
    );

    await expect(
      browserCapture.snapshot({ workspaceId: 'workspace-a', name: 'empty-snapshot' }),
    ).rejects.toThrow(outputDir);
    await expect(fs.stat(path.join(outputDir, 'screenshot.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('rejects an empty capture step before creating screenshot.jpg', async () => {
    const session = await browserCapture.startSession({
      workspaceId: 'workspace-a',
      name: 'empty-step-session',
    });
    vi.mocked(embeddedBrowserCdp.screenshot).mockResolvedValueOnce({
      base64: '',
      width: 1,
      height: 1,
    });
    const stepDir = path.join(session.outputDir, 'step-1-empty-step');

    await expect(
      browserCapture.captureStep(session.id, 'workspace-a', 'empty-step'),
    ).rejects.toThrow(stepDir);
    await expect(fs.stat(path.join(stepDir, 'screenshot.jpg'))).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('sanitizes traversal trace names and writes only inside the session directory', async () => {
    const session = await browserCapture.startSession({
      workspaceId: 'workspace-a',
      name: 'trace-flow',
    });

    const traceId = await browserCapture.startTrace(session.id, 'workspace-a', '../../outside');
    const tracePath = await browserCapture.stopTrace(session.id, 'workspace-a', traceId);
    const relativeTracePath = path.relative(session.outputDir, tracePath);

    expect(traceId).not.toMatch(/[\\/]/);
    expect(relativeTracePath).not.toMatch(/^\.\.(?:[\\/]|$)/);
    expect(path.isAbsolute(relativeTracePath)).toBe(false);
    await expect(fs.readFile(tracePath, 'utf-8')).resolves.toContain('event');
  });

  it('rejects cross-workspace session access and summary traversal', async () => {
    const workspaceTraversal = await executeActions(
      { actions: [{ action: 'startSession', name: 'outside' }] },
      undefined,
      'agent-1',
      '../../outside',
    );
    const startResult = await executeActions(
      { actions: [{ action: 'startSession', name: 'owned-flow' }] },
      undefined,
      'agent-1',
      'workspace-a',
    );
    const session = startResult.results[0]?.result as CaptureSession;
    const summary = {
      capturedAt: '2026-07-24T00:00:00.000Z',
      url: 'https://example.test/page',
      title: 'Example',
      console: {
        total: 0,
        errors: 0,
        warnings: 0,
        info: 0,
        log: 0,
        debug: 0,
        topErrors: [],
        topWarnings: [],
      },
      network: {
        total: 0,
        failed: 0,
        byStatus: {},
        byType: {},
        slowest: [],
        failures: [],
      },
    };
    await fs.writeFile(
      path.join(session.outputDir, 'summary.json'),
      JSON.stringify(summary),
      'utf-8',
    );

    const crossWorkspaceSession = await executeActions(
      { actions: [{ action: 'startCapture', sessionId: session.id }] },
      undefined,
      'agent-2',
      'workspace-b',
    );
    const traversalSummary = await executeActions(
      { actions: [{ action: 'getSummary', captureId: '../../outside' }] },
      undefined,
      'agent-1',
      'workspace-a',
    );
    const ownedSummary = await executeActions(
      { actions: [{ action: 'getSummary', captureId: session.captureId }] },
      undefined,
      'agent-1',
      'workspace-a',
    );
    const crossWorkspaceSummary = await executeActions(
      { actions: [{ action: 'getSummary', captureId: session.captureId }] },
      undefined,
      'agent-2',
      'workspace-b',
    );

    expect(workspaceTraversal.success).toBe(false);
    expect(workspaceTraversal.results[0]?.error).toContain('Invalid workspace ID');
    expect(crossWorkspaceSession.success).toBe(false);
    expect(crossWorkspaceSession.results[0]?.error).toContain(
      'not found for workspace workspace-b',
    );
    expect(traversalSummary.success).toBe(false);
    expect(traversalSummary.results[0]?.error).toContain('must stay within');
    expect(ownedSummary.results[0]?.result).toEqual(summary);
    expect(crossWorkspaceSummary.results[0]?.result).toBeNull();
  });
});
