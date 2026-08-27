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

/**
 * Machine-readable rejection code: the invoking window does not own the
 * active relay session (transfer/import sessions are pinned to the window
 * that started them; see monorepo#3519).
 */
export type SessionOwnershipErrorCode = 'not-session-owner';

/** Where the transfer goes (mirrors the renderer's `TransferDestination`). */
type TransferRelayDestination = { kind: 'server'; connectionId: string } | { kind: 'download' };

/** Whether a failed relay may have stopped source agents or failed before export began. */
export type TransferFailurePhase = 'preflight' | 'post-export';

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
type TransferRelayPhase = 'building' | 'relaying' | 'committing';

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
  /** Present on failure so the renderer can describe source-agent impact accurately. */
  failurePhase?: TransferFailurePhase;
  /** Set when another window owns the active session. */
  code?: SessionOwnershipErrorCode;
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
  /** Set when another window owns the active session. */
  code?: SessionOwnershipErrorCode;
  /** Agent ids the target failed to resume (fail-soft, never blocks finalize). */
  resumeFailed?: string[];
}

/** `transfer:cancel` result. */
export interface TransferCancelResult {
  success: boolean;
  error?: string;
  /** Set when another window owns the active session. */
  code?: SessionOwnershipErrorCode;
}

/** `transfer:import-start` params. */
export interface ImportStartParams {
  /** Re-run against the previously picked file (retry) instead of a dialog. */
  reuseLastFile?: boolean;
}

/**
 * Import phase, for the wizard's progress UI:
 *  - `reading` — hashing the local archive + reading its manifest.
 *  - `uploading` — base64 chunks are moving file → main → current backend.
 *  - `committing` — the backend is reassembling/committing the import.
 */
type ImportRelayPhase = 'reading' | 'uploading' | 'committing';

/** `transfer:import-progress` push payload (counters only — never bytes). */
export interface ImportProgressEvent {
  phase: ImportRelayPhase;
  /** Archive size on disk. */
  bytesTotal: number;
  /** Bytes uploaded to the backend so far. */
  bytesUp: number;
  chunksTotal?: number;
  chunksDone: number;
}

/** `transfer:import-start` result (success envelope). */
export interface ImportStartResult {
  success: boolean;
  /** True when the user dismissed the open dialog or cancelled the run. */
  canceled?: boolean;
  /** Daemon error, verbatim (e.g. version mismatch names both versions). */
  error?: string;
  /** Set when another window owns the active session. */
  code?: SessionOwnershipErrorCode;
  /** The imported workspace's id + title, on success. */
  workspaceId?: string;
  workspaceTitle?: string;
  /** Agent ids the import marked interrupted on the backend. */
  interruptedAgents?: string[];
}

/** `transfer:import-cancel` result. */
export interface ImportCancelResult {
  success: boolean;
  error?: string;
  /** Set when another window owns the active session. */
  code?: SessionOwnershipErrorCode;
}
