/**
 * Daemon events → renderer Redux bridge.
 *
 * Consumes the daemon's `events.event` JSON-RPC notifications (PROTOCOL §7)
 * and dispatches three families of actions:
 *
 *   1. `workspaceEvents/eventReceived` for the agent-lifecycle subset, so the
 *      `agentSession` reducer can faithfully apply BE-canonical status
 *      transitions (notably `agent:idle` clearing the optimistic
 *      `isStreaming`/`isProcessing`/`isResponding` flags set by
 *      `chatSendStarted`).
 *   2. `workspaceAgents/agentStreamUpdateReceived` for the live stream subset
 *      (`agent:stream:chunk`, `agent:tool:call`, `agent:stream:end`,
 *      `agent:failed`), so the `agent-stream-service` middleware grows the
 *      in-flight assistant message live and finalizes it in place. Without
 *      this wire the assistant reply only appears after a manual refresh
 *      (the chat-read-service hydration via `agents.getConversation`).
 *   3. `chatState/streamStatusReceived` on `agent:tool:call` (status=started)
 *      to surface the "Calling tool" hint next to the Thinking spinner. The
 *      chunk reducer auto-emits the "Streaming response…" hint on the first
 *      text chunk, and the `'complete'` / `'error'` paths clear `statusEvents`
 *      on `agent:stream:end` / `agent:failed`, so this is the only extra
 *      status dispatch needed.
 *
 * The stream family is accumulated per agent (one in-flight assistant per
 * agent) using the BE's monotonic `blockIndex` so the candidate transcript
 * always grows and the renderer's regression guard
 * (`resolveStreamContentBlocks`) accepts each update. Cleanup runs on
 * `agent:stream:end` / `agent:failed` so a subsequent prompt turn starts from
 * a clean slate. Dedup on hydration is preserved by carrying the BE-canonical
 * `messageId` as `assistantMessageId` so the in-flight message id matches the
 * one `agents.getConversation` returns later.
 *
 * Dependency-light: registers a one-shot subscription on first dispatch and a
 * single notification listener; both are cleaned up if the host store
 * disposes. The `appClient.events.subscribe(["agent:*"])` call piggybacks on
 * the existing live transport.
 *
 * Besides the Redux dispatches, the bridge re-emits a small set of daemon
 * events onto the LEGACY mock-IPC event channels (`relayLegacyIpcEvent`) that
 * components still subscribe to via `listenSync`/`on` — `workspace:updated`,
 * `git:status-changed`, `file-tracking:changes-updated`,
 * `task:ready-tasks-changed`, `agent:status-changed`, `agent:idle`. Without
 * the relay those listeners never fire (the silent-gap class: stale git
 * status, lost ready-task transitions). The emitted channel set is declared in
 * `EMITTED_MOCK_IPC_EVENT_CHANNELS` (ipc-mock-router.ts) and reconciled
 * against listener call sites by ipc-channel-reconciliation.test.ts.
 *
 * Fan-out scoping: the daemon emits one `events.event` notification per
 * matching subscription on the socket (PROTOCOL §6.3 / intent-transport
 * `build_event_notification`), each tagged with `params.subscriptionId`. If any
 * other consumer on the same socket subscribes to an overlapping `agent:*`
 * type, the same chunk would be delivered once per subscription and
 * `handleStreamChunkEvent`'s `priorText + content` append would run N times,
 * echoing each delta. The handler therefore gates on the envelope's
 * `subscriptionId`: notifications carrying a foreign id are dropped, and
 * legacy/flat envelopes (no id) are still accepted for back-compat. This
 * mirrors the same fan-out dedupe `live-terminals-client.ts` applies to
 * `terminal:*` deliveries.
 */
import type { StoreMiddleware } from "@augmentcode/ag-redux-toolkit/types";
import type { ContentBlock, QueuedMessage } from "$shared/types";
import type { AppliedSettingChange } from "$lib/client/app-client";
import { store as appStore } from "$store/renderer/store";
import { eventReceived } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import { agentStreamUpdateReceived } from "$store/renderer/slices/workspace-agents/workspace-agents-stream-slice";
import { streamStatusReceived } from "$store/renderer/slices/chat-state/chat-state-slice";
import { replaceAgentQueue } from "$store/renderer/slices/agent-queue/agent-queue-slice";
import { tokenUsageReceived } from "$store/renderer/slices/token-usage/token-usage-slice";
import type { TokenUsage } from "$features/token-usage/token-usage-types";
import { applySettingsChanges } from "$features/settings/settings-hydration-service";
import {
  backendRequest,
  onBackendNotification,
} from "$lib/client/live/backend-transport";
import { emitMockIpcEvent } from "$shared/ipc-mock-router";
import type { WorkspaceEvent } from "$features/events/types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("DaemonEventsBridge");

