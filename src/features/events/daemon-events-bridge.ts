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
 *   3. `chatState/streamStatusReceived` on `agent:tool:call` — surfaces the
 *      "Calling tool" hint next to the Thinking spinner on `status=started`
 *      and appends a follow-up "Awaiting tool response" entry on
 *      `status=completed`/`error`, so `computeCompletedEvents` measures the
 *      tool-call entry from its start to the tool's terminal event instead of
 *      to the next text chunk (a gap that inflates the reported duration when
 *      the model pauses before streaming again). Repeated ticks for the same
 *      `toolCallId` are deduped against the prior recorded status so progress
 *      updates never spam duplicate status entries. The chunk reducer still
 *      auto-emits "Streaming response…" on the first text chunk after the tool
 *      (both dispatches carry `resetFirstChunk: true`), and the
 *      `'complete'` / `'error'` paths clear `statusEvents` on
 *      `agent:stream:end` / `agent:failed`. The `agent:stream:status` wire
 *      event (STAT-1 / PROTOCOL §7) — the pre-first-token turn-startup family
 *      (`launch` / `init` / `session-create` / `session-load` / `prompt` →
 *      "Sent prompt…") — flows through the same dispatch with
 *      `resetFirstChunk: false` so the spinner shows the startup phase until
 *      the first chunk / stream:end / failed clears it.
 *   4. `note:*` (workspace-scoped, §7) → `applyNoteFromEvent` in the
 *      notes-read-service, which dispatches `applyNoteCreated`/
 *      `applyNoteUpdated`/`applyNoteDeleted` on the workspace-notes slice so
 *      agent-side note writes (add_to_note etc.) appear live in the notes
 *      panel while the workspace is open.
 *   5. `task:status-changed` (§6.5) → `applyTaskStatusChanged` on the
 *      workspace-tasks slice so a task ticked complete/in-progress by an agent
 *      or a sibling client updates the tasks pane / progress card without a
 *      workspace reload. The event payload is self-sufficient
 *      (`{ noteId, previousStatus, newStatus, ... }`), so the bridge maps it
 *      directly without a follow-up fetch.
 *   6. `comment:added` / `comment:resolved` (§6.5) → `applyCommentFromEvent` in
 *      the comments-read-service, which refetches the affected note's comments
 *      and reconciles the global comments slice per-comment (add / update /
 *      remove) so other notes' comments stay intact. Wired the same way
 *      `note:*` funnels through the notes-read-service.
 *   7. `pr:linked` / `pr:updated` / `pr:unlinked` (§7.6) → `updateWorkspaceEntity`
 *      on the workspace slice with `{ prNumber, prUrl, prStatus, activePullRequest }`
 *      (or the cleared shape on unlink). This replaces the legacy main→renderer
 *      relay path so the "View PR" pill / progress card refresh live while the
 *      app runs.
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
 * Workspace lifecycle: on `workspace:deleted` (§7) the bridge resolves the
 * agent-id list for the doomed workspace from the agent-session index and
 * dispatches `workspace-lifecycle/workspaceDeleted(wsId, agentIds)`, which
 * purges the agent-session slice, workspace-agents index, and per-agent
 * chat-state entries — preventing a recreated same-slug workspace from
 * surfacing ghost agents. `workspace:created` covers the recycled-ID case:
 * if the created ID still has local agent/chat state (the delete event was
 * missed or never delivered), the bridge purges it the same way and then
 * dispatches `hydrateAgentsRequested` so the store converges on the daemon's
 * canonical agent list for the new workspace.
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
import type {
  ContentBlock,
  PullRequestInfo,
  PullRequestStatus,
  QueuedMessage,
  TaskStatus,
  Workspace,
} from "$shared/types";
import { WorkspaceStatus } from "$shared/types";
import type { AppliedSettingChange } from "$lib/client/app-client";
import { store as appStore } from "$store/renderer/store";
import { eventReceived } from "$store/renderer/slices/workspace-events/workspace-events-slice";
import { agentStreamUpdateReceived } from "$store/renderer/slices/workspace-agents/workspace-agents-stream-slice";
import { streamStatusReceived } from "$store/renderer/slices/chat-state/chat-state-slice";
import { replaceAgentQueue } from "$store/renderer/slices/agent-queue/agent-queue-slice";
import { renameSession } from "$store/renderer/slices/agent-session/agent-session-slice";
import { workspaceDeleted } from "$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice";
import { hydrateAgentsRequested } from "$store/renderer/slices/workspace-agents/workspace-agents-slice";
import { applyTaskStatusChanged } from "$store/renderer/slices/workspace-tasks/workspace-tasks-slice";
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from "$store/renderer/slices/workspace/workspace-slice";
import { applyNoteFromEvent } from "$features/notes/notes-read-service";
import { applyCommentFromEvent } from "$features/comments/comments-read-service";
import { ensureAgentSession } from "$features/agent/agent-read-service";
import { refreshWorkspaceSubscriptionEntries } from "$features/agent/agent-subscription-read-service";
import {
  permissionRequestReceived,
  removePermissionRequest,
  type PermissionRequest,
} from "$store/renderer/slices/permission/permission-slice";
import { tokenUsageReceived } from "$store/renderer/slices/token-usage/token-usage-slice";
import type { TokenUsage } from "$features/token-usage/token-usage-types";
import { applySettingsChanges } from "$features/settings/settings-hydration-service";
import {
  appendScriptOutput,
  updateRuntimeState,
} from "$store/renderer/slices/scripts/scripts-slice";
import type {
  ScriptOutputLine,
  ScriptRuntimeState,
} from "$store/renderer/slices/scripts/scripts-types";
import {
  clearServerErrorMessage,
  setServerErrorMessage,
  setServerStatus,
} from "$store/renderer/slices/mcp-settings/mcp-settings-slice";
import type { McpServerStatus } from "$store/renderer/slices/mcp-settings/mcp-settings-types";
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from "$lib/client/live/backend-transport";
import { loadChatTranscript } from "$features/agent/chat-read-service";
import { emitMockIpcEvent } from "$shared/ipc-mock-router";
import type { WorkspaceEvent } from "$features/events/types";
import { createLogger } from "$lib/utils/client-logger";

