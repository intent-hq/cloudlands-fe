import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentSession } from "$shared/types";

// Fake the live backend transport so the bridge installs against in-memory
// fakes (no Electron). `vi.hoisted` keeps the spies visible to the hoisted
// vi.mock factory.
const { onBackendNotificationSpy, backendRequestSpy, capturedHandlers } = vi.hoisted(() => ({
  onBackendNotificationSpy: vi.fn(),
  backendRequestSpy: vi.fn(),
  capturedHandlers: [] as Array<(n: { method: string; params?: unknown }) => void>,
}));
vi.mock("$lib/client/live/backend-transport", () => ({
  onBackendNotification: (handler: (n: { method: string; params?: unknown }) => void) => {
    onBackendNotificationSpy(handler);
    capturedHandlers.push(handler);
    return () => {
      const idx = capturedHandlers.indexOf(handler);
      if (idx >= 0) capturedHandlers.splice(idx, 1);
    };
  },
  backendRequest: (method: string, params?: unknown) => {
    backendRequestSpy(method, params);
    return Promise.resolve({ subscriptionId: "sub-1" });
  },
}));

import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  clearAllSessions,
  setAgentStreaming,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { selectAgentIsResponding } from "$store/renderer/slices/agent-session/agent-session-selectors";
import { __resetDaemonEventsBridgeForTests } from "$features/events/daemon-events-bridge";

const WS = "ws-bridge-1";
const AGENT = "agent-bridge-1";
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedSession(overrides: Partial<AgentSession> = {}): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT,
        backendSessionId: "backend-1",
        workspaceId: WS,
        name: "A",
        status: AgentStatus.Pending,
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        ...overrides,
      } as AgentSession,
    ]),
  );
}

/** Trigger the bridge to install — middleware runs lazily on first dispatch. */
async function primeBridge(): Promise<void> {
  // setAgentStreaming(false) is a harmless action that runs through the
  // configured middleware chain and triggers the bridge's lazy install.
  appStore.dispatch(setAgentStreaming(AGENT, false));
  // installSubscriptionOnce is async; let the microtask settle.
  await flush();
}

describe("daemonEventsBridge (wire contract — agent:idle clears the spinner)", () => {
  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    appStore.dispatch(clearAllSessions());
    onBackendNotificationSpy.mockClear();
    backendRequestSpy.mockClear();
    __resetDaemonEventsBridgeForTests();
    capturedHandlers.length = 0;
    seedSession();
  });

  afterEach(() => vi.clearAllMocks());

  it("registers a notification listener and subscribes to agent:* on first dispatch", async () => {
    await primeBridge();

    expect(onBackendNotificationSpy).toHaveBeenCalledTimes(1);
    expect(backendRequestSpy).toHaveBeenCalledTimes(1);
    expect(backendRequestSpy).toHaveBeenCalledWith("events.subscribe", {
      eventTypes: ["agent:*"],
    });
  });

  it("agent:idle notification flips selectAgentIsResponding from true → false", async () => {
    // Optimistic chatSendStarted-style flag: the FE reducer marks isStreaming
    // true while the user message is being sent.
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    await primeBridge();
    const handler = capturedHandlers[0];
    expect(handler).toBeTypeOf("function");

    // PROTOCOL §7 notification envelope: `events.event` with the WorkspaceEvent
    // nested in `params.event`. The bridge must extract `params.event` and
    // dispatch eventReceived(workspaceId, event) — that drives the
    // agentSession reducer's canonicalFieldsFromWorkspaceEvent path which
    // clears isStreaming/isProcessing/isResponding and sets status='idle'.
    handler!({
      method: "events.event",
      params: {
        event: {
          id: "evt-1",
          workspaceId: WS,
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "agent:idle",
          actor: { type: "agent", id: AGENT },
          data: { agentId: AGENT, status: "idle", isActive: false },
        },
      },
    });

    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(false);
  });

  it("ignores notifications that are not events.event or not agent-lifecycle", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    // Unrelated method — no-op.
    handler({ method: "agent.stream:chunk", params: { agentId: AGENT } });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);

    // events.event but not a lifecycle type — no-op.
    handler({
      method: "events.event",
      params: {
        event: {
          id: "evt-2",
          workspaceId: WS,
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "note:updated",
          actor: { type: "system" },
          data: { agentId: AGENT },
        },
      },
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
  });

  it("drops events without a workspaceId rather than guessing", async () => {
    seedSession({ isStreaming: true, status: AgentStatus.Active });
    await primeBridge();
    const handler = capturedHandlers[0]!;

    handler({
      method: "events.event",
      params: {
        event: {
          id: "evt-3",
          timestamp: "2026-01-02T00:00:00.000Z",
          type: "agent:idle",
          actor: { type: "agent", id: AGENT },
          data: { agentId: AGENT, status: "idle" },
        },
      },
    });
    expect(selectAgentIsResponding.select(appStore.state, AGENT)).toBe(true);
  });
});
