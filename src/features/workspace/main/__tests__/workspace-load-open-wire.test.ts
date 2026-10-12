import { EventEmitter } from 'node:events';
import { Duplex } from 'node:stream';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { BrowserWindow, IpcMainInvokeEvent } from 'electron';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mockInvoke, resetMockIpcRouter } from '$shared/ipc-mock-router';
import { WORKSPACE_CHANNELS } from '$shared/ipc/channels';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { WorkspaceStatus, type CommandResponse, type Workspace } from '$shared/types';
import type { WorkspaceLoadReadOutcome } from '$shared/types/workspace-load-route';
import { stampWindowWithBackend } from '../../../../main/window-backend';
import { createSafeValidatedHandler } from '../../../../main/ipc-validation-middleware';
import { WorkspaceOpenSchema } from '../../../../main/ipc-schemas';
import { JsonRpcClient } from '../../../backend/main/json-rpc-client';
import { JsonRpcError, type JsonRpcErrorShape } from '../../../backend/main/json-rpc-errors';
import { ProtocolAdapter } from '../../../protocol/main/protocol-adapter';
import { WorkspaceService } from '../workspace.service';
import { DaemonWorkspaceRepository } from '../workspace.repository';
import {
  __resetChangeHistoryForTesting,
  getAllChangeHistory,
  initChangeHistory,
} from '../change-history-persistence';
import { createWorkspaceOpenHandler } from '../workspace-open-handler';
import { createWorkspaceLoadRoutes } from '../workspace-load-route';
import { setupWorkspaceIPC } from '../workspace.ipc';

// Global test setup mocks this owner; this suite exercises its real implementation.
vi.unmock('../../../protocol/main/protocol-adapter');

// Primary envelope/policy oracle: intent-hq/intentd c6f55f2a27106e332ea5e2dfa5f2503fe97ed4fe
// router workspace.get/git.getConfig/settings.get/file.exists + service/file_ops.
// Controlled frames exercise actual FE parsers; daemon filesystem/deployment is NOT proved.
type OpenDependencies = Parameters<typeof createWorkspaceOpenHandler>[0];
const state = vi.hoisted(() => ({
  windows: new Map<object, object>(),
  event: undefined as IpcMainInvokeEvent | undefined,
  sourceOpenDependencies: undefined as OpenDependencies | undefined,
  getBackendClient: vi.fn<() => JsonRpcClient>(),
}));
vi.mock('electron', async () => {
  const { registerMockIpcHandler } = await import('$shared/ipc-mock-router');
  return {
    BrowserWindow: { fromWebContents: (sender: object) => state.windows.get(sender) ?? null },
    ipcMain: {
      handle: (
        channel: string,
        handler: (event: IpcMainInvokeEvent, payload: unknown) => unknown,
      ) => {
        registerMockIpcHandler(channel, (payload) => handler(state.event!, payload));
      },
    },
  };
});
vi.mock('../../../backend/main/backend.ipc', () => ({
  getBackendClient: state.getBackendClient,
  getBackendIdForIpcSender: () => 'local',
  onBackendReconnected: () => () => {},
}));
// Capture the real registration's converter/logger dependencies, then run the
// actual helper. No duplicate result converter or getWorkspace implementation.
vi.mock('../workspace-open-handler', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workspace-open-handler')>();
  return {
    ...actual,
    createWorkspaceOpenHandler: (deps: OpenDependencies) => {
      state.sourceOpenDependencies ??= deps;
      return actual.createWorkspaceOpenHandler(deps);
    },
  };
});
// Idle unrelated registration dependencies only; all workspace read owners stay real.
vi.mock('../../../system/main/system.ipc', () => ({ getFocusedWindowWorkspaceId: () => null }));
vi.mock('../../../terminal/main/terminal.ipc', () => ({ cleanupWorkspaceTerminals: vi.fn() }));
vi.mock('../../../metadata-fs/main/metadata-fs-factory', () => ({ clearMetadataFSCache: vi.fn() }));
vi.mock('../workspace-path.service', () => ({ getWorkspacePath: vi.fn() }));
vi.mock('../repo-registry', () => ({
  initRepoRegistry: async () => {},
  getAllRepos: () => [],
  addRepo: vi.fn(),
  removeRepo: vi.fn(),
  syncRepos: vi.fn(),
  clearRepos: vi.fn(),
}));
vi.mock('../../../tools/main/tool.service', () => ({ ToolService: class {} }));
vi.mock('../../../tools/main/executor-manager', () => ({ executorManager: {} }));
vi.mock('../../../acp-official/main/server/acp-server', () => ({ ACPServer: class {} }));
vi.mock('../../../../shared/git/git-env', () => ({ execFileAsync: vi.fn() }));
vi.mock('../../../../shared/logger', () => ({
  Logger: class {
    info() {}
    warn() {}
    error() {}
    debug() {}
  },
}));
vi.mock('../../../../shared/main/ipc-debug-tracker', () => ({
  ipcDebugTracker: {
    trackCall: vi.fn(),
    trackSuccess: vi.fn(),
    trackValidationError: vi.fn(),
  },
}));

