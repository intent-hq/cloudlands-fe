/**
 * Workspace import relay (main process) — the "Import Workspace from File…"
 * flow. Reads a transfer zip picked via a file-open dialog, pulls its
 * `manifest.json` (central-directory read, nothing extracted), hashes the
 * archive, then streams it into the invoking window's backend per PROTOCOL §5.1:
 * `workspace.import.begin` → seq-numbered base64 `workspace.import.chunk`
 * calls (respecting the begin result's `maxChunkBytes`) →
 * `workspace.import.commit`.
 *
 * Archive bytes live only in this module — they never cross the renderer IPC
 * boundary; the renderer sees byte/chunk counters on
 * `transfer:import-progress`. Failures and cancels abort the staged import
 * best-effort (`workspace.import.abort`) so the backend holds no staging
 * garbage. The picked file path is remembered so a retry after a failure
 * re-runs against the same archive without a second dialog.
 */

import { createHash } from 'node:crypto';
import type {
  ImportCancelResult,
  ImportProgressEvent,
  ImportStartParams,
  ImportStartResult,
} from '../../../shared/types/workspace-transfer';
import type { RelayRpcClient } from './workspace-transfer-relay';
import { readZipManifest, type ZipByteSource } from './zip-manifest';

/** Random-access handle over the picked archive (injectable for tests). */
export interface ImportFileSource extends ZipByteSource {
  close(): Promise<void>;
}

