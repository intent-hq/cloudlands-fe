import { AgentStatus, type AgentSession } from '$shared/types';
import { AgentId, WorkspaceId } from '$shared/types/branded-ids';
import { deriveAgentHasUnread } from '$shared/utils/agent-unread';
const agentWorkspaceIndex = new Map<string, string>();
export function getKnownAgentWorkspace(agentId: string) {
  return agentWorkspaceIndex.get(agentId);
}
function rememberAgentWorkspace(agentId: string, workspaceId: string): void {
  if (agentId && workspaceId) agentWorkspaceIndex.set(agentId, workspaceId);
}

/** Coerce a raw daemon agent object into the renderer `AgentSession` shape. */
export function normalizeAgent(raw: Record<string, unknown>): AgentSession {
  const now = new Date().toISOString();
  const id = String(raw.id ?? '');
  const acpSessionId = raw.acpSessionId ? String(raw.acpSessionId) : null;
  const workspaceId = String(raw.workspaceId ?? '');
  rememberAgentWorkspace(id, workspaceId);
  const session = {
    ...(raw as Partial<AgentSession>),
    id: AgentId(id),
    backendSessionId: acpSessionId ? AgentId(acpSessionId) : null,
    workspaceId: WorkspaceId(workspaceId),
    name: String(raw.name ?? id),
    status: (typeof raw.status === 'string' ? raw.status : AgentStatus.Pending) as AgentStatus,
    // The list/get payloads carry message COUNTS, not transcripts; chat history
    // is loaded separately by transcript consumers; metadata reads do not invent it.
    messages: Array.isArray(raw.messages) ? (raw.messages as AgentSession['messages']) : [],
    createdAt: String(raw.createdAt ?? now),
    updatedAt: String(raw.updatedAt ?? now),
  } as AgentSession;
  // `retiredAt` (§5.5 soft retire) is presence-detected on the wire:
  // set on retired rows, omitted (never null) on active ones. Pure presence
  // pass-through — assign only when a non-empty string is present; a
  // divergent shape (null, empty string) is not healed away client-side.
  if (typeof raw.retiredAt === 'string' && raw.retiredAt.length > 0) {
    session.retiredAt = raw.retiredAt;
  }
  // `parentAgentId` (§5.5 row scope — the daemon's bin partition key) is
  // presence-detected the same way: set on delegated rows, omitted on
  // top-level ones. Both the list and detail projections serve it.
  if (typeof raw.parentAgentId === 'string' && raw.parentAgentId.length > 0) {
    session.parentAgentId = AgentId(raw.parentAgentId);
  }
  // Canonical booleans override stale metadata, including a persisted false.
  if (typeof raw.isBackground === 'boolean') {
    session.metadata = { ...session.metadata, isBackground: raw.isBackground };
    if (session.agentMetadata) {
      session.agentMetadata = { ...session.agentMetadata, isBackground: raw.isBackground };
    }
  }
  // Per-agent unread (monorepo#1597): derived here so every AgentLite ingest
  // path — list/get reads, new-message pushes, and the agent:updated marker
  // convergence after agent.markSeen — recomputes it through one seam.
  session.hasUnread = deriveAgentHasUnread(session);
  return session;
}