type Frame = { jsonrpc: '2.0'; id: number; method: string; params: Record<string, unknown> };
type Reply = { result: unknown } | { error: JsonRpcErrorShape };
class ControlledSocket extends Duplex {
  readonly frames: Frame[] = [];
  readonly hold = new Set<string>();
  private readonly claimed = new Set<Frame>();
  private readonly waiting: Array<{ method: string; resolve: (frame: Frame) => void }> = [];
  constructor(readonly answer: (frame: Frame) => Reply) {
    super();
  }
  _read() {}
  _write(chunk: Buffer, _encoding: BufferEncoding, done: (error?: Error | null) => void) {
    const frame = JSON.parse(chunk.toString()) as Frame;
    this.frames.push(frame);
    const index = this.waiting.findIndex((row) => row.method === frame.method);
    if (index !== -1) {
      this.claimed.add(frame);
      this.waiting.splice(index, 1)[0].resolve(frame);
    }
    done();
    if (!this.hold.has(frame.method)) queueMicrotask(() => this.respond(frame));
  }
  next(method: string): Promise<Frame> {
    const frame = this.frames.find((row) => row.method === method && !this.claimed.has(row));
    if (frame) {
      this.claimed.add(frame);
      return Promise.resolve(frame);
    }
    return new Promise((resolve) => this.waiting.push({ method, resolve }));
  }
  respond(frame: Frame, reply = this.answer(frame)) {
    this.push(Buffer.from(JSON.stringify({ jsonrpc: '2.0', id: frame.id, ...reply }) + '\n'));
  }
}
const WS = 'amber-forest';
const WORKTREE = '/canonical/worktrees/amber-forest';
const GIT_CONFIG =
  '[remote "origin"]\n  url = https://github.com/contract-owner/contract-repo.git\n';
function workspaceRow(overrides: Record<string, unknown> = {}) {
  return {
    id: WS,
    title: 'Daemon workspace',
    branch: 'work',
    status: 'Active',
    repositoryPath: '/canonical/repository',
    worktreePath: WORKTREE,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    agentSummary: { count: 1, agentIds: ['agent-a'], agents: [] },
    gitSummary: { ahead: 2, behind: 0, hasUnpushed: true },
    diffSummary: { totalAdditions: 1, totalDeletions: 0, fileCount: 1 },
    ...overrides,
  };
}
const cleanups: Array<() => void | Promise<void>> = [];
beforeEach(() => {
  state.windows.clear();
  state.sourceOpenDependencies = undefined;
  state.getBackendClient.mockReset();
  __resetChangeHistoryForTesting();
  resetMockIpcRouter();
});
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  __resetChangeHistoryForTesting();
  resetMockIpcRouter();
  state.windows.clear();
  vi.restoreAllMocks();
});

async function peer() {
  const replies = new Map<string, Reply>([
    ['client.hello', { result: { clientId: 'captured-client' } }],
    ['workspace.get', { result: { workspace: workspaceRow() } }],
    ['file.exists', { result: { exists: true, isFile: false, isDirectory: true } }],
    ['git.getConfig', { result: { config: GIT_CONFIG } }],
    ['settings.get', { result: { path: 'workspace.changeHistory', value: {}, revision: 1 } }],
  ]);
  const socket = new ControlledSocket(
    (frame) =>
      replies.get(frame.method) ?? {
        error: { code: -32601, message: `Unexpected controlled method ${frame.method}` },
      },
  );
  const client = new JsonRpcClient({
    config: { transport: 'uds', socketPath: '/controlled/workspace-open.sock' },
    socketFactory: () => socket,
    heartbeatIntervalMs: 0,
    helloParams: () => ({ clientId: 'desktop-open-test' }),
  });
  cleanups.push(() => client.dispose());
  const ready = new Promise<void>((resolve) => {
    const listener = (status: string) => {
      if (status === 'connected') {
        client.off('status', listener);
        resolve();
      }
    };
    client.on('status', listener);
  });
  client.start();
  socket.emit('connect');
  await ready;
  expect(client.getRepositoryConnection()).not.toBeNull();
  return { client, socket, replies };
}

