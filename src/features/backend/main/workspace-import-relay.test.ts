/**
 * Unit tests for the workspace import relay engine (main process).
 *
 * All seams are injected — no sockets, dialogs, or disk. The archive is an
 * in-memory zip fixture; a fake client records the `import.begin/chunk/commit`
 * sequence and scripts per-method results.
 */

import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import type { RelayRpcClient } from './workspace-transfer-relay';
import {
  createWorkspaceImportRelay,
  type ImportFileSource,
  type ImportRelayDeps,
} from './workspace-import-relay';
import type {
  ImportProgressEvent,
  ImportStartParams,
} from '../../../shared/types/workspace-transfer';

const MANIFEST = { formatVersion: 1, workspaceId: 'ws-1', creatingIntentdVersion: '1.2.3' };

/** Minimal single-entry stored zip carrying manifest.json. */
function buildArchive(): Buffer {
  const data = Buffer.from(JSON.stringify(MANIFEST));
  const name = Buffer.from('manifest.json');
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(0, 8);
  local.writeUInt32LE(data.length, 18);
  local.writeUInt32LE(data.length, 22);
  local.writeUInt16LE(name.length, 26);
  const cen = Buffer.alloc(46);
  cen.writeUInt32LE(0x02014b50, 0);
  cen.writeUInt16LE(0, 10);
  cen.writeUInt32LE(data.length, 20);
  cen.writeUInt32LE(data.length, 24);
  cen.writeUInt16LE(name.length, 28);
  cen.writeUInt32LE(0, 42);
  const centralOffset = 30 + name.length + data.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);
  eocd.writeUInt16LE(1, 10);
  eocd.writeUInt32LE(46 + name.length, 12);
  eocd.writeUInt32LE(centralOffset, 16);
  return Buffer.concat([local, name, data, cen, name, eocd]);
}

const ARCHIVE = buildArchive();
const ARCHIVE_SHA = createHash('sha256').update(ARCHIVE).digest('hex');

function makeFile(bytes: Buffer = ARCHIVE) {
  const close = vi.fn(async () => undefined);
  const file: ImportFileSource = {
    async size() {
      return bytes.length;
    },
    async read(offset, length) {
      return bytes.subarray(offset, offset + length);
    },
    close,
  };
  return { file, close };
}

/** Fake backend client: records calls; scripted per-method results. */
function makeClient(overrides: Record<string, (params: any) => unknown> = {}) {
  const calls: Array<{ method: string; params: any }> = [];
  const handlers: Record<string, (params: any) => unknown> = {
    'workspace.import.begin': () => ({ importId: 'import-1', maxChunkBytes: 64 }),
    'workspace.import.chunk': ({ seq }: { seq: number }) => ({ importId: 'import-1', seq }),
    'workspace.import.commit': () => ({
      workspace: { id: 'ws-1', title: 'My Space' },
      interruptedAgents: ['agent-9'],
    }),
    'workspace.import.abort': () => ({ importId: 'import-1', aborted: true }),
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
    on: () => undefined,
    off: () => undefined,
  };
  return { client, calls };
}

function makeDeps(
  client: ReturnType<typeof makeClient>,
  file: ReturnType<typeof makeFile>,
  extra: Partial<ImportRelayDeps> = {},
) {
  const progress: ImportProgressEvent[] = [];
  const deps: ImportRelayDeps = {
    showOpenDialog: vi.fn(async () => '/tmp/in.zip'),
    openFile: vi.fn(async () => file.file),
    broadcastProgress: (e) => progress.push(e),
    isOwnerGone: vi.fn(() => false),
    logger: { info: vi.fn(), warn: vi.fn() },
    ...extra,
  };
  return { deps, progress };
}

/** Default owning window for tests that don't exercise cross-window affinity. */
const OWNER = 101;

/** Relay wrapper defaulting the ownerId so single-window tests stay terse. */
function makeRelay(deps: ImportRelayDeps) {
  const relay = createWorkspaceImportRelay(deps);
  return {
    start: (params: ImportStartParams, client: RelayRpcClient, ownerId: number = OWNER) =>
      relay.start(params, client, ownerId),
    cancel: (ownerId: number = OWNER) => relay.cancel(ownerId),
  };
}

