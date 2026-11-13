/** One row of `agent.importableSessions.list` (spec "Wire contract (phase 1)"). */
export interface ImportableSession {
  provider: string;
  sessionId: string;
  title: string;
  /** Absolute working directory the session ran in, on the daemon host. */
  cwd: string;
  /** ISO time of the last write; null when the provider reports none (listed last). */
  updatedAt: string | null;
  gitBranch?: string;
  messageCount?: number;
  /**
   * Git top-level of `cwd` on the daemon host. Omitted when the folder is gone or
   * not in a git repository, and by daemons that predate the field.
   */
  repoRoot?: string;
}

/** Per-provider listing status (`providers` on the list result). */
export interface ImportableSessionProvider {
  id: string;
  label: string;
  status: 'ok' | 'error' | 'unsupported';
  error?: string;
}

/** The pick the new-workspace form carries to `agent.importSession`. */
export interface SessionImportSelection {
  provider: string;
  sessionId: string;
  title: string;
  cwd: string;
  gitBranch?: string;
  /** The codebase the workspace uses: the daemon's `repoRoot`, else a known repository. */
  repoRoot?: string;
}

export function toSessionImportSelection(
  session: ImportableSession,
  repoRoot: string | null = session.repoRoot ?? null,
): SessionImportSelection {
  return {
    provider: session.provider,
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
    ...(repoRoot ? { repoRoot } : {}),
  };
}

/** Stable key of a session row (provider and session id). */
export function importableSessionKey(
  session: Pick<ImportableSession, 'provider' | 'sessionId'>,
): string {
  return `${session.provider}:${session.sessionId}`;
}