/**
 * Per-agent in-flight stream accumulator. The BE assigns each block a
 * monotonic `blockIndex` (see `crates/intent-services/src/agent_session.rs`
 * `Transcript`); we mirror that order on the FE so the candidate transcript
 * monotonically grows and never regresses. `toolResultsByUseIndex` holds the
 * synthesized `tool_result` block (the BE pushes one of its own, but only
 * exposes the *use* index on `agent:tool:call`), so it is rendered immediately
 * after its tool_use in `buildContentBlocks`.
 */
interface StreamState {
  messageId: string;
  workspaceId: string;
  blocksByIndex: Map<number, ContentBlock>;
  toolResultsByUseIndex: Map<number, ContentBlock>;
}

const streamsByAgent = new Map<string, StreamState>();
let installed = false;
let cleanup: (() => void) | null = null;
/**
 * The subscriptionId returned by this bridge's own
 * `events.subscribe(['agent:*', 'settings:changed'])` call. The notification
 * handler uses it to drop foreign-subscription fan-out copies (see file header).
 * `undefined` until the subscribe resolves; legacy/flat envelopes carrying no
 * `subscriptionId` are always accepted regardless of this value.
 */
let ownSubscriptionId: string | undefined;

function workspaceIdOf(event: WorkspaceEvent | undefined): string | null {
  if (!event || typeof event !== "object") return null;
  const wsId = (event as { workspaceId?: unknown }).workspaceId;
  if (typeof wsId === "string" && wsId.length > 0) return wsId;
  // PROTOCOL §7 events are workspace-scoped; if a relay strips workspaceId we
  // bail rather than guessing — the reducer will simply not run.
  return null;
}

function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== "object") return null;
  // The daemon wraps each domain event in `{ event, subscriptionId? }` per the
  // notification envelope; older paths may send the event flat as `params`.
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === "object") return wrapped as WorkspaceEvent;
  return params as WorkspaceEvent;
}

/**
 * Read the wire-level `params.subscriptionId` tag the daemon attaches when
 * fanning a domain event out per matching subscription. Returns `undefined`
 * for flat/legacy envelopes that carry no id (those bypass the scope gate).
 */
function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== "object") return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === "string" ? id : undefined;
}

function ensureStream(
  agentId: string,
  messageId: string,
  workspaceId: string,
): StreamState {
  const existing = streamsByAgent.get(agentId);
  if (existing && existing.messageId === messageId) return existing;
  const fresh: StreamState = {
    messageId,
    workspaceId,
    blocksByIndex: new Map(),
    toolResultsByUseIndex: new Map(),
  };
  streamsByAgent.set(agentId, fresh);
  return fresh;
}

function buildContentBlocks(state: StreamState): ContentBlock[] {
  const sortedKeys = [...state.blocksByIndex.keys()].sort((a, b) => a - b);
  const result: ContentBlock[] = [];
  for (const key of sortedKeys) {
    result.push(state.blocksByIndex.get(key)!);
    const toolResult = state.toolResultsByUseIndex.get(key);
    if (toolResult) result.push(toolResult);
  }
  return result;
}

function dispatchStreamUpdate(
  agentId: string,
  state: StreamState,
  eventType: "chunk" | "content-blocks" | "complete" | "error",
): void {
  appStore.dispatch(
    agentStreamUpdateReceived({
      workspaceId: state.workspaceId,
      agentId,
      handlerSessionId: agentId,
      source: "sendMessage",
      eventType,
      assistantMessageId: state.messageId,
      contentBlocks: buildContentBlocks(state),
    }),
  );
}

function handleStreamChunkEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  const blockIndex = data.blockIndex;
  const blockId = data.blockId;
  const blockType = data.blockType;
  const content = data.content;
  if (
    typeof agentId !== "string" ||
    typeof messageId !== "string" ||
    typeof blockIndex !== "number"
  ) {
    return;
  }
  const state = ensureStream(agentId, messageId, workspaceId);

  if (blockType === "text" && typeof content === "string") {
    const prior = state.blocksByIndex.get(blockIndex);
    const priorText =
      prior && prior.type === "text" ? (prior.text ?? prior.content ?? "") : "";
    const next: ContentBlock = {
      type: "text",
      ...(typeof blockId === "string" ? { id: blockId } : {}),
      text: priorText + content,
    };
    state.blocksByIndex.set(blockIndex, next);
  } else if (content && typeof content === "object") {
    state.blocksByIndex.set(blockIndex, content as ContentBlock);
  } else {
    return;
  }

  dispatchStreamUpdate(agentId, state, "chunk");
}

function handleToolCallEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  const blockIndex = data.blockIndex;
  const blockId = data.blockId;
  const toolCallId = data.toolCallId;
  const toolName = data.toolName;
  const toolKind = data.toolKind;
  const status = data.status;
  const input = data.input;
  const output = data.output;
  if (
    typeof agentId !== "string" ||
    typeof messageId !== "string" ||
    typeof blockIndex !== "number" ||
    typeof toolCallId !== "string"
  ) {
    return;
  }
  const state = ensureStream(agentId, messageId, workspaceId);

  const toolUseBlock: ContentBlock = {
    type: "tool_use",
    ...(typeof blockId === "string" ? { id: blockId } : {}),
    name: typeof toolName === "string" ? toolName : "",
    input: (input as Record<string, unknown> | undefined) ?? undefined,
    toolCallId,
    metadata: {
      ...(typeof toolKind === "string" ? { toolKind } : {}),
      ...(typeof status === "string" ? { status } : {}),
    },
  } as ContentBlock;
  state.blocksByIndex.set(blockIndex, toolUseBlock);

  if ((status === "completed" || status === "error") && output !== undefined) {
    state.toolResultsByUseIndex.set(blockIndex, {
      type: "tool_result",
      tool_use_id: toolCallId,
      output: output as ContentBlock["output"],
      is_error: status === "error",
    } as ContentBlock);
  }

  dispatchStreamUpdate(agentId, state, "content-blocks");

  // Status hint: when the tool *starts*, surface "Calling tool" next to the
  // Thinking spinner. `resetFirstChunk: true` re-arms the chunk reducer so the
  // next text chunk after the tool completes appends a fresh "Streaming
  // response…" entry. Mirrors the reference acp-provider-streaming.ts
  // `onStatus('tool-call', 'Calling tool')` behaviour.
  if (status === "started") {
    appStore.dispatch(
      streamStatusReceived(
        agentId,
        {
          phase: "tool-call",
          message: "Calling tool",
          level: "info",
          timestamp: Date.now(),
        },
        true,
      ),
    );
  }
}

function handleStreamEndEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== "string") return;
  const state = streamsByAgent.get(agentId);
  if (!state) return;
  dispatchStreamUpdate(agentId, state, "complete");
  streamsByAgent.delete(agentId);
}

function handleAgentFailedStream(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== "string") return;
  const state = streamsByAgent.get(agentId);
  if (!state) return;
  dispatchStreamUpdate(agentId, state, "error");
  streamsByAgent.delete(agentId);
}

/**
 * `agent:queue:updated` (§5.5 / §6.5) carries the **current** queue snapshot
 * `{ agentId, queue: QueuedMessage[] }` — self-sufficient per the §6.7
 * event-design rule — so the renderer mirrors the BE queue directly without a
 * follow-up `agent.getQueue`. The reducer's recently-removed-id tombstone
 * suppresses messages the user just deleted but the BE has not yet self-drained
 * out of the snapshot, preventing flicker.
 */
function handleQueueUpdatedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const queue = data.queue;
  if (typeof agentId !== "string" || !Array.isArray(queue)) return;
  appStore.dispatch(replaceAgentQueue(agentId, queue as QueuedMessage[]));
}

/**
 * `workspace:tokenUsage-changed` (§5.23 / §6.5) carries the full recomputed
 * `{ workspaceId, tokenUsage }` rollup — self-sufficient per §6.7 — so the
 * renderer mirrors it straight into the tokenUsage slice without a follow-up
 * `workspace.getTokenUsage` read.
 */
function handleTokenUsageChangedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const dataWorkspaceId = data.workspaceId;
  const workspaceId =
    typeof dataWorkspaceId === "string" && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : workspaceIdOf(event);
  const tokenUsage = data.tokenUsage;
  if (!workspaceId || !tokenUsage || typeof tokenUsage !== "object") return;
  appStore.dispatch(tokenUsageReceived(workspaceId, tokenUsage as TokenUsage));
}

