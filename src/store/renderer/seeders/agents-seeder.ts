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
    const agents = await client.agents.list(wsId);

    store.dispatch(setAgentsLoaded(wsId, true));
    if (agents.length === 0) continue;

    // Populate the agent-session slice (byAgentId + workspace index).
    store.dispatch(bulkUpsertSessions(agents));
    // Track agent IDs in the workspace-agents slice (agentIds + foreground).
    for (const agent of agents) {
      store.dispatch(upsertSession(agent));
    }

    const firstForeground = agents.find((agent) => !agent.isBackground) ?? agents[0];
    store.dispatch(setActiveAgentId(wsId, String(firstForeground.id)));
  }
});
