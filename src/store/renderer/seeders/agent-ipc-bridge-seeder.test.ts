/**
 * Wire-contract tests for the agent IPC bridge seeder.
 *
 * Asserts each legacy renderer→main agent channel registers a mock IPC
 * handler that (a) forwards to the canonical daemon JSON-RPC method with the
 * right params (PROTOCOL §5.5), and (b) wraps the daemon response in the
 * envelope the call site expects (IpcResponse for typedInvoke;
 * CommandResponse for set-model). The queue-quintet bridges were removed
 * with their last renderer producer (T3/T4) — queue flows are covered by the
 * `appClient.agents.*` wire-contract tests in `live-agents-client.test.ts`.
 * The stream-message bridge followed once both send paths were routed
 * directly through the `BackendTransport` seam (T1/T2) — that wire contract
 * is covered by `answer-submission-wire.test.ts` (chat-send middleware +
 * agent-send) and `unified-agent-factory.test.ts`.
 */
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

// FAKE transport only: the daemon bridge is mocked so no UDS request ever
// fires. Each test asserts the JSON-RPC method + params the handler emits
// and how it maps the daemon result back to the renderer envelope.
vi.mock("$lib/client/live/backend-transport", () => ({
  backendRequest: vi.fn(),
}));

// The global `test-setup.ts` stubs `$lib/electron-bridge.invoke` to a switch
// that returns `{success:true,data:null}` for unknown channels — which would
// short-circuit consumer calls (e.g. `agentClient.setModel`) before they reach
// the mock IPC router. Route `invoke` through `mockInvoke` here so consumers
// exercise the seeder-registered bridges end-to-end.
vi.mock("$lib/electron-bridge", async () => {
  const { mockInvoke } = await import("$shared/ipc-mock-router");
  return {
    isElectron: () => false,
    invoke: <T>(channel: string, data?: unknown) => mockInvoke<T>(channel, data),
    listen: async () => () => {},
    listenSync: () => () => {},
    emit: async () => {},
  };
});

// Stable idempotency key so we can assert it without leaking randomness.
vi.mock("$lib/client/live/live-support", async (importActual) => {
  const actual = await importActual<typeof import("$lib/client/live/live-support")>();
  return { ...actual, newIdempotencyKey: () => "idk-test" };
});

import { backendRequest } from "$lib/client/live/backend-transport";
import { hasMockIpcHandler, mockInvoke, resetMockIpcRouter } from "$shared/ipc-mock-router";
import { AGENT_CHANNELS } from "$shared/ipc/channels";
import { validateIpcRequest } from "$shared/ipc/request-validation";
import { isSuccessResponse } from "$shared/ipc/typed-invoke";
// End-to-end consumer for the set-model bridge: ModelPicker calls
// `agentClient.setModel`, which folds the bridge's CommandResponse envelope
// into a `Result` — exercising it here catches envelope regressions (the
// original bug: no bridge → `undefined` → TypeError inside the fold).
import { agentClient } from "$features/agent/agent.client";

const mockedRequest = vi.mocked(backendRequest);

/**
 * A workspace ID slug that satisfies `WorkspaceIdSchema` so the
 * `validateIpcRequest('agent:create', ...)` assertions exercise the real FE
 * request-validation path (PROTOCOL-shaped slug, no synthetic format).
 */
const WORKSPACE_ID = "amber-forest";