const logger = createLogger("DaemonEventsBridge");

/**
 * Agent-lifecycle events that change the daemon's completion-watch registry
 * (AS-2/AS-4) — a child completing/failing/being deleted advances its parent's
 * `after_all` group, and a create can add a new watched child. Each delivery
 * refreshes the agent-subscription-ui entries for the event's workspace.
 */
const SUBSCRIPTION_REFRESH_EVENT_TYPES = new Set([
  "agent:idle",
  "agent:failed",
  "agent:deleted",
  "agent:created",
]);

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

  // Merge subsequent `agent:tool:call` events for the same tool_use block
  // (identified by `blockIndex`, which the daemon holds constant across a
  // toolCallId's lifetime — see `crates/intent-services/agent_session.rs`
  // `record_tool`). The daemon's `map_tool_call_update` (crates/intent-acp)
  // maps a partial ACP `tool_call_update` into `MappedToolCall` by defaulting
  // any unset field (`title` → "", `kind` → "other", `raw_input` → null); on
  // the wire only `status` (and sometimes `output`) is authoritative for a
  // progress-only tick. Mirror the daemon-side `record_tool` merge policy so
  // the tool_use block retains the initial name/input/toolKind and the
  // classifier keeps a rich label instead of collapsing to a generic "Run".
  const prior = state.blocksByIndex.get(blockIndex) as
    | (ContentBlock & { toolCallId?: string })
    | undefined;
  const priorIsSameToolUse =
    prior?.type === "tool_use" && prior.toolCallId === toolCallId;
  // A non-empty `toolName` on the wire signals an authoritative update
  // (the daemon's `map_tool_call_update` only supplies a `title` when the
  // upstream ACP update carries one); an empty string is the mapper's default
  // for a status-only tick, in which case we preserve every non-status field
  // on the prior block. This mirrors the persisted transcript on the daemon
  // side (`record_tool` only patches `metadata.status` on repeats).
  const isProgressOnlyUpdate =
    priorIsSameToolUse && (typeof toolName !== "string" || toolName.length === 0);
  const priorMetadata =
    priorIsSameToolUse && typeof (prior as { metadata?: unknown }).metadata === "object"
      ? ((prior as { metadata?: Record<string, unknown> }).metadata ?? {})
      : {};
  const nextName = isProgressOnlyUpdate
    ? ((prior as { name?: string }).name ?? "")
    : typeof toolName === "string"
      ? toolName
      : "";
  const nextInput = isProgressOnlyUpdate
    ? ((prior as { input?: Record<string, unknown> | undefined }).input ?? undefined)
    : input !== undefined && input !== null
      ? (input as Record<string, unknown>)
      : undefined;
  const nextToolKind = isProgressOnlyUpdate
    ? (priorMetadata as { toolKind?: string }).toolKind
    : typeof toolKind === "string" && toolKind.length > 0
      ? toolKind
      : undefined;

  const toolUseBlock: ContentBlock = {
    type: "tool_use",
    ...(typeof blockId === "string" ? { id: blockId } : {}),
    name: nextName,
    input: nextInput,
    toolCallId,
    metadata: {
      ...(typeof nextToolKind === "string" ? { toolKind: nextToolKind } : {}),
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

  // Status hint: track the actual tool-execution window so the "Calling tool"
  // entry's duration in `computeCompletedEvents` ends at the tool's terminal
  // event rather than at the next text chunk (which can arrive much later if
  // the model pauses before streaming again).
  //
  // - On `status=started` (first time for this toolCallId): append the
  //   "Calling tool" entry and re-arm the chunk reducer so the next text
  //   chunk after the tool completes appends a fresh "Streaming response…"
  //   entry. Mirrors the reference acp-provider-streaming.ts
  //   `onStatus('tool-call', 'Calling tool')` behaviour.
  // - On `status=completed`/`error` (following a `started` for the same tool):
  //   append a follow-up "Awaiting tool response" entry so the "Calling tool"
  //   entry closes at this moment. `resetFirstChunk: true` keeps the streaming
  //   re-arm intact if interleaved text already flipped the flag.
  //
  // Repeated ticks for the same `toolCallId` are deduped against the prior
  // recorded metadata status so progress-only updates (daemon emits one
  // `agent:tool:call` per ACP `tool_call_update`) never spam duplicates.
  const priorStatus = priorIsSameToolUse
    ? ((priorMetadata as { status?: unknown }).status as string | undefined)
    : undefined;
  if (status === "started" && priorStatus !== "started") {
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
  } else if (
    (status === "completed" || status === "error") &&
    priorStatus === "started"
  ) {
    appStore.dispatch(
      streamStatusReceived(
        agentId,
        {
          phase: "tool-waiting",
          message:
            status === "error" ? "Tool call failed" : "Awaiting tool response",
          level: status === "error" ? "error" : "info",
          timestamp: Date.now(),
        },
        true,
      ),
    );
  }
}

/**
 * `agent:stream:status` (PROTOCOL §6.5 / §7 pre-first-token hints) carries the
 * self-sufficient `{ agentId, workspaceId, phase, message, level, timestamp }`
 * payload the daemon emits while a turn is starting (`launch` / `init` /
 * `session-create` / `session-load` / `prompt`). Map it directly to
 * `streamStatusReceived` so the chat spinner surfaces the current phase —
 * "Sent prompt…" and friends — before the first `agent:stream:chunk` arrives.
 *
 * `resetFirstChunk` is `false`: startup hints are cleared by the chunk /
 * stream:end / failed reducer paths (see file header §3), not by the status
 * event itself. Level/phase/message/timestamp round-trip verbatim so the shape
 * matches the reference `StatusEventData` the ported StreamingStatus renders.
 */
function handleStreamStatusEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const phase = data.phase;
  const message = data.message;
  if (
    typeof agentId !== "string" ||
    agentId.length === 0 ||
    typeof phase !== "string" ||
    typeof message !== "string"
  ) {
    return;
  }
  const levelRaw = data.level;
  const level: "info" | "warn" | "error" =
    levelRaw === "warn" || levelRaw === "error" ? levelRaw : "info";
  const timestamp = typeof data.timestamp === "number" ? data.timestamp : Date.now();
  appStore.dispatch(
    streamStatusReceived(
      agentId,
      { phase, message, level, timestamp },
      false,
    ),
  );
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
 * `agent:created` (§5.5 / §6.5) fires after `agent.create` persists a new
 * session — including the mid-session case where `agent.delegate` or any
 * `agent.create` from a running turn spawns a sibling. The payload is lite
 * (`{ agentId, name }`), so the bridge hydrates the sidebar via the
 * transcript-preserving `ensureAgentSession` read-service path (which fetches
 * `agent.get` and dispatches `bulkUpsertSessions` + `upsertSession`), the same
 * mechanism the AgentCard mount effect uses. Without this handler the
 * Delegated agent card only appears after a reload.
 */
function handleAgentCreatedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) return;
  void ensureAgentSession(agentId);
}

