/**
 * Agents & chat mock seeder.
 *
 * Pulls agent sessions (with their sample chat transcripts) from the `AppClient`
 * seam and dispatches existing slice actions so the agent list, agent overview,
 * and chat panel render with mock agents and a static conversation — replacing
 * the work the agent-loading sagas used to do against the real backend.
 *
 * Agent-provider readiness is also probed directly over IPC at boot: the
 * AuggieSetupGate checks `providers:get-availability` and `auggie:status`. Those
 * channels are registered against the mock IPC router synchronously at import
 * time (before any component mounts) so the gate sees an available, logged-in
 * provider instead of making real CLI/network calls.
 *
 * `agent:get-active-streams` is registered alongside for the same
 * unregistered-channel class of bug: `ActiveStreamsTracker.fetchActiveStreams`
 * fires on WindowTitleBar mount and the undefined fallback produced a recurring
 * "Failed to fetch active streams" warning (`Cannot read properties of
 * undefined (reading 'success')`). A no-streams default keeps the tracker quiet
 * until the daemon owns this surface.
 */
import { registerMockIpcHandler } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS, AUGGIE_CHANNELS, PROVIDERS_CHANNELS } from "$shared/ipc/channels";
import { MINIMUM_AUGGIE_VERSION } from "$shared/constants/auggie";
import type { ProviderAvailabilityResult } from "$shared/types/provider-availability";
import { registerMockSeeder } from "../mock-bootstrap";
import { bulkUpsertSessions, upsertSession } from "../slices/agent-session/agent-session-slice";
import {
  setActiveAgentId,
  setAgentsLoaded,
} from "../slices/workspace-agents/workspace-agents-slice";

/** Deterministic identity surfaced for the logged-in mock provider. */
const MOCK_PROVIDER_AUTH_DETAILS = "mock@example.com";

/** Auggie reports available + authenticated so the setup gate stays dismissed. */
const mockProviderAvailability: ProviderAvailabilityResult = {
  hasAnyProvider: true,
  providers: {
    auggie: { available: true, authenticated: true, authDetails: MOCK_PROVIDER_AUTH_DETAILS },
    claudeCode: { available: false },
    codex: { available: false },
    cortex: { available: false },
    mock: { available: true, authenticated: true },
    opencode: { available: false },
    pi: { available: false },
    droid: { available: false },
  },
  hiddenProviders: [],
};

// Registered at import time (not inside the async seeder) so the AuggieSetupGate's
// onMount probes resolve to mocks before the real CLI/network checks could run.
registerMockIpcHandler(PROVIDERS_CHANNELS.GET_AVAILABILITY, async () => ({
  success: true,
  data: mockProviderAvailability,
}));
registerMockIpcHandler(AUGGIE_CHANNELS.STATUS, async () => ({
  success: true,
  data: {
    installed: true,
    authenticated: true,
    version: MINIMUM_AUGGIE_VERSION,
    versionOk: true,
    minimumVersion: MINIMUM_AUGGIE_VERSION,
    authDetails: MOCK_PROVIDER_AUTH_DETAILS,
  },
}));

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