describe("agent-ipc-bridge-seeder", () => {
  beforeAll(async () => {
    // Importing the seeder runs its `registerMockIpcHandler` side effects.
    await import("./agent-ipc-bridge-seeder");
  });
  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("agent:create → daemon agent.create", () => {
    it("forwards workspaceId / name / model / specialistId and wraps the result in IpcResponse<{agent,sessionId}>", async () => {
      // PROTOCOL-shaped daemon response for `agent.create` (§5.5):
      // `{ agent: { id, name } }` — the bridge must accept this verbatim.
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-42", name: "Coordinator" } });

      // The FE request must first pass the FE's own `agent:create` schema
      // (request-validation.ts) — that contract is independent of the bridge
      // and would catch a regression where the renderer started sending an
      // off-spec payload.
      const request = {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        name: "Coordinator",
        model: "claude-opus",
        metadata: { specialist: "coordinator" },
      };
      expect(() => validateIpcRequest("agent:create", request)).not.toThrow();

      const response = await mockInvoke(AGENT_CHANNELS.CREATE, request);

      // No `agentId` on the wire: the daemon assigns the session id and
      // returns it on the response's `agent.id`; the bridge echoes that id as
      // `sessionId` so callers adopt the daemon-assigned id.
      expect(mockedRequest).toHaveBeenCalledWith("agent.create", {
        workspaceId: WORKSPACE_ID,
        name: "Coordinator",
        model: "claude-opus",
        specialistId: "coordinator",
        idempotencyKey: "idk-test",
      });
      // `typedInvoke` consumers (UnifiedAgentFactory.createInBackend) gate on
      // `isSuccessResponse`, so the bridge envelope MUST satisfy that guard.
      expect(isSuccessResponse(response as never)).toBe(true);
      expect(response).toEqual({
        success: true,
        data: { agent: { id: "agent-42", name: "Coordinator" }, sessionId: "agent-42" },
      });
    });

    it("forwards reasoningEffort on the agent.create wire (Option B session field, §5.5)", async () => {
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-42", name: "Coordinator" } });
      const request = {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        model: "gpt-5.3-codex",
        reasoningEffort: "xhigh",
      };
      expect(() => validateIpcRequest("agent:create", request)).not.toThrow();

      await mockInvoke(AGENT_CHANNELS.CREATE, request);

      const params = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(params.model).toBe("gpt-5.3-codex");
      expect(params.reasoningEffort).toBe("xhigh");
    });

    it("forwards nameExplicitlySet:false verbatim on the agent.create wire", async () => {
      // PROTOCOL §5.5: `nameExplicitlySet` is a strict boolean — `false`
      // marks a generated placeholder name and must survive the bridge
      // verbatim (dropping it would make the daemon treat the placeholder as
      // a user-chosen name).
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-42", name: "anon" } });
      const request = {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        name: "anon",
        nameExplicitlySet: false,
      };
      expect(() => validateIpcRequest("agent:create", request)).not.toThrow();

      await mockInvoke(AGENT_CHANNELS.CREATE, request);

      const params = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(params).toBeDefined();
      expect(params.nameExplicitlySet).toBe(false);
    });

    it("rejects a non-boolean nameExplicitlySet with INVALID_REQUEST instead of silently dropping it", async () => {
      // PROTOCOL §5.5: non-boolean is a -32602 on the daemon wire. Silently
      // dropping the value would mask an upstream bug behind the daemon
      // default, so the bridge fails fast before any wire call — and the FE
      // request schema rejects the same payload.
      const request = {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        name: "anon",
        nameExplicitlySet: "false",
      };
      expect(() => validateIpcRequest("agent:create", request)).toThrow();

      const response = await mockInvoke(AGENT_CHANNELS.CREATE, request);

      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response).toEqual({
        success: false,
        error: {
          code: "INVALID_REQUEST",
          message: "nameExplicitlySet must be a boolean when present (PROTOCOL §5.5)",
        },
      });
    });

    it("omits nameExplicitlySet from the agent.create body when the request lacks it", async () => {
      // PROTOCOL §5.5: omitted reads as absent and keeps the daemon default —
      // the bridge must not default the flag on the caller's behalf.
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-42", name: "anon" } });

      await mockInvoke(AGENT_CHANNELS.CREATE, {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        name: "anon",
      });

      const params = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(params).toBeDefined();
      expect("nameExplicitlySet" in params).toBe(false);
    });

    it("never forwards a client-supplied agentId to the daemon (daemon mints its own)", async () => {
      mockedRequest.mockResolvedValueOnce({ agent: { id: "agent-be-99", name: "anon" } });
      const response = await mockInvoke(AGENT_CHANNELS.CREATE, {
        workspaceId: WORKSPACE_ID,
        workspacePath: "/tmp/ws",
        // A legacy caller may still pass an id — it must be dropped.
        agentId: "agent-legacy-client",
      });
      const params = mockedRequest.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(params).toBeDefined();
      expect("agentId" in params).toBe(false);
      // The daemon-assigned id is surfaced back as the sessionId.
      expect(response).toEqual({
        success: true,
        data: { agent: { id: "agent-be-99", name: "anon" }, sessionId: "agent-be-99" },
      });
    });

    it("returns an IpcResponse error when the daemon response lacks agent.id", async () => {
      // Without the daemon-assigned id the FE cannot address follow-up sends;
      // the bridge must fail loudly instead of returning sessionId: undefined.
      mockedRequest.mockResolvedValueOnce({ agent: { name: "no-id" } });
      const response = await mockInvoke<{ success: boolean; error?: { code: string; message: string } }>(
        AGENT_CHANNELS.CREATE,
        { workspaceId: WORKSPACE_ID },
      );
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("BACKEND_ERROR");
      expect(response.error?.message).toContain("agent.id");
    });

    it("returns an IpcResponse error when workspaceId is missing (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: { code: string } }>(
        AGENT_CHANNELS.CREATE,
        { name: "anon" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("INVALID_REQUEST");
    });

    it("surfaces a daemon failure as an IpcResponse error envelope", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("nope"));
      const response = await mockInvoke<{ success: boolean; error?: { code: string; message: string } }>(
        AGENT_CHANNELS.CREATE,
        { workspaceId: WORKSPACE_ID },
      );
      expect(response.success).toBe(false);
      expect(response.error?.code).toBe("BACKEND_ERROR");
      expect(response.error?.message).toBe("nope");
    });
  });

  describe("retired bridges stay removed", () => {
    it("registers no handler for the queue channels (last renderer producer retired with T3)", () => {
      // The unifiedOrchestrator proxy was the only renderer producer of these
      // channels; queue flows now call appClient.agents.* over the live
      // transport. A re-registered bridge would shadow that seam — any new
      // invoke call site instead fails the ipc-channel-reconciliation audit.
      // The AGENT_BACKEND channel constants were deleted with the T7
      // main-process handler removal, so the raw strings are asserted here.
      expect(hasMockIpcHandler("agent:backend:queue-message")).toBe(false);
      expect(hasMockIpcHandler("agent:backend:edit-queued")).toBe(false);
      expect(hasMockIpcHandler("agent:backend:remove-queued")).toBe(false);
      expect(hasMockIpcHandler("agent:backend:force-message")).toBe(false);
      expect(hasMockIpcHandler("agent:backend:get-queue")).toBe(false);
    });

    it("registers no handler for agent:backend:stream-message (send paths use the BackendTransport seam, T1/T2)", () => {
      // Both renderer producers (agent-send.sendMessage and
      // agent-factory.sendInitialMessage) now call
      // backendRequest("agent.sendMessage") directly; a resurrected bridge
      // would silently reintroduce the legacy channel hop.
      expect(hasMockIpcHandler("agent:backend:stream-message")).toBe(false);
    });
  });

  describe("agent:set-model → daemon agent.setModel", () => {
    it("end-to-end: agentClient.setModel sends {agentId,modelId,workspaceId} and folds the PROTOCOL body into an ok Result", async () => {
      // PROTOCOL §5.5: `agent.setModel` → `{ success, modelId }` (emits
      // `agent:updated`). The bridge wraps it as CommandResponse
      // `{success:true, data:<daemonBody>}` so `commandResponseToResult`
      // yields `ok:true` and ModelPicker reads `result.data.success`.
      mockedRequest.mockResolvedValueOnce({ success: true, modelId: "fable-5" });

      const result = await agentClient.setModel("agent-7", "fable-5", WORKSPACE_ID);

      expect(mockedRequest).toHaveBeenCalledWith("agent.setModel", {
        agentId: "agent-7",
        modelId: "fable-5",
        workspaceId: WORKSPACE_ID,
      });
      expect(result).toEqual({ ok: true, data: { success: true, modelId: "fable-5" } });
    });

    it("daemon failure surfaces as {ok:false,error:<message>} so ModelPicker toasts the daemon error", async () => {
      mockedRequest.mockRejectedValueOnce(new Error("not found: agent session"));
      const result = await agentClient.setModel("agent-7", "fable-5", WORKSPACE_ID);
      expect(result).toEqual({ ok: false, error: "not found: agent session" });
    });

    it("validates required params at the bridge boundary (no daemon call)", async () => {
      const response = await mockInvoke<{ success: boolean; error?: string }>(
        AGENT_CHANNELS.SET_MODEL,
        { agentId: "agent-7" },
      );
      expect(mockedRequest).not.toHaveBeenCalled();
      expect(response.success).toBe(false);
      expect(response.error).toContain("modelId");
    });
  });

  // Suppress the unused-import warning while keeping the import in place so
  // tests that run in isolation still tear the router down cleanly.
  void resetMockIpcRouter;
});