describe('workspace import relay', () => {
  it('runs begin → chunk → commit with sha/size from the file', async () => {
    const client = makeClient();
    const file = makeFile();
    const { deps, progress } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toEqual({
      success: true,
      workspaceId: 'ws-1',
      workspaceTitle: 'My Space',
      interruptedAgents: ['agent-9'],
    });
    const methods = client.calls.map((c) => c.method);
    expect(methods[0]).toBe('workspace.import.begin');
    expect(methods.at(-1)).toBe('workspace.import.commit');
    expect(client.calls[0].params).toEqual({
      manifest: MANIFEST,
      archiveSizeBytes: ARCHIVE.length,
      archiveSha256: ARCHIVE_SHA,
    });
    // Chunks: sequential seq, base64 payloads reassemble to the archive.
    const chunks = client.calls.filter((c) => c.method === 'workspace.import.chunk');
    expect(chunks.length).toBe(Math.ceil(ARCHIVE.length / 64));
    expect(chunks.map((c) => c.params.seq)).toEqual(chunks.map((_, i) => i));
    const reassembled = Buffer.concat(
      chunks.map((c) => Buffer.from(c.params.data as string, 'base64')),
    );
    expect(reassembled.equals(ARCHIVE)).toBe(true);
    expect(progress.some((p) => p.phase === 'uploading')).toBe(true);
    expect(progress.at(-1)?.phase).toBe('committing');
    expect(file.close).toHaveBeenCalled();
  });

  it('returns canceled (no error) when the open dialog is dismissed', async () => {
    const client = makeClient();
    const file = makeFile();
    const { deps } = makeDeps(client, file, {
      showOpenDialog: vi.fn(async () => undefined),
    });
    const relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toEqual({ success: false, canceled: true });
    expect(client.calls).toHaveLength(0);
  });

  it('surfaces the daemon begin error verbatim and calls no chunk/commit', async () => {
    const daemonError =
      'archive was created by intentd 1.0.0 but this daemon is 1.2.3 — versions must match exactly';
    const client = makeClient({
      'workspace.import.begin': () => new Error(daemonError),
    });
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toEqual({ success: false, error: daemonError });
    const methods = client.calls.map((c) => c.method);
    expect(methods).toEqual(['workspace.import.begin']);
  });

  it('aborts the staged import when a chunk fails', async () => {
    const client = makeClient({
      'workspace.import.chunk': ({ seq }: { seq: number }) =>
        seq === 1 ? new Error('link dropped') : { importId: 'import-1', seq },
    });
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toEqual({ success: false, error: 'link dropped' });
    const abort = client.calls.find((c) => c.method === 'workspace.import.abort');
    expect(abort?.params).toEqual({ importId: 'import-1' });
    expect(client.calls.some((c) => c.method === 'workspace.import.commit')).toBe(false);
  });

  it('aborts the staged import when a commit fails', async () => {
    const client = makeClient({
      'workspace.import.commit': () => new Error('sha mismatch'),
    });
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toEqual({ success: false, error: 'sha mismatch' });
    expect(client.calls.some((c) => c.method === 'workspace.import.abort')).toBe(true);
  });

  it('cancel mid-upload aborts the staged import and reports canceled', async () => {
    const client = makeClient();
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);
    // Cancel as soon as the first chunk lands on the wire.
    const originalRequest = client.client.request.bind(client.client);
    let cancelled = false;
    client.client.request = async (method, params, options) => {
      const result = await originalRequest(method, params, options);
      if (method === 'workspace.import.chunk' && !cancelled) {
        cancelled = true;
        await relay.cancel();
      }
      return result as never;
    };

    const result = await relay.start({}, client.client);

    expect(result).toEqual({ success: false, canceled: true });
    expect(client.calls.some((c) => c.method === 'workspace.import.abort')).toBe(true);
    expect(client.calls.some((c) => c.method === 'workspace.import.commit')).toBe(false);
  });

  it('retry with reuseLastFile skips the dialog and reuses the picked path', async () => {
    const failing = makeClient({
      'workspace.import.commit': () => new Error('boom'),
    });
    const file = makeFile();
    const openDialog = vi.fn(async () => '/tmp/in.zip');
    const openFile = vi.fn(async () => file.file);
    const { deps } = makeDeps(failing, file, { showOpenDialog: openDialog, openFile });
    const relay = makeRelay(deps);

    await relay.start({}, failing.client);
    expect(openDialog).toHaveBeenCalledTimes(1);

    const second = makeFile();
    openFile.mockResolvedValueOnce(second.file);
    await relay.start({ reuseLastFile: true }, failing.client);

    expect(openDialog).toHaveBeenCalledTimes(1);
    expect(openFile).toHaveBeenLastCalledWith('/tmp/in.zip');
  });

  it('retries a transiently failing chunk once (idempotent per seq)', async () => {
    let failures = 0;
    const client = makeClient({
      'workspace.import.chunk': ({ seq }: { seq: number }) => {
        if (seq === 1 && failures === 0) {
          failures++;
          return new Error('link hiccup');
        }
        return { importId: 'import-1', seq };
      },
    });
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toMatchObject({ success: true });
    const seqOnes = client.calls.filter(
      (c) => c.method === 'workspace.import.chunk' && c.params.seq === 1,
    );
    expect(seqOnes).toHaveLength(2);
    expect(client.calls.some((c) => c.method === 'workspace.import.abort')).toBe(false);
  });

  it('rejects an invalid maxChunkBytes from begin and aborts the staging', async () => {
    for (const maxChunkBytes of [0, -1, undefined]) {
      const client = makeClient({
        'workspace.import.begin': () => ({ importId: 'import-1', maxChunkBytes }),
      });
      const file = makeFile();
      const { deps } = makeDeps(client, file);
      const relay = makeRelay(deps);

      const result = await relay.start({}, client.client);

      expect(result).toEqual({
        success: false,
        error: 'invalid maxChunkBytes from workspace.import.begin',
      });
      expect(client.calls.some((c) => c.method === 'workspace.import.chunk')).toBe(false);
      expect(client.calls.some((c) => c.method === 'workspace.import.abort')).toBe(true);
    }
  });

  it('a cancel while the open dialog is up discards the picked file', async () => {
    const client = makeClient();
    const file = makeFile();
    let relay: ReturnType<typeof makeRelay>;
    const { deps } = makeDeps(client, file, {
      showOpenDialog: vi.fn(async () => {
        // The wizard closes (cancel) while the native dialog is still open.
        await relay.cancel();
        return '/tmp/in.zip';
      }),
    });
    relay = makeRelay(deps);

    const result = await relay.start({}, client.client);

    expect(result).toEqual({ success: false, canceled: true });
    expect(client.calls).toHaveLength(0);
  });

  it('rejects a second concurrent import', async () => {
    const client = makeClient();
    const file = makeFile();
    // Hold the commit so the first run stays in flight.
    let commitStarted = false;
    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => (releaseCommit = resolve));
    const originalRequest = client.client.request.bind(client.client);
    client.client.request = async (method, params, options) => {
      if (method === 'workspace.import.commit') {
        commitStarted = true;
        await commitGate;
      }
      return (await originalRequest(method, params, options)) as never;
    };
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const first = relay.start({}, client.client);
    await vi.waitFor(() => {
      if (!commitStarted) throw new Error('commit not reached yet');
    });
    const second = await relay.start({}, client.client);
    expect(second).toEqual({ success: false, error: 'an import is already in progress' });

    releaseCommit?.();
    await expect(first).resolves.toMatchObject({ success: true });
  });
});

