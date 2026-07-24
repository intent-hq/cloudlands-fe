/**
 * Suite 3 — streaming-chunk rendering pipeline (PROTOCOL §6.3 / §7).
 *
 * Cross-cutting suite: daemon `agent:stream:*` notifications flow through the
 * `MockBackendTransport` fixture, into `daemon-events-bridge.ts`, into the
 * `workspace-agents` + `chat-state` reducers, into the shape the message DOM
 * renders. The renderer is a thin presenter over the daemon (see
 * `packages/cloudlands-fe/AGENTS.md`), so the assistant message's
 * `contentBlocks` is exactly what `AgentMessageList` / `StreamingMessageContent`
 * render — asserting on the store state faithfully proves the DOM grows on
 * each chunk without dragging in the markdown/Tiptap render stack.
 *
 * Also codifies the "chunk-echo" fan-out gate the existing bridge test
 * documents: the same chunk delivered under a foreign subscriptionId must NOT
 * append.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("$lib/client/live/backend-transport", async () => {
  const mod = await import("../../../../test/mocks/backend-transport.mock");
  return mod.mockBackendTransportModule;
});

import { store as appStore } from "$store/renderer/store";
import {
  bulkUpsertSessions,
  clearAllSessions,
  setAgentStreaming,
} from "$store/renderer/slices/agent-session/agent-session-slice";
import { chatReset } from "$store/renderer/slices/chat-state/chat-state-slice";
import { __resetDaemonEventsBridgeForTests } from "$features/events/daemon-events-bridge.client";
import { AgentStatus } from "$shared/types/agent.types";
import type { AgentMessage, AgentSession } from "$shared/types";
import type { StatusEvent } from "$store/renderer/slices/chat-state/chat-state-types";
import {
  installMockBackend,
  resetMockBackend,
  type MockBackendHandle,
} from "../../../../test/mocks/backend-transport.mock";

const WORKSPACE_ID = "ws-stream";
const AGENT_ID = "agent-stream-1";
const MESSAGE_ID = "msg_assistant_stream";
const STREAM_ID = "stream_stream";
const SUBSCRIPTION_ID = "sub-stream-1";

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function seedSession(): void {
  // Seed a session with an EMPTY assistant message placeholder so the chunk
  // accumulator has a target to grow. Matches the `createInitialPlaceholder`
  // path the workspaceAgents reducer normally installs at `chatSendStarted`.
  appStore.dispatch(
    bulkUpsertSessions([
      {
        id: AGENT_ID,
        backendSessionId: "backend-stream-1",
        workspaceId: WORKSPACE_ID,
        name: "Streaming Impl",
        status: AgentStatus.Active,
        isStreaming: true,
        messages: [],
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      } as AgentSession,
    ]),
  );
}

function readSession(): AgentSession | undefined {
  const state = appStore.state as {
    agentSessions?: { byAgentId: Record<string, AgentSession> };
  };
  return state.agentSessions?.byAgentId[AGENT_ID];
}

function readAssistantMessages(): AgentMessage[] {
  return (readSession()?.messages ?? []).filter((m) => m.role === "assistant");
}

function readStatusEvents(): StatusEvent[] {
  const state = appStore.state as {
    chatState?: { byAgentId: Record<string, { statusEvents: StatusEvent[] }> };
  };
  return state.chatState?.byAgentId[AGENT_ID]?.statusEvents ?? [];
}

function pushChunk(backend: MockBackendHandle, delta: string): void {
  backend.pushEvent({
    type: "agent:stream:chunk",
    data: {
      agentId: AGENT_ID,
      content: delta,
      messageId: MESSAGE_ID,
      blockIndex: 0,
      blockId: `${MESSAGE_ID}:0`,
      blockType: "text",
      streamId: STREAM_ID,
    },
    workspaceId: WORKSPACE_ID,
    actor: { type: "agent", id: AGENT_ID },
    subscriptionId: SUBSCRIPTION_ID,
  });
}

describe("agent-stream.wss — chunk accumulation → transcript growth", () => {
  let backend: MockBackendHandle;

  beforeAll(() => {
    appStore.init();
  });

  beforeEach(async () => {
    // Reset bridge singletons BEFORE any dispatch — otherwise a lingering
    // `installed=true` from a prior test's install (whose async subscribe
    // hadn't resolved when the previous reset ran) leaves a stale notification
    // handler attached to the mock, and the next install adds a second one,
    // causing every chunk to be applied twice ("HelloHello" symptom).
    __resetDaemonEventsBridgeForTests();
    backend = installMockBackend();
    // `events.subscribe` is the only backend call the bridge makes — resolve it
    // with a deterministic id so the fan-out scope gate accepts our pushEvents
    // tagged with the same id.
    backend.onRequest("events.subscribe", () => ({ subscriptionId: SUBSCRIPTION_ID }));
    // The task note calls out an `agent.getConversation` hydration script; we
    // register a handler that returns the seeded transcript so any consumer
    // that reaches for it gets a PROTOCOL-shaped response rather than the
    // fixture's MOCK_UNHANDLED_METHOD error.
    backend.onRequest("agent.getConversation", (params) => {
      expect(params).toMatchObject({ agentId: AGENT_ID });
      return {
        messages: (readSession()?.messages ?? []) as AgentMessage[],
      };
    });

    appStore.dispatch(clearAllSessions());
    appStore.dispatch(chatReset(AGENT_ID));
    seedSession();
    // `setAgentStreaming` runs through the middleware chain and triggers the
    // bridge's lazy install. Awaiting the microtask lets `events.subscribe`
    // resolve so `ownSubscriptionId` is captured before any pushEvent runs.
    appStore.dispatch(setAgentStreaming(AGENT_ID, true));
    await flush();
  });

  afterEach(() => {
    resetMockBackend();
    vi.clearAllMocks();
  });

  it("grows the assistant message per chunk and clears statusEvents on stream:end", async () => {
    // Baseline: seeded session has no assistant message yet, no status hints.
    expect(readAssistantMessages()).toHaveLength(0);
    expect(readStatusEvents()).toEqual([]);

    // Chunk 1 — first delta. Creates the assistant message, and the chunk
    // reducer arms the "Streaming response…" status hint on the first text
    // chunk (see chat-state-slice.reduceChunkReceived).
    pushChunk(backend, "Hello");
    let messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].id).toBe(MESSAGE_ID);
    expect(messages[0].isStreaming).toBe(true);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello",
    });
    expect(readStatusEvents().map((e) => e.phase)).toEqual(["streaming"]);

    // Chunk 2 — second delta. The bridge coalesces consecutive text chunks at
    // the same blockIndex into a single text block, mirroring the daemon's
    // `Transcript.push_text` (crates/intent-services/src/agent_session.rs).
    pushChunk(backend, " world");
    messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world",
    });

    // Chunk 3 — final delta. Still exactly one assistant message, still one
    // text block; `chat message DOM grows per chunk` in the thin-presenter
    // sense (this is the same `contentBlocks` array `StreamingMessageContent`
    // hands to `MarkdownViewer`).
    pushChunk(backend, "!");
    messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks).toHaveLength(1);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world!",
    });
    // Final concatenated deltas must equal the sum of the pushed deltas.
    expect((messages[0].contentBlocks?.[0] as { text: string }).text).toBe(
      ["Hello", " world", "!"].join(""),
    );

    // stream:end finalizes the transcript and — per §5 chat-state contract —
    // clears the status hints on the chatState side.
    backend.pushEvent({
      type: "agent:stream:end",
      data: { agentId: AGENT_ID, streamId: STREAM_ID },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].isStreaming).toBe(false);
    expect(messages[0].streamingComplete).toBe(true);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Hello world!",
    });
    expect(readStatusEvents()).toEqual([]);
  });

  it("lifts a completed tool's proposal-MIME resource item into a standalone block (§7.1)", async () => {
    // PROTOCOL §7.1 proposal-resource item exactly as the daemon carries it in
    // tool_result.output (tool_block.rs::find_proposal_resource contract).
    const proposalJson = JSON.stringify({
      kind: "workspace-create",
      payload: { operation: "workspace.create", params: { repositoryPath: "/repo" } },
      preview: { title: "Create workspace" },
      applyToolCallId: "tc-prop-1",
    });
    const resourceItem = {
      type: "resource",
      resource: {
        uri: "intent-proposal://workspace-create/tc-prop-1",
        name: "Create workspace",
        mimeType: "application/vnd.intent.proposal+json",
        text: proposalJson,
      },
    };

    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        toolCallId: "tc-prop-1",
        toolName: "propose_workspace",
        toolKind: "other",
        status: "completed",
        input: {},
        output: [resourceItem],
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    // tool_use, tool_result, then the standalone proposal-resource block with
    // the §7.1 predicted stable id (tool_use index + 2).
    expect(blocks.map((b) => b.type)).toEqual(["tool_use", "tool_result", "resource"]);
    expect(blocks[2]).toMatchObject({
      type: "resource",
      id: `${MESSAGE_ID}:2`,
      resource: {
        mimeType: "application/vnd.intent.proposal+json",
        text: proposalJson,
      },
    });
    // The tool_result keeps the resource item untouched in its output.
    expect(blocks[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tc-prop-1",
      output: [resourceItem],
    });
  });

  it("lifts a proposal from a provider-collapsed tool output (§7.1 collapsed-output fallback)", async () => {
    // Real-world regression shape (chief message 019f923d-d38a-…): auggie
    // flattens the daemon's dual text+resource MCP content items into a single
    // `{ "output": "<stringified {ok, proposal}>" }` object, dropping the
    // resource item. PROTOCOL §7.1 documents the daemon-side fallback
    // (tool_block.rs::rebuild_collapsed_proposal_resource); the bridge must
    // mirror it so the live transcript matches the persisted one.
    const proposal = {
      kind: "workspace-create",
      payload: { operation: "workspace.create", params: { repositoryPath: "/repo" } },
      preview: { title: "Create workspace", summary: "Review before creating." },
    };
    const collapsedOutput = { output: JSON.stringify({ ok: true, proposal }) };

    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        toolCallId: "tc-collapsed-1",
        toolName: "ws-app-proposal-show",
        toolKind: "other",
        status: "completed",
        input: {},
        output: collapsedOutput,
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["tool_use", "tool_result", "resource"]);
    // Rebuilt exactly as the daemon's build_proposal_resource_item: uri from
    // kind + encoded preview.title (no applyToolCallId), name from
    // preview.title, compact proposal JSON as text.
    expect(blocks[2]).toMatchObject({
      type: "resource",
      id: `${MESSAGE_ID}:2`,
      resource: {
        uri: "intent-proposal://workspace-create/Create%20workspace",
        name: "Create workspace",
        mimeType: "application/vnd.intent.proposal+json",
      },
    });
    expect(
      JSON.parse((blocks[2] as { resource: { text: string } }).resource.text),
    ).toEqual(proposal);
    // The tool_result keeps the collapsed output untouched.
    expect(blocks[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tc-collapsed-1",
      output: collapsedOutput,
    });
  });

  it("lifts a proposal from a bare-string collapsed output (§7.1)", async () => {
    // Mirrors the daemon's Value::String arm (tool_block.rs::
    // collapsed_output_text, pinned there by
    // lift_proposal_resource_rebuilds_from_plain_string_output).
    const proposal = {
      kind: "workspace-create",
      payload: { operation: "workspace.create", params: { repositoryPath: "/repo" } },
      preview: { title: "Create workspace" },
    };

    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        toolCallId: "tc-bare-1",
        toolName: "ws-app-proposal-show",
        toolKind: "other",
        status: "completed",
        input: {},
        output: JSON.stringify({ ok: true, proposal }),
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["tool_use", "tool_result", "resource"]);
  });

  it("lifts a proposal from a provider-wrapped collapsed output (§7.1 wrap repair)", async () => {
    // Real-world regression shape (chief message agent-b8eb9a95… seq 1 block
    // 5): the provider hard-wraps the pretty-printed `{ok, proposal}` string
    // at 1000 columns, injecting RAW newlines into JSON string literals —
    // including one mid-word — so a plain JSON.parse throws and the lift
    // silently skips. The bridge must repair the wrap (strip raw control
    // characters inside string literals) and lift the proposal.
    const longPrompt =
      "Fix these open bugs from intent-hq/monorepo in parallel and create one task per issue. ".repeat(
        20,
      );
    const proposal = {
      kind: "workspace-create",
      payload: {
        operation: "workspace.create",
        params: { initialPrompt: longPrompt, repositoryPath: "/repo" },
      },
      preview: { title: "Create workspace", summary: "Review before creating." },
    };
    const pretty = JSON.stringify({ ok: true, proposal }, null, 2);
    // Hard-wrap every pretty-printed line at 1000 columns with raw newlines,
    // mirroring the provider's observed line-length signature (1000, remainder).
    const wrapped = pretty
      .split("\n")
      .map((line) => line.match(/.{1,1000}/g)?.join("\n") ?? line)
      .join("\n");
    // Fixture sanity: the wrap corrupted the payload (raw newline inside a
    // string literal, breaking a word in two) and plain parsing fails.
    expect(wrapped).not.toBe(pretty);
    expect(() => JSON.parse(wrapped)).toThrow();
    const collapsedOutput = { output: wrapped };

    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        toolCallId: "tc-wrapped-1",
        toolName: "ws-app-proposal-show",
        toolKind: "other",
        status: "completed",
        input: {},
        output: collapsedOutput,
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["tool_use", "tool_result", "resource"]);
    expect(blocks[2]).toMatchObject({
      type: "resource",
      id: `${MESSAGE_ID}:2`,
      resource: {
        uri: "intent-proposal://workspace-create/Create%20workspace",
        name: "Create workspace",
        mimeType: "application/vnd.intent.proposal+json",
      },
    });
    // The repair strips exactly the wrap-injected newlines: the recovered
    // proposal round-trips to the original, long prompt intact.
    expect(
      JSON.parse((blocks[2] as { resource: { text: string } }).resource.text),
    ).toEqual(proposal);
    // The tool_result keeps the wrapped output untouched.
    expect(blocks[1]).toMatchObject({
      type: "tool_result",
      tool_use_id: "tc-wrapped-1",
      output: collapsedOutput,
    });

    // Escape-split coverage: the subtlest repair case is a wrap boundary
    // landing BETWEEN a backslash and its escaped character (`escapePending`
    // must survive the stripped newline). Build a minified envelope where the
    // `\` of an escaped newline sits exactly at column index 999, so the
    // 1000-column wrap splits the two-character `\n` escape in half.
    const makeEnvelope = (prompt: string) =>
      JSON.stringify({
        ok: true,
        proposal: {
          kind: "workspace-create",
          payload: {
            operation: "workspace.create",
            params: { initialPrompt: prompt, repositoryPath: "/repo" },
          },
          preview: { title: "Create workspace", summary: "Review before creating." },
        },
      });
    const promptStart = makeEnvelope("MARKER").indexOf("MARKER");
    const escapeSplitPrompt =
      "a".repeat(999 - promptStart) + "\n" + "tail after the split escape";
    const serialized = makeEnvelope(escapeSplitPrompt);
    // Fixture sanity: the escape's backslash is the last character of the
    // first 1000-column chunk, so the injected newline lands between `\` and
    // `n` — and the corrupted payload does not parse.
    expect(serialized[999]).toBe("\\");
    expect(serialized[1000]).toBe("n");
    const escapeSplitWrapped = serialized.match(/.{1,1000}/g)?.join("\n") ?? serialized;
    expect(() => JSON.parse(escapeSplitWrapped)).toThrow();

    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 3,
        blockId: `${MESSAGE_ID}:3`,
        toolCallId: "tc-wrapped-2",
        toolName: "ws-app-proposal-show",
        toolKind: "other",
        status: "completed",
        input: {},
        output: { output: escapeSplitWrapped },
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const blocksAfter = readAssistantMessages()[0].contentBlocks ?? [];
    expect(blocksAfter.map((b) => b.type)).toEqual([
      "tool_use",
      "tool_result",
      "resource",
      "tool_use",
      "tool_result",
      "resource",
    ]);
    // The repaired round-trip preserves the escaped character: the recovered
    // prompt still contains the `\n` the wrap boundary split in two.
    const recovered = JSON.parse(
      (blocksAfter[5] as { resource: { text: string } }).resource.text,
    ) as { payload: { params: { initialPrompt: string } } };
    expect(recovered.payload.params.initialPrompt).toBe(escapeSplitPrompt);
  });

  it("never lifts from a wrapped output that is invalid JSON even after repair (§7.1)", async () => {
    // Truncated pretty-printed envelope with the same 1000-column raw-newline
    // wrap: stripping control characters inside string literals cannot make
    // it parse, so the lift must stay silent.
    const longPrompt = "word ".repeat(400);
    const pretty = JSON.stringify(
      { ok: true, proposal: { kind: "workspace-create", payload: { p: longPrompt } } },
      null,
      2,
    );
    const truncated = pretty.slice(0, Math.floor(pretty.length * 0.8));
    const wrapped = truncated
      .split("\n")
      .map((line) => line.match(/.{1,1000}/g)?.join("\n") ?? line)
      .join("\n");
    expect(() => JSON.parse(wrapped)).toThrow();

    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        toolCallId: "tc-wrapped-bad-1",
        toolName: "ws-app-proposal-show",
        toolKind: "other",
        status: "completed",
        input: {},
        output: { output: wrapped },
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["tool_use", "tool_result"]);
  });

  it("never lifts from a collapsed output that fails the §7.1 guards", async () => {
    // Each collapsed output is valid JSON but must be rejected by a specific
    // guard: not a proposal echo, daemon's non-empty-title requirement, and
    // daemon's payload-must-be-an-object requirement (is_valid_proposal).
    const rejected = [
      { ok: true, stdout: "done" },
      {
        ok: true,
        proposal: {
          kind: "workspace-create",
          payload: { operation: "workspace.create", params: {} },
          preview: { title: "" },
        },
      },
      {
        ok: true,
        proposal: {
          kind: "workspace-create",
          payload: [],
          preview: { title: "Create workspace" },
        },
      },
    ];
    rejected.forEach((envelope, i) => {
      backend.pushEvent({
        type: "agent:tool:call",
        data: {
          agentId: AGENT_ID,
          messageId: MESSAGE_ID,
          blockIndex: i * 2,
          blockId: `${MESSAGE_ID}:${i * 2}`,
          toolCallId: `tc-guard-${i}`,
          toolName: "run_command",
          toolKind: "execute",
          status: "completed",
          input: {},
          output: { output: JSON.stringify(envelope) },
          streamId: STREAM_ID,
        },
        workspaceId: WORKSPACE_ID,
        actor: { type: "agent", id: AGENT_ID },
        subscriptionId: SUBSCRIPTION_ID,
      });
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual([
      "tool_use",
      "tool_result",
      "tool_use",
      "tool_result",
      "tool_use",
      "tool_result",
    ]);
  });

  it("never lifts a proposal block from a tool that ends in error (§7.1)", async () => {
    backend.pushEvent({
      type: "agent:tool:call",
      data: {
        agentId: AGENT_ID,
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        toolCallId: "tc-err-1",
        toolName: "propose_workspace",
        toolKind: "other",
        status: "error",
        input: {},
        output: [
          {
            type: "resource",
            resource: {
              mimeType: "application/vnd.intent.proposal+json",
              text: "{}",
            },
          },
        ],
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    const blocks = messages[0].contentBlocks ?? [];
    expect(blocks.map((b) => b.type)).toEqual(["tool_use", "tool_result"]);
  });

  it("does not echo when the same chunk arrives on a foreign fan-out subscription", async () => {
    // Chunk-echo regression: with an overlapping `agent:*` subscription on the
    // same socket the daemon delivers ONE notification per matching sub. The
    // bridge's scope gate (see daemon-events-bridge.ts header) drops copies
    // whose envelope subscriptionId != our own so `priorText + content` runs
    // exactly once. If the gate breaks, "TodayTodayToday" is the symptom.
    backend.pushEvent({
      type: "agent:stream:chunk",
      data: {
        agentId: AGENT_ID,
        content: "Today",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: SUBSCRIPTION_ID,
    });
    // Same delta, foreign subscription id — MUST be dropped.
    backend.pushEvent({
      type: "agent:stream:chunk",
      data: {
        agentId: AGENT_ID,
        content: "Today",
        messageId: MESSAGE_ID,
        blockIndex: 0,
        blockId: `${MESSAGE_ID}:0`,
        blockType: "text",
        streamId: STREAM_ID,
      },
      workspaceId: WORKSPACE_ID,
      actor: { type: "agent", id: AGENT_ID },
      subscriptionId: "sub-foreign",
    });

    const messages = readAssistantMessages();
    expect(messages).toHaveLength(1);
    expect(messages[0].contentBlocks?.[0]).toMatchObject({
      type: "text",
      text: "Today",
    });
  });
});
