import { all, call, delay, put, type SagaGenerator } from 'typed-redux-saga';
import { appClient } from '$lib/client';
import { scanDockHumanMessages, type DockHumanScan } from '$features/hud/utils/dock-recency';
import { isAgentDeletionPending } from '$features/agent/utils/pending-agent-deletions';
import { CHIEF_WORKSPACE_ID } from '$shared/types/branded-ids';
import { WorkspaceStatus, type AgentSession, type Workspace } from '$shared/types';
import { selectActiveBackendId } from '../../../utils/backend-storage-namespace';
import { selectHudWorkspaceEntities } from '../hud-selectors';
import { dockConversationsLoaded } from '../hud-slice';

const REFRESH_MS = 30_000;
const CACHE_MS = 60_000;
const CONCURRENCY = 4;
interface CachedRoster {
  readAt: number;
  agents: AgentSession[];
}
interface CachedConversation extends DockHumanScan {
  signature: string;
}

/** A dock-only lifetime: HUD routes do not fan out message-index reads. */
export function* dockRecencySaga(): SagaGenerator<never> {
  const rosters = new Map<string, CachedRoster>();
  const conversations = new Map<string, CachedConversation>();
  const retryAfter = new Map<string, number>();
  let backendId: string | undefined;
  let previous: Record<string, number> = {};
  let stopped = false;
  try {
    while (true) {
      const activeBackendId = yield* selectActiveBackendId();
      if (backendId !== activeBackendId) {
        rosters.clear();
        conversations.clear();
        retryAfter.clear();
        backendId = activeBackendId;
        previous = {};
        yield* put(dockConversationsLoaded({}, Date.now()));
      }
      const workspaces = (yield* selectHudWorkspaceEntities.effect()).filter(
        (workspace) =>
          workspace.id !== CHIEF_WORKSPACE_ID &&
          workspace.status !== WorkspaceStatus.Archived &&
          workspace.status !== WorkspaceStatus.Deleted,
      );
      const latestByWorkspaceId: Record<string, number> = { ...previous };
      const liveWorkspaces = new Set(workspaces.map((workspace) => String(workspace.id)));
      for (const id of Object.keys(latestByWorkspaceId))
        if (!liveWorkspaces.has(id)) delete latestByWorkspaceId[id];
      for (const id of rosters.keys()) if (!liveWorkspaces.has(id)) rosters.delete(id);
      const liveAgents = new Set<string>();

      async function readWorkspace(workspace: Workspace): Promise<void> {
        const workspaceId = String(workspace.id);
        let roster = rosters.get(workspaceId);
        if (!roster || Date.now() - roster.readAt >= CACHE_MS) {
          try {
            // A human can speak directly to any bin. Read bins separately to avoid
            // the unscoped all-agent response exceeding the transport frame budget.
            const byId = new Map<string, AgentSession>();
            for (const scope of ['topLevel', 'delegated', 'background'] as const) {
              if (stopped) return;
              const rows = await appClient.agents.list(workspaceId, { scope });
              for (const agent of rows) byId.set(String(agent.id), agent);
            }
            const agents = [...byId.values()];
            roster = { readAt: Date.now(), agents };
            rosters.set(workspaceId, roster);
          } catch {
            // Unknown rosters never admit a workspace by its activity/unread summary.
            if (!roster) return;
          }
        }
        if (stopped) return;
        delete latestByWorkspaceId[workspaceId];
        for (const agent of roster.agents) {
          if (stopped) return;
          const agentId = String(agent.id);
          if (agent.retiredAt || agent.pendingDeleteAt || isAgentDeletionPending(agentId)) continue;
          const key = `${workspaceId}/${agentId}`;
          liveAgents.add(key);
          let cached = conversations.get(key);
          const signature = `${String(agent.updatedAt)}:${agent.lastMessageId ?? ''}`;
          if (
            (!cached || cached.signature !== signature) &&
            Date.now() >= (retryAfter.get(key) ?? 0)
          ) {
            try {
              const scan = await scanDockHumanMessages(
                (page) => appClient.agents.listUserMessages(agentId, 80, workspaceId, page),
                cached,
              );
              if (scan) {
                retryAfter.delete(key);
                cached = { signature, ...scan };
                conversations.set(key, cached);
              } else {
                retryAfter.set(key, Date.now() + CACHE_MS);
              }
            } catch {
              retryAfter.set(key, Date.now() + CACHE_MS);
              // Retain only previously proven timestamps; failures cannot extend recency.
            }
          }
          if (cached?.latest != null) {
            latestByWorkspaceId[workspaceId] = Math.max(
              latestByWorkspaceId[workspaceId] ?? 0,
              cached.latest,
            );
          }
        }
      }

      // At most four requests in flight, including roster and index reads.
      for (let offset = 0; offset < workspaces.length; offset += CONCURRENCY) {
        yield* all(
          workspaces
            .slice(offset, offset + CONCURRENCY)
            .map((workspace) => call(readWorkspace, workspace)),
        );
        yield* put(dockConversationsLoaded({ ...latestByWorkspaceId }, Date.now()));
      }
      for (const key of conversations.keys()) if (!liveAgents.has(key)) conversations.delete(key);
      for (const key of retryAfter.keys()) if (!liveAgents.has(key)) retryAfter.delete(key);
      previous = latestByWorkspaceId;
      yield* put(dockConversationsLoaded(latestByWorkspaceId, Date.now()));
      yield* delay(workspaces.length > 0 ? REFRESH_MS : 1_000);
    }
  } finally {
    stopped = true;
  }
}
