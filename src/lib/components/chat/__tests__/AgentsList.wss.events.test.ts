/**
 * Suite 2 — event-driven refetch loop for AgentsList (PROTOCOL §6.3 lifecycle).
 *
 * Given: `installMockBackend()` scripted so `workspace.list` returns one
 * workspace and `agent.list` returns one Pending agent. `LiveAgentsClient`
 * subscribes and its handler drives the `agents` prop passed to
 * `AgentsList.svelte` (a pure presenter).
 *
 * When: an `agent:started` / `agent:idle` / `agent:renamed` / `agent:completed`
 * event is pushed onto the notification stream, the delta-subscription's
 * legacy `events.event` fallback issues a fresh `agent.list` refetch and
 * re-emits the reconciled list.
 *
 * Then: the recorded `agent.list` call count increments by one per event, the
 * rerendered `AgentsList` reflects the new status (via the underlying session
 * projection) and — for `agent:renamed` — surfaces the updated display name in
 * the DOM. New file per T3; existing `AgentsList.test.ts` is untouched.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, waitFor } from "@testing-library/svelte";
import { tick } from "svelte";
import { get, writable } from "svelte/store";

vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../../../../test/mocks/backend-transport.mock");
  return mod.mockBackendTransportModule;
});

vi.mock("$lib/utils/workspace-navigation", () => ({
  navigateToAgent: vi.fn(),
}));

vi.mock("$store/renderer/slices/theme/theme-selectors", () => ({
  selectIsDarkTheme: Object.assign(
    () => ({
      subscribe: (run: (value: boolean) => void) => {
        run(false);
        return () => {};
      },
    }),
    { select: () => false },
  ),
}));

vi.mock("$store/renderer/slices/agent-session/agent-session-selectors", () => ({
  selectAgentIsThinking: Object.assign(
    () => ({
      subscribe: (run: (value: boolean) => void) => {
        run(false);
        return () => {};
      },
    }),
    { select: () => false },
  ),
  selectAgentProvider: Object.assign(
    () => ({
      subscribe: (run: (value: string | undefined) => void) => {
        run(undefined);
        return () => {};
      },
    }),
    { select: () => undefined },
  ),
}));

import { LiveAgentsClient } from "$lib/client/live/live-agents-client";
import type { AgentSession } from "$shared/types";
import { AgentStatus } from "$shared/types";
import AgentsList from "../AgentsList.svelte";
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from "../../../../test/mocks/backend-transport.mock";

const WORKSPACE_ID = "ws-events";
const AGENT_ID = "agent-events-1";
const INITIAL_NAME = "Implementor 7";
const RENAMED = "Implementor 7 — post-plan";

interface RawAgent {
  id: string;
  workspaceId: string;
  name: string;
  status: AgentStatus;
  agentInfo?: { id: string; name: string; model: string };
  createdAt?: string;
  updatedAt?: string;
}

function makeAgent(overrides: Partial<RawAgent> = {}): RawAgent {
  const now = new Date("2026-06-01T00:00:00.000Z").toISOString();
  return {
    id: AGENT_ID,
    workspaceId: WORKSPACE_ID,
    name: INITIAL_NAME,
    status: AgentStatus.Pending,
    agentInfo: { id: AGENT_ID, name: INITIAL_NAME, model: "sonnet-3.5" },
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function countCalls(backend: MockBackendHandle, method: string): number {
  return backend.requests.filter((r) => r.method === method).length;
}

/** Wait until the subscription has run its post-event `agent.list` refetch. */
async function waitForAgentListCall(
  backend: MockBackendHandle,
  target: number,
): Promise<void> {
  await waitFor(() => {
    expect(countCalls(backend, "agent.list")).toBe(target);
  });
}

