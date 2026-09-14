/**
 * Tests for the `browser.exec` FE-served reverse-intent handler (GAP-2b,
 * PROTOCOL §5.14). We register the handler on a real `JsonRpcClient` driven by
 * an in-memory fake socket, feed it a daemon-shaped inbound request, and assert
 * the wire response matches the `{ success, results, error? }` envelope
 * GAP-2a's daemon-side `browser_ops::shape_result` expects.
 */

import { EventEmitter } from 'node:events';
import type { Duplex } from 'node:stream';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { JsonRpcClient } from '../../backend/main/json-rpc-client';
import {
  BROWSER_EXEC_METHOD,
  registerBrowserExecReverseHandler,
  type ExecuteBrowserActionsFn,
} from '../main/browser-exec-reverse';
import { parseToolResult } from '../../../lib/components/chat/tool-result-parser';
import { resolveBrowserScreenshotSource } from '../../../lib/components/chat/browser-screenshot-source';
import { IPC_CHANNELS } from '../../../shared/ipc-registry';

// Electron seams for the end-to-end block at the bottom, which drives the
// REAL action executor and REAL CDP service under the handler. The unit
// tests above inject their own executor and never reach these.
const electronMocks = vi.hoisted(() => ({
  sendToWorkspaceWindows: vi.fn(),
  getAllWebContents: vi.fn(() => [] as unknown[]),
  fromId: vi.fn(() => undefined as unknown),
  handlers: new Map<string, (event: unknown, data: unknown) => unknown>(),
}));

vi.mock('electron', () => ({
  __esModule: true,
  ipcMain: {
    handle: vi.fn((channel: string, handler: (event: unknown, data: unknown) => unknown) => {
      electronMocks.handlers.set(channel, handler);
    }),
    on: vi.fn(),
    removeHandler: vi.fn(),
  },
  webContents: {
    getAllWebContents: electronMocks.getAllWebContents,
    fromId: electronMocks.fromId,
  },
  default: {},
}));

vi.mock('../../system/main/system.ipc', () => ({
  sendToWorkspaceWindows: electronMocks.sendToWorkspaceWindows,
  getWindowIdForWorkspace: () => 1,
  getWindowIdsForWorkspace: () => [1],
}));

vi.mock('../main/browser-capture-service', () => ({ browserCapture: {} }));

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => ({ request: vi.fn() }),
}));

const JPEG_1PX =
  '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAP//////////////////////////////////////////////////////////////////////////////////////2wBDAf//////////////////////////////////////////////////////////////////////////////////////wAARCAABAAEDASIAAhEBAxEB/8QAFQABAQAAAAAAAAAAAAAAAAAAAAX/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/9oADAMBAAIQAxAAAAEf/8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABBQJ//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPwF//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPwF//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQAGPwJ//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPyF//9oADAMBAAIAAwAAABAf/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAwEBPxB//8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAgBAgEBPxB//8QAFBABAAAAAAAAAAAAAAAAAAAAAP/aAAgBAQABPxB//9k=';

function parseScreenshotPayload(payload: unknown) {
  return parseToolResult(
    'workspace_api_workspace-mcp',
    { code: 'return await ws.browser.exec([{ action: "screenshot" }])' },
    JSON.stringify(payload),
  );
}

class FakeSocket extends EventEmitter {
  writes: string[] = [];
  write(data: string): boolean {
    this.writes.push(data);
    return true;
  }
  destroy(): void {}
  receive(chunk: string): void {
    this.emit('data', Buffer.from(chunk));
  }
  open(): void {
    this.emit('connect');
  }
}

function makeClient() {
  const socket = new FakeSocket();
  const client = new JsonRpcClient({
    socketFactory: () => socket as unknown as Duplex,
    heartbeatIntervalMs: 0,
  });
  client.start();
  socket.open();
  return { client, socket };
}

const flush = () => new Promise((resolve) => setImmediate(resolve));

