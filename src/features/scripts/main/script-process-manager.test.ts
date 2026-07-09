/**
 * Tests for the daemon-backed ScriptProcessManager. The manager is a thin
 * client over `script.*` (PROTOCOL §5.8): these tests mock the backend client,
 * assert the RPC requests the manager sends, and drive `script:state` /
 * `script:output` notifications back through the same seam to check state and
 * output-buffer plumbing.
 */
import { EventEmitter } from 'events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mockRequest } = vi.hoisted(() => ({ mockRequest: vi.fn() }));

class FakeBackendClient extends EventEmitter {
  request = mockRequest;
}

const fakeClient = new FakeBackendClient();

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => fakeClient,
}));

vi.mock('../../../shared/logger', () => ({
  Logger: class MockLogger {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    debug = vi.fn();
  },
}));

import {
  ScriptProcessManager,
  disposeAllScriptProcessManagers,
  type WorkspaceScript,
} from './script-process-manager';

function makeScript(overrides: Partial<WorkspaceScript> = {}): WorkspaceScript {
  return {
    id: 'script-1',
    name: 'dev',
    command: 'pnpm dev',
    mode: 'service',
    source: 'user',
    createdAt: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

function emitEvent(type: string, data: Record<string, unknown>): void {
  fakeClient.emit('notification', {
    method: 'events.event',
    params: { subscriptionId: 'sub-1', event: { type, data } },
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

beforeEach(async () => {
  mockRequest.mockReset();
  await disposeAllScriptProcessManagers();
  fakeClient.removeAllListeners();
});

afterEach(async () => {
  await disposeAllScriptProcessManagers();
});

describe('ScriptProcessManager daemon integration', () => {
  it('subscribes to script events, registers the script, then calls script.start', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-1' };
      return { ok: true };
    });

    const manager = new ScriptProcessManager('ws-1');
    manager.start(makeScript({ cwd: 'apps/web', env: { FOO: 'bar' }, category: 'dev' }));

    await flush();
    await flush();

    const methods = mockRequest.mock.calls.map((c) => c[0]);
    expect(methods).toContain('events.subscribe');
    expect(methods).toContain('script.create');
    expect(methods).toContain('script.start');

    const createCall = mockRequest.mock.calls.find((c) => c[0] === 'script.create');
    expect(createCall?.[1]).toMatchObject({
      workspaceId: 'ws-1',
      scriptId: 'script-1',
      name: 'dev',
      command: 'pnpm dev',
      mode: 'service',
      cwd: 'apps/web',
      env: { FOO: 'bar' },
      category: 'dev',
    });

    const startCall = mockRequest.mock.calls.find((c) => c[0] === 'script.start');
    expect(startCall?.[1]).toEqual({ workspaceId: 'ws-1', scriptId: 'script-1' });
  });

  it('applies script:state events and invokes the state callback', async () => {
    mockRequest.mockResolvedValue({ subscriptionId: 'sub-1' });

    const manager = new ScriptProcessManager('ws-1');
    const stateCb = vi.fn();
    manager.setStateChangeCallback(stateCb);
    manager.start(makeScript());
    await flush();

    emitEvent('script:state', {
      scriptId: 'script-1',
      status: 'running',
      pid: 4242,
      startedAt: '2026-01-01T00:00:01Z',
      restartCount: 0,
    });

    expect(stateCb).toHaveBeenLastCalledWith('script-1', expect.objectContaining({
      status: 'running',
      pid: 4242,
      startedAt: '2026-01-01T00:00:01Z',
      restartCount: 0,
    }));
    expect(manager.getState('script-1')?.status).toBe('running');
  });

  it('base64-decodes script:output chunks and delivers them via the output buffer', async () => {
    mockRequest.mockResolvedValue({ subscriptionId: 'sub-1' });

    const manager = new ScriptProcessManager('ws-1');
    const outputCb = vi.fn();
    manager.setOutputCallback(outputCb);
    manager.start(makeScript());
    await flush();

    const chunk = Buffer.from('hello\nworld\n', 'utf8').toString('base64');
    emitEvent('script:output', { scriptId: 'script-1', chunk });

    // Buffer batches via a small setTimeout window; advance timers to flush.
    await new Promise((resolve) => setTimeout(resolve, 80));

    expect(outputCb).toHaveBeenCalled();
    const delivered = outputCb.mock.calls.flatMap((c) => c[1] as Array<{ text: string }>);
    expect(delivered.map((l) => l.text)).toEqual(['hello', 'world']);
  });

  it('routes stop / restart / remove through the daemon', async () => {
    mockRequest.mockResolvedValue({ subscriptionId: 'sub-1' });

    const manager = new ScriptProcessManager('ws-1');
    manager.start(makeScript());
    await flush();

    mockRequest.mockClear();
    mockRequest.mockResolvedValue({ ok: true });

    await manager.stop('script-1');
    expect(mockRequest).toHaveBeenCalledWith('script.stop', {
      workspaceId: 'ws-1',
      scriptId: 'script-1',
    });

    mockRequest.mockClear();
    await manager.restart('script-1');
    // Definition matches what was registered, so we take the fast path.
    expect(mockRequest).toHaveBeenCalledWith('script.restart', {
      workspaceId: 'ws-1',
      scriptId: 'script-1',
    });

    mockRequest.mockClear();
    await manager.remove('script-1');
    expect(mockRequest).toHaveBeenCalledWith('script.remove', {
      workspaceId: 'ws-1',
      scriptId: 'script-1',
    });
    expect(manager.getManagedScriptIds()).toEqual([]);
  });

  it('re-registers the daemon definition after updateDefinition before restart', async () => {
    mockRequest.mockResolvedValue({ subscriptionId: 'sub-1' });

    const manager = new ScriptProcessManager('ws-1');
    manager.start(makeScript());
    await flush();

    mockRequest.mockClear();
    mockRequest.mockResolvedValue({ ok: true });

    manager.updateDefinition('script-1', makeScript({ command: 'pnpm build' }));
    await manager.restart('script-1');

    const methods = mockRequest.mock.calls.map((c) => c[0]);
    expect(methods).toContain('script.stop');
    expect(methods).toContain('script.create');
    expect(methods).toContain('script.start');
    expect(methods).not.toContain('script.restart');

    const createCall = mockRequest.mock.calls.find((c) => c[0] === 'script.create');
    expect(createCall?.[1]).toMatchObject({ scriptId: 'script-1', command: 'pnpm build' });
  });
});
