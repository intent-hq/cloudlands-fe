/**
 * Workspace transfer relay (main process) — wizard steps 3–4 execution.
 *
 * Drives the FE-mediated transfer per PROTOCOL §5.1: `workspace.export.start`
 * on the SOURCE (the invoking window's backend client, passed per start), after
 * a server TARGET has completed an authenticated `host.status` preflight, then
 * either
 *   - relays the sealed archive chunk-by-chunk (`workspace.export.read` →
 *     `workspace.import.chunk`) into a second, short-lived JsonRpcClient
 *     pinned to the chosen TARGET connection and commits
 *     (`workspace.import.commit`), or
 *   - streams the chunks to a local zip file picked via a save dialog
 *     ("Download to file").
 *
 * Archive bytes live only in this module — they never cross the renderer IPC
 * boundary; the renderer sees byte/chunk counters on `transfer:progress`.
 * The temporary target client is ALWAYS disposed (success, failure, cancel);
 * the active client stays pinned to the source throughout. Preflight failures
 * never touch the source; later failures abort both sides best-effort
 * (`workspace.export.abort` + `workspace.import.abort`) so the source stays
 * usable and the target holds no staging garbage.
 */

import type {
  TransferFinalizeParams,
  TransferFinalizeResult,
  TransferCancelResult,
  TransferProgressEvent,
  TransferStartParams,
  TransferStartResult,
} from '../../../shared/types/workspace-transfer';

/** The subset of JsonRpcClient the relay needs (injectable for tests). */
export interface RelayRpcClient {
  request<T = unknown>(
    method: string,
    params?: unknown,
    options?: { timeoutMs?: number },
  ): Promise<T>;
  on(event: 'notification', listener: (n: { method: string; params?: unknown }) => void): unknown;
  off(event: 'notification', listener: (n: { method: string; params?: unknown }) => void): unknown;
}

/** A disposable client handle for the temporary target connection. */
export interface TargetClientHandle {
  client: RelayRpcClient;
  dispose(): void;
}

/** Injectable seams so unit tests never stand up sockets/dialogs/disk. */
export interface TransferRelayDeps {
  createTargetClient(connectionId: string): Promise<TargetClientHandle>;
  /** Returns the chosen path, or undefined when the user cancelled. */
  showSaveDialog(defaultFileName: string): Promise<string | undefined>;
  /** Sequential chunk sink for the download destination. */
  openFileSink(filePath: string): Promise<FileSink>;
  broadcastProgress(event: TransferProgressEvent): void;
  logger: {
    info(msg: string, meta?: Record<string, unknown>): void;
    warn(msg: string, meta?: Record<string, unknown>): void;
  };
}

export interface FileSink {
  write(bytes: Buffer): Promise<void>;
  close(): Promise<void>;
  /** Best-effort removal of a partially-written file on failure. */
  discard(): Promise<void>;
}

/** `workspace:transfer:ready` event payload (PROTOCOL §6.5). */
interface TransferReadyData {
  workspaceId: string;
  exportId: string;
  manifest: unknown;
  archiveSizeBytes: number;
  archiveSha256: string;
  maxChunkBytes: number;
  totalChunks: number;
}

/** Per-chunk ops get a generous bound (16 MiB base64 frames on slow links). */
const CHUNK_TIMEOUT_MS = 120_000;
/** Overall target connect + authenticated status-probe deadline. */
const TARGET_PREFLIGHT_TIMEOUT_MS = 15_000;
/** `workspace.import.commit` unpacks + materializes git — the slowest call. */
const COMMIT_TIMEOUT_MS = 600_000;
/** Waiting for the source's archive build (`:ready`/`:failed`) is unbounded
 * by RPC — bound it so a wedged daemon cannot hang the wizard forever. */
const BUILD_TIMEOUT_MS = 600_000;