/**
 * `settings:changed` (§6.5) carries `{ changes: [{ path, value }] }` — the
 * applied subset of the most recent `settings.update` call (§5.12), with
 * sensitive values pre-redacted by the BE. We hand it straight to the shared
 * `applySettingsChanges` helper so settings panels converge from the SAME
 * routing the boot hydration uses; the helper also emits the typed
 * `settingsChanged` action for any consumer that watches it directly.
 */
function handleSettingsChangedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const raw = (data as { changes?: unknown }).changes;
  if (!Array.isArray(raw)) return;
  const changes: AppliedSettingChange[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== "string" || path.length === 0) continue;
    const value = (entry as { value?: unknown }).value;
    changes.push({ path, value });
  }
  if (changes.length > 0) applySettingsChanges(changes);
}

/**
 * Re-emit daemon events onto the legacy mock-IPC event channels components
 * still `listenSync`/`on` (see file header). Channel names are string
 * literals on purpose: the reconciliation suite statically scans
 * `emitMockIpcEvent` call sites to keep `EMITTED_MOCK_IPC_EVENT_CHANNELS`
 * honest. Payload shapes mirror what the legacy Electron main process sent:
 *
 * - `agent:status-changed` / `agent:idle` → active-streams-tracker refetches
 *   on any delivery (payload unused) — the full event is forwarded.
 * - `task:ready-tasks-changed` → WorkspaceProgressCard reads
 *   `payload.workspaceId` + `payload.data.readyTaskIds`; the daemon event
 *   envelope (§5.4 TS-parity payload) already has exactly that shape.
 * - `changes:git-status` (§5.18) → `git:status-changed { workspaceId }` —
 *   the listener only gates on workspaceId before a debounced reload.
 * - `changes:tracked` (§5.18) → `file-tracking:changes-updated
 *   { workspaceId }` — same debounced-reload gate.
 * - `workspace:updated` → forwarded as `{ workspaceId, changes: data }`.
 * - `pr:linked`/`pr:updated`/`pr:unlinked` (§6.5) → `workspace:updated` with
 *   the PR fields as `changes`, because the legacy emitter surfaced PR
 *   discovery as a workspace update carrying `activePullRequest`/`prNumber`/
 *   `prStatus` — exactly the keys the WorkspaceProgressCard listener checks.
 */
function relayLegacyIpcEvent(type: string, event: WorkspaceEvent, workspaceId: string): void {
  const data = ((event as { data?: Record<string, unknown> }).data ?? {}) as Record<
    string,
    unknown
  >;
  switch (type) {
    case "agent:status-changed":
      emitMockIpcEvent("agent:status-changed", event);
      return;
    case "agent:idle":
      emitMockIpcEvent("agent:idle", event);
      return;
    case "task:ready-tasks-changed":
      emitMockIpcEvent("task:ready-tasks-changed", event);
      return;
    case "changes:git-status":
      emitMockIpcEvent("git:status-changed", { workspaceId });
      return;
    case "changes:tracked":
      emitMockIpcEvent("file-tracking:changes-updated", { workspaceId });
      return;
    case "workspace:updated":
      emitMockIpcEvent("workspace:updated", { workspaceId, changes: data });
      return;
    case "pr:linked":
    case "pr:updated":
    case "pr:unlinked":
      emitMockIpcEvent("workspace:updated", {
        workspaceId,
        changes: {
          activePullRequest: data.activePullRequest ?? null,
          prNumber: data.prNumber ?? null,
          prStatus: data.prStatus ?? null,
        },
      });
      return;
  }
}