/**
 * `agent:renamed` (§5.5 / §6.5) carries `{ agentId, name }` — the daemon's
 * `agent.rename` emits it after persisting the new name. Dispatching
 * `renameSession` mutates only the session's `name` field so the sidebar entry
 * updates without touching the transcript.
 */
function handleAgentRenamedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const name = data.name;
  if (typeof agentId !== "string" || agentId.length === 0) return;
  if (typeof name !== "string") return;
  appStore.dispatch(renameSession(agentId, name));
}

/**
 * `agent:updated` (§5.5 / §6.5) is emitted after non-name session-metadata
 * mutations (`agent.setModel`, `agent.reportToParent`, …). Payload shapes vary
 * per mutation (`{ agentId, modelId }`, `{ agentId, completionReportLength }`,
 * …), so instead of decoding each variant the bridge re-fetches the
 * projection via `ensureAgentSession` — which preserves the local transcript
 * on a metadata-only refresh (see FE 69f8c74c) so re-hydration cannot clobber
 * messages the live stream already appended.
 */
function handleAgentUpdatedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  if (typeof agentId !== "string" || agentId.length === 0) return;
  void ensureAgentSession(agentId);
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
/**
 * `agent:permission:request` (PROTOCOL §8) carries the normalized
 * `PermissionRequestData` -- `{ requestId, sessionId, title, description?,
 * options[], agentName?, riskLevel?, timestamp }` -- exactly the shape the
 * `PermissionRequest` slice type declares. Coerce the wire payload into the
 * slice type and dispatch `permissionRequestReceived` so the inline chat
 * prompt renders. The BE is the source of truth for `requestId` (used by
 * `agent.respondPermission` to route the answer back).
 */
function handlePermissionRequestEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const requestId = data.requestId;
  const sessionId = data.sessionId;
  const title = data.title;
  if (
    typeof requestId !== "string" ||
    requestId.length === 0 ||
    typeof sessionId !== "string" ||
    sessionId.length === 0 ||
    typeof title !== "string"
  ) {
    return;
  }
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options: PermissionRequest["options"] = [];
  for (const raw of rawOptions) {
    if (!raw || typeof raw !== "object") continue;
    const id = (raw as { id?: unknown }).id;
    const label = (raw as { label?: unknown }).label;
    if (typeof id !== "string" || typeof label !== "string") continue;
    const description = (raw as { description?: unknown }).description;
    const destructive = (raw as { destructive?: unknown }).destructive;
    options.push({
      id,
      label,
      ...(typeof description === "string" ? { description } : {}),
      ...(typeof destructive === "boolean" ? { destructive } : {}),
    });
  }
  const description = data.description;
  const agentName = data.agentName;
  const riskLevelRaw = data.riskLevel;
  const timestamp = data.timestamp;
  const request: PermissionRequest = {
    requestId,
    sessionId,
    title,
    description:
      typeof description === "string" || description === null ? description : undefined,
    options,
    ...(typeof agentName === "string" ? { agentName } : {}),
    ...(riskLevelRaw === "low" || riskLevelRaw === "medium" || riskLevelRaw === "high"
      ? { riskLevel: riskLevelRaw }
      : {}),
    timestamp: typeof timestamp === "number" ? timestamp : Date.now(),
  };
  appStore.dispatch(permissionRequestReceived(request));
}

