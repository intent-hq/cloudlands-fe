/**
 * Workspace import relay (main process) — the "Import Workspace from File…"
 * flow. Reads a transfer zip picked via a file-open dialog, pulls its
 * `manifest.json` (central-directory read, nothing extracted), hashes the
 * archive, then streams it into the CURRENT backend per PROTOCOL §5.1:
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
  /** The CURRENT backend's client — the import target. */
  getClient(): RelayRpcClient;
  /** Returns the chosen path, or undefined when the user cancelled. */
  showOpenDialog(): Promise<string | undefined>;
  openFile(filePath: string): Promise<ImportFileSource>;
  broadcastProgress(event: ImportProgressEvent): void;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

/** Per-chunk ops get a generous bound (16 MiB base64 frames on slow links). */
const CHUNK_TIMEOUT_MS = 120_000;
/** `workspace.import.commit` unpacks + materializes git — the slowest call. */
const COMMIT_TIMEOUT_MS = 600_000;
/** Read the archive in 4 MiB slices while hashing. */
const HASH_READ_BYTES = 4 * 1024 * 1024;

interface ImportSession {
  cancelled: boolean;
  /** Set while chunks are staging on the backend (cleared after commit). */
  importId?: string;
  client?: RelayRpcClient;
}

export interface WorkspaceImportRelay {
  start(params: ImportStartParams): Promise<ImportStartResult>;
  cancel(): Promise<ImportCancelResult>;
}

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkspaceImportRelay(deps: ImportRelayDeps): WorkspaceImportRelay {
  let session: ImportSession | null = null;
  /** Last picked archive, for dialog-free retry after a failure. */
  let lastFilePath: string | undefined;

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
      await client.request(
        'workspace.import.chunk',
        { importId, seq, data: bytes.toString('base64') },
        { timeoutMs: CHUNK_TIMEOUT_MS },
      );
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

  async function start(params: ImportStartParams): Promise<ImportStartResult> {
    if (session) {
      return { success: false, error: 'an import is already in progress' };
    }
    let filePath = params.reuseLastFile ? lastFilePath : undefined;
    if (!filePath) {
      filePath = await deps.showOpenDialog();
      if (!filePath) return { success: false, canceled: true };
    }
    lastFilePath = filePath;

    const current: ImportSession = { cancelled: false };
    session = current;
    const isCancelled = (): boolean => current.cancelled;

    let file: ImportFileSource | null = null;
    try {
      const client = deps.getClient();
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
        await uploadChunks(client, file, sizeBytes, begin.maxChunkBytes, begin.importId, isCancelled);
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
        }>('workspace.import.commit', { importId: begin.importId }, { timeoutMs: COMMIT_TIMEOUT_MS });
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
      session = null;
    }
  }

  async function cancel(): Promise<ImportCancelResult> {
    const current = session;
    if (!current) return { success: true };
    current.cancelled = true;
    // The in-flight start() loop observes the flag between reads/chunks and
    // aborts the staged import itself; nothing else to do here.
    return { success: true };
  }

  return { start, cancel };
}
