/**
 * Unit tests for the workspace-transfer relay engine (main process).
 *
 * All seams are injected — no sockets, dialogs, or disk. A fake source client
 * scripts the export lifecycle (`events.subscribe` → `export.start` →
 * `:ready`/`:failed` notifications → seq-numbered `export.read` chunks); a
 * fake target records the `import.begin/chunk/commit` sequence.
 */

import { describe, expect, it, vi } from 'vitest';
import {
  createWorkspaceTransferRelay,
  type FileSink,
  type RelayRpcClient,
  type TargetClientHandle,
  type TransferRelayDeps,
} from './workspace-transfer-relay';
import type { TransferProgressEvent } from '../../../shared/types/workspace-transfer';

type Notification = { method: string; params?: unknown };
type Listener = (n: Notification) => void;

const CHUNK0 = Buffer.from('hello world').toString('base64'); // 11 bytes
const CHUNK1 = Buffer.from('bye').toString('base64'); // 3 bytes

const READY_DATA = {
  workspaceId: 'ws-1',
  exportId: 'export-1',
  manifest: { formatVersion: 1, workspaceId: 'ws-1' },
  archiveSizeBytes: 14,
  archiveSha256: 'ab'.repeat(32),
  maxChunkBytes: 11,
  totalChunks: 2,
};