function handleNotification(method: string, params: unknown): void {
  if (method !== "events.event") return;
  // Fan-out scope gate (see file header): drop notifications delivered through
  // a different subscription on the same socket so chunk-append/queue/idle
  // handlers never apply the same event twice. Flat/legacy envelopes (no
  // `subscriptionId` on params) are still accepted for back-compat.
  const envelopeSubscriptionId = extractSubscriptionId(params);
  if (
    envelopeSubscriptionId !== undefined &&
    envelopeSubscriptionId !== ownSubscriptionId
  ) {
    return;
  }
  const event = extractEvent(params);
  if (!event || typeof event !== "object") return;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== "string") return;

  // `settings:changed` (§6.5) is global — no `workspaceId` envelope is
  // expected, so it must be routed BEFORE the workspace-id gate below.
  if (type === "settings:changed") {
    handleSettingsChangedEvent(event);
    return;
  }

  // `workspace:tokenUsage-changed` (§5.23) carries its workspaceId inside
  // `data`, so it is routed before the envelope workspace-id gate too.
  if (type === "workspace:tokenUsage-changed") {
    handleTokenUsageChangedEvent(event);
    return;
  }

  const workspaceId = workspaceIdOf(event);
  if (!workspaceId) return;

  // Legacy mock-IPC re-emit (side effect, never an early return) — components
  // still listening on the legacy channels get the daemon event too.
  relayLegacyIpcEvent(type, event, workspaceId);

  // Live stream family — accumulate per-agent and grow the in-flight assistant
  // message. `agent:failed` flows through both paths: it finalizes any
  // in-flight stream AND forwards the lifecycle to `eventReceived` so the
  // session status transitions to "failed".
  if (type === "agent:stream:chunk") {
    handleStreamChunkEvent(event, workspaceId);
    return;
  }
  if (type === "agent:tool:call") {
    handleToolCallEvent(event, workspaceId);
    return;
  }
  if (type === "agent:stream:end") {
    handleStreamEndEvent(event);
    return;
  }
  if (type === "agent:queue:updated") {
    handleQueueUpdatedEvent(event);
    return;
  }
  if (type === "agent:failed") {
    handleAgentFailedStream(event);
    // fall through to the lifecycle dispatch below
  }

  // Storage + fan-out: every workspace-scoped event flows into
  // `workspaceEvents` (activity timeline) and, for the agent-lifecycle subset
  // (`agent:idle`, `agent:failed`, `agent:session-completed`,
  // `agent:status-changed`, `agent:session-updated`, `agent:user-message:sent`,
  // `agent:message`), through the `agentSession` reducer's
  // `canonicalFieldsFromWorkspaceEvent` path wired to the same `eventReceived`
  // action.
  appStore.dispatch(eventReceived(workspaceId, event));
}

async function installSubscriptionOnce(): Promise<void> {
  if (installed) return;
  installed = true;

  const off = onBackendNotification((n) => {
    try {
      handleNotification(n.method, n.params);
    } catch (error) {
      logger.error("daemon-events-bridge notification handler threw", error);
    }
  });

  // Ask the daemon to firehose `agent:*` events, `settings:changed`
  // (§5.12 / §6.5), `workspace:tokenUsage-changed` (§5.23), and the
  // legacy-relay families (`workspace:updated`, `task:ready-tasks-changed`,
  // `changes:git-status`/`changes:tracked` §5.18, `pr:*` §6.5 — see
  // relayLegacyIpcEvent) to this socket. The subscription id is owned by the
  // bridge (no consumer needs it); refetch delta-subscriptions in
  // `live-agents-client` register their own.
  try {
    const result = (await backendRequest("events.subscribe", {
      eventTypes: [
        "agent:*",
        "settings:changed",
        "workspace:tokenUsage-changed",
        "workspace:updated",
        "task:ready-tasks-changed",
        "changes:git-status",
        "changes:tracked",
        "pr:*",
      ],
    })) as { subscriptionId?: string } | undefined;
    if (typeof result?.subscriptionId === "string" && result.subscriptionId.length > 0) {
      ownSubscriptionId = result.subscriptionId;
    } else {
      logger.warn("events.subscribe returned no subscriptionId", result);
    }
  } catch (error) {
    logger.error("events.subscribe (bridge firehose + legacy relay families) failed", error);
  }

  cleanup = () => {
    try {
      off();
    } catch (error) {
      logger.error("backend notification off() threw", error);
    }
  };
}

/**
 * Lazily install the bridge on the first dispatched action so the renderer
 * store is fully constructed before we touch `appClient`/`appStore`. Calling
 * the middleware factory does not perform any I/O.
 */
export function createDaemonEventsBridgeMiddleware(): StoreMiddleware {
  return () => (next) => (action) => {
    if (!installed) void installSubscriptionOnce();
    return next(action);
  };
}

/** Test-only — tear down the singleton subscription and stream accumulators. */
export function __resetDaemonEventsBridgeForTests(): void {
  if (cleanup) cleanup();
  cleanup = null;
  installed = false;
  ownSubscriptionId = undefined;
  streamsByAgent.clear();
}