describe('workspace import relay — per-window session affinity (monorepo#3519)', () => {
  const OTHER = 202;

  /** Start an import and hold its commit so the session stays in flight. */
  function makeGatedClient() {
    const client = makeClient();
    let commitStarted = false;
    let releaseCommit: (() => void) | undefined;
    const commitGate = new Promise<void>((resolve) => (releaseCommit = resolve));
    const originalRequest = client.client.request.bind(client.client);
    client.client.request = async (method, params, options) => {
      if (method === 'workspace.import.commit') {
        commitStarted = true;
        await commitGate;
      }
      return (await originalRequest(method, params, options)) as never;
    };
    return {
      ...client,
      commitReached: () => commitStarted,
      releaseCommit: () => releaseCommit?.(),
    };
  }

  it('rejects cancel from a non-owning window; the import completes', async () => {
    const client = makeGatedClient();
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const first = relay.start({}, client.client);
    await vi.waitFor(() => {
      if (!client.commitReached()) throw new Error('commit not reached yet');
    });

    const hijack = await relay.cancel(OTHER);
    expect(hijack).toEqual({
      success: false,
      error: 'the import session belongs to another window',
      code: 'not-session-owner',
    });

    client.releaseCommit();
    await expect(first).resolves.toMatchObject({ success: true });
    expect(client.calls.some((c) => c.method === 'workspace.import.abort')).toBe(false);
  });

  it('allows cancel from another window once the owning window is gone', async () => {
    const isOwnerGone = vi.fn(() => false);
    const client = makeGatedClient();
    const file = makeFile();
    const { deps } = makeDeps(client, file, { isOwnerGone });
    const relay = makeRelay(deps);

    const first = relay.start({}, client.client);
    await vi.waitFor(() => {
      if (!client.commitReached()) throw new Error('commit not reached yet');
    });

    isOwnerGone.mockReturnValue(true);
    const result = await relay.cancel(OTHER);
    expect(result).toEqual({ success: true });
    expect(isOwnerGone).toHaveBeenCalledWith(OWNER);

    client.releaseCommit();
    await expect(first).resolves.toMatchObject({ success: false, canceled: true });
  });

  it('releases an in-flight run whose owner is gone: a new start cancels it and proceeds', async () => {
    const isOwnerGone = vi.fn(() => false);
    const client = makeGatedClient();
    const file = makeFile();
    const { deps } = makeDeps(client, file, { isOwnerGone });
    const relay = makeRelay(deps);

    // Orphaned run: held at commit, then its window closes.
    const orphan = relay.start({}, client.client);
    await vi.waitFor(() => {
      if (!client.commitReached()) throw new Error('commit not reached yet');
    });
    isOwnerGone.mockReturnValue(true);

    const fresh = makeClient();
    const second = relay.start({}, fresh.client, OTHER);
    client.releaseCommit();
    // The orphan unwinds as cancelled (its cancel raced the commit and lost).
    await expect(orphan).resolves.toMatchObject({ success: false, canceled: true });
    isOwnerGone.mockReturnValue(false);
    await expect(second).resolves.toMatchObject({ success: true });
  });

  it("keeps rejecting a second start while the in-flight run's owner is alive", async () => {
    const client = makeGatedClient();
    const file = makeFile();
    const { deps } = makeDeps(client, file);
    const relay = makeRelay(deps);

    const first = relay.start({}, client.client);
    await vi.waitFor(() => {
      if (!client.commitReached()) throw new Error('commit not reached yet');
    });
    const second = await relay.start({}, client.client, OTHER);
    expect(second).toMatchObject({ success: false, error: expect.stringContaining('already') });

    client.releaseCommit();
    await expect(first).resolves.toMatchObject({ success: true });
  });

  it("does not reuse another window's last file: retry from a second window re-opens the dialog", async () => {
    const failing = makeClient({
      'workspace.import.commit': () => new Error('boom'),
    });
    const file = makeFile();
    const openDialog = vi.fn(async () => '/tmp/in.zip');
    const openFile = vi.fn(async () => file.file);
    const { deps } = makeDeps(failing, file, { showOpenDialog: openDialog, openFile });
    const relay = makeRelay(deps);

    await relay.start({}, failing.client);
    expect(openDialog).toHaveBeenCalledTimes(1);

    // A different window's "retry" must not silently re-run the first
    // window's archive — it gets its own open dialog.
    openDialog.mockResolvedValueOnce('/tmp/other.zip');
    const second = makeFile();
    openFile.mockResolvedValueOnce(second.file);
    await relay.start({ reuseLastFile: true }, failing.client, OTHER);

    expect(openDialog).toHaveBeenCalledTimes(2);
    expect(openFile).toHaveBeenLastCalledWith('/tmp/other.zip');
  });
});