/** Fake source: scripted RPC results + manual notification emission. */
function makeSource(overrides: Record<string, (params: any) => unknown> = {}) {
  const listeners = new Set<Listener>();
  const calls: Array<{ method: string; params: any }> = [];
  const handlers: Record<string, (params: any) => unknown> = {
    'events.subscribe': () => ({ subscriptionId: 'sub-1' }),
    'events.unsubscribe': () => ({}),
    'workspace.export.start': () => ({ exportId: 'export-1', maxChunkBytes: 11 }),
    'workspace.export.read': ({ seq }: { seq: number }) => ({
      exportId: 'export-1',
      seq,
      totalChunks: 2,
      data: seq === 0 ? CHUNK0 : CHUNK1,
    }),
    'workspace.export.finalize': () => ({ exportId: 'export-1', finalized: true }),
    'workspace.export.abort': () => ({ exportId: 'export-1', aborted: true }),
    ...overrides,
  };
  const client: RelayRpcClient = {
    async request(method, params) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected method ${method}`);
      const result = handler(params);
      if (result instanceof Error) throw result;
      return result as never;
    },
    on: (_e, l) => listeners.add(l as Listener),
    off: (_e, l) => listeners.delete(l as Listener),
  };
  return {
    client,
    calls,
    emit(type: string, data: Record<string, unknown>) {
      for (const l of [...listeners]) {
        l({ method: 'events.event', params: { event: { type, data } } });
      }
    },
    /** True once export.start has been requested (subscription armed). */
    started: () => calls.some((c) => c.method === 'workspace.export.start'),
  };
}

/** Fake target: records calls; scripted per-method results. */
function makeTarget(overrides: Record<string, (params: any) => unknown> = {}) {
  const calls: Array<{ method: string; params: any }> = [];
  const handlers: Record<string, (params: any) => unknown> = {
    'workspace.import.begin': () => ({ importId: 'import-1', maxChunkBytes: 11 }),
    'workspace.import.chunk': ({ seq }: { seq: number }) => ({ importId: 'import-1', seq }),
    'workspace.import.commit': () => ({
      workspace: { id: 'ws-1' },
      interruptedAgents: ['agent-9'],
    }),
    'workspace.import.abort': () => ({ importId: 'import-1', aborted: true }),
    'agent.resolveInterrupted': () => ({ resumed: ['agent-9'], abandoned: [], failed: [] }),
    ...overrides,
  };
  const dispose = vi.fn();
  const client: RelayRpcClient = {
    async request(method, params) {
      calls.push({ method, params });
      const handler = handlers[method];
      if (!handler) throw new Error(`unexpected method ${method}`);
      const result = handler(params);
      if (result instanceof Error) throw result;
      return result as never;
    },
    on: () => undefined,
    off: () => undefined,
  };
  return { handle: { client, dispose } satisfies TargetClientHandle, calls, dispose };
}

function makeDeps(
  source: ReturnType<typeof makeSource>,
  target?: ReturnType<typeof makeTarget>,
  extra: Partial<TransferRelayDeps> = {},
) {
  const progress: TransferProgressEvent[] = [];
  const deps: TransferRelayDeps = {
    createTargetClient: vi.fn(async () => {
      if (!target) throw new Error('no target in this scenario');
      return target.handle;
    }),
    showSaveDialog: vi.fn(async () => '/tmp/out.zip'),
    openFileSink: vi.fn(async (): Promise<FileSink> => {
      throw new Error('no file sink in this scenario');
    }),
    broadcastProgress: (e) => progress.push(e),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...extra,
  };
  return { deps, progress };
}

/** Poll until the source's export.start was issued, then emit `type`. */
async function emitWhenStarted(
  source: ReturnType<typeof makeSource>,
  type: string,
  data: Record<string, unknown>,
) {
  await vi.waitFor(() => {
    if (!source.started()) throw new Error('not started yet');
  });
  source.emit(type, data);
}

describe('workspace-transfer relay — server destination', () => {
  it('relays start → ready → chunks → commit and reports counters', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps, progress } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toEqual({ success: true, interruptedAgents: ['agent-9'] });
    const begin = target.calls.find((c) => c.method === 'workspace.import.begin');
    expect(begin?.params).toEqual({
      manifest: READY_DATA.manifest,
      archiveSizeBytes: 14,
      archiveSha256: READY_DATA.archiveSha256,
    });
    const chunks = target.calls.filter((c) => c.method === 'workspace.import.chunk');
    expect(chunks.map((c) => c.params.seq)).toEqual([0, 1]);
    expect(chunks[0].params.data).toBe(CHUNK0);
    expect(target.calls.at(-1)?.method).toBe('workspace.import.commit');
    expect(target.dispose).toHaveBeenCalledOnce();

    const relayFrames = progress.filter((p) => p.phase === 'relaying');
    expect(relayFrames.at(-1)).toMatchObject({ bytesDown: 14, bytesUp: 14, chunksDone: 2 });
    expect(progress.at(-1)?.phase).toBe('committing');
  });

  it('forwards build stages as building progress frames', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps, progress } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:progress', {
      workspaceId: 'ws-1',
      exportId: 'export-1',
      stage: 'bundling-git',
    });
    source.emit('workspace:transfer:ready', READY_DATA);
    await startPromise;

    expect(progress[0]).toMatchObject({ phase: 'building', stage: 'bundling-git' });
  });

  it('ignores transfer events for other workspaces', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps, progress } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:failed', {
      workspaceId: 'ws-OTHER',
      exportId: 'export-x',
      reason: 'unrelated failure',
    });
    source.emit('workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result.success).toBe(true);
    expect(progress.every((p) => p.workspaceId === 'ws-1')).toBe(true);
  });

  it('fails on :failed, aborts nothing on target, keeps source usable via export.abort', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:failed', {
      workspaceId: 'ws-1',
      exportId: 'export-1',
      reason: 'git bundle failed',
    });
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, error: 'git bundle failed' });
    // export.start resolved with the id, so abort targets it best-effort.
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
    expect(target.calls).toEqual([]);
  });

  it('aborts both sides and disposes the target when import.begin rejects (version mismatch)', async () => {
    const source = makeSource();
    const target = makeTarget({
      'workspace.import.begin': () => new Error('versions must match exactly'),
    });
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, error: 'versions must match exactly' });
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
    // begin failed before a session existed — no import.abort possible.
    expect(target.calls.filter((c) => c.method === 'workspace.import.abort')).toEqual([]);
    expect(target.dispose).toHaveBeenCalledOnce();
  });

  it('aborts the import and export when a chunk upload fails mid-relay', async () => {
    const source = makeSource();
    const target = makeTarget({
      'workspace.import.chunk': ({ seq }: { seq: number }) =>
        seq === 1 ? new Error('connection lost') : { importId: 'import-1', seq },
    });
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, error: 'connection lost' });
    expect(target.calls.some((c) => c.method === 'workspace.import.abort')).toBe(true);
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
    expect(target.dispose).toHaveBeenCalledOnce();
  });

  it('fails when the target client cannot be created; source aborted', async () => {
    const source = makeSource();
    const { deps } = makeDeps(source, undefined, {
      createTargetClient: vi.fn(async () => {
        throw new Error('unknown connection conn-9');
      }),
    });
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-9' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, error: 'unknown connection conn-9' });
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
  });

  it('a new start aborts a stale committed-but-unfinalized export on the old source', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const first = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    await first;
    // No finalize and no cancel (e.g. renderer reload) — the session lingers.
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(false);

    const second = relay.start(
      { workspaceId: 'ws-2', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await vi.waitFor(() => {
      if (!source.calls.some((c) => c.method === 'workspace.export.abort')) {
        throw new Error('stale export not aborted yet');
      }
    });
    const abort = source.calls.find((c) => c.method === 'workspace.export.abort');
    expect(abort?.params).toMatchObject({ exportId: 'export-1' });
    await vi.waitFor(() => {
      if (source.calls.filter((c) => c.method === 'workspace.export.start').length < 2) {
        throw new Error('second export not started yet');
      }
    });
    source.emit('workspace:transfer:ready', { ...READY_DATA, workspaceId: 'ws-2' });
    await second;
  });

  it('rejects a second concurrent start', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const first = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    const second = await relay.start(
      { workspaceId: 'ws-2', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    expect(second).toMatchObject({ success: false, error: expect.stringContaining('already') });

    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    await first;
  });
});

describe('workspace-transfer relay — download destination', () => {
  function makeSink() {
    const written: Buffer[] = [];
    const close = vi.fn(async () => undefined);
    const discard = vi.fn(async () => undefined);
    const sink: FileSink = {
      write: async (bytes) => {
        written.push(bytes);
      },
      close,
      discard,
    };
    return { sink, written, close, discard };
  }

  it('streams chunks to the file sink and reports download-only counters', async () => {
    const source = makeSource();
    const { sink, written, close } = makeSink();
    const { deps, progress } = makeDeps(source, undefined, {
      openFileSink: vi.fn(async () => sink),
    });
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'download' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toEqual({ success: true, filePath: '/tmp/out.zip' });
    expect(Buffer.concat(written).toString()).toBe('hello worldbye');
    expect(close).toHaveBeenCalledOnce();
    const last = progress.at(-1);
    expect(last).toMatchObject({ phase: 'relaying', bytesDown: 14, bytesUp: 0, chunksDone: 2 });
  });

  it('returns canceled without touching the source when the dialog is dismissed', async () => {
    const source = makeSource();
    const { deps } = makeDeps(source, undefined, {
      showSaveDialog: vi.fn(async () => undefined),
    });
    const relay = createWorkspaceTransferRelay(deps);

    const result = await relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'download' } },
      source.client,
    );
    expect(result).toEqual({ success: false, canceled: true });
    expect(source.calls).toEqual([]);
  });

  it('discards the partial file and aborts the export when a read fails', async () => {
    const source = makeSource({
      'workspace.export.read': ({ seq }: { seq: number }) => {
        if (seq === 1) return new Error('daemon went away');
        return { exportId: 'export-1', seq, totalChunks: 2, data: CHUNK0 };
      },
    });
    const { sink, discard } = makeSink();
    const { deps } = makeDeps(source, undefined, { openFileSink: vi.fn(async () => sink) });
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'download' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, error: 'daemon went away' });
    expect(discard).toHaveBeenCalledOnce();
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
  });
});

describe('workspace-transfer relay — finalize', () => {
  async function committedRelay(
    sourceOverrides: Record<string, (params: any) => unknown> = {},
    targetOverrides: Record<string, (params: any) => unknown> = {},
  ) {
    const source = makeSource(sourceOverrides);
    const target = makeTarget(targetOverrides);
    const targetFactory = vi.fn(async () => target.handle);
    const { deps } = makeDeps(source, target, { createTargetClient: targetFactory });
    const relay = createWorkspaceTransferRelay(deps);
    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    await startPromise;
    return { relay, source, target, targetFactory };
  }

  it('finalizes the source with archive + status message', async () => {
    const { relay, source, target } = await committedRelay();
    const result = await relay.finalize({
      archiveSource: true,
      finalStatusMessage: 'Transferred to devbox on 2026-08-11',
      restartAgents: false,
    });

    expect(result).toEqual({ success: true });
    const finalize = source.calls.find((c) => c.method === 'workspace.export.finalize');
    expect(finalize?.params).toEqual({
      exportId: 'export-1',
      archiveSource: true,
      finalStatusMessage: 'Transferred to devbox on 2026-08-11',
    });
    expect(target.calls.some((c) => c.method === 'agent.resolveInterrupted')).toBe(false);
  });

  it('resumes interrupted agents on the target when restartAgents is set', async () => {
    const { relay, target, targetFactory } = await committedRelay();
    const result = await relay.finalize({ archiveSource: false, restartAgents: true });

    expect(result).toEqual({ success: true });
    // A fresh target client is created for the resolve and disposed after.
    expect(targetFactory).toHaveBeenCalledTimes(2);
    expect(target.dispose).toHaveBeenCalledTimes(2);
    const resolve = target.calls.find((c) => c.method === 'agent.resolveInterrupted');
    expect(resolve?.params).toEqual({ resume: ['agent-9'] });
  });

  it('reports resume failures fail-soft while finalize still succeeds', async () => {
    const { relay } = await committedRelay(
      {},
      {
        'agent.resolveInterrupted': () => ({
          resumed: [],
          abandoned: [],
          failed: [{ agentId: 'agent-9', error: 'provider spawn failed' }],
        }),
      },
    );
    const result = await relay.finalize({ archiveSource: true, restartAgents: true });
    expect(result).toEqual({ success: true, resumeFailed: ['agent-9'] });
  });

  it('propagates a finalize failure', async () => {
    const { relay } = await committedRelay({
      'workspace.export.finalize': () => new Error('workspace gone'),
    });
    const result = await relay.finalize({ archiveSource: true });
    expect(result).toMatchObject({ success: false, error: 'workspace gone' });
  });

  it('rejects finalize with no committed transfer', async () => {
    const source = makeSource();
    const { deps } = makeDeps(source);
    const relay = createWorkspaceTransferRelay(deps);
    const result = await relay.finalize({ archiveSource: true });
    expect(result).toMatchObject({
      success: false,
      error: expect.stringContaining('no committed'),
    });
  });

  it('start and finalize use the per-invocation source client, not a shared one', async () => {
    const first = makeSource();
    const second = makeSource();
    const target = makeTarget();
    const { deps } = makeDeps(first, target);
    const relay = createWorkspaceTransferRelay(deps);

    const firstStart = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      first.client,
    );
    await emitWhenStarted(first, 'workspace:transfer:ready', READY_DATA);
    await firstStart;
    await relay.finalize({ archiveSource: false, restartAgents: false });

    // A start invoked from a window bound to another backend must talk to
    // that backend for export.start/finalize; the first client sees nothing.
    const callsBefore = first.calls.length;
    const secondStart = relay.start(
      { workspaceId: 'ws-2', destination: { kind: 'server', connectionId: 'conn-1' } },
      second.client,
    );
    await emitWhenStarted(second, 'workspace:transfer:ready', {
      ...READY_DATA,
      workspaceId: 'ws-2',
    });
    await secondStart;
    const result = await relay.finalize({ archiveSource: true, restartAgents: false });

    expect(result).toEqual({ success: true });
    expect(second.calls.some((c) => c.method === 'workspace.export.start')).toBe(true);
    expect(second.calls.some((c) => c.method === 'workspace.export.finalize')).toBe(true);
    expect(first.calls.length).toBe(callsBefore);
  });
});

describe('workspace-transfer relay — cancel', () => {
  it('cancel mid-build aborts the export and start resolves canceled', async () => {
    const source = makeSource();
    const { deps } = makeDeps(source);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await vi.waitFor(() => {
      if (!source.started()) throw new Error('not started yet');
    });
    // Let export.start's response settle so the session holds the exportId.
    await vi.waitFor(() => {
      if (!source.calls.some((c) => c.method === 'workspace.export.start')) {
        throw new Error('no start call');
      }
    });
    await relay.cancel();
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, canceled: true });
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
  });

  it('cancel after commit (wizard dismissed) aborts export staging on the source', async () => {
    const source = makeSource();
    const target = makeTarget();
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    await startPromise;

    const result = await relay.cancel();
    expect(result).toEqual({ success: true });
    expect(source.calls.some((c) => c.method === 'workspace.export.abort')).toBe(true);
    // Finalize after a dismissed wizard has nothing to settle.
    const finalize = await relay.finalize({ archiveSource: true });
    expect(finalize.success).toBe(false);
  });

  it('cancel with no session is a quiet no-op', async () => {
    const source = makeSource();
    const { deps } = makeDeps(source);
    const relay = createWorkspaceTransferRelay(deps);
    expect(await relay.cancel()).toEqual({ success: true });
    expect(source.calls).toEqual([]);
  });

  it('a cancel racing the target commit resolves canceled and never aborts the committed import', async () => {
    const source = makeSource();
    let relayRef: { cancel: () => Promise<unknown> } | null = null;
    const target = makeTarget({
      'workspace.import.commit': async () => {
        // The wizard is dismissed while the commit RPC is in flight.
        await relayRef!.cancel();
        return { workspace: { id: 'ws-1' }, interruptedAgents: [] };
      },
    });
    const { deps } = makeDeps(source, target);
    const relay = createWorkspaceTransferRelay(deps);
    relayRef = relay;

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'server', connectionId: 'conn-1' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, canceled: true });
    // The commit landed: it must not be aborted, only surfaced as cancelled.
    expect(target.calls.some((c) => c.method === 'workspace.import.abort')).toBe(false);
    expect(deps.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('cancelled during target commit'),
      expect.objectContaining({ workspaceId: 'ws-1' }),
    );
    expect(target.dispose).toHaveBeenCalledOnce();
  });

  it('a cancel racing the last download chunk discards the completed file', async () => {
    let relayRef: { cancel: () => Promise<unknown> } | null = null;
    const source = makeSource({
      'workspace.export.read': async ({ seq }: { seq: number }) => {
        if (seq === 1) await relayRef!.cancel();
        return {
          exportId: 'export-1',
          seq,
          totalChunks: 2,
          data: seq === 0 ? CHUNK0 : CHUNK1,
        };
      },
    });
    const written: Buffer[] = [];
    const close = vi.fn(async () => undefined);
    const discard = vi.fn(async () => undefined);
    const { deps } = makeDeps(source, undefined, {
      openFileSink: vi.fn(async () => ({
        write: async (bytes: Buffer) => {
          written.push(bytes);
        },
        close,
        discard,
      })),
    });
    const relay = createWorkspaceTransferRelay(deps);
    relayRef = relay;

    const startPromise = relay.start(
      { workspaceId: 'ws-1', destination: { kind: 'download' } },
      source.client,
    );
    await emitWhenStarted(source, 'workspace:transfer:ready', READY_DATA);
    const result = await startPromise;

    expect(result).toMatchObject({ success: false, canceled: true });
    expect(discard).toHaveBeenCalledOnce();
  });
});