/**
 * `agent:permission:resolved` (PROTOCOL §8) carries `{ requestId, outcome }`
 * once the BE has forwarded the chosen outcome to the blocked provider (either
 * because a client answered via `agent.respondPermission` or because the
 * 5-minute timeout elapsed and cancelled the prompt). Clear the local entry so
 * the inline prompt disappears; a reducer no-op is safe if the FE already
 * removed it optimistically.
 */
function handlePermissionResolvedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const requestId = data.requestId;
  if (typeof requestId !== "string" || requestId.length === 0) return;
  appStore.dispatch(removePermissionRequest(requestId));
}

/**
 * `note:*` (§7 workspace-scoped) carries `{ noteId, path, action, ... }` — the
 * daemon-authoritative "something changed" ping (PROTOCOL §7 note events do
 * NOT embed the full note body). The handler routes to `applyNoteFromEvent`,
 * which fetches the fresh note via `notes.list(workspaceId)` on
 * `note:created`/`note:updated` and dispatches the matching `applyNote*`
 * action, or dispatches `applyNoteDeleted` immediately on `note:deleted`.
 */
function handleNoteEvent(
  event: WorkspaceEvent,
  workspaceId: string,
  type: "note:created" | "note:updated" | "note:deleted",
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const noteId = data?.noteId;
  if (typeof noteId !== "string" || noteId.length === 0) return;
  applyNoteFromEvent(workspaceId, noteId, type);
}

/**
 * `task:status-changed` (§6.5) carries the self-sufficient payload
 * `{ noteId, noteTitle, previousStatus, newStatus, changedAt }` — the daemon
 * mints the FE-canonical status word (`not_started` | `in_progress` |
 * `complete` | ...) via `status_word` in `intent-services`, so no mapping is
 * needed. The workspace-tasks reducer's own guard makes this a no-op if the
 * workspace is not initialized or the task/status is unknown/unchanged.
 */
function handleTaskStatusChangedEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const noteId = data.noteId;
  const newStatus = data.newStatus;
  if (typeof noteId !== "string" || typeof newStatus !== "string") return;
  appStore.dispatch(applyTaskStatusChanged(workspaceId, noteId, newStatus as TaskStatus));
}

/**
 * `comment:added` (§6.5, `{ noteId, commentId }`) and `comment:resolved`
 * (`{ noteId, threadId, resolved }`) are wire pings — the payload only carries
 * identifiers, so the actual comment/thread is refetched via
 * `applyCommentFromEvent`. That helper diffs the affected note's fresh comment
 * list against the global slice and dispatches per-comment
 * add/update/remove actions so other notes' comments stay untouched.
 */
function handleCommentEvent(
  event: WorkspaceEvent,
  workspaceId: string,
  kind: "added" | "resolved",
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const noteId = data?.noteId;
  if (typeof noteId !== "string" || noteId.length === 0) return;
  applyCommentFromEvent(workspaceId, noteId, kind);
}

/**
 * `pr:linked` (§7.6) carries `{ workspaceId, prNumber, prUrl, prStatus,
 * activePullRequest }`; `pr:updated` carries the same shape minus `prUrl`; and
 * `pr:unlinked` carries only `{ workspaceId }`. All three converge into a
 * single `updateWorkspaceEntity` dispatch so the sidebar PR pill / progress
 * card refresh live without waiting for the workspace list to refetch. This
 * replaces the legacy `relayLegacyIpcEvent` `workspace:updated` re-emit for
 * PR events — Redux is now the single source of truth for PR pill state.
 */
function handlePrEvent(
  event: WorkspaceEvent,
  workspaceId: string,
  type: "pr:linked" | "pr:updated" | "pr:unlinked",
): void {
  const data = (event as { data?: Record<string, unknown> }).data ?? {};
  const changes: Partial<Workspace> =
    type === "pr:unlinked"
      ? ({
          prNumber: undefined,
          prUrl: undefined,
          prStatus: undefined,
          activePullRequest: null,
        } as Partial<Workspace>)
      : {};
  if (type !== "pr:unlinked") {
    if (typeof data.prNumber === "number") changes.prNumber = data.prNumber;
    if (typeof data.prUrl === "string") changes.prUrl = data.prUrl;
    if (typeof data.prStatus === "string") changes.prStatus = data.prStatus as PullRequestStatus;
    if (data.activePullRequest !== undefined) {
      changes.activePullRequest = data.activePullRequest as PullRequestInfo | null;
    }
    if (Object.keys(changes).length === 0) return;
  }
  // `updateWorkspaceEntity` has no standalone reducer case — the workspace
  // slice folds it through `bulkUpdateWorkspaceEntities`, which is the shared
  // path for partial merges (see workspace-slice `.with(bulkUpdateWorkspaceEntities, ...)`).
  appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
}

