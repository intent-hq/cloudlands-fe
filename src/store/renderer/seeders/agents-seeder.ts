/**
 * Agents & chat mock seeder.
 *
 * Pulls agent sessions (with their sample chat transcripts) from the `AppClient`
 * seam and dispatches existing slice actions so the agent list, agent overview,
 * and chat panel render with mock agents and a static conversation — replacing
 * the work the agent-loading sagas used to do against the real backend.
 */
import { registerMockSeeder } from "../mock-bootstrap";
import { bulkUpsertSessions, upsertSession } from "../slices/agent-session/agent-session-slice";
import {
  setActiveAgentId,
  setAgentsLoaded,
} from "../slices/workspace-agents/workspace-agents-slice";

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