async function harness() {
  const local = await peer();
  const captured = await peer();
  state.getBackendClient.mockReturnValue(local.client);
  const sender = Object.assign(new EventEmitter(), { mainFrame: {}, isDestroyed: () => false });
  const window = Object.assign(new EventEmitter(), {
    webContents: sender,
    isDestroyed: () => false,
  });
  state.windows.set(sender, window);
  const event = { sender, senderFrame: sender.mainFrame } as unknown as IpcMainInvokeEvent;
  state.event = event;
  stampWindowWithBackend(window as unknown as BrowserWindow, 'local');
  setupWorkspaceIPC();
  await initChangeHistory(); // Join the real startup read before this test's capture.
  __resetChangeHistoryForTesting();
  state.getBackendClient.mockClear();
  local.socket.frames.length = 0;
  const sourceDependencies = state.sourceOpenDependencies;
  if (!sourceDependencies) throw new Error('Canonical OPEN registration was not observed');
  const service = new WorkspaceService(new DaemonWorkspaceRepository());
  const adapter = new ProtocolAdapter(service);
  cleanups.push(() => service.cleanup());
  const notify = vi.fn();
  const routes = createWorkspaceLoadRoutes({
    readBackend: (id) => (id === 'local' ? captured.client : undefined),
    open: (event, id, reads) =>
      createSafeValidatedHandler(
        WorkspaceOpenSchema,
        createWorkspaceOpenHandler({
          ...sourceDependencies,
          getWorkspace: (id) => adapter.getWorkspace(id, reads),
        }),
        WORKSPACE_CHANNELS.OPEN,
      )(event, { id }),
    errorPayload: (error) =>
      error instanceof JsonRpcError
        ? error.toErrorPayload()
        : {
            code: 'TRANSPORT_ERROR',
            message: error instanceof Error ? error.message : String(error),
          },
    notify,
  });
  cleanups.push(() => routes.dispose());
  const prepare = (workspaceId = WS, requestId = 'request-a') => {
    const origin = routes.observeOrigin(event);
    return routes.prepare(event, { ...origin, workspaceId, requestId });
  };
  const open = (ref = prepare()) => routes.read(event, { ...ref, operation: 'open' });
  return {
    local,
    captured,
    window: window as unknown as BrowserWindow,
    event,
    routes,
    prepare,
    open,
    notify,
    service,
    adapter,
  };
}
function command(outcome: WorkspaceLoadReadOutcome): CommandResponse<Workspace> {
  expect(outcome.current).toBe(true);
  if (!outcome.current || outcome.settlement.status !== 'fulfilled')
    throw new Error('Expected a fulfilled original OPEN command');
  return outcome.settlement.value as CommandResponse<Workspace>;
}
function calls(socket: ControlledSocket) {
  return socket.frames
    .filter((f) => f.method !== 'client.hello')
    .map(({ method, params }) => ({ method, params }));
}

