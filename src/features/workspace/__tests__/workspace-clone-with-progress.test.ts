import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';

/**
 * Wire-contract tests for WorkspaceService.cloneWithProgress.
 *
 * Per PROTOCOL.md §5.6 (`git.clone` method) + §6.5 (`git:clone:progress` /
 * `git:clone:done` bus events), the FE no longer spawns `git clone` locally.
 * It drives the daemon and translates progress frames into the unchanged
 * `workspace:clone-progress` renderer broadcast. These tests pin the exact
 * request shape sent on the wire and feed back PROTOCOL-shaped mock
 * notifications through the JSON-RPC client seam.
 */

const { mockRequest, mockNotificationHandlers, mockBackendClient } = vi.hoisted(
  () => {
    const mockRequest = vi.fn();
    const mockNotificationHandlers = new Set<(n: unknown) => void>();
    const mockBackendClient = {
      request: mockRequest,
      on: vi.fn((event: string, handler: (n: unknown) => void) => {
        if (event === 'notification') mockNotificationHandlers.add(handler);
        return mockBackendClient;
      }),
      off: vi.fn((event: string, handler: (n: unknown) => void) => {
        if (event === 'notification') mockNotificationHandlers.delete(handler);
        return mockBackendClient;
      }),
    };
    return { mockRequest, mockNotificationHandlers, mockBackendClient };
  },
);

vi.mock('../../backend/main/backend.ipc', () => ({
  getBackendClient: () => mockBackendClient,
}));

// Silence the LFS post-clone probe that runs after a successful clone
// resolves. It is unrelated to the wire contract under test.
vi.mock('child_process', () => {
  const execFile = vi.fn(
    (_cmd: string, _args: string[], _optsOrCb: unknown, maybeCb?: unknown) => {
      const cb = (typeof _optsOrCb === 'function' ? _optsOrCb : maybeCb) as
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      if (cb) setTimeout(() => cb(null, '', ''), 0);
    },
  );
  const exec = vi.fn(
    (_cmd: string, _optsOrCb: unknown, maybeCb?: unknown) => {
      const cb = (typeof _optsOrCb === 'function' ? _optsOrCb : maybeCb) as
        | ((err: Error | null, stdout: string, stderr: string) => void)
        | undefined;
      if (cb) setTimeout(() => cb(null, '', ''), 0);
    },
  );
  return { default: { exec, execFile }, exec, execFile };
});

// Match workspace.service.test.ts's promisify wiring so execFileAsync /
// execAsync resolve rather than hang against the mocked child_process.
vi.mock('util', async () => {
  const actual = await vi.importActual<typeof import('util')>('util');
  const childProcess = await import('child_process');
  return {
    ...actual,
    promisify: (fn: unknown) => {
      if (fn === childProcess.execFile || fn === childProcess.exec) {
        return (...args: unknown[]) =>
          new Promise((resolve, reject) => {
            const cb = (
              err: Error | null,
              stdout: string,
              stderr: string,
            ): void => {
              if (err) reject(err);
              else resolve({ stdout: stdout || '', stderr: stderr || '' });
            };
            (fn as (...a: unknown[]) => unknown)(...args, cb);
          });
      }
      return actual.promisify(fn as never);
    },
  };
});

vi.mock('../../../store/main/redux-store-bridge', () => ({
  mainDispatch: vi.fn((action: unknown) => action),
}));

import { WorkspaceService } from '../main/workspace.service';
import { InMemoryWorkspaceRepository } from '../main/workspace.repository';
import { InMemoryNotesRepository } from '../../notes/main/notes.repository';

type Broadcast = { phase: string; percent: number; message: string };

interface CloneWireAccess {
  cloneWithProgress(url: string, clonePath: string, parentDir: string): Promise<void>;
  broadcastCloneProgress(payload: Broadcast): void;
}

function pushEvent(type: string, data: Record<string, unknown>): void {
  const notification = {
    method: 'events.event',
    params: {
      subscriptionId: 'sub-test',
      event: {
        type,
        workspaceId: '',
        id: `evt-${Math.random().toString(36).slice(2)}`,
        timestamp: new Date().toISOString(),
        actor: { type: 'system' },
        data,
      },
    },
  };
  for (const handler of Array.from(mockNotificationHandlers)) {
    handler(notification);
  }
}