/** One in-flight/settled transfer awaiting finalize. */
interface RelaySession {
  workspaceId: string;
  /** The SOURCE daemon's client, pinned at start() time — a backend switch
   * rebinds windows to other clients, and finalize/cancel must keep talking
   * to the daemon that owns this exportId. */
  source: RelayRpcClient;
  exportId: string;
  /** True once `workspace.export.start` has been sent and agents may be stopped. */
  sourceExportStarted: boolean;
  /** Set while chunks are staging on the target (cleared after commit). */
  importId?: string;
  targetConnectionId?: string;
  interruptedAgents: string[];
  committed: boolean;
  cancelled: boolean;
  /** Settles the active preflight/build wait early when cancel arrives. */
  signalCancel?: () => void;
}

export interface WorkspaceTransferRelay {
  /** `source` is the invoking window's backend client — the transfer SOURCE. */
  start(params: TransferStartParams, source: RelayRpcClient): Promise<TransferStartResult>;
  finalize(params: TransferFinalizeParams): Promise<TransferFinalizeResult>;
  cancel(): Promise<TransferCancelResult>;
}

const TRANSFER_EVENT_TYPES = [
  'workspace:transfer:progress',
  'workspace:transfer:ready',
  'workspace:transfer:failed',
];

function errText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function createWorkspaceTransferRelay(deps: TransferRelayDeps): WorkspaceTransferRelay {
  let session: RelaySession | null = null;

  /** Best-effort source-side cleanup; never throws. */
  async function abortExport(client: RelayRpcClient, exportId: string): Promise<void> {
    try {
      await client.request('workspace.export.abort', { exportId });
    } catch (error) {
      deps.logger.warn('workspace.export.abort failed (best-effort)', { error: errText(error) });
    }
  }

  /** Best-effort target-side cleanup; never throws. */
  async function abortImport(client: RelayRpcClient, importId: string): Promise<void> {
    try {
      await client.request('workspace.import.abort', { importId });
    } catch (error) {
      deps.logger.warn('workspace.import.abort failed (best-effort)', { error: errText(error) });
    }
  }

  /** Prove the target is authenticated and responsive before source export. */
  async function preflightTarget(target: RelayRpcClient, current: RelaySession): Promise<void> {
    if (current.cancelled) throw new Error('cancelled');
    let signalCancel: (() => void) | undefined;
    try {
      await new Promise<void>((resolve, reject) => {
        let settled = false;
        const settle = (fn: () => void): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          fn();
        };
        const timer = setTimeout(() => {
          settle(() => reject(new Error('Timed out connecting to the transfer destination')));
        }, TARGET_PREFLIGHT_TIMEOUT_MS);
        signalCancel = () => settle(() => reject(new Error('cancelled')));
        current.signalCancel = signalCancel;
        target
          .request('host.status', undefined, { timeoutMs: TARGET_PREFLIGHT_TIMEOUT_MS })
          .then(() => settle(resolve))
          .catch((error) =>
            settle(() => reject(error instanceof Error ? error : new Error(errText(error)))),
          );
      });
    } finally {
      if (current.signalCancel === signalCancel) current.signalCancel = undefined;
    }
  }

  /**
   * Start the export on the source and wait for the archive build to settle:
   * resolves with the `:ready` payload, rejects on `:failed` / timeout /
   * cancel. Subscribes to `workspace:transfer:*` BEFORE `export.start` so the
   * first progress frame cannot be missed, and forwards build stages to the
   * renderer as `building` progress.
   */
  async function startExportAndAwaitReady(
    source: RelayRpcClient,
    workspaceId: string,
    isCancelled: () => boolean,
  ): Promise<TransferReadyData> {
    const sub = await source.request<{ subscriptionId?: string }>('events.subscribe', {
      eventTypes: TRANSFER_EVENT_TYPES,
      workspaceId,
    });
    const subscriptionId = typeof sub?.subscriptionId === 'string' ? sub.subscriptionId : undefined;

    let exportId: string | undefined;
    let listener: ((n: { method: string; params?: unknown }) => void) | null = null;
    const cleanup = (): void => {
      if (listener) {
        source.off('notification', listener);
        listener = null;
      }
      if (subscriptionId) {
        source.request('events.unsubscribe', { subscriptionId }).catch((error) => {
          deps.logger.warn('events.unsubscribe after transfer failed (best-effort)', {
            error: errText(error),
          });
        });
      }
    };

    try {
      const ready = await new Promise<TransferReadyData>((resolve, reject) => {
        const timer = setTimeout(() => {
          reject(new Error('Timed out waiting for the source to build the archive'));
        }, BUILD_TIMEOUT_MS);
        const settle = (fn: () => void): void => {
          clearTimeout(timer);
          fn();
        };
        // Let cancel() settle this wait immediately instead of leaving the
        // start() promise pending until the daemon's build task notices.
        if (session) {
          session.signalCancel = () => settle(() => reject(new Error('cancelled')));
        }
        listener = (n) => {
          if (n.method !== 'events.event') return;
          const event = (n.params as { event?: { type?: string; data?: Record<string, unknown> } })
            ?.event;
          const data = event?.data ?? {};
          if (data.workspaceId !== workspaceId) return;
          if (exportId && data.exportId && data.exportId !== exportId) return;
          if (event?.type === 'workspace:transfer:progress') {
            if (isCancelled()) return; // a cancel is settling — stop forwarding
            deps.broadcastProgress({
              workspaceId,
              phase: 'building',
              stage: typeof data.stage === 'string' ? data.stage : undefined,
              bytesDown: 0,
              bytesUp: 0,
              chunksDone: 0,
            });
          } else if (event?.type === 'workspace:transfer:ready') {
            settle(() => resolve(data as unknown as TransferReadyData));
          } else if (event?.type === 'workspace:transfer:failed') {
            const reason = typeof data.reason === 'string' ? data.reason : 'export failed';
            settle(() => reject(new Error(reason)));
          }
        };
        source.on('notification', listener);
        if (isCancelled()) {
          settle(() => reject(new Error('cancelled')));
          return;
        }
        if (session) session.sourceExportStarted = true;
        source
          .request<{ exportId: string }>('workspace.export.start', { workspaceId })
          .then((result) => {
            exportId = result.exportId;
            if (session) session.exportId = result.exportId;
            if (isCancelled()) {
              // Cancelled while export.start was in flight: abort and bail.
              void abortExport(source, result.exportId);
              settle(() => reject(new Error('cancelled')));
            }
          })
          .catch((error) =>
            settle(() => reject(error instanceof Error ? error : new Error(errText(error)))),
          );
      });
      return ready;
    } finally {
      if (session) session.signalCancel = undefined;
      cleanup();
    }
  }

  /** Relay every chunk source → target, reporting progress per chunk. */
  async function relayChunks(
    source: RelayRpcClient,
    target: RelayRpcClient,
    ready: TransferReadyData,
    importId: string,
    isCancelled: () => boolean,
  ): Promise<void> {
    let bytesDown = 0;
    let bytesUp = 0;
    for (let seq = 0; seq < ready.totalChunks; seq++) {
      if (isCancelled()) throw new Error('cancelled');
      const chunk = await source.request<{ data: string }>(
        'workspace.export.read',
        { exportId: ready.exportId, seq },
        { timeoutMs: CHUNK_TIMEOUT_MS },
      );
      const decodedBytes = Buffer.from(chunk.data, 'base64').byteLength;
      bytesDown += decodedBytes;
      if (isCancelled()) throw new Error('cancelled');
      await target.request(
        'workspace.import.chunk',
        { importId, seq, data: chunk.data },
        { timeoutMs: CHUNK_TIMEOUT_MS },
      );
      bytesUp += decodedBytes;
      deps.broadcastProgress({
        workspaceId: ready.workspaceId,
        phase: 'relaying',
        bytesTotal: ready.archiveSizeBytes,
        bytesDown,
        bytesUp,
        chunksTotal: ready.totalChunks,
        chunksDone: seq + 1,
      });
    }
  }

  /** Stream every chunk source → local file, reporting progress per chunk. */
  async function downloadChunks(
    source: RelayRpcClient,
    sink: FileSink,
    ready: TransferReadyData,
    isCancelled: () => boolean,
  ): Promise<void> {
    let bytesDown = 0;
    for (let seq = 0; seq < ready.totalChunks; seq++) {
      if (isCancelled()) throw new Error('cancelled');
      const chunk = await source.request<{ data: string }>(
        'workspace.export.read',
        { exportId: ready.exportId, seq },
        { timeoutMs: CHUNK_TIMEOUT_MS },
      );
      const bytes = Buffer.from(chunk.data, 'base64');
      await sink.write(bytes);
      bytesDown += bytes.byteLength;
      deps.broadcastProgress({
        workspaceId: ready.workspaceId,
        phase: 'relaying',
        bytesTotal: ready.archiveSizeBytes,
        bytesDown,
        bytesUp: 0,
        chunksTotal: ready.totalChunks,
        chunksDone: seq + 1,
      });
    }
  }

  async function start(
    params: TransferStartParams,
    source: RelayRpcClient,
  ): Promise<TransferStartResult> {
    if (session && !session.committed && !session.cancelled) {
      return {
        success: false,
        error: 'a transfer is already in progress',
        failurePhase: session.sourceExportStarted ? 'post-export' : 'preflight',
      };
    }
    // A committed-but-unfinalized leftover (renderer reloaded/crashed before
    // finalize or close, so no transfer:cancel ever arrived) would otherwise
    // be overwritten with its export staging leaked on the source.
    if (session?.committed && session.exportId) {
      await abortExport(session.source, session.exportId);
    }
    const { workspaceId, destination } = params;
    const current: RelaySession = {
      workspaceId,
      source,
      exportId: '',
      sourceExportStarted: false,
      interruptedAgents: [],
      committed: false,
      cancelled: false,
    };
    session = current;
    const isCancelled = (): boolean => current.cancelled;

    // Download destination: pick the file BEFORE stopping agents/building, so
    // a dismissed dialog costs nothing.
    let filePath: string | undefined;
    if (destination.kind === 'download') {
      filePath = await deps.showSaveDialog(`${workspaceId}-transfer.zip`);
      if (!filePath) {
        session = null;
        return { success: false, canceled: true };
      }
    }

    let targetHandle: TargetClientHandle | null = null;
    let target: RelayRpcClient | null = null;
    try {
      if (destination.kind === 'server') {
        current.targetConnectionId = destination.connectionId;
        targetHandle = await deps.createTargetClient(destination.connectionId);
        target = targetHandle.client;
        await preflightTarget(target, current);
        if (isCancelled()) throw new Error('cancelled');
      }

      const ready = await startExportAndAwaitReady(source, workspaceId, isCancelled);
      current.exportId = ready.exportId;
      if (isCancelled()) throw new Error('cancelled');

      if (destination.kind === 'download') {
        const sink = await deps.openFileSink(filePath as string);
        try {
          await downloadChunks(source, sink, ready, isCancelled);
          if (isCancelled()) throw new Error('cancelled');
          await sink.close();
          // A cancel that raced the final write/close still wins: discard
          // the completed file instead of reporting success to a reset UI.
          if (isCancelled()) throw new Error('cancelled');
        } catch (error) {
          await sink.discard();
          throw error;
        }
        // Settled: step 4's archive checkbox still applies `export.finalize`
        // on the source, so the session stays for finalize().
        current.committed = true;
        return { success: true, filePath };
      }

      // Server destination: reuse the preflighted target client for staged import.
      if (!target) throw new Error('transfer destination client unavailable');
      const begin = await target.request<{ importId: string }>('workspace.import.begin', {
        manifest: ready.manifest,
        archiveSizeBytes: ready.archiveSizeBytes,
        archiveSha256: ready.archiveSha256,
      });
      current.importId = begin.importId;
      try {
        await relayChunks(source, target, ready, begin.importId, isCancelled);
        if (isCancelled()) throw new Error('cancelled');
        deps.broadcastProgress({
          workspaceId,
          phase: 'committing',
          bytesTotal: ready.archiveSizeBytes,
          bytesDown: ready.archiveSizeBytes,
          bytesUp: ready.archiveSizeBytes,
          chunksTotal: ready.totalChunks,
          chunksDone: ready.totalChunks,
        });
        const commit = await target.request<{ interruptedAgents?: string[] }>(
          'workspace.import.commit',
          { importId: begin.importId },
          { timeoutMs: COMMIT_TIMEOUT_MS },
        );
        current.importId = undefined;
        if (isCancelled()) {
          // The cancel raced the commit and lost: the target already holds
          // the imported workspace (a commit cannot be undone). Surface the
          // run as cancelled rather than success against a reset UI.
          deps.logger.warn(
            'transfer cancelled during target commit; imported workspace remains on the target',
            { workspaceId },
          );
          throw new Error('cancelled');
        }
        current.committed = true;
        current.interruptedAgents = Array.isArray(commit.interruptedAgents)
          ? commit.interruptedAgents
          : [];
        return { success: true, interruptedAgents: current.interruptedAgents };
      } catch (error) {
        // Only staged imports can be aborted — a committed one stays.
        if (current.importId) {
          await abortImport(target, current.importId);
          current.importId = undefined;
        }
        throw error;
      }
    } catch (error) {
      // Source cleanup only applies after export starts; preflight failures
      // leave the source untouched and its agents running.
      if (current.exportId) await abortExport(source, current.exportId);
      const cancelled = current.cancelled || errText(error) === 'cancelled';
      if (!cancelled) {
        deps.logger.warn('workspace transfer failed', {
          workspaceId,
          error: errText(error),
        });
      }
      session = null;
      return cancelled
        ? { success: false, canceled: true }
        : {
            success: false,
            error: errText(error),
            failurePhase: current.sourceExportStarted ? 'post-export' : 'preflight',
          };
    } finally {
      targetHandle?.dispose();
    }
  }

  async function finalize(params: TransferFinalizeParams): Promise<TransferFinalizeResult> {
    const current = session;
    if (!current || !current.committed) {
      return { success: false, error: 'no committed transfer to finalize' };
    }
    const source = current.source;
    const resumeFailed: string[] = [];

    // Restart in-flight agents on the TARGET (fail-soft — a resume failure
    // never blocks the source finalize; the user can resolve on the target).
    if (
      params.restartAgents &&
      current.interruptedAgents.length > 0 &&
      current.targetConnectionId
    ) {
      let targetHandle: TargetClientHandle | null = null;
      try {
        targetHandle = await deps.createTargetClient(current.targetConnectionId);
        const result = await targetHandle.client.request<{ failed?: Array<{ agentId?: string }> }>(
          'agent.resolveInterrupted',
          { resume: current.interruptedAgents },
        );
        for (const failure of result.failed ?? []) {
          if (typeof failure?.agentId === 'string') resumeFailed.push(failure.agentId);
        }
      } catch (error) {
        deps.logger.warn('agent.resolveInterrupted on target failed (fail-soft)', {
          error: errText(error),
        });
        resumeFailed.push(...current.interruptedAgents);
      } finally {
        targetHandle?.dispose();
      }
    }

    try {
      await source.request('workspace.export.finalize', {
        exportId: current.exportId,
        archiveSource: params.archiveSource,
        ...(params.finalStatusMessage ? { finalStatusMessage: params.finalStatusMessage } : {}),
      });
    } catch (error) {
      return { success: false, error: errText(error), resumeFailed };
    }
    session = null;
    return { success: true, ...(resumeFailed.length > 0 ? { resumeFailed } : {}) };
  }

  async function cancel(): Promise<TransferCancelResult> {
    const current = session;
    if (!current) {
      return { success: true };
    }
    if (current.committed) {
      // The transfer settled but the wizard was dismissed without finalizing:
      // clean up the source's export staging (WIP snapshots unwound, staging
      // deleted, workspace stays usable) without status message or archive.
      session = null;
      if (current.exportId) {
        await abortExport(current.source, current.exportId);
      }
      return { success: true };
    }
    current.cancelled = true;
    // Settle a pending archive-build wait right away; the chunk loops observe
    // the flag between chunks.
    current.signalCancel?.();
    // The in-flight start() loop observes the flag and aborts both sides; an
    // idle session (start already returned a failure) is cleaned here.
    if (current.exportId) {
      await abortExport(current.source, current.exportId);
    }
    return { success: true };
  }

  return { start, finalize, cancel };
}