describe('canonical enriched OPEN on one captured workspace-load route', () => {
  it('uses the exact captured wire for enrichment and retains normalized metadata while stripping summaries', async () => {
    const h = await harness();
    const access = vi.spyOn(fs, 'access');
    const result = command(await h.open());
    expect(result).toMatchObject({
      success: true,
      data: {
        id: WS,
        title: 'Daemon workspace',
        worktreePath: WORKTREE,
        status: WorkspaceStatus.Active,
        repositoryOwner: 'contract-owner',
        repositoryName: 'contract-repo',
        changesets: [],
        timeline: [],
        conversationInfo: [],
      },
    });
    expect(result.data?.agentSummary).toBeUndefined();
    expect(result.data?.gitSummary).toBeUndefined();
    expect(result.data?.diffSummary).toBeUndefined();
    expect(result.data?.diffs).toBeUndefined();
    expect(calls(h.captured.socket)).toEqual([
      { method: 'workspace.get', params: { workspaceId: WS } },
      { method: 'file.exists', params: { workspaceId: WS, path: WORKTREE } },
      { method: 'git.getConfig', params: { workspaceId: WS } },
      { method: 'settings.get', params: { path: 'workspace.changeHistory' } },
    ]);
    expect(state.getBackendClient).not.toHaveBeenCalled();
    expect(calls(h.local.socket)).toEqual([]);
    expect(access).not.toHaveBeenCalled();
  });

  it.each([
    ['missing', { result: { exists: false, isFile: false, isDirectory: false } }],
    ['contained ordinary file', { result: { exists: true, isFile: true, isDirectory: false } }],
    ['contained special entry', { result: { exists: true, isFile: false, isDirectory: false } }],
    [
      'access denied',
      {
        error: {
          code: -32603,
          message: 'Internal error',
          data: 'Access denied: path outside workspace',
        },
      },
    ],
    ['membership denied', { error: { code: -32003, message: 'Forbidden' } }],
  ] as const)('retains deliberate canonical path folding for %s', async (_name, reply) => {
    const h = await harness();
    h.captured.replies.set('file.exists', reply);
    const ref = h.prepare();
    const result = command(await h.open(ref));
    expect(result.success).toBe(true);
    const exists = 'result' in reply && reply.result.exists;
    expect(result.data?.worktreePath).toBe(exists ? WORKTREE : undefined);
    const detail = h.routes.read(h.event, { ...ref, operation: 'get' });
    expect((await detail).current).toBe(true); // Ordinary missing/access did not retire the route.
  });

  it.each([
    ['method not found', { error: { code: -32601, message: 'Method not found' } }],
    ['missing fields', { result: { exists: true } }],
    ['wrong scalar', { result: { exists: 'true', isFile: false, isDirectory: true } }],
    ['contradictory absent type', { result: { exists: false, isFile: true, isDirectory: false } }],
    ['both file and directory', { result: { exists: true, isFile: true, isDirectory: true } }],
    ['null payload', { result: null }],
  ] as const)(
    'retires %s before source catch-and-clear can become eligible success',
    async (_name, reply) => {
      const h = await harness();
      h.captured.replies.set('file.exists', reply);
      const ref = h.prepare();
      expect(await h.open(ref)).toEqual({ ref, current: false, reason: 'retired' });
      expect(calls(h.captured.socket)).toEqual([
        { method: 'workspace.get', params: { workspaceId: WS } },
        { method: 'file.exists', params: { workspaceId: WS, path: WORKTREE } },
      ]);
      // No renderer notification is delivered; the same reply carries retirement.
      expect(h.notify).toHaveBeenCalled();
      expect((await h.routes.read(h.event, { ...ref, operation: 'get' })).current).toBe(false);
    },
  );

  it('distinguishes numeric method-not-found from an ordinary error with the same string code', async () => {
    const h = await harness();
    h.captured.replies.set('file.exists', {
      error: {
        code: -32603,
        message: 'Ordinary access failure',
        data: { code: 'METHOD_NOT_FOUND' },
      },
    });
    const result = command(await h.open());
    expect(result.success).toBe(true);
    expect(result.data?.worktreePath).toBeUndefined();
  });

  it.each(['workspace.get', 'file.exists', 'git.getConfig', 'settings.get'])(
    'returns retired in the same reply when %s settles after scope release',
    async (method) => {
      const h = await harness();
      h.captured.socket.hold.add(method);
      const ref = h.prepare();
      const pending = h.open(ref);
      const frame = await h.captured.socket.next(method);
      const before = calls(h.captured.socket);
      h.routes.release(h.event, ref);
      h.captured.socket.respond(frame);
      expect(await pending).toEqual({ ref, current: false, reason: 'retired' });
      expect(calls(h.captured.socket)).toEqual(before);
    },
  );

  it('rejects a held ordinary error after binding retirement despite service error folding', async () => {
    const h = await harness();
    h.captured.socket.hold.add('workspace.get');
    const ref = h.prepare();
    const pending = h.open(ref);
    const frame = await h.captured.socket.next('workspace.get');
    stampWindowWithBackend(h.window, 'local');
    h.captured.socket.respond(frame, { error: { code: -32602, message: 'Workspace not found' } });
    expect(await pending).toEqual({ ref, current: false, reason: 'retired' });
  });

  it('does not join or mutate a pending default history initialization', async () => {
    const h = await harness();
    h.local.socket.hold.add('settings.get');
    const initializing = initChangeHistory();
    const held = await h.local.socket.next('settings.get');
    h.captured.replies.set('settings.get', {
      result: {
        path: 'workspace.changeHistory',
        value: { [WS]: [{ files: [], timestamp: 'captured' }] },
        revision: 4,
      },
    });
    const result = command(await h.open());
    expect(result.success).toBe(true);
    expect(calls(h.captured.socket).at(-1)).toEqual({
      method: 'settings.get',
      params: { path: 'workspace.changeHistory' },
    });
    h.local.socket.respond(held, {
      result: {
        path: 'workspace.changeHistory',
        value: { [WS]: [{ files: [], timestamp: 'default' }] },
        revision: 3,
      },
    });
    await initializing;
    expect(await getAllChangeHistory()).toEqual({ [WS]: [{ files: [], timestamp: 'default' }] });
    expect(calls(h.local.socket)).toEqual([
      { method: 'settings.get', params: { path: 'workspace.changeHistory' } },
    ]);
  });

  it.each([{ isRemote: true }, { environmentConfig: { type: 'remote' } }])(
    'preserves the canonical remote-workspace skip without claiming remote route support: %j',
    async (remote) => {
      const h = await harness();
      h.captured.replies.set('workspace.get', { result: { workspace: workspaceRow(remote) } });
      expect(command(await h.open()).data?.worktreePath).toBe(WORKTREE);
      expect(calls(h.captured.socket).map((call) => call.method)).toEqual([
        'workspace.get',
        'git.getConfig',
        'settings.get',
      ]);
    },
  );

  it('retains existing git metadata without fetching config again', async () => {
    const h = await harness();
    h.captured.replies.set('workspace.get', {
      result: {
        workspace: workspaceRow({ repositoryOwner: 'daemon-owner', repositoryName: 'daemon-name' }),
      },
    });
    expect(command(await h.open()).data).toMatchObject({
      repositoryOwner: 'daemon-owner',
      repositoryName: 'daemon-name',
    });
    expect(calls(h.captured.socket).map((call) => call.method)).toEqual([
      'workspace.get',
      'file.exists',
      'settings.get',
    ]);
  });

  it('runs canonical Chief and validation paths without backend reads', async () => {
    const h = await harness();
    expect(command(await h.open(h.prepare(CHIEF_WORKSPACE_ID))).data).toMatchObject({
      id: CHIEF_WORKSPACE_ID,
      createdAt: '2026-01-01T00:00:00.000Z',
      status: WorkspaceStatus.Active,
    });
    expect(calls(h.captured.socket)).toEqual([]);
    const invalid = command(await h.open(h.prepare('bad/path', 'invalid')));
    expect(invalid).toMatchObject({ success: false, error: { code: 'VALIDATION_ERROR' } });
    expect(calls(h.captured.socket)).toEqual([]);
  });

  it.each([
    { code: -32602, message: 'Workspace not found' },
    { code: -32603, message: 'Internal error', data: 'Known daemon failure' },
  ])('retains ordinary canonical OPEN error folding for $code', async (error) => {
    const h = await harness();
    h.captured.replies.set('workspace.get', { error });
    const result = command(await h.open());
    expect(result.success).toBe(false);
    expect(typeof result.error).toBe('string');
    expect(calls(h.captured.socket)).toEqual([
      { method: 'workspace.get', params: { workspaceId: WS } },
    ]);
  });

  it('keeps the source registered OPEN on its default daemon and real desktop existence check', async () => {
    const h = await harness();
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'workspace-load-source-'));
    cleanups.push(() => fs.rm(directory, { recursive: true, force: true }));
    h.local.replies.set('workspace.get', {
      result: { workspace: workspaceRow({ worktreePath: directory }) },
    });
    const present = await mockInvoke<CommandResponse<Workspace>>(WORKSPACE_CHANNELS.OPEN, {
      id: WS,
    });
    expect(present.success).toBe(true);
    expect(present.data?.worktreePath).toBe(directory);
    await fs.rm(directory, { recursive: true, force: true });
    const missing = await mockInvoke<CommandResponse<Workspace>>(WORKSPACE_CHANNELS.OPEN, {
      id: WS,
    });
    expect(missing.success).toBe(true);
    expect(missing.data?.worktreePath).toBeUndefined();
    expect(calls(h.captured.socket)).toEqual([]);
    expect(calls(h.local.socket).map((call) => call.method)).toEqual([
      'workspace.get',
      'git.getConfig',
      'settings.get',
      'workspace.get',
      'git.getConfig',
    ]);
  });
});