/** Injectable seams so unit tests never stand up sockets/dialogs/disk. */
export interface ImportRelayDeps {
  /** Returns the chosen path, or undefined when the user cancelled. */
  showOpenDialog(): Promise<string | undefined>;
  openFile(filePath: string): Promise<ImportFileSource>;
  broadcastProgress(event: ImportProgressEvent): void;
  /** True when the session-owning window no longer exists (closed/destroyed),
   * releasing its session for cancellation by other windows. */
  isOwnerGone(ownerId: number): boolean;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/** Per-chunk ops get a generous bound (16 MiB base64 frames on slow links). */
const CHUNK_TIMEOUT_MS = 120_000;
/** `workspace.import.chunk` is idempotent per seq (PROTOCOL §5.1) — retry once. */
const CHUNK_ATTEMPTS = 2;
/** `workspace.import.commit` unpacks + materializes git — the slowest call. */
const COMMIT_TIMEOUT_MS = 600_000;
/** Read the archive in 4 MiB slices while hashing. */
const HASH_READ_BYTES = 4 * 1024 * 1024;

interface ImportSession {
  /** WebContents id of the window that started the session — lifecycle calls
   * from other windows are rejected while this window is alive. */
  ownerId: number;
  cancelled: boolean;
  /** Set while chunks are staging on the backend (cleared after commit). */
  importId?: string;
  client?: RelayRpcClient;
}

export interface WorkspaceImportRelay {
  /** `client` is the invoking window's backend client — the import target;
   * `ownerId` is the invoking window's WebContents id (session affinity). */
  start(
    params: ImportStartParams,
    client: RelayRpcClient,
    ownerId: number,
  ): Promise<ImportStartResult>;
  cancel(ownerId: number): Promise<ImportCancelResult>;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** Structured rejection when another window owns the active session. */
const NOT_OWNER = {
  success: false,
  error: 'the import session belongs to another window',
  code: 'not-session-owner',
} as const;

export function createWorkspaceImportRelay(deps: ImportRelayDeps): WorkspaceImportRelay {
  let session: ImportSession | null = null;
  /** Last picked archive, for dialog-free retry after a failure — pinned to
   * the window that picked it so another window cannot re-run its import. */
  let lastFile: { path: string; ownerId: number } | undefined;

  /** Owner check: the caller owns the session, or its owner window is gone. */
  function ownsSession(current: ImportSession, ownerId: number): boolean {
    return current.ownerId === ownerId || deps.isOwnerGone(current.ownerId);
  }

  /** Best-effort backend-side cleanup; never throws. */
  async function abortImport(client: RelayRpcClient, importId: string): Promise<void> {
    try {
      await client.request('workspace.import.abort', { importId });
    } catch (error) {
      deps.logger.warn('workspace.import.abort failed (best-effort)', { error: errText(error) });
    }
  }

  /** SHA-256 of the whole archive, streamed in slices. */
  async function hashArchive(
    file: ImportFileSource,
    sizeBytes: number,
    isCancelled: () => boolean,
  ): Promise<string> {
    const hash = createHash('sha256');
    for (let offset = 0; offset < sizeBytes; offset += HASH_READ_BYTES) {
      if (isCancelled()) throw new Error('cancelled');
      const length = Math.min(HASH_READ_BYTES, sizeBytes - offset);
      hash.update(await file.read(offset, length));
    }
    return hash.digest('hex');
  }

  /** Upload every chunk file → backend, reporting progress per chunk. */
  async function uploadChunks(
    client: RelayRpcClient,
    file: ImportFileSource,
    sizeBytes: number,
    maxChunkBytes: number,
    importId: string,
    isCancelled: () => boolean,
  ): Promise<void> {
    const chunksTotal = Math.max(1, Math.ceil(sizeBytes / maxChunkBytes));
    let bytesUp = 0;
    for (let seq = 0; seq < chunksTotal; seq++) {
      if (isCancelled()) throw new Error('cancelled');
      const offset = seq * maxChunkBytes;
      const length = Math.min(maxChunkBytes, sizeBytes - offset);
      const bytes = await file.read(offset, length);
      if (isCancelled()) throw new Error('cancelled');
      for (let attempt = 1; ; attempt++) {
        try {
          await client.request(
            'workspace.import.chunk',
            { importId, seq, data: bytes.toString('base64') },
            { timeoutMs: CHUNK_TIMEOUT_MS },
          );
          break;
        } catch (error) {
          if (attempt >= CHUNK_ATTEMPTS || isCancelled()) throw error;
          deps.logger.warn('workspace.import.chunk failed; retrying', {
            seq,
            attempt,
            error: errText(error),
          });
        }
      }
      bytesUp += length;
      deps.broadcastProgress({
        phase: 'uploading',
        bytesTotal: sizeBytes,
        bytesUp,
        chunksTotal,
        chunksDone: seq + 1,
      });
    }
  }

  async function start(
    params: ImportStartParams,
    client: RelayRpcClient,
    ownerId: number,
  ): Promise<ImportStartResult> {
    if (session) {
      if (!deps.isOwnerGone(session.ownerId)) {
        return { success: false, error: 'an import is already in progress' };
      }
      // The in-flight run's owner window is gone: no renderer remains to
      // cancel it, so release it here — flag it cancelled (its loop observes
      // the flag and aborts the staged import) and let the new start proceed.
      session.cancelled = true;
    }
    // The session exists across the open dialog too, so a wizard close while
    // the native dialog is up marks it cancelled and the pick is discarded.
    const current: ImportSession = { ownerId, cancelled: false };
    session = current;
    const isCancelled = (): boolean => current.cancelled;

    let file: ImportFileSource | null = null;
    // Retry only re-runs the invoking window's own pick — another window's
    // last file must not leak across (monorepo#3519).
    let filePath =
      params.reuseLastFile && lastFile?.ownerId === ownerId ? lastFile.path : undefined;
    try {
      if (!filePath) {
        filePath = await deps.showOpenDialog();
        if (!filePath || isCancelled()) return { success: false, canceled: true };
      }
      lastFile = { path: filePath, ownerId };

      current.client = client;
      file = await deps.openFile(filePath);
      const sizeBytes = await file.size();

      deps.broadcastProgress({
        phase: 'reading',
        bytesTotal: sizeBytes,
        bytesUp: 0,
        chunksDone: 0,
      });
      const manifest = await readZipManifest(file);
      const archiveSha256 = await hashArchive(file, sizeBytes, isCancelled);
      if (isCancelled()) throw new Error('cancelled');

      const begin = await client.request<{ importId: string; maxChunkBytes: number }>(
        'workspace.import.begin',
        { manifest, archiveSizeBytes: sizeBytes, archiveSha256 },
      );
      current.importId = begin.importId;
      try {
        if (!Number.isFinite(begin.maxChunkBytes) || begin.maxChunkBytes <= 0) {
          throw new Error('invalid maxChunkBytes from workspace.import.begin');
        }
        await uploadChunks(
          client,
          file,
          sizeBytes,
          begin.maxChunkBytes,
          begin.importId,
          isCancelled,
        );
        if (isCancelled()) throw new Error('cancelled');
        deps.broadcastProgress({
          phase: 'committing',
          bytesTotal: sizeBytes,
          bytesUp: sizeBytes,
          chunksTotal: Math.max(1, Math.ceil(sizeBytes / begin.maxChunkBytes)),
          chunksDone: Math.max(1, Math.ceil(sizeBytes / begin.maxChunkBytes)),
        });
        const commit = await client.request<{
          workspace?: { id?: string; title?: string; name?: string };
          interruptedAgents?: string[];
        }>(
          'workspace.import.commit',
          { importId: begin.importId },
          { timeoutMs: COMMIT_TIMEOUT_MS },
        );
        current.importId = undefined;
        if (isCancelled()) {
          // The cancel raced the commit and lost: the backend already holds
          // the imported workspace (a commit cannot be undone). Surface the
          // run as cancelled rather than success against a reset UI.
          deps.logger.warn(
            'import cancelled during commit; imported workspace remains on the backend',
            { filePath },
          );
          throw new Error('cancelled');
        }
        return {
          success: true,
          workspaceId: commit.workspace?.id,
          workspaceTitle: commit.workspace?.title || commit.workspace?.name || undefined,
          interruptedAgents: Array.isArray(commit.interruptedAgents)
            ? commit.interruptedAgents
            : [],
        };
      } catch (error) {
        // Only staged imports can be aborted — a committed one stays.
        if (current.importId) {
          await abortImport(client, current.importId);
          current.importId = undefined;
        }
        throw error;
      }
    } catch (error) {
      const cancelled = current.cancelled || errText(error) === 'cancelled';
      if (!cancelled) {
        deps.logger.warn('workspace import failed', { filePath, error: errText(error) });
      }
      return cancelled
        ? { success: false, canceled: true }
        : { success: false, error: errText(error) };
    } finally {
      await file?.close().catch(() => undefined);
      // An orphaned run released by a takeover must not clear its successor.
      if (session === current) session = null;
    }
  }

  async function cancel(ownerId: number): Promise<ImportCancelResult> {
    const current = session;
    if (!current) return { success: true };
    if (!ownsSession(current, ownerId)) {
      return NOT_OWNER;
    }
    current.cancelled = true;
    // The in-flight start() loop observes the flag between reads/chunks and
    // aborts the staged import itself; nothing else to do here.
    return { success: true };
  }

  return { start, cancel };
}