/**
 * `workspace:updated` (PROTOCOL §6.5 / §7) carries `{ workspaceId, changes }`
 * where `changes` is the applied `WorkspaceUpdate` delta — the fields the
 * caller actually asked to mutate, with `Option::is_none` fields skipped in
 * serialization (see `crates/intent-core/src/model.rs::WorkspaceUpdate` and
 * `crates/intentd/tests/uds_events.rs::workspace_update_emits_workspace_updated_with_delta`).
 * Reference-parity with `watchWorkspaceUpdatedSaga` in the legacy
 * `workspace-ipc-saga.ts`: dispatch a merge onto the workspace entity so the
 * sidebar/header react synchronously (agent `workspace.setTitle` was the
 * regression that motivated this — the legacy relay fires
 * `WorkspaceProgressCard`'s `listenSync`, but never touched Redux).
 *
 * The wire delta is whitelisted against the applied-delta shape rather than
 * blind-spread, so unknown fields (e.g. `attention`, which has no FE
 * `Workspace` field) are dropped rather than leaking into the entity. Field
 * names match FE `Workspace` camelCase 1:1 with the daemon struct.
 *
 * The legacy `relayLegacyIpcEvent` re-emit (case `"workspace:updated"`) stays
 * untouched — `WorkspaceProgressCard` still listens on the mock-IPC channel.
 */
function handleWorkspaceUpdatedEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data ?? {};
  const wireChanges = (data as { changes?: unknown }).changes;
  if (!wireChanges || typeof wireChanges !== "object") return;
  const raw = wireChanges as Record<string, unknown>;
  const changes: Partial<Workspace> = {};
  if (typeof raw.title === "string") changes.title = raw.title;
  if (typeof raw.statusMessage === "string") changes.statusMessage = raw.statusMessage;
  if (typeof raw.branch === "string") changes.branch = raw.branch;
  if (typeof raw.baseRef === "string") changes.baseRef = raw.baseRef;
  if (typeof raw.baseCommitSha === "string") changes.baseCommitSha = raw.baseCommitSha;
  if (
    typeof raw.status === "string" &&
    (Object.values(WorkspaceStatus) as string[]).includes(raw.status)
  ) {
    changes.status = raw.status as WorkspaceStatus;
  }
  if (Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === "string")) {
    changes.tags = raw.tags as string[];
  }
  if (typeof raw.path === "string") changes.path = raw.path;
  if (typeof raw.repositoryPath === "string") changes.repositoryPath = raw.repositoryPath;
  if (typeof raw.repositoryOwner === "string") changes.repositoryOwner = raw.repositoryOwner;
  if (typeof raw.repositoryName === "string") changes.repositoryName = raw.repositoryName;
  if (typeof raw.worktreePath === "string") changes.worktreePath = raw.worktreePath;
  if (typeof raw.scope === "string") changes.scope = raw.scope;
  if (typeof raw.skipWorktree === "boolean") changes.skipWorktree = raw.skipWorktree;
  if (typeof raw.setupScript === "string") changes.setupScript = raw.setupScript;
  if (typeof raw.isRemote === "boolean") changes.isRemote = raw.isRemote;
  if (typeof raw.defaultModel === "string") changes.defaultModel = raw.defaultModel;
  if (typeof raw.prNumber === "number") changes.prNumber = raw.prNumber;
  if (typeof raw.prUrl === "string") changes.prUrl = raw.prUrl;
  if (typeof raw.lastActivity === "string") changes.lastActivity = raw.lastActivity;
  if (typeof raw.archived === "boolean") changes.archived = raw.archived;
  if (Object.keys(changes).length === 0) return;
  // Same reducer path as `handlePrEvent` — `updateWorkspaceEntity` has no
  // standalone case; the slice folds it through `bulkUpdateWorkspaceEntities`.
  appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
}

/**
 * `workspace:deleted` (PROTOCOL §7) — purge every trace of the deleted
 * workspace from Redux so a recreated same-slug workspace does not surface
 * ghost agents. The chat-state slice is keyed by `agentId`, so we resolve the
 * agent-id list from the agent-session workspace index *before* dispatching
 * and pass it in the payload.
 */
function handleWorkspaceDeletedEvent(workspaceId: string): void {
  const state = appStore.state as {
    agentSessions?: { agentIdsByWorkspace: Record<string, string[]> };
  };
  const agentIds = state.agentSessions?.agentIdsByWorkspace[workspaceId] ?? [];
  appStore.dispatch(workspaceDeleted(workspaceId, [...agentIds]));
}

/**
 * `workspace:created` (PROTOCOL §7) — recycled-ID guard. A create may reuse
 * the ID of a previously deleted workspace; if the store still carries
 * agent/chat state under that ID (e.g. the `workspace:deleted` event was
 * missed), purge it exactly like a delete would, then dispatch
 * `hydrateAgentsRequested` so the lifecycle-read-service refetches the
 * daemon's canonical agent list for the new workspace. A create for an ID
 * with no local state is a no-op here (mount-time hydration covers it).
 */
