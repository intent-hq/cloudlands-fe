/**
 * Client for importing an existing coding-agent session into a new workspace
 * (spec "Wire contract (phase 1)"):
 *
 * - `agent.importableSessions.list { provider?, query?, cursor?, limit? }`
 *   → `{ sessions: ImportableSession[], nextCursor? }`, newest first.
 * - `agent.importSession { workspaceId, provider, sessionId, name? }`
 *   → `{ agent: AgentLite }`.
 *
 * Callers gate both on the host's `sessionImport: 1` capability.
 */
import { backendRequest } from '$lib/client/live/backend-transport';
import type { ImportableSession, ImportableSessionProvider } from './importable-session';

export interface ImportableSessionsListParams {
  provider?: string;
  query?: string;
  cursor?: string;
  limit?: number;
}

export type ImportableSessionsListResult =
  | {
      ok: true;
      sessions: ImportableSession[];
      providers: ImportableSessionProvider[];
      nextCursor?: string;
    }
  | { ok: false; error: string };

export interface ImportSessionParams {
  workspaceId: string;
  provider: string;
  sessionId: string;
  name?: string;
}

interface ImportedSessionAgent {
  id: string;
  name?: string;
  [key: string]: unknown;
}

export interface ImportedSession {
  agent: ImportedSessionAgent;
  /**
   * False when the provider could only load the original session: the CLI
   * session now continues in Intent. Absent reads as forked.
   */
  forked: boolean;
}

type Request = <T>(method: string, params?: unknown) => Promise<T>;

function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isImportableSession(value: unknown): value is ImportableSession {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.provider === 'string' &&
    typeof row.sessionId === 'string' &&
    typeof row.cwd === 'string' &&
    typeof row.updatedAt === 'string'
  );
}

function isProvider(value: unknown): value is ImportableSessionProvider {
  if (!value || typeof value !== 'object') return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === 'string' &&
    typeof row.label === 'string' &&
    (row.status === 'ok' || row.status === 'error' || row.status === 'unsupported')
  );
}

/** Newest first; the daemon already orders them, this keeps a merged page stable. */
function sortSessionsNewestFirst(sessions: ImportableSession[]): ImportableSession[] {
  return [...sessions].sort((a, b) => Date.parse(b.updatedAt) - Date.parse(a.updatedAt));
}

export async function listImportableSessions(
  params: ImportableSessionsListParams = {},
  request: Request = backendRequest,
): Promise<ImportableSessionsListResult> {
  try {
    const result = await request<{ sessions?: unknown; providers?: unknown; nextCursor?: unknown }>(
      'agent.importableSessions.list',
      params,
    );
    const rows = Array.isArray(result?.sessions) ? result.sessions : [];
    const sessions = sortSessionsNewestFirst(
      rows.filter(isImportableSession).map((row) => ({
        ...row,
        title: typeof row.title === 'string' ? row.title : '',
      })),
    );
    const providers = (Array.isArray(result?.providers) ? result.providers : [])
      .filter(isProvider)
      .map((provider) => ({
        id: provider.id,
        label: provider.label,
        status: provider.status,
        ...(typeof provider.error === 'string' ? { error: provider.error } : {}),
      }));
    const nextCursor = typeof result?.nextCursor === 'string' ? result.nextCursor : undefined;
    return { ok: true, sessions, providers, ...(nextCursor ? { nextCursor } : {}) };
  } catch (error) {
    return { ok: false, error: message(error) };
  }
}

/** Throws the daemon's error; the initialization saga reports it as a post-create failure. */
export async function importSession(
  params: ImportSessionParams,
  request: Request = backendRequest,
): Promise<ImportedSession> {
  const result = await request<{ agent?: ImportedSessionAgent; forked?: unknown }>(
    'agent.importSession',
    params,
  );
  if (!result?.agent || typeof result.agent.id !== 'string') {
    throw new Error('agent.importSession returned no agent'); // i18n-ignore (protocol error)
  }
  return { agent: result.agent, forked: result.forked !== false };
}
