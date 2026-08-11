/**
 * Workspace transfer relay — shared IPC contract (main ⇄ preload ⇄ renderer).
 *
 * The transfer wizard's execution surface: the renderer drives the relay via
 * `transfer:start` / `transfer:finalize` / `transfer:cancel` and observes
 * progress on the `transfer:progress` push channel. Archive bytes NEVER cross
 * this boundary — the main-process relay pipes chunks from the source daemon
 * to the target daemon (or a local file); only counters travel to the
 * renderer.
 *
 * Dependency-light (channel-name registry only) so it is safe to import from
 * renderer, preload, and main.
 */

import { IPC_CHANNELS } from '../ipc-registry';

/** Request/response + push channel names for the transfer relay. */
export const TRANSFER_CHANNELS = IPC_CHANNELS.TRANSFER;

/**
 * Push-event channel (main → renderer). Mirrored as a literal in
 * `EVENT_CHANNELS` (ipc-registry.ts) so the preload allow-list includes it.
 */
export const TRANSFER_PROGRESS_EVENT = 'transfer:progress';

/** Where the transfer goes (mirrors the renderer's `TransferDestination`). */
export type TransferRelayDestination =
  | { kind: 'server'; connectionId: string }
  | { kind: 'download' };

/** `transfer:start` params. */
export interface TransferStartParams {
  workspaceId: string;
  destination: TransferRelayDestination;
}

/**
 * Relay phase, for the step-3 progress UI:
 *  - `building` — source is building the archive (`workspace:transfer:progress`
 *    stages ride along in `stage`).
 *  - `relaying` — chunks are moving source → main → target/file.
 *  - `committing` — target is reassembling/committing the import.
 */
export type TransferRelayPhase = 'building' | 'relaying' | 'committing';

/** `transfer:progress` push payload (counters only — never bytes). */
export interface TransferProgressEvent {
  workspaceId: string;
  phase: TransferRelayPhase;
  /** Source build stage (`stopping-agents`, `exporting-rows`, …) while building. */
  stage?: string;
  /** Actual archive size, known once the source reports `:ready`. */
  bytesTotal?: number;
  /** Bytes downloaded from the source so far. */
  bytesDown: number;
  /** Bytes uploaded to the target so far (0 for downloads). */
  bytesUp: number;
  chunksTotal?: number;
  chunksDone: number;
}

/** `transfer:start` result (success envelope). */
export interface TransferStartResult {
  success: boolean;
  /** True when the user dismissed the save dialog (download destination). */
  canceled?: boolean;
  error?: string;
  /** Download destination: where the archive was written. */
  filePath?: string;
  /**
   * Server destination: agent ids the import marked interrupted on the
   * target — candidates for the "restart in-flight agents" resolve.
   */
  interruptedAgents?: string[];
}

/** `transfer:finalize` params. */
export interface TransferFinalizeParams {
  /** Archive the source workspace after settling the export (default ON in UI). */
  archiveSource: boolean;
  /** Final status message applied to the source workspace, if any. */
  finalStatusMessage?: string;
  /**
   * Resolve (resume) the transferred interrupted agents on the target —
   * the step-3 "restart in-flight agents" toggle.
   */
  restartAgents?: boolean;
}

/** `transfer:finalize` result. */
export interface TransferFinalizeResult {
  success: boolean;
  error?: string;
  /** Agent ids the target failed to resume (fail-soft, never blocks finalize). */
  resumeFailed?: string[];
}

/** `transfer:cancel` result. */
export interface TransferCancelResult {
  success: boolean;
  error?: string;
}