function handleWorkspaceCreatedEvent(workspaceId: string): void {
  const state = appStore.state as {
    agentSessions?: { agentIdsByWorkspace: Record<string, string[]> };
    workspaceAgents?: { byWorkspaceId: Record<string, unknown> };
  };
  const agentIds = state.agentSessions?.agentIdsByWorkspace[workspaceId] ?? [];
  const hasLocalState =
    agentIds.length > 0 || state.workspaceAgents?.byWorkspaceId[workspaceId] !== undefined;
  if (!hasLocalState) return;
  appStore.dispatch(workspaceDeleted(workspaceId, [...agentIds]));
  appStore.dispatch(hydrateAgentsRequested(workspaceId));
}

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
 * Decode a base64 `chunk` (PROTOCOL §6.5 `script:output` payload) into a
 * UTF-8 string. Runs in the renderer, so `atob` is available; the two-step
 * conversion via `Uint8Array` preserves multibyte characters that a naive
 * `atob(...).split('')` would corrupt.
 */
function decodeBase64Chunk(chunk: string): string | null {
  try {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    return new TextDecoder("utf-8").decode(bytes);
  } catch {
    return null;
  }
}

/**
 * `script:output` (§6.5) carries `{ scriptId, chunk }` where `chunk` is the
 * base64 of raw PTY bytes. Split on `\r?\n` into `ScriptOutputLine[]` and
 * feed the scripts slice's `appendScriptOutput`; the trailing empty string
 * from a chunk that ends on a newline is dropped so the reference viewer's
 * `.join('\n')` reconstruction stays lossless. Streams are collapsed to
 * `stdout` because the daemon PTY is a single unified stream (§5.8).
 */
function handleScriptOutputEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const scriptId = data.scriptId;
  const chunk = data.chunk;
  if (typeof scriptId !== "string" || typeof chunk !== "string") return;
  const text = decodeBase64Chunk(chunk);
  if (text === null) return;
  const parts = text.split(/\r?\n/);
  const timestamp = new Date().toISOString();
  const lines: ScriptOutputLine[] = [];
  for (let i = 0; i < parts.length; i++) {
    if (i === parts.length - 1 && parts[i] === "") continue;
    lines.push({ text: parts[i], stream: "stdout", timestamp });
  }
  if (lines.length === 0) return;
  appStore.dispatch(appendScriptOutput(workspaceId, scriptId, lines));
}

/**
 * `script:state` (§6.5) carries the recomputed `ScriptRuntimeState` plus a
 * `scriptId` — self-sufficient per §6.7 — so the renderer mirrors it into
 * the scripts slice via `updateRuntimeState` without a follow-up
 * `script.status` read. The reducer no-ops if the script hasn't been
 * hydrated yet by `initializeScripts` (matches the reference saga).
 */
function handleScriptStateEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const { scriptId, ...rest } = data as { scriptId?: unknown } & Record<string, unknown>;
  if (typeof scriptId !== "string") return;
  appStore.dispatch(
    updateRuntimeState(workspaceId, scriptId, rest as Partial<ScriptRuntimeState>),
  );
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
 * - `line-attribution:updated` (§5.2.1 / §6.5) → forwarded as
 *   `{ workspaceId, noteId, attributions }` so the tiptap
 *   `LineAttributionGutter.svelte` `listenSync('line-attribution:updated')`
 *   reload path fires without touching the daemon transport directly.
 * - `workspace:updated` → forwarded as `{ workspaceId, changes: data }`.
 *
 * `pr:linked`/`pr:updated`/`pr:unlinked` (§7.6) are no longer relayed here —
 * they are dispatched directly to the workspace slice via `handlePrEvent` in
 * `handleNotification`, replacing the legacy `workspace:updated` re-emit.
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
    case "line-attribution:updated":
      emitMockIpcEvent("line-attribution:updated", {
        workspaceId,
        noteId: data.noteId,
        attributions: data.attributions,
      });
      return;
    case "workspace:updated":
      emitMockIpcEvent("workspace:updated", { workspaceId, changes: data });
      return;
  }
}


/**
 * `mcp.servers:status-changed` (§6.5) — self-sufficient payload
 * `{ serverId, status: McpServerStatus }` where `status.state` is one of
 * `"stopped" | "starting" | "running" | "error"` (PROTOCOL §5.22). No
 * `workspaceId` envelope: the MCP-servers surface is global, so this handler
 * runs before the workspace-id gate in `handleNotification`. Resolve the
 * daemon-assigned `serverId` back to a server `name` via the current
 * `mcpSettings.servers` list (`fromWireMcpConfig` carries `id` through), then
 * dispatch `setServerStatus` plus `setServerErrorMessage` /
 * `clearServerErrorMessage` keyed by name — the slice keys everything by name.
 */
function mapDaemonMcpState(state: unknown): McpServerStatus | null {
  switch (state) {
    case "running":
      return "connected";
    case "starting":
      return "configured";
    case "stopped":
      return "stopped";
    case "error":
      return "error";
    default:
      return null;
  }
}

function handleMcpServerStatusChangedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const serverId = data.serverId;
  const status = data.status as { state?: unknown; lastError?: unknown } | undefined;
  if (typeof serverId !== "string" || !serverId || !status || typeof status !== "object") {
    return;
  }
  const mapped = mapDaemonMcpState(status.state);
  if (mapped === null) return;

  // Resolve serverId → name via the local server list. When the FE has not
  // yet loaded `mcp.servers.list` (e.g. the settings panel was never opened)
  // or when the daemon emits for an id the FE never mirrored, drop the
  // update — the next `refreshMcpServers` will pick up the current state.
  const servers = appStore.state.mcpSettings.servers;
  const match = servers.find((s) => s.id === serverId);
  if (!match) return;

  appStore.dispatch(setServerStatus(match.name, mapped));
  const lastError = status.lastError;
  if (mapped === "error" && typeof lastError === "string" && lastError.length > 0) {
    appStore.dispatch(setServerErrorMessage(match.name, lastError));
  } else {
    appStore.dispatch(clearServerErrorMessage(match.name));
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

  // `mcp.servers:status-changed` (§6.5) is global — no `workspaceId` envelope
  // — so it must also run before the workspace-id gate below.
  if (type === "mcp.servers:status-changed") {
    handleMcpServerStatusChangedEvent(event);
    return;
  }

  const workspaceId = workspaceIdOf(event);
  if (!workspaceId) return;

  // Workspace lifecycle: purge every Redux trace of the deleted workspace so a
  // recreated same-slug workspace does not surface ghost agents (§7).
  if (type === "workspace:deleted") {
    handleWorkspaceDeletedEvent(workspaceId);
    return;
  }
  if (type === "workspace:created") {
    handleWorkspaceCreatedEvent(workspaceId);
    // fall through so the activity timeline records the creation.
  }
  // `workspace:updated` (§6.5) — merge the applied delta onto the workspace
  // entity so agent-driven `workspace.setTitle` / `workspace.update` writes
  // reflect in the sidebar/header live. Side effect, never an early return:
  // `relayLegacyIpcEvent` below still fans out to the mock-IPC channel that
  // `WorkspaceProgressCard` listens on, and the timeline dispatch below still
  // records the update.
  if (type === "workspace:updated") {
    handleWorkspaceUpdatedEvent(event, workspaceId);
  }

  // Legacy mock-IPC re-emit (side effect, never an early return) — components
  // still listening on the legacy channels get the daemon event too.
  relayLegacyIpcEvent(type, event, workspaceId);

  // Completion-watch lifecycle subset (side effect, never an early return):
  // these events feed the daemon's AS-3/AS-4 fan-in, so refresh every tracked
  // agent-subscription-ui entry via `agent.getSubscriptions` — completion
  // counts tick live while a coordinator waits on `waitMode: after_all`.
  if (SUBSCRIPTION_REFRESH_EVENT_TYPES.has(type)) {
    refreshWorkspaceSubscriptionEntries(workspaceId);
  }

  // Note domain events (§7 workspace-scoped) live-apply to the
  // workspace-notes slice so agent-side note writes (add_to_note etc.) show
  // up in the notes panel without a manual refresh.
  if (type === "note:created" || type === "note:updated" || type === "note:deleted") {
    handleNoteEvent(event, workspaceId, type);
    return;
  }

  // Task/comment/PR domain events converge into their owning slices so the
  // task pane, inline comment thread, and workspace PR pill refresh without a
  // reload.
  if (type === "task:status-changed") {
    handleTaskStatusChangedEvent(event, workspaceId);
    return;
  }
  if (type === "comment:added") {
    handleCommentEvent(event, workspaceId, "added");
    return;
  }
  if (type === "comment:resolved") {
    handleCommentEvent(event, workspaceId, "resolved");
    return;
  }
  if (type === "pr:linked" || type === "pr:updated" || type === "pr:unlinked") {
    handlePrEvent(event, workspaceId, type);
    return;
  }

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
  if (type === "agent:stream:status") {
    handleStreamStatusEvent(event);
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
  if (type === "agent:permission:request") {
    handlePermissionRequestEvent(event);
    // fall through to the storage dispatch below so the activity timeline
    // records the prompt alongside the slice update.
  }
  if (type === "agent:permission:resolved") {
    handlePermissionResolvedEvent(event);
    // fall through to the storage dispatch below so the activity timeline
    // records the outcome.
  }
  // Script output/state (§6.5) — script:output feeds the live buffer the
  // `ScriptOutputViewer` xterm reads from, script:state mirrors the
  // recomputed `ScriptRuntimeState` into the scripts slice. Both fall
  // through to the storage dispatch below so the activity timeline still
  // records that they happened.
  if (type === "script:output") {
    handleScriptOutputEvent(event, workspaceId);
    // Chunks are noise for the activity timeline (one per PTY read); skip
    // the storage dispatch so we do not fill the 100-event cap with them.
    return;
  }
  if (type === "script:state") {
    handleScriptStateEvent(event, workspaceId);
    // fall through to the lifecycle dispatch below
  }
  if (type === "agent:failed") {
    handleAgentFailedStream(event);
    // fall through to the lifecycle dispatch below
  }
  // Session-mutation lifecycle (§5.5): keep the sidebar/agents index in sync
  // as new agents are created and existing ones renamed/updated mid-session.
  // Each handler falls through so `eventReceived` still records the event in
  // the activity timeline.
  if (type === "agent:created") {
    handleAgentCreatedEvent(event);
  }
  if (type === "agent:renamed") {
    handleAgentRenamedEvent(event);
  }
  if (type === "agent:updated") {
    handleAgentUpdatedEvent(event);
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

/**
 * Event types the bridge firehose subscribes to. Kept as a module constant so
 * the initial install and the post-reconnect replay use the same filter list
 * (RESUB-1) — a divergence here would silently drop event families after a
 * daemon restart.
 */
const BRIDGE_SUBSCRIBE_EVENT_TYPES = [
  "agent:*",
  "file:*",
  "note:*",
  "comment:*",
  "script:*",
  "settings:changed",
  "workspace:tokenUsage-changed",
  "workspace:updated",
  "workspace:created",
  "workspace:deleted",
  // Daemon filter is exact-match unless the pattern ends in `:*`; a bare
  // `task:ready-tasks-changed` therefore silently drops `task:status-changed`
  // and every other task family the bridge's reducers act on. Use the
  // wildcard so any future `task:*` event added on the BE reaches the FE
  // without another subscribe change.
  "task:*",
  // Taxonomy parity with the reference `WorkspaceEventType` — the daemon
  // emits `git:commit` / `git:pull` (and future `git:*` events) as workspace
  // activity, and the bridge's activity-timeline reducer already handles
  // them; without a matching subscribe filter the daemon never routes them.
  "git:*",
  "changes:git-status",
  "changes:tracked",
  "line-attribution:updated",
  "pr:*",
  "mcp.servers:status-changed",
] as const;

/**
 * Issue the firehose `events.subscribe` and stash the resulting id on
 * `ownSubscriptionId` for the notification-scope gate. Shared by the one-shot
 * install and the post-reconnect replay so both go through the same code path.
 */
async function subscribeFirehose(): Promise<void> {
  try {
    const result = (await backendRequest("events.subscribe", {
      eventTypes: [...BRIDGE_SUBSCRIBE_EVENT_TYPES],
    })) as { subscriptionId?: string } | undefined;
    if (typeof result?.subscriptionId === "string" && result.subscriptionId.length > 0) {
      ownSubscriptionId = result.subscriptionId;
    } else {
      logger.warn("events.subscribe returned no subscriptionId", result);
    }
  } catch (error) {
    logger.error("events.subscribe (bridge firehose + legacy relay families) failed", error);
  }
}

/**
 * After the daemon restarts and the socket reconnects, its in-memory
 * subscription registry is empty and the old `ownSubscriptionId` refers to
 * nothing. Replay the firehose subscribe (obtaining a fresh id), then refresh
 * coarse state so anything missed during the outage converges: re-hydrate the
 * active workspace's agent list and the open chat conversation via the
 * existing read-service paths (LEAK-1: both reads pin to the workspace/agent
 * that are active AT DISPATCH TIME — a subsequent switch is handled by the
 * read-service's own workspace guards).
 */
async function replayAfterReconnect(): Promise<void> {
  // Drop the stale id first: the notification-scope gate accepts flat/legacy
  // envelopes (no id) and matches on our own id — leaving the old id in place
  // during the resubscribe window would let a foreign subscription's
  // notifications leak through if they happened to share the old id.
  ownSubscriptionId = undefined;
  await subscribeFirehose();

  // LEAK-1: capture the active workspace/agent at completion time; the
  // read-services themselves coalesce concurrent loads per key so a workspace
  // switch racing this replay does not double-hydrate.
  const state = appStore.state as {
    workspace?: { activeWorkspaceId?: string | null };
    workspaceAgents?: {
      byWorkspaceId: Record<string, { activeAgentId?: string | null }>;
    };
  };
  const activeWorkspaceId = state.workspace?.activeWorkspaceId ?? null;
  if (activeWorkspaceId) {
    appStore.dispatch(hydrateAgentsRequested(activeWorkspaceId));
    const activeAgentId =
      state.workspaceAgents?.byWorkspaceId[activeWorkspaceId]?.activeAgentId ?? null;
    if (activeAgentId) {
      void loadChatTranscript(activeAgentId);
    }
  }
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
  // (§5.12 / §6.5), `workspace:tokenUsage-changed` (§5.23), the
  // activity-timeline families (`file:*`, `note:*`, `comment:*`, `script:*`
  // — §6.5) that populate `selectWorkspaceEvents`, and the legacy-relay
  // families (`workspace:updated`, `task:ready-tasks-changed`,
  // `changes:git-status`/`changes:tracked` §5.18, `line-attribution:updated`
  // §5.2.1 / §6.5, `pr:*` §6.5 — see relayLegacyIpcEvent) to this socket.
  // The subscription id is owned by the bridge (no consumer needs it);
  // refetch delta-subscriptions in `live-agents-client` register their own.
  await subscribeFirehose();

  // Daemon restart replay: the in-memory subscription registry is dropped on
  // restart, so a straight `notification` re-registration is not enough — we
  // must re-issue the subscribe AND converge coarse state (RESUB-1).
  const offReconnect = onBackendReconnected(() => {
    void replayAfterReconnect();
  });

  cleanup = () => {
    try {
      off();
    } catch (error) {
      logger.error("backend notification off() threw", error);
    }
    try {
      offReconnect();
    } catch (error) {
      logger.error("backend reconnect off() threw", error);
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