describe('registerBrowserExecReverseHandler', () => {
  let executor: ReturnType<
    typeof vi.fn<Parameters<ExecuteBrowserActionsFn>, ReturnType<ExecuteBrowserActionsFn>>
  >;

  beforeEach(() => {
    executor = vi.fn();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('registers under the "browser.exec" method name', () => {
    const { client } = makeClient();
    const registerSpy = vi.spyOn(client, 'registerMethod');
    registerBrowserExecReverseHandler(client, { executor });
    expect(registerSpy).toHaveBeenCalledWith(BROWSER_EXEC_METHOD, expect.any(Function));
    client.dispose();
  });

  it('happy path: invokes executor with parsed params and returns the FE envelope verbatim', async () => {
    const { client, socket } = makeClient();
    const envelope = {
      success: true,
      results: [{ action: 'listTabs', success: true, result: [{ tabId: 'a' }] }],
    };
    executor.mockResolvedValue(envelope);
    registerBrowserExecReverseHandler(client, { executor });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-1',
        method: BROWSER_EXEC_METHOD,
        params: {
          actions: [{ action: 'listTabs' }],
          tabId: 't-1',
          agentId: 'agent-1',
          workspaceId: 'ws-1',
        },
      })}\n`,
    );
    await flush();

    expect(executor).toHaveBeenCalledWith(
      [{ action: 'listTabs' }],
      't-1',
      'agent-1',
      'ws-1',
      {
        client,
        backendId: 'local',
        savedRemote: false,
      },
      expect.any(Number),
    );
    expect(socket.writes).toHaveLength(1);
    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-1',
      result: envelope,
    });
    client.dispose();
  });

  it('binds a background saved-remote reverse call to its originating client', async () => {
    const { client, socket } = makeClient();
    executor.mockResolvedValue({ success: true, results: [] });
    registerBrowserExecReverseHandler(client, {
      executor,
      backendId: 'remote-loopback',
      savedRemote: true,
    });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-remote',
        method: BROWSER_EXEC_METHOD,
        params: { actions: [{ action: 'openTab', url: 'http://localhost:8080' }] },
      })}\n`,
    );
    await flush();

    expect(executor).toHaveBeenCalledWith(
      [{ action: 'openTab', url: 'http://localhost:8080' }],
      undefined,
      undefined,
      undefined,
      { client, backendId: 'remote-loopback', savedRemote: true },
      expect.any(Number),
    );
    client.dispose();
  });

  it('passes executor-error envelopes through unchanged (GAP-2a shapes the wire error)', async () => {
    const { client, socket } = makeClient();
    const envelope = {
      success: false,
      results: [{ action: 'evaluate', success: false, error: 'boom' }],
      error: "Action 'evaluate' failed: boom",
    };
    executor.mockResolvedValue(envelope);
    registerBrowserExecReverseHandler(client, { executor });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-2',
        method: BROWSER_EXEC_METHOD,
        params: { actions: [{ action: 'evaluate', expression: 'x' }] },
      })}\n`,
    );
    await flush();

    expect(JSON.parse(socket.writes[0])).toEqual({
      jsonrpc: '2.0',
      id: 'rev-2',
      result: envelope,
    });
    client.dispose();
  });

  it('surfaces invalid params as -32602 (executor never called)', async () => {
    const { client, socket } = makeClient();
    registerBrowserExecReverseHandler(client, { executor });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-3',
        method: BROWSER_EXEC_METHOD,
        params: { actions: [] },
      })}\n`,
    );
    await flush();

    expect(executor).not.toHaveBeenCalled();
    const response = JSON.parse(socket.writes[0]);
    expect(response.id).toBe('rev-3');
    expect(response.error.code).toBe(-32602);
    expect(response.error.message).toMatch(/actions must not be empty/);
    client.dispose();
  });

  it('rewrites screenshot base64 to an assetUrl when workspaceId + saveAsset are provided', async () => {
    const { client, socket } = makeClient();
    executor.mockResolvedValue({
      success: true,
      results: [
        {
          action: 'screenshot',
          success: true,
          result: { base64: JPEG_1PX, width: 10, height: 20 },
        },
      ],
    });
    const saveAsset = vi.fn().mockResolvedValue({ url: 'workspace-asset://ws-1/abc.jpg' });
    registerBrowserExecReverseHandler(client, { executor, saveAsset });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-4',
        method: BROWSER_EXEC_METHOD,
        params: {
          actions: [{ action: 'screenshot' }],
          workspaceId: 'ws-1',
        },
      })}\n`,
    );
    await flush();

    expect(saveAsset).toHaveBeenCalledWith({
      workspaceId: 'ws-1',
      data: JPEG_1PX,
      mimeType: 'image/jpeg',
      originalName: expect.stringMatching(/^screenshot-\d+\.jpg$/),
    });
    const response = JSON.parse(socket.writes[0]);
    expect(response.result.results[0].result).toEqual({
      assetUrl: 'workspace-asset://ws-1/abc.jpg',
      width: 10,
      height: 20,
    });
    expect(
      resolveBrowserScreenshotSource(parseScreenshotPayload(response.result.results[0].result)),
    ).toBe('workspace-asset://ws-1/abc.jpg');
    client.dispose();
  });

  it('keeps the base64 screenshot payload when saveAsset resolves without a url', async () => {
    const { client, socket } = makeClient();
    const original = { base64: JPEG_1PX, width: 10, height: 20 };
    executor.mockResolvedValue({
      success: true,
      results: [{ action: 'screenshot', success: true, result: { ...original } }],
    });
    const saveAsset = vi.fn().mockResolvedValue(undefined);
    registerBrowserExecReverseHandler(client, { executor, saveAsset });

    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id: 'rev-5',
        method: BROWSER_EXEC_METHOD,
        params: { actions: [{ action: 'screenshot' }], workspaceId: 'ws-1' },
      })}\n`,
    );
    await flush();

    expect(saveAsset).toHaveBeenCalledTimes(1);
    const response = JSON.parse(socket.writes[0]);
    expect(response.result.results[0].result).toEqual(original);
    const parsed = parseScreenshotPayload(response.result.results[0].result);
    expect(parsed.screenshotMimeType).toBe('image/jpeg');
    expect(resolveBrowserScreenshotSource(parsed)).toBe(`data:image/jpeg;base64,${JPEG_1PX}`);
    client.dispose();
  });

  it('bounds stalled asset persistence and returns the usable inline screenshot', async () => {
    vi.useFakeTimers();
    try {
      const { client, socket } = makeClient();
      const original = { base64: 'AAAA', width: 10, height: 20 };
      executor.mockResolvedValue({
        success: true,
        results: [{ action: 'screenshot', success: true, result: { ...original } }],
      });
      const saveAsset = vi.fn(() => new Promise<never>(() => {}));
      registerBrowserExecReverseHandler(client, { executor, saveAsset });

      socket.receive(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id: 'rev-6',
          method: BROWSER_EXEC_METHOD,
          params: { actions: [{ action: 'screenshot' }], workspaceId: 'ws-1' },
        })}\n`,
      );
      await vi.advanceTimersByTimeAsync(5_100);

      expect(saveAsset).toHaveBeenCalledTimes(1);
      const response = JSON.parse(socket.writes[0]);
      expect(response.result.results[0].result).toEqual(original);
      client.dispose();
    } finally {
      vi.useRealTimers();
    }
  });

  // intent-hq/intent#4835 — the whole request (capture + persistence) must
  // answer inside intentd's reverse deadline (20 s for a screenshot batch,
  // 30 s otherwise) minus a transport margin, or the daemon discards the
  // reply and the agent sees a bare "reverse request timed out".
  describe('request deadline (#4835)', () => {
    const RECEIVED_AT = new Date('2026-09-12T12:00:00Z').getTime();

    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(RECEIVED_AT);
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    function receive(socket: FakeSocket, id: string, actions: unknown[]) {
      socket.receive(
        `${JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: BROWSER_EXEC_METHOD,
          params: { actions, workspaceId: 'ws-1' },
        })}\n`,
      );
    }

    it('hands the executor the screenshot deadline (20 s minus margin) when the batch captures', async () => {
      const { client, socket } = makeClient();
      executor.mockResolvedValue({ success: true, results: [] });
      registerBrowserExecReverseHandler(client, { executor });

      receive(socket, 'rev-d1', [{ action: 'listTabs' }, { action: 'screenshot' }]);
      await vi.advanceTimersByTimeAsync(0);

      const deadline = executor.mock.calls[0]?.[5];
      expect(deadline).toBe(RECEIVED_AT + 18_000);
      client.dispose();
    });

    it('hands the executor the default deadline (30 s minus margin) for non-screenshot batches', async () => {
      const { client, socket } = makeClient();
      executor.mockResolvedValue({ success: true, results: [] });
      registerBrowserExecReverseHandler(client, { executor });

      receive(socket, 'rev-d2', [{ action: 'evaluate', expression: '1' }]);
      await vi.advanceTimersByTimeAsync(0);

      const deadline = executor.mock.calls[0]?.[5];
      expect(deadline).toBe(RECEIVED_AT + 28_000);
      client.dispose();
    });

    it('answers within the 20 s screenshot reverse budget when the capture was slow and persistence stalls', async () => {
      const { client, socket } = makeClient();
      const original = { base64: 'AAAA', width: 10, height: 20 };
      executor.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  results: [{ action: 'screenshot', success: true, result: { ...original } }],
                }),
              16_000,
            ),
          ),
      );
      const saveAsset = vi.fn(() => new Promise<never>(() => {}));
      registerBrowserExecReverseHandler(client, { executor, saveAsset });

      receive(socket, 'rev-7', [{ action: 'screenshot' }]);
      // Capture settles at 16 s; persistence gets only the 2 s left before
      // the 18 s request deadline instead of its own 5 s cap.
      await vi.advanceTimersByTimeAsync(17_900);
      expect(saveAsset).toHaveBeenCalledTimes(1);
      expect(socket.writes).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(200);
      expect(socket.writes).toHaveLength(1);
      const response = JSON.parse(socket.writes[0]);
      expect(response.result.results[0].result).toEqual(original);
      client.dispose();
    });

    it('skips persistence entirely (keeping the inline image) when the capture consumed the whole budget', async () => {
      const { client, socket } = makeClient();
      const original = { base64: 'AAAA', width: 10, height: 20 };
      executor.mockImplementation(
        () =>
          new Promise((resolve) =>
            setTimeout(
              () =>
                resolve({
                  success: true,
                  results: [{ action: 'screenshot', success: true, result: { ...original } }],
                }),
              18_000,
            ),
          ),
      );
      const saveAsset = vi.fn(() => new Promise<never>(() => {}));
      registerBrowserExecReverseHandler(client, { executor, saveAsset });

      receive(socket, 'rev-8', [{ action: 'screenshot' }]);
      await vi.advanceTimersByTimeAsync(18_000);

      expect(saveAsset).not.toHaveBeenCalled();
      expect(socket.writes).toHaveLength(1);
      expect(JSON.parse(socket.writes[0]).result.results[0].result).toEqual(original);
      client.dispose();
    });

    it('backstop: an executor that never settles gets a truthful failure envelope inside the daemon budget', async () => {
      const { client, socket } = makeClient();
      executor.mockImplementation(() => new Promise<never>(() => {}));
      registerBrowserExecReverseHandler(client, { executor });

      receive(socket, 'rev-9', [{ action: 'screenshot' }]);
      // The backstop sits a grace window past the 18 s request deadline (so
      // it never races a stage answering at the deadline) but still inside
      // the daemon's 20 s.
      await vi.advanceTimersByTimeAsync(18_999);
      expect(socket.writes).toHaveLength(0);

      await vi.advanceTimersByTimeAsync(1);
      expect(socket.writes).toHaveLength(1);
      const response = JSON.parse(socket.writes[0]);
      expect(response.id).toBe('rev-9');
      expect(response.result).toEqual({
        success: false,
        results: [],
        error: expect.stringContaining('did not settle within the request deadline'),
      });
      expect(response.result.error).toContain('stage: action execution');
      client.dispose();
    });

    it('a per-action stage error answered exactly at the deadline is kept, not replaced by the backstop', async () => {
      const { client, socket } = makeClient();
      const stageFailure = {
        success: false,
        results: [
          {
            action: 'screenshot',
            success: false,
            errorCode: 'deadline-exhausted',
            error: 'Page.captureScreenshot timed out: the request deadline was exhausted',
          },
        ],
        error: 'Action screenshot failed',
      };
      executor.mockImplementation(
        (_a, _t, _ag, _ws, _ctx, deadline) =>
          new Promise((resolve) =>
            setTimeout(() => resolve(stageFailure), (deadline as number) - Date.now()),
          ),
      );
      registerBrowserExecReverseHandler(client, { executor });

      receive(socket, 'rev-10', [{ action: 'screenshot' }]);
      await vi.advanceTimersByTimeAsync(18_000);

      expect(socket.writes).toHaveLength(1);
      expect(JSON.parse(socket.writes[0]).result).toEqual(stageFailure);
      await vi.advanceTimersByTimeAsync(2_000);
      expect(socket.writes).toHaveLength(1);
      client.dispose();
    });
  });
});

/**
 * End to end through the REAL executor and REAL CDP service (only Electron
 * is faked): the reply the daemon reads off the socket must carry the
 * per-action `deadline-exhausted` result naming the stage — never the
 * handler's empty backstop envelope, which `browser_ops::shape_agent_result`
 * would collapse into a bare -32603 (intent-hq/intent#4835).
 */
describe('browser.exec deadline end to end (real executor + CDP service, #4835)', () => {
  const RECEIVED_AT = new Date('2026-09-12T12:00:00Z').getTime();

  function hangingCdpWebview(id: number, url: string) {
    return {
      id,
      getType: () => 'webview',
      isDestroyed: () => false,
      isLoading: () => false,
      getURL: () => url,
      getTitle: () => `title-${id}`,
      once: vi.fn(),
      removeListener: vi.fn(),
      debugger: {
        isAttached: () => true,
        attach: vi.fn(),
        on: vi.fn(),
        sendCommand: vi.fn((method: string) =>
          method.startsWith('Page.') || method === 'Runtime.evaluate'
            ? new Promise(() => {})
            : Promise.resolve(undefined),
        ),
      },
      capturePage: vi.fn(() => new Promise<never>(() => {})),
    };
  }

  function wireRenderer(tabs: { tabId: string; url: string; title: string }[]) {
    electronMocks.sendToWorkspaceWindows.mockImplementation(
      (_workspaceId: string | undefined, channel: string, payload: { requestId?: string }) => {
        if (channel === IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) {
          electronMocks.handlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
            {},
            { tabs: [...tabs], requestId: payload.requestId },
          );
        }
        return { windowCount: 1, browserClientsNotified: false, delivered: true };
      },
    );
  }

  async function realExecutor(): Promise<ExecuteBrowserActionsFn> {
    const { executeActions } = await import('../main/browser-action-executor');
    return (actions, tabId, agentId, workspaceId, _backendContext, deadline) =>
      executeActions(
        { actions, tabId },
        undefined,
        agentId,
        workspaceId,
        undefined,
        undefined,
        deadline,
      );
  }

  function receive(socket: FakeSocket, id: string, actions: unknown[], tabId: string) {
    socket.receive(
      `${JSON.stringify({
        jsonrpc: '2.0',
        id,
        method: BROWSER_EXEC_METHOD,
        params: { actions, tabId, workspaceId: 'ws-e2e' },
      })}\n`,
    );
  }

  beforeEach(() => {
    vi.resetModules();
    electronMocks.handlers.clear();
    electronMocks.fromId.mockReturnValue(undefined);
    electronMocks.getAllWebContents.mockReturnValue([]);
    electronMocks.sendToWorkspaceWindows.mockReturnValue({
      windowCount: 1,
      browserClientsNotified: false,
      delivered: true,
    });
    vi.useFakeTimers();
    vi.setSystemTime(RECEIVED_AT);
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('a hanging Runtime.evaluate answers at the 28 s deadline with a per-action deadline-exhausted result', async () => {
    const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
    const wc = hangingCdpWebview(901, 'http://127.0.0.1:5199/app');
    electronMocks.fromId.mockReturnValue(wc);
    embeddedBrowserCdp.registerTab('tab-e2e-eval', 901);
    const { client, socket } = makeClient();
    registerBrowserExecReverseHandler(client, { executor: await realExecutor() });

    receive(socket, 'e2e-1', [{ action: 'evaluate', expression: '1 + 1' }], 'tab-e2e-eval');
    await vi.advanceTimersByTimeAsync(27_999);
    expect(socket.writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.writes).toHaveLength(1);
    const response = JSON.parse(socket.writes[0]);
    expect(response.id).toBe('e2e-1');
    expect(response.result.success).toBe(false);
    expect(response.result.results).toHaveLength(1);
    expect(response.result.results[0]).toMatchObject({
      action: 'evaluate',
      success: false,
      errorCode: 'deadline-exhausted',
      error: expect.stringContaining('Runtime.evaluate timed out'),
    });
    expect(response.result.error).not.toContain('stage: action execution');

    // The backstop's grace window passes without a second reply.
    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.writes).toHaveLength(1);
    embeddedBrowserCdp.unregisterTab('tab-e2e-eval');
    client.dispose();
  });

  it('slow mount, then hung Page commands and capturePage: one 18 s budget, answered with the failing stage named', async () => {
    const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
    const url = 'http://127.0.0.1:5199/app';
    wireRenderer([{ tabId: 'tab-e2e-shot', url, title: 'app' }]);
    const { client, socket } = makeClient();
    registerBrowserExecReverseHandler(client, { executor: await realExecutor() });

    receive(socket, 'e2e-2', [{ action: 'screenshot' }], 'tab-e2e-shot');
    // The offscreen host mounts the tab 8.5 s in; the remaining 9.5 s must
    // then cover the CDP stage (5 s cap) and the fallback (clamped to 4.5 s).
    await vi.advanceTimersByTimeAsync(8_500);
    expect(socket.writes).toHaveLength(0);
    const wc = hangingCdpWebview(902, url);
    electronMocks.fromId.mockReturnValue(wc);
    embeddedBrowserCdp.registerTab('tab-e2e-shot', 902);

    await vi.advanceTimersByTimeAsync(9_499);
    expect(wc.capturePage).toHaveBeenCalledTimes(1);
    expect(socket.writes).toHaveLength(0);

    await vi.advanceTimersByTimeAsync(1);
    expect(socket.writes).toHaveLength(1);
    const response = JSON.parse(socket.writes[0]);
    expect(response.id).toBe('e2e-2');
    expect(response.result.success).toBe(false);
    expect(response.result.results).toHaveLength(1);
    expect(response.result.results[0]).toMatchObject({
      action: 'screenshot',
      success: false,
      errorCode: 'deadline-exhausted',
    });
    expect(response.result.results[0].error).toContain(
      'Page.getLayoutMetrics timed out after 5000ms',
    );
    expect(response.result.results[0].error).toContain('capturePage timed out after 4500ms');
    expect(response.result.error).not.toContain('stage: action execution');

    await vi.advanceTimersByTimeAsync(2_000);
    expect(socket.writes).toHaveLength(1);
    embeddedBrowserCdp.unregisterTab('tab-e2e-shot');
    client.dispose();
  });

  it('a mount that never completes answers with deadline-exhausted naming the budget actually left after the tab listing', async () => {
    const { embeddedBrowserCdp } = await import('../main/embedded-browser-cdp-service');
    // Renderer answers the tab listing only after 400 ms; the mount wait
    // must be budgeted from what remains at that point.
    electronMocks.sendToWorkspaceWindows.mockImplementation(
      (_workspaceId: string | undefined, channel: string, payload: { requestId?: string }) => {
        if (channel === IPC_CHANNELS.BROWSER.LIST_TABS_REQUEST) {
          setTimeout(() => {
            electronMocks.handlers.get(IPC_CHANNELS.BROWSER.LIST_TABS_RESPONSE)?.(
              {},
              {
                tabs: [{ tabId: 'tab-e2e-nomount', url: 'http://127.0.0.1:5199/', title: 'x' }],
                requestId: payload.requestId,
              },
            );
          }, 400);
        }
        return { windowCount: 1, browserClientsNotified: false, delivered: true };
      },
    );
    const { client, socket } = makeClient();
    const executor = await realExecutor();
    registerBrowserExecReverseHandler(client, {
      // Shrink the budget so the deadline, not the 10 s mount cap, binds.
      executor: (actions, tabId, agentId, workspaceId, ctx) =>
        executor(actions, tabId, agentId, workspaceId, ctx, Date.now() + 3_000),
    });

    receive(socket, 'e2e-3', [{ action: 'screenshot' }], 'tab-e2e-nomount');
    await vi.advanceTimersByTimeAsync(3_000);

    expect(socket.writes).toHaveLength(1);
    const [result] = JSON.parse(socket.writes[0]).result.results;
    expect(result).toMatchObject({
      action: 'screenshot',
      success: false,
      errorCode: 'deadline-exhausted',
    });
    expect(result.error).toContain('did not mount within the 2600ms left');
    expect(embeddedBrowserCdp.isTabMounted('tab-e2e-nomount')).toBe(false);
    client.dispose();
  });
});