describe("AgentsList — event-driven refetch (WSS mock)", () => {
  let backend: MockBackendHandle;
  let currentAgent: RawAgent;

  beforeEach(() => {
    backend = installMockBackend();
    currentAgent = makeAgent();
    backend.onRequest("workspace.list", () => ({
      workspaces: [{ id: WORKSPACE_ID }],
    }));
    backend.onRequest("agent.list", (params) => {
      expect(params).toEqual({ workspaceId: WORKSPACE_ID });
      return { agents: [currentAgent] };
    });
  });

  afterEach(() => {
    resetMockBackend();
  });

  it("refetches and rerenders across the agent lifecycle events", async () => {
    const client = new LiveAgentsClient();
    const agentsStore = writable<AgentSession[]>([]);
    const unsubscribe = client.subscribe((agents) => {
      agentsStore.set(agents);
    });

    // Initial refetch: workspace.list + agent.list once each.
    await waitForAgentListCall(backend, 1);
    expect(countCalls(backend, "workspace.list")).toBe(1);
    expect(get(agentsStore)).toHaveLength(1);
    expect(get(agentsStore)[0].status).toBe(AgentStatus.Pending);
    expect(get(agentsStore)[0].name).toBe(INITIAL_NAME);

    const view = render(AgentsList, {
      props: { agents: get(agentsStore), collapsed: false },
    });
    await tick();
    expect(view.container.textContent).toContain(INITIAL_NAME);

    // --- agent:started ---------------------------------------------------
    currentAgent = makeAgent({ status: AgentStatus.Active });
    backend.pushEvent({
      type: "agent:started",
      data: { agentId: AGENT_ID },
      actor: { type: "agent", id: AGENT_ID },
      workspaceId: WORKSPACE_ID,
    });
    await waitForAgentListCall(backend, 2);
    expect(get(agentsStore)[0].status).toBe(AgentStatus.Active);
    await view.rerender({ agents: get(agentsStore), collapsed: false });
    expect(view.container.textContent).toContain(INITIAL_NAME);

    // --- agent:idle (spinner cleared) ------------------------------------
    currentAgent = makeAgent({ status: AgentStatus.RuntimeIdle });
    backend.pushEvent({
      type: "agent:idle",
      data: { agentId: AGENT_ID },
      actor: { type: "agent", id: AGENT_ID },
      workspaceId: WORKSPACE_ID,
    });
    await waitForAgentListCall(backend, 3);
    expect(get(agentsStore)[0].status).toBe(AgentStatus.RuntimeIdle);
    await view.rerender({ agents: get(agentsStore), collapsed: false });
    expect(view.container.textContent).toContain(INITIAL_NAME);

    // --- agent:renamed (name updated in DOM) -----------------------------
    currentAgent = makeAgent({
      status: AgentStatus.RuntimeIdle,
      name: RENAMED,
      agentInfo: { id: AGENT_ID, name: RENAMED, model: "sonnet-3.5" },
    });
    backend.pushEvent({
      type: "agent:renamed",
      data: { agentId: AGENT_ID, name: RENAMED },
      actor: { type: "agent", id: AGENT_ID },
      workspaceId: WORKSPACE_ID,
    });
    await waitForAgentListCall(backend, 4);
    expect(get(agentsStore)[0].name).toBe(RENAMED);
    await view.rerender({ agents: get(agentsStore), collapsed: false });
    await waitFor(() => {
      expect(view.container.textContent).toContain(RENAMED);
    });

    // --- agent:completed (status flip) -----------------------------------
    currentAgent = makeAgent({
      status: AgentStatus.Completed,
      name: RENAMED,
      agentInfo: { id: AGENT_ID, name: RENAMED, model: "sonnet-3.5" },
    });
    backend.pushEvent({
      type: "agent:completed",
      data: { agentId: AGENT_ID },
      actor: { type: "agent", id: AGENT_ID },
      workspaceId: WORKSPACE_ID,
    });
    await waitForAgentListCall(backend, 5);
    expect(get(agentsStore)[0].status).toBe(AgentStatus.Completed);
    await view.rerender({ agents: get(agentsStore), collapsed: false });
    expect(view.container.textContent).toContain(RENAMED);

    // Cross-family events (e.g. `note:updated`) must NOT trigger an
    // agent.list refetch — the subscription narrows to lifecycle types.
    const before = countCalls(backend, "agent.list");
    backend.pushEvent({
      type: "note:updated",
      data: { noteId: "spec" },
    });
    await tick();
    expect(countCalls(backend, "agent.list")).toBe(before);

    unsubscribe();
    view.unmount();
  });
});
