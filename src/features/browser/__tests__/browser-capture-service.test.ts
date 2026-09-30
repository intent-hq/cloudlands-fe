import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

let cdpMessageHandler: ((method: string, params: unknown) => void) | undefined;

const electronMocks = vi.hoisted(() => ({ getPath: vi.fn() }));
const cryptoMocks = vi.hoisted(() => ({ randomUUID: vi.fn<() => string>() }));

// Session ids are `session-<uuid>`; the #5643 regression pins the uuid shape.
// Both the named export and `default` must carry the mock: the module runner
// resolves the service's named import of this Node builtin through `default`.
vi.mock('crypto', async () => {
  const actual = await vi.importActual<typeof import('crypto')>('crypto');
  cryptoMocks.randomUUID.mockImplementation(actual.randomUUID);
  return {
    ...actual,
    randomUUID: cryptoMocks.randomUUID,
    default: { ...actual, randomUUID: cryptoMocks.randomUUID },
  };
});

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
      if (method === 'Page.addScriptToEvaluateOnNewDocument') return { identifier: 'early-script' };
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
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it.each([
    ['hex-leading', 'abcdef00-0000-4000-8000-000000000001'],
    ['digit-leading', '12345678-0000-4000-8000-000000000002'],
  ])(
    'records the real session start time in session.json after a captured step for a %s session id (#5643)',
    async (_shape, uuid) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      const startedAt = new Date('2026-09-22T06:00:00.000Z');
      const endedAt = new Date('2026-09-22T06:05:00.000Z');
      vi.setSystemTime(startedAt);
      cryptoMocks.randomUUID.mockReturnValueOnce(uuid);

      const session = await browserCapture.startSession({
        workspaceId: 'workspace-a',
        name: 'start-time-session',
      });
      expect(session.id).toBe(`session-${uuid}`);

      await browserCapture.captureStep(session.id, 'workspace-a', 'first-step');

      vi.setSystemTime(endedAt);
      const result = await browserCapture.endSession(session.id, 'workspace-a');

      expect(result.metadata.startTime).toBe(startedAt.toISOString());
      expect(result.metadata.endTime).toBe(endedAt.toISOString());
      expect(result.metadata.stepCount).toBe(1);
      const written = JSON.parse(
        await fs.readFile(path.join(session.outputDir, 'session.json'), 'utf-8'),
      ) as { startTime: string; endTime: string };
      expect(written.startTime).toBe(startedAt.toISOString());
      expect(written.endTime).toBe(endedAt.toISOString());
      expect(session.startTime).toBe(startedAt.toISOString());
      await expect(
        browserCapture.getSummary('workspace-a', session.captureId),
      ).resolves.toMatchObject({ url: 'https://example.test/page', title: 'Example' });
    },
  );

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
  it('captures thrown exceptions and failing HTTP requests before navigation', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    await browserCapture.startCapture(session.id, 'workspace-a');
    cdpMessageHandler?.('Runtime.exceptionThrown', {
      exceptionDetails: {
        text: 'Uncaught',
        exception: {
          description:
            'Error: fixture throw\\n    at boot (https://example.test/app.js?token=secret:1:2)',
        },
        stackTrace: {
          callFrames: [
            {
              functionName: 'boot',
              url: 'https://example.test/app.js?token=secret',
              lineNumber: 1,
              columnNumber: 2,
            },
          ],
        },
      },
    });
    cdpMessageHandler?.('Network.requestWillBeSent', {
      requestId: 'failure',
      wallTime: 1700000000,
      request: { method: 'GET', url: 'https://user:password@example.test/module.js?token=secret' },
      initiator: {
        type: 'script',
        stack: {
          callFrames: [
            {
              functionName: 'boot',
              url: 'https://example.test/entry.js',
              lineNumber: 4,
              columnNumber: 2,
            },
          ],
        },
      },
    });
    cdpMessageHandler?.('Network.responseReceived', {
      requestId: 'failure',
      response: { status: 500, statusText: 'Server Error', mimeType: 'text/plain' },
    });
    vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockResolvedValueOnce({
      body: 'module failed token=secret',
      base64Encoded: false,
    });
    cdpMessageHandler?.('Network.loadingFinished', { requestId: 'failure', encodedDataLength: 30 });
    await browserCapture.endCapture(session.id, 'workspace-a');
    const result = await browserCapture.endSession(session.id, 'workspace-a');
    const consoleLog = await fs.readFile(result.console, 'utf8');
    const networkLog = await fs.readFile(result.network, 'utf8');
    expect(consoleLog).toContain('fixture throw');
    expect(consoleLog).toContain('boot');
    expect(networkLog).toContain('module failed');
    expect(networkLog).toContain('entry.js');
    expect(networkLog).toContain('2023-11-14T22:13:20.000Z');
    expect(consoleLog + networkLog).not.toMatch(/password|secret/);
    expect(embeddedBrowserCdp.sendCdpCommand).toHaveBeenCalledWith(
      1,
      'Page.addScriptToEvaluateOnNewDocument',
      expect.objectContaining({ source: expect.any(String) }),
    );
  });

  it('cleans up the original guest even when the tab vanishes', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    await browserCapture.startCapture(session.id, 'workspace-a');
    vi.mocked(embeddedBrowserCdp.listAllTabs).mockResolvedValueOnce({ tabs: [], stale: false });
    await browserCapture.endCapture(session.id, 'workspace-a');
    expect(cdpMessageHandler).toBeUndefined();
    await browserCapture.endSession(session.id, 'workspace-a');
  });

  it('retrieves only the caller-owned bounded artifacts after a session ends', async () => {
    const start = await executeActions(
      { actions: [{ action: 'startSession', name: 'owned-read' }] },
      undefined,
      'agent-1',
      'workspace-a',
    );
    const session = start.results[0]?.result as CaptureSession;
    await executeActions(
      { actions: [{ action: 'endSession', sessionId: session.id }] },
      undefined,
      'agent-1',
      'workspace-a',
    );
    const read = (agent: string, artifact = 'session.json') =>
      executeActions(
        {
          actions: [
            { action: 'readCapture', captureId: session.captureId, artifact, maxBytes: 32 },
          ],
        },
        undefined,
        agent,
        'workspace-a',
      );
    const own = await read('agent-1');
    expect(own.success).toBe(true);
    expect(own.results[0]?.result).toMatchObject({
      encoding: 'base64',
      nextOffset: 32,
      eof: false,
    });
    expect((await read('agent-2')).success).toBe(false);
    expect((await read('agent-1', '../outside')).success).toBe(false);
    for (const captureId of ['../outside', '/tmp/private', '.', 'missing/capture']) {
      await expect(
        browserCapture.readCapture('workspace-a', captureId, 'session.json', 'agent-1'),
      ).rejects.toThrow();
    }
    for (const [offset, maxBytes] of [
      [-1, 32],
      [0, 65537],
      [0, 0],
      [0.5, 32],
    ]) {
      await expect(
        browserCapture.readCapture(
          'workspace-a',
          session.captureId,
          'session.json',
          'agent-1',
          offset,
          maxBytes,
        ),
      ).rejects.toThrow('Invalid');
    }
    const first = own.results[0]?.result as { data: string };
    const rest = await browserCapture.readCapture(
      'workspace-a',
      session.captureId,
      'session.json',
      'agent-1',
      32,
    );
    expect(rest.eof).toBe(true);
    expect(
      Buffer.concat([Buffer.from(first.data, 'base64'), Buffer.from(rest.data, 'base64')]).toString(
        'utf8',
      ),
    ).toBe(await fs.readFile(path.join(session.outputDir, 'session.json'), 'utf8'));
    expect(
      await browserCapture.readCapture(
        'workspace-a',
        session.captureId,
        'session.json',
        'agent-1',
        rest.totalBytes,
      ),
    ).toMatchObject({ data: '', eof: true });
  });
  it('bounds diagnostic storage across restart intervals and records dropped events', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    for (let interval = 0; interval < 2; interval++) {
      await browserCapture.startCapture(session.id, 'workspace-a');
      for (let n = 0; n < 5000; n++)
        cdpMessageHandler?.('Runtime.consoleAPICalled', {
          type: 'error',
          args: [{ value: 'fixture-' + 'x'.repeat(17000) }],
        });
      await browserCapture.endCapture(session.id, 'workspace-a');
    }
    const result = await browserCapture.endSession(session.id, 'workspace-a');
    expect((await fs.stat(result.console)).size).toBeLessThan(4 * 1024 * 1024 + 4096);
    expect(session.diagnostics.dropped).toBeGreaterThan(0);
    expect(
      JSON.parse(await fs.readFile(path.join(result.dir, 'session.json'), 'utf8')).diagnostics
        .dropped,
    ).toBe(session.diagnostics.dropped);
  });

  it('retains serialized window errors and rejections and removes installed script/binding', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    const originalSend = vi.mocked(embeddedBrowserCdp.sendCdpCommand).getMockImplementation();
    vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(async (_id, method) =>
      method === 'Page.addScriptToEvaluateOnNewDocument' ? { identifier: 'script-early' } : {},
    );
    try {
      await browserCapture.startCapture(session.id, 'workspace-a');
      const call = vi
        .mocked(embeddedBrowserCdp.sendCdpCommand)
        .mock.calls.findLast((c) => c[1] === 'Runtime.addBinding');
      const name = call?.[2]?.name;
      for (const kind of ['window.error', 'unhandledrejection'])
        cdpMessageHandler?.('Runtime.bindingCalled', {
          name,
          payload: JSON.stringify({
            kind,
            message: 'early failure',
            stack:
              'Error: early failure\n at start (https://user:pass@example.test/app.js?key=sensitive)',
            url: 'https://example.test/?token=sensitive',
          }),
        });
      cdpMessageHandler?.('Runtime.bindingCalled', { name, payload: '{bad json' });
      await browserCapture.endCapture(session.id, 'workspace-a');
      expect(session.consoleBuffer.map((m) => m.source)).toEqual([
        'window.error',
        'unhandledrejection',
      ]);
      expect(JSON.stringify(session.consoleBuffer)).not.toMatch(/sensitive|user:pass/);
      expect(embeddedBrowserCdp.sendCdpCommand).toHaveBeenCalledWith(
        1,
        'Page.removeScriptToEvaluateOnNewDocument',
        { identifier: 'script-early' },
      );
      expect(embeddedBrowserCdp.sendCdpCommand).toHaveBeenCalledWith(1, 'Runtime.removeBinding', {
        name,
      });
      await browserCapture.endSession(session.id, 'workspace-a');
    } finally {
      vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(originalSend!);
    }
  });

  it('does not let another agent stop a session or read symlinked artifacts', async () => {
    const start = await executeActions(
      { actions: [{ action: 'startSession', name: 'isolated' }] },
      undefined,
      'agent-1',
      'workspace-a',
    );
    const session = start.results[0]?.result as CaptureSession;
    const stopped = await executeActions(
      { actions: [{ action: 'endSession', sessionId: session.id }] },
      undefined,
      'agent-2',
      'workspace-a',
    );
    expect(stopped.success).toBe(false);
    await browserCapture.endSession(session.id, 'workspace-a');
    const outside = path.join(tempRoot, 'outside.txt');
    await fs.writeFile(outside, 'private');
    await fs.unlink(path.join(session.outputDir, 'network.jsonl'));
    await fs.symlink(outside, path.join(session.outputDir, 'network.jsonl'));
    await expect(
      browserCapture.readCapture('workspace-a', session.captureId, 'network.jsonl', 'agent-1'),
    ).rejects.toThrow();
    await expect(
      browserCapture.readCapture('workspace-b', session.captureId, 'console.jsonl', 'agent-1'),
    ).rejects.toThrow();
  });

  it('keeps separate artifacts when two agents choose the same name', async () => {
    const a = await browserCapture.startSession({
      workspaceId: 'workspace-a',
      ownerAgentId: 'a',
      name: 'same',
    });
    const b = await browserCapture.startSession({
      workspaceId: 'workspace-a',
      ownerAgentId: 'b',
      name: 'same',
    });
    expect(a.captureId).not.toBe(b.captureId);
    await browserCapture.endSession(a.id, 'workspace-a');
    await browserCapture.endSession(b.id, 'workspace-a');
    await expect(
      browserCapture.readCapture('workspace-a', a.captureId, 'session.json', 'b'),
    ).rejects.toThrow('owned');
  });
  it('rolls back listeners when early script installation fails and allows another start', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    const original = vi.mocked(embeddedBrowserCdp.sendCdpCommand).getMockImplementation();
    vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(async (_id, method) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') throw new Error('guest closed');
      return {};
    });
    try {
      await expect(browserCapture.startCapture(session.id, 'workspace-a')).rejects.toThrow(
        'guest closed',
      );
      expect(cdpMessageHandler).toBeUndefined();
      expect(session.captureActive).toBe(false);
    } finally {
      vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(original!);
    }
    await browserCapture.startCapture(session.id, 'workspace-a');
    await browserCapture.endSession(session.id, 'workspace-a');
  });

  it('removes instrumentation when its session ends during capture setup', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    const original = vi.mocked(embeddedBrowserCdp.sendCdpCommand).getMockImplementation();
    let finishSetup!: (value: { identifier: string }) => void;
    let reachedSetup!: () => void;
    const ready = new Promise<void>((resolve) => {
      reachedSetup = resolve;
    });
    vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(async (_id, method) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        reachedSetup();
        return new Promise((resolve) => {
          finishSetup = resolve;
        });
      }
      return {};
    });
    try {
      const starting = browserCapture.startCapture(session.id, 'workspace-a');
      await ready;
      const ending = browserCapture.endSession(session.id, 'workspace-a');
      finishSetup({ identifier: 'late-script' });
      await expect(starting).rejects.toThrow('ended');
      await ending;
      expect(cdpMessageHandler).toBeUndefined();
    } finally {
      vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(original!);
    }
  });

  it('cancels pending capture setup when endCapture is called and permits a later restart', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    const original = vi.mocked(embeddedBrowserCdp.sendCdpCommand).getMockImplementation();
    let finishSetup!: (value: { identifier: string }) => void;
    let reachedSetup!: () => void;
    const ready = new Promise<void>((resolve) => {
      reachedSetup = resolve;
    });
    vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(async (_id, method) => {
      if (method === 'Page.addScriptToEvaluateOnNewDocument') {
        reachedSetup();
        return new Promise((resolve) => {
          finishSetup = resolve;
        });
      }
      return {};
    });
    try {
      const starting = browserCapture.startCapture(session.id, 'workspace-a');
      await ready;
      const stopping = browserCapture.endCapture(session.id, 'workspace-a');
      finishSetup({ identifier: 'cancelled-script' });
      await expect(starting).rejects.toThrow();
      await stopping;
      expect(cdpMessageHandler).toBeUndefined();
      expect(session.captureActive).toBe(false);
    } finally {
      vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockImplementation(original!);
    }
    await browserCapture.startCapture(session.id, 'workspace-a');
    await browserCapture.endSession(session.id, 'workspace-a');
  });

  it('protects new exception details on getSummary while retaining legacy summary reads', async () => {
    const session = await browserCapture.startSession({
      workspaceId: 'workspace-a',
      ownerAgentId: 'agent-1',
    });
    await browserCapture.startCapture(session.id, 'workspace-a');
    cdpMessageHandler?.('Runtime.exceptionThrown', {
      exceptionDetails: { exception: { description: 'private failure detail from agent A' } },
    });
    await browserCapture.endSession(session.id, 'workspace-a');
    const read = (agentId?: string) =>
      executeActions(
        { actions: [{ action: 'getSummary', captureId: session.captureId }] },
        undefined,
        agentId,
        'workspace-a',
      );
    expect((await read('agent-2')).success).toBe(false);
    expect(JSON.stringify(await read('agent-2'))).not.toContain('private failure');
    expect(JSON.stringify(await read('agent-1'))).toContain('private failure');
    expect((await read()).success).toBe(true);
    await fs.unlink(path.join(session.outputDir, 'capture-owner.json'));
    expect((await read('agent-2')).success).toBe(true);
  });

  it('reports unavailable and oversized response bodies without fetching them again', async () => {
    const session = await browserCapture.startSession({ workspaceId: 'workspace-a' });
    await browserCapture.startCapture(session.id, 'workspace-a');
    for (const id of ['unavailable', 'large']) {
      cdpMessageHandler?.('Network.requestWillBeSent', {
        requestId: id,
        request: { method: 'GET', url: 'https://example.test/' + id },
      });
      cdpMessageHandler?.('Network.responseReceived', {
        requestId: id,
        response: { status: 500, mimeType: 'text/plain' },
      });
      if (id === 'unavailable')
        vi.mocked(embeddedBrowserCdp.sendCdpCommand).mockRejectedValueOnce(new Error('evicted'));
      cdpMessageHandler?.('Network.loadingFinished', {
        requestId: id,
        encodedDataLength: id === 'large' ? 1000000 : 10,
      });
    }
    await browserCapture.endCapture(session.id, 'workspace-a');
    expect(session.networkBuffer).toHaveLength(2);
    expect(session.networkBuffer.every((r) => r.failed && r.bodyUnavailable && !r.body)).toBe(true);
    expect(
      vi
        .mocked(embeddedBrowserCdp.sendCdpCommand)
        .mock.calls.filter((c) => c[1] === 'Network.getResponseBody'),
    ).toHaveLength(1);
    await browserCapture.endSession(session.id, 'workspace-a');
  });
});
