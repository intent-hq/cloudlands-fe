/**
 * Workspace Script Types
 *
 * Types for workspace scripts — named processes with lifecycle management.
 * Scripts can be long-running services (dev servers) or one-shot commands (test suites).
 */

/**
 * Script execution mode.
 * - `service`: Long-running, auto-restartable (dev server, file watcher)
 * - `command`: Run-once, exits with result (test suite, build, lint)
 */
export type ScriptMode = 'service' | 'command';

export type ScriptArchiveFilter = 'active' | 'archived' | 'all';
export type ScriptPurpose = 'saved' | 'oneOff';
interface ScriptLastRun {
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'interrupted';
  exitCode?: number;
  startedAt?: string;
  stoppedAt: string;
  error?: string;
}
export interface ScriptArchiveResult {
  archived: string[];
  skipped: { scriptId: string; reason: 'live' | 'service' | 'notFound' }[];
}
export interface ScriptRestoreResult {
  restored: string[];
  skipped: { scriptId: string; reason: 'notFound' }[];
}

/**
 * Script category for grouping in the UI.
 */
export type ScriptCategory =
  'dev' | 'build' | 'test' | 'lint' | 'typecheck' | 'format' | 'storybook' | 'other';

/**
 * How the script was created.
 * - `auto-detected`: Discovered from package.json or similar
 * - `user`: Manually created by user or agent
 */
export type ScriptSource = 'auto-detected' | 'user';

/**
 * Runtime status of a script process.
 */
export type ScriptStatus = 'idle' | 'running' | 'restarting' | 'exited';

/**
 * A workspace script definition — persisted by the intentd daemon.
 */
export interface WorkspaceScript {
  id: string;
  workspaceId: string;
  name: string;
  command: string;
  cwd?: string; // Relative to workspace repo root
  env?: Record<string, string>;
  mode: ScriptMode;
  category?: ScriptCategory;
  source: ScriptSource;
  autoStart?: boolean; // Start when workspace opens (services only)
  createdAt: string;
  updatedAt?: string;
  lastRunAt?: string;
  purpose?: ScriptPurpose;
  archivedAt?: string;
  lastRun?: ScriptLastRun;
}

/**
 * Runtime state of a script process — kept in memory, not persisted.
 */
export interface ScriptRuntimeState {
  status: ScriptStatus;
  pid?: number;
  exitCode?: number | null;
  startedAt?: string;
  stoppedAt?: string;
  restartCount: number;
  error?: string;
  detectedUrl?: string; // URL detected from stdout (for services)
  previouslyRunning?: boolean; // Service was running before the daemon shut down (PROTOCOL §5.8)
}

/**
 * Combined script definition + runtime state for the renderer.
 */
export interface ScriptWithState extends WorkspaceScript {
  runtime: ScriptRuntimeState;
}

/**
 * Default runtime state for a script that hasn't been started.
 */
export function createDefaultRuntimeState(): ScriptRuntimeState {
  return {
    status: 'idle',
    restartCount: 0,
  };
}
