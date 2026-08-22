/**
 * Workspace Import types
 *
 * Renderer-local wizard state for the "Import Workspace from File…" modal.
 * The heavy lifting (file dialog, zip manifest read, sha256, chunked
 * `workspace.import.*` upload) happens in the main process; the renderer
 * only renders progress counters and the settled result.
 */

export type ImportStep = 'importing' | 'result';

export type ImportRunStatus = 'idle' | 'running' | 'succeeded' | 'failed';

/** Import phase mirroring the main-process `ImportRelayPhase`. */
type ImportRunPhase = 'reading' | 'uploading' | 'committing';

/** Renderer copy of the `transfer:import-progress` counters (never bytes). */
export interface ImportProgress {
  phase: ImportRunPhase;
  /** Archive size on disk. */
  bytesTotal: number;
  bytesUp: number;
  chunksTotal?: number;
  chunksDone: number;
}

export interface WorkspaceImportState {
  /** Whether the import wizard modal is open. */
  open: boolean;
  step: ImportStep;
  runStatus: ImportRunStatus;
  progress: ImportProgress | null;
  /** Daemon error, verbatim (e.g. version mismatch names both versions). */
  runError: string | null;
  /** The imported workspace, on success. */
  workspaceId: string | null;
  workspaceTitle: string;
  /** Agent ids the import marked interrupted on the backend. */
  interruptedAgents: string[];
}
