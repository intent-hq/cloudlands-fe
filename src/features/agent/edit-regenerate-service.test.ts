import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";

// FAKE seam: `appClient.agents.editAndRegenerate` is stubbed. The middleware
// runs against the REAL configured store so the async action resolves through
// the real action.success/failure path, and the optimistic local truncation is
// asserted on real reducer state.
const { editAndRegenerate } = vi.hoisted(() => ({ editAndRegenerate: vi.fn() }));
vi.mock("$lib/client", () => ({
  appClient: { agents: { editAndRegenerate } },
}));

// The handler lazily `import("svelte-sonner")` for error toasts; stub it so no
// real toast component is mounted.
vi.mock("svelte-sonner", () => ({
  toast: Object.assign(vi.fn(), {
    warning: vi.fn(),
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  }),
}));

import { store as appStore } from "$store/renderer/store";
import { toast } from "svelte-sonner";
import {
  agentSessionEditAndRegenerateRequested,
  bulkUpsertSessions,
} from "$store/renderer/slices/agent-session/agent-session-slice";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function makeMessage(id: string, role: "user" | "assistant", text: string): AgentMessage {
  return {
    id,
    role,
    timestamp: "2026-01-01T00:00:00.000Z",
    contentBlocks: [{ type: "text", text }],
  } as AgentMessage;
}

function seedSession(agentId: string, wsId: string, messages: AgentMessage[]): void {
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: agentId,
        backendSessionId: "backend-" + agentId,
        workspaceId: wsId,
        name: "Agent",
        status: AgentStatus.Active,
        messages,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as AgentSession,
    ]),
  );
}

function readMessages(agentId: string): AgentMessage[] {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return state.agentSessions?.byAgentId[agentId]?.messages ?? [];
}

describe("editRegenerateService (fake appClient.agents.editAndRegenerate, real store)", () => {
  beforeAll(() => appStore.init());
  afterEach(() => {
    editAndRegenerate.mockReset();
    vi.clearAllMocks();
  });

  it("forwards the §5.5 params, resolves, and truncates the local transcript at the edited message", async () => {
    const WS = "ws-edit-happy";
    const AGENT = "agent-edit-happy";
    seedSession(AGENT, WS, [
      makeMessage("m1", "user", "first"),
      makeMessage("m2", "assistant", "reply 1"),
      makeMessage("m3", "user", "second"),
      makeMessage("m4", "assistant", "reply 2"),
    ]);
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m3", "edited second");
    appStore.dispatch(action);
    await action.promise;

    expect(editAndRegenerate).toHaveBeenCalledWith({
      agentId: AGENT,
      workspaceId: WS,
      messageId: "m3",
      content: "edited second",
    });
    // Optimistic truncation drops the edited message and everything after it.
    expect(readMessages(AGENT).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("passes options.model through as the per-request model override", async () => {
    const WS = "ws-edit-model";
    const AGENT = "agent-edit-model";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "first")]);
    editAndRegenerate.mockResolvedValueOnce({ success: true });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited", {
      model: "opus",
    });
    appStore.dispatch(action);
    await action.promise;

    expect(editAndRegenerate).toHaveBeenCalledWith(
      expect.objectContaining({ model: "opus" }),
    );
  });

  it("rejects, toasts, and leaves the transcript untouched on a non-success result", async () => {
    const WS = "ws-edit-fail";
    const AGENT = "agent-edit-fail";
    const messages = [
      makeMessage("m1", "user", "first"),
      makeMessage("m2", "assistant", "reply"),
    ];
    seedSession(AGENT, WS, messages);
    editAndRegenerate.mockResolvedValueOnce({ success: false, error: "bad message id" });

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("bad message id");

    await flush();
    expect(toast.error).toHaveBeenCalledWith("bad message id");
    expect(readMessages(AGENT).map((m) => m.id)).toEqual(["m1", "m2"]);
  });

  it("rejects, toasts, and leaves the transcript untouched on a thrown transport error", async () => {
    const WS = "ws-edit-throw";
    const AGENT = "agent-edit-throw";
    seedSession(AGENT, WS, [makeMessage("m1", "user", "first")]);
    editAndRegenerate.mockRejectedValueOnce(new Error("transport boom"));

    const action = agentSessionEditAndRegenerateRequested(AGENT, WS, "m1", "edited");
    appStore.dispatch(action);
    await expect(action.promise).rejects.toThrow("transport boom");

    await flush();
    expect(toast.error).toHaveBeenCalledWith("transport boom");
    expect(readMessages(AGENT).map((m) => m.id)).toEqual(["m1"]);
  });
});
