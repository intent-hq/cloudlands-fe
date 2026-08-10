/**
 * Transient provisioning-progress state for in-flight `workspace.create`
 * calls, keyed by the FE-minted `progressId` the daemon echoes on
 * `git:clone:progress` / `git:clone:done` frames (PROTOCOL §5.1 / §6.5).
 * UI-only: entries are created when a create starts and cleared when it
 * settles — nothing here is canonical or persisted.
 */
export interface WorkspaceCreateProgressEntry {
  /** Daemon-owned phase label (e.g. `receiving`, `cache`, `submodules`, `cow-copy`, `worktree`, `finalizing`). */
  phase: string;
  /** Daemon-normalized 0–100 percent across the whole provisioning pipeline. */
  percent: number;
  /** Optional human-readable progress line from the daemon. */
  message?: string;
  /** True once the terminal `git:clone:done` frame arrived. */
  done: boolean;
  /** Terminal outcome; only present when `done` is true. */
  ok?: boolean;
  /** Redacted failure detail from the done frame, when the clone failed. */
  error?: string;
  /** Machine-readable clone-failure taxonomy code (§9.1), when classified. */
  errorCode?: string;
}

export interface WorkspaceCreateProgressState {
  byProgressId: Record<string, WorkspaceCreateProgressEntry>;
}