describe('WorkspaceService.cloneWithProgress (git.clone streaming wire)', () => {
  let service: WorkspaceService;
  let broadcasts: Broadcast[];

  beforeEach(() => {
    mockRequest.mockReset();
    mockNotificationHandlers.clear();
    service = new WorkspaceService(
      new InMemoryWorkspaceRepository(),
      new InMemoryNotesRepository(),
    );
    broadcasts = [];
    // Capture renderer-facing frames without needing a fake BrowserWindow.
    const wire = service as unknown as CloneWireAccess;
    wire.broadcastCloneProgress = (payload: Broadcast) => {
      broadcasts.push(payload);
    };
  });

  it('sends events.subscribe + git.clone with { url, parentDir, targetName, requestId } and resolves on done{ok:true}', async () => {
    mockRequest.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-test' };
      if (method === 'git.clone') {
        const requestId = (params as { requestId?: string }).requestId ?? 'x';
        setImmediate(() => {
          pushEvent('git:clone:progress', {
            requestId, phase: 'receiving', percent: 45, message: 'Receiving objects: 45%',
          });
          pushEvent('git:clone:done', { requestId, ok: true });
        });
        return { requestId, targetPath: '/tmp/wt/repo' };
      }
      if (method === 'events.unsubscribe') return {};
      throw new Error(`unexpected method: ${method}`);
    });

    await (service as unknown as CloneWireAccess).cloneWithProgress(
      'https://github.com/example/repo.git',
      '/tmp/wt/repo',
      '/tmp/wt',
    );

    const subscribeCall = mockRequest.mock.calls.find(([m]) => m === 'events.subscribe');
    expect(subscribeCall?.[1]).toEqual({
      eventTypes: ['git:clone:progress', 'git:clone:done'],
    });

    const cloneCall = mockRequest.mock.calls.find(([m]) => m === 'git.clone');
    expect(cloneCall).toBeDefined();
    const cloneParams = cloneCall![1] as {
      url: string; parentDir: string; targetName: string; requestId: string;
    };
    expect(cloneParams.url).toBe('https://github.com/example/repo.git');
    expect(cloneParams.parentDir).toBe('/tmp/wt');
    expect(cloneParams.targetName).toBe('repo');
    expect(typeof cloneParams.requestId).toBe('string');
    expect(cloneParams.requestId.length).toBeGreaterThan(0);

    const unsubscribeCall = mockRequest.mock.calls.find(([m]) => m === 'events.unsubscribe');
    expect(unsubscribeCall?.[1]).toEqual({ subscriptionId: 'sub-test' });
    expect(mockNotificationHandlers.size).toBe(0);
  });

  it('translates git:clone:progress into workspace:clone-progress frames and filters foreign requestIds', async () => {
    mockRequest.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-x' };
      if (method === 'git.clone') {
        const requestId = (params as { requestId?: string }).requestId ?? 'r';
        setImmediate(() => {
          pushEvent('git:clone:progress', {
            requestId: 'other', phase: 'receiving', percent: 99, message: 'noise',
          });
          pushEvent('git:clone:progress', {
            requestId, phase: 'counting', percent: 0, message: 'Counting objects...',
          });
          pushEvent('git:clone:progress', {
            requestId, phase: 'receiving', percent: 42, message: 'Receiving objects: 42%',
          });
          pushEvent('git:clone:done', { requestId, ok: true });
        });
        return { requestId, targetPath: '/tmp/wt/repo' };
      }
      if (method === 'events.unsubscribe') return {};
      throw new Error(`unexpected method: ${method}`);
    });

    await (service as unknown as CloneWireAccess).cloneWithProgress(
      'https://github.com/example/repo.git',
      '/tmp/wt/repo',
      '/tmp/wt',
    );

    // Synthetic starting frame + 2 matching progress frames + synthesized
    // `complete` frame emitted by the FE when done{ok:true} arrives without
    // an explicit `phase:'complete'` progress frame in front of it.
    expect(broadcasts).toEqual([
      { phase: 'starting', percent: 0, message: 'Starting clone...' },
      { phase: 'counting', percent: 0, message: 'Counting objects...' },
      { phase: 'receiving', percent: 42, message: 'Receiving objects: 42%' },
      { phase: 'complete', percent: 100, message: 'Clone complete!' },
    ]);
  });

  it('rejects when git:clone:done arrives with { ok: false } and surfaces the daemon error', async () => {
    mockRequest.mockImplementation(async (method: string, params: unknown) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-fail' };
      if (method === 'git.clone') {
        const requestId = (params as { requestId?: string }).requestId ?? 'r';
        setImmediate(() => {
          pushEvent('git:clone:done', {
            requestId, ok: false, error: 'exit=128 (fatal: repository not found)',
          });
        });
        return { requestId, targetPath: '/tmp/wt/repo' };
      }
      if (method === 'events.unsubscribe') return {};
      throw new Error(`unexpected method: ${method}`);
    });

    await expect(
      (service as unknown as CloneWireAccess).cloneWithProgress(
        'https://github.com/does/not/exist.git',
        '/tmp/wt/repo',
        '/tmp/wt',
      ),
    ).rejects.toThrow('exit=128 (fatal: repository not found)');
    expect(mockNotificationHandlers.size).toBe(0);
  });

  it('rejects (honest degradation) when the git.clone RPC itself fails — no local spawn fallback', async () => {
    mockRequest.mockImplementation(async (method: string) => {
      if (method === 'events.subscribe') return { subscriptionId: 'sub-rpc' };
      if (method === 'git.clone') throw new Error('daemon disconnected');
      if (method === 'events.unsubscribe') return {};
      throw new Error(`unexpected method: ${method}`);
    });

    await expect(
      (service as unknown as CloneWireAccess).cloneWithProgress(
        'https://github.com/example/repo.git',
        '/tmp/wt/repo',
        '/tmp/wt',
      ),
    ).rejects.toThrow('daemon disconnected');
    expect(mockNotificationHandlers.size).toBe(0);
  });
});
