/**
 * Agents & chat mock seeder.
 *
 * Pulls agent sessions (with their sample chat transcripts) from the `AppClient`
 * seam and dispatches existing slice actions so the agent list, agent overview,
 * and chat panel render with mock agents and a static conversation — replacing
 * the work the agent-loading sagas used to do against the real backend.
 *
 * Agent-provider readiness (`providers:get-availability`,
 * `providers:check-single`) is bridged to real daemon probes in
 * `provider-status-bridge-seeder.ts` — this module no longer seeds fake
 * provider status.
 *
 * `agent:get-active-streams` is bridged to real daemon data in
 * `active-streams-bridge-seeder.ts` via the cross-workspace `agent.listActive`
 * RPC, which is registered via the seeder barrel before agents-seeder runs.
 */
import { registerMockSeeder } from "../mock-bootstrap";
import { isAgentDeletionPending } from "$features/agent/utils/pending-agent-deletions";
import { bulkUpsertSessions, upsertSession } from "../slices/agent-session/agent-session-slice";
import {
  setActiveAgentId,
  setAgentsLoaded,
} from "../slices/workspace-agents/workspace-agents-slice";

registerMockSeeder("agents", async ({ store, client }) => {
  const wsId = store.state.workspace.activeWorkspaceId;
  if (!wsId) return;

  // Drop agents with a pending soft-hidden deletion (undo window still
  // open) so the boot/seed path cannot resurrect a deleted agent — same
  // guard `hydrateWorkspaceAgents` applies in lifecycle-read-service.ts.
  const fetched = (await client.agents.list(wsId)).filter(
    (agent) => !isAgentDeletionPending(String(agent.id)),
  );

  store.dispatch(setAgentsLoaded(wsId, true));
  if (fetched.length === 0) return;

  // Preserve existing messages when AgentLite returns messages: [] (PROTOCOL
  // §5.5 — same merge `hydrateWorkspaceAgents` uses in lifecycle-read-service.ts).
  // If a fetched agent has 0 messages but the store already has messages for
  // that session, keep the existing messages to avoid clobbering transcripts
  // already hydrated by chat-read-service / agent-read-service.
  const agents = fetched.map((agent) => {
    const existing = store.state.agentSessions?.byAgentId[String(agent.id)];
    return agent.messages.length === 0 && existing && existing.messages.length > 0
      ? { ...agent, messages: existing.messages }
      : agent;
  });

  // Populate the agent-session slice (byAgentId + workspace index).
  store.dispatch(bulkUpsertSessions(agents));
  // Track agent IDs in the workspace-agents slice (agentIds + foreground).
  for (const agent of agents) {
    store.dispatch(upsertSession(agent));
  }

  // Guard against clobbering activeAgentId when route navigation already set
  // one (mirrors the guard in `hydrateWorkspaceAgents`). If an active agent
  // is already set and still in the agent list, do not override it.
  const workspaceState = store.state.workspaceAgents.byWorkspaceId[wsId];
  const activeAgentId = workspaceState?.activeAgentId;
  if (activeAgentId && (workspaceState?.agentIds ?? []).includes(activeAgentId)) {
    return;
  }

  const firstForeground = agents.find((agent) => !agent.isBackground) ?? agents[0];
  store.dispatch(setActiveAgentId(wsId, String(firstForeground.id)));
});
