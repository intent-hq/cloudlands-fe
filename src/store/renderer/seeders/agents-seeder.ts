/**
 * Agents & chat mock seeder.
 *
 * Pulls agent sessions (with their sample chat transcripts) from the `AppClient`
 * seam and dispatches existing slice actions so the agent list, agent overview,
 * and chat panel render with mock agents and a static conversation — replacing
 * the work the agent-loading sagas used to do against the real backend.
 *
 * Agent-provider readiness (`providers:get-availability`, `providers:check-single`,
 * `auggie:status`) is bridged to real daemon probes in
 * `provider-status-bridge-seeder.ts` — this module no longer seeds fake
 * provider status.
 *
 * `agent:get-active-streams` is registered here for the
 * unregistered-channel class of bug: `ActiveStreamsTracker.fetchActiveStreams`
 * fires on WindowTitleBar mount and the undefined fallback produced a recurring
 * "Failed to fetch active streams" warning (`Cannot read properties of
 * undefined (reading 'success')`). A no-streams default keeps the tracker quiet
 * until the daemon owns this surface.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS } from "$shared/ipc/channels";
import { registerMockSeeder } from "../mock-bootstrap";
import { bulkUpsertSessions, upsertSession } from "../slices/agent-session/agent-session-slice";
import {
  setActiveAgentId,
  setAgentsLoaded,
} from "../slices/workspace-agents/workspace-agents-slice";

// ActiveStreamsTracker.fetchActiveStreams reads `result.success` /
// `result.data`, so an undefined fallback would TypeError on every poll.
// No mock streams: an empty list keeps the tracker idle (matches the seam,
// where mock agents are surfaced via `client.agents.list`, not via streams).
registerMockIpcHandler(AGENT_CHANNELS.GET_ACTIVE_STREAMS, async () => ({
  success: true,
  data: [],
}));

registerMockSeeder("agents", async ({ store, client }) => {
  const workspaces = await client.workspaces.list();

  for (const workspace of workspaces) {
    const wsId = String(workspace.id);
    const fetched = await client.agents.list(wsId);

    store.dispatch(setAgentsLoaded(wsId, true));
    if (fetched.length === 0) continue;

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
      continue;
    }

    const firstForeground = agents.find((agent) => !agent.isBackground) ?? agents[0];
    store.dispatch(setActiveAgentId(wsId, String(firstForeground.id)));
  }
});
