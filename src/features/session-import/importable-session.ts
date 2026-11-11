/** One row of `agent.importableSessions.list` (spec "Wire contract (phase 1)"). */
export interface ImportableSession {
  provider: string;
  sessionId: string;
  title: string;
  /** Absolute working directory the session ran in, on the daemon host. */
  cwd: string;
  /** ISO time of the last write. */
  updatedAt: string;
  gitBranch?: string;
  messageCount?: number;
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
}

export function toSessionImportSelection(session: ImportableSession): SessionImportSelection {
  return {
    provider: session.provider,
    sessionId: session.sessionId,
    title: session.title,
    cwd: session.cwd,
    ...(session.gitBranch ? { gitBranch: session.gitBranch } : {}),
  };
}
