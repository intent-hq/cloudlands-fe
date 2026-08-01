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
 *   2. Content-free chat-state stream bookkeeping for the live stream subset
 *      (`agent:stream:activity`, `agent:tool:call`, `agent:stream:end`,
 *      `agent:failed`). The TRANSCRIPT itself is owned by the standing
 *      `chat.subscribe` delta stream (PROTOCOL §7.1, chat-subscribe-service)
 *      — the bridge no longer assembles messages or content blocks from
 *      these events. The dispatches (`streamActivityReceived` / `streamEnded`
 *      / `streamFailed`) carry NO content and exist purely for the chat-state
 *      reducer's spinner/timer bookkeeping (`lastChunkTime`,
 *      `receivedFirstChunk`, `statusEvents` clears, the #965 interrupted
 *      retry-record clear) and the agent-session busy-flag clears.
 *      `agent:stream:activity` and the terminal `agent:stream:end`
 *      additionally carry the server-derived live-preview fields
 *      (`lastAgentResponse`/`digest`, intentd#792) that the bridge applies
 *      to the agent-session slice push-style — see
 *      `handleStreamActivityEvent`.
 *      `agent:stream:start` (§6.6, agent-initiated harness-wake turns only)
 *      dispatches `chatSendStarted` so the busy/Thinking UI opens without a
 *      user send — see `handleStreamStartEvent`.
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
 *      panel while the workspace is open. The same events also trigger a
 *      debounced `loadWorkspaceTasksRequested` refetch (initialized
 *      workspaces only) — task notes are plain notes, so a created/deleted
 *      task note changes the BE-owned `task.list` stats rollup without a
 *      `task:status-changed` edge.
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
 * The stream family carries NO transcript state: per-agent bookkeeping is
 * limited to the tool-status dedup map (status-hint dedup across repeated
 * `agent:tool:call` ticks) and the wake-turn dedup map, both cleaned up on
 * `agent:stream:end` / `agent:failed` so a subsequent turn starts from a
 * clean slate.
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
 * surfacing ghost agents. It also calls `navigateAwayIfViewing` so a
 * workspace deleted by another client while on screen closes its tab and
 * routes away — this is the PRIMARY navigate-away path: the `events.event`
 * firehose fires in both live and legacy modes, whereas the workspace-list
 * snapshot diff is suppressed post-boot under live-state
 * (intent-hq/monorepo#775). `workspace:created` covers the recycled-ID case:
 * if the created ID still has local agent/chat state (the delete event was
 * missed or never delivered), the bridge purges it the same way and then
 * dispatches `hydrateAgentsRequested` so the store converges on the daemon's
 * canonical agent list for the new workspace.
 *
 * Fan-out scoping: the daemon emits one `events.event` notification per
 * matching subscription on the socket (PROTOCOL §6.3 / intent-transport
 * `build_event_notification`), each tagged with `params.subscriptionId`. If any
 * other consumer on the same socket subscribes to an overlapping `agent:*`
 * type, the same event would be delivered once per subscription and every
 * per-delivery side effect (status-hint appends, refetches, relays) would run
 * N times. The handler therefore gates on the envelope's `subscriptionId`:
 * notifications carrying a foreign id are dropped, and legacy/flat envelopes
 * (no id) are still accepted for back-compat. This mirrors the same fan-out
 * dedupe `live-terminals-client.ts` applies to `terminal:*` deliveries.
 */
import { m } from '$shared/paraglide/messages.js';
import type { StoreMiddleware } from '$lib/store-shim/types';
import type {
  PullRequestInfo,
  PullRequestStatus,
  QueuedMessage,
  TaskStatus,
  Workspace,
} from '$shared/types';
import { WorkspaceStatus, isWorkspaceDisplayStatus } from '$shared/types';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { store as appStore } from '$store/renderer/store';
import { eventReceived } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import {
  streamStatusReceived,
  streamActivityReceived,
  streamEnded,
  streamFailed,
  chatQueueProcessingReceived,
  chatErrorCleared,
  chatModelUnavailableCleared,
  chatSendFailed,
  chatSendStarted,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import {
  renameSession,
  setProcessQueueHint,
  clearProcessQueueHint,
  updateSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import { hydrateAgentsRequested } from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import {
  applyTaskStatusChanged,
  loadWorkspaceTasksRequested,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
import {
  bulkUpdateWorkspaceEntities,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import { navigateAwayIfViewing } from '$features/workspace/navigate-away-if-viewing';
import { applyNoteFromEvent } from '$features/notes/notes-read-service';
import { applyCommentFromEvent } from '$features/comments/comments-read-service';
import { ensureAgentSession } from '$features/agent/agent-read-service';
import { hasLiveChatSubscription } from '$features/agent/chat-subscribe-service';
import { recordAgentFailure, removeAgentFailure } from '$features/agent/agent-failure-registry';
import { showAgentAttentionToast } from '$features/agent/agent-attention-toast-service';
import { refreshWorkspaceSubscriptionEntries } from '$features/agent/agent-subscription-read-service';
import {
  permissionRequestReceived,
  removePermissionRequest,
  type PermissionRequest,
} from '$store/renderer/slices/permission/permission-slice';
import { tokenUsageReceived } from '$store/renderer/slices/token-usage/token-usage-slice';
import type { TokenUsage } from '$features/token-usage/token-usage-types';
import { hydrateContextItems } from '$store/renderer/slices/context/context-slice';
import type { ContextItem } from '$features/context/types';
import {
  applyTaskAgentLinked,
  applyTaskAgentUnlinked,
} from '$store/renderer/slices/task-agent-associations/task-agent-associations-slice';
import type { TaskAgentAssociation } from '$store/renderer/slices/task-agent-associations/task-agent-associations-types';
import { applySettingsChanges } from '$features/settings/settings-hydration-service';
import {
  appendScriptOutput,
  updateRuntimeState,
} from '$store/renderer/slices/scripts/scripts-slice';
import type { ScriptRuntimeState } from '$store/renderer/slices/scripts/scripts-types';
import {
  clearServerErrorMessage,
  setServerErrorMessage,
  setServerStatus,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import type { McpServerStatus } from '$store/renderer/slices/mcp-settings/mcp-settings-types';
import { githubAuthChanged } from '$store/renderer/slices/github-auth/github-auth-slice';
import {
  backendRequest,
  onBackendNotification,
  onBackendReconnected,
} from '$lib/client/live/backend-transport';
import { loadChatTranscript } from '$features/agent/chat-read-service';
import { emitMockIpcEvent } from '$shared/ipc-mock-router';
import type { WorkspaceEvent } from '$features/events/types';
import { createLogger } from '$lib/utils/client-logger';
import { requestUiHighlight } from '$store/renderer/slices/ui-highlight/ui-highlight-slice';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';
import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';

const logger = createLogger('DaemonEventsBridge');

/**
 * Agent-lifecycle events that change the daemon's completion-watch registry
 * (AS-2/AS-4) — a child completing/failing/being deleted advances its parent's
 * `after_all` group, and a create can add a new watched child. Each delivery
 * refreshes the agent-subscription-ui entries for the event's workspace.
 */
const SUBSCRIPTION_REFRESH_EVENT_TYPES = new Set([
  'agent:idle',
  'agent:failed',
  'agent:deleted',
  'agent:created',
  'agent:subscriptions-changed',
]);

/**
 * Per-agent status-hint dedup: `toolCallId` → last recorded `agent:tool:call`
 * status. The daemon emits one `agent:tool:call` per ACP `tool_call_update`
 * (progress ticks included), so `handleToolCallEvent` records each tool's last
 * status here and only appends a status entry on a real transition
 * (`started` first seen / `started` → `completed`/`error`). Cleared per agent
 * on `agent:stream:end` / `agent:failed` so a subsequent turn starts fresh.
 */
const toolStatusByAgent = new Map<string, Map<string, string>>();

/**
 * Per-agent wake-turn dedup: the last `agent:stream:start` messageId handled.
 * A duplicate delivery for the same messageId (at-least-once, e.g. across a
 * reconnect) must not re-dispatch `chatSendStarted` mid-turn — that would wipe
 * `statusEvents`/`receivedFirstChunk` and restart the Thinking elapsed timer.
 */
const wakeTurnMessageIdByAgent = new Map<string, string>();
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

/**
 * Debounce timers for changes-slice refresh per workspace. `changes:tracked`
 * can fire very frequently during agent activity (matching the note in
 * WorkspaceProgressCard.svelte line ~213), so we debounce ~1s per workspace to
 * avoid redundant refreshRequested dispatches.
 */
const changesRefreshTimersByWorkspace = new Map<string, ReturnType<typeof setTimeout>>();
const CHANGES_REFRESH_DEBOUNCE_MS = 1000;

/**
 * Debounce timers for workspace-tasks refetch per workspace. Agents write
 * notes in bursts (spec edits, task-block conversion), so `note:*` events are
 * debounced ~1s per workspace before refetching `task.list` — mirroring the
 * changes-refresh pattern above.
 */
const tasksRefreshTimersByWorkspace = new Map<string, ReturnType<typeof setTimeout>>();
const TASKS_REFRESH_DEBOUNCE_MS = 1000;

function workspaceIdOf(event: WorkspaceEvent | undefined): string | null {
  if (!event || typeof event !== 'object') return null;
  const wsId = (event as { workspaceId?: unknown }).workspaceId;
  if (typeof wsId === 'string' && wsId.length > 0) return wsId;
  // PROTOCOL §7 events are workspace-scoped; if a relay strips workspaceId we
  // bail rather than guessing — the reducer will simply not run.
  return null;
}

function extractEvent(params: unknown): WorkspaceEvent | null {
  if (!params || typeof params !== 'object') return null;
  // The daemon wraps each domain event in `{ event, subscriptionId? }` per the
  // notification envelope; older paths may send the event flat as `params`.
  const wrapped = (params as { event?: unknown }).event;
  if (wrapped && typeof wrapped === 'object') return wrapped as WorkspaceEvent;
  return params as WorkspaceEvent;
}

/**
 * Read the wire-level `params.subscriptionId` tag the daemon attaches when
 * fanning a domain event out per matching subscription. Returns `undefined`
 * for flat/legacy envelopes that carry no id (those bypass the scope gate).
 */
function extractSubscriptionId(params: unknown): string | undefined {
  if (!params || typeof params !== 'object') return undefined;
  const id = (params as { subscriptionId?: unknown }).subscriptionId;
  return typeof id === 'string' ? id : undefined;
}

/**
 * Push-apply the server-derived live-preview fields carried on
 * `agent:stream:activity` / terminal `agent:stream:end` (intentd#792) into
 * the agent-session slice — no RPC, no client-side debounce (the daemon
 * already throttles the activity signal to 1s leading-edge). The `updateSession`
 * reducer is a no-op for unknown agents, so this never conjures a session.
 * Empty/whitespace values are dropped (the daemon omits fields until
 * derivable; an empty string would only arise from a contract regression).
 * The viewed agent's standing `chat.subscribe` buffer stays the authoritative
 * character-level preview — AgentCard prefers it over these fields when live.
 */
function applyStreamPreviewFields(
  agentId: string,
  lastAgentResponse: string | undefined,
  digest: string | undefined,
): void {
  const updates: { lastAgentResponse?: string; digest?: string } = {};
  if (typeof lastAgentResponse === 'string' && lastAgentResponse.trim()) {
    updates.lastAgentResponse = lastAgentResponse;
  }
  if (typeof digest === 'string' && digest.trim()) {
    updates.digest = digest;
  }
  if (Object.keys(updates).length === 0) return;
  appStore.dispatch(updateSession(agentId, updates));
}

/**
 * `agent:stream:activity` (PROTOCOL §7) is the content-free liveness ping —
 * no raw transcript content, leading-edge throttled per agent (first ping of
 * a turn immediate, then ≤1/s until the turn ends). The standing
 * `chat.subscribe` delta stream (PROTOCOL §7.1) is the transcript writer.
 * Two jobs remain: chat-state bookkeeping (the `receivedFirstChunk` flip
 * that auto-appends the "Streaming response…" status entry once response
 * text exists, plus the stall-detection timestamps) and the push-applied
 * live-preview fields (`lastAgentResponse`/`digest`, intentd#792) so a
 * non-viewed watched agent's footer preview advances mid-turn without a
 * fetch. The preview fields are omitted until derivable (pre-first-token) —
 * an omission means "no text yet this turn", so the ping only refreshes
 * timestamps. The wire guard mirrors the §7 payload (`agentId`/`messageId`)
 * so malformed events stay inert.
 */
function handleStreamActivityEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  if (typeof agentId !== 'string' || typeof messageId !== 'string') {
    return;
  }
  const lastAgentResponse =
    typeof data.lastAgentResponse === 'string' ? data.lastAgentResponse : undefined;
  const digest = typeof data.digest === 'string' ? data.digest : undefined;
  // Meaningful `lastAgentResponse` text means the turn has streamed response
  // text — the signal for the "Streaming response…" flip; a pre-text ping
  // only refreshes timestamps. The predicate mirrors the empty/whitespace
  // drop in `applyStreamPreviewFields` so the bookkeeping never advances
  // into the text-streaming path without a preview actually applying.
  const hasResponseText = lastAgentResponse !== undefined && lastAgentResponse.trim().length > 0;
  appStore.dispatch(streamActivityReceived(agentId, hasResponseText));
  applyStreamPreviewFields(agentId, lastAgentResponse, digest);
}

/**
 * `agent:tool:call` no longer feeds transcript assembly (the §7.1 delta
 * stream synthesizes the tool_use/tool_result/attachment blocks). The event's
 * remaining jobs are the status hints next to the Thinking spinner and the
 * stall-detection timestamp refresh. The wire guard keeps the §7 payload
 * shape (`agentId`/`messageId`/`blockIndex`/`toolCallId`) so a contract
 * regression is rejected rather than silently absorbed.
 */
function handleToolCallEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  const blockIndex = data.blockIndex;
  const toolCallId = data.toolCallId;
  const status = data.status;
  if (
    typeof agentId !== 'string' ||
    typeof messageId !== 'string' ||
    typeof blockIndex !== 'number' ||
    typeof toolCallId !== 'string'
  ) {
    return;
  }

  appStore.dispatch(streamActivityReceived(agentId, false));

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
  // recorded status (`toolStatusByAgent`) so progress-only updates (daemon
  // emits one `agent:tool:call` per ACP `tool_call_update`) never spam
  // duplicates.
  const agentToolStatuses = toolStatusByAgent.get(agentId) ?? new Map<string, string>();
  toolStatusByAgent.set(agentId, agentToolStatuses);
  const priorStatus = agentToolStatuses.get(toolCallId);
  if (typeof status === 'string') {
    agentToolStatuses.set(toolCallId, status);
  }
  if (status === 'started' && priorStatus !== 'started') {
    appStore.dispatch(
      streamStatusReceived(
        agentId,
        {
          phase: 'tool-call',
          message: m.events_bridge_callingTool_status(),
          level: 'info',
          timestamp: Date.now(),
        },
        true,
      ),
    );
  } else if ((status === 'completed' || status === 'error') && priorStatus === 'started') {
    appStore.dispatch(
      streamStatusReceived(
        agentId,
        {
          phase: 'tool-waiting',
          message:
            status === 'error'
              ? m.events_bridge_toolCallFailed_status()
              : m.events_bridge_awaitingToolResponse_status(),
          level: status === 'error' ? 'error' : 'info',
          timestamp: Date.now(),
        },
        true,
      ),
    );
  }
}

/**
 * Localized messages for the daemon's turn-startup phases (PROTOCOL §6.5:
 * `launch` / `init` / `session-create` / `session-load` / `prompt`). The wire
 * `message` is English prose authored daemon-side; the FE renders a catalog
 * string keyed off the machine-readable `phase` instead so the thinking
 * indicator localizes. Unknown phases fall back to the wire `message`.
 */
const STREAM_STATUS_PHASE_MESSAGES: Record<string, () => string> = {
  launch: () => m.events_bridge_phaseLaunch_status(),
  init: () => m.events_bridge_phaseInit_status(),
  'session-create': () => m.events_bridge_phaseSessionCreate_status(),
  'session-load': () => m.events_bridge_phaseSessionLoad_status(),
  prompt: () => m.events_bridge_phasePrompt_status(),
};

/**
 * `agent:stream:status` (PROTOCOL §6.5 / §7 pre-first-token hints) carries the
 * self-sufficient `{ agentId, workspaceId, phase, message, level, timestamp }`
 * payload the daemon emits while a turn is starting (`launch` / `init` /
 * `session-create` / `session-load` / `prompt`). Map it to
 * `streamStatusReceived` so the chat spinner surfaces the current phase —
 * "Sent prompt…" and friends — before the first `agent:stream:activity`
 * arrives.
 *
 * The rendered message is a localized catalog string keyed off `phase`; the
 * daemon's English `message` is only used as a fallback for unknown phases,
 * and for non-info `launch` events, which carry daemon-authored dynamic text
 * (the model-switch restart warning, §6.5 / intentd#647) that a static
 * localized label would drop. Known limitation: the repeated info-level
 * `launch`-phase Unsloth server-progress updates (§6.5) collapse to the
 * static localized launch message. Level/phase/timestamp round-trip verbatim.
 *
 * `resetFirstChunk` is `false`: startup hints are cleared by the chunk /
 * stream:end / failed reducer paths (see file header §3), not by the status
 * event itself.
 */
function handleStreamStatusEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const phase = data.phase;
  if (typeof agentId !== 'string' || agentId.length === 0 || typeof phase !== 'string') {
    return;
  }
  const message = typeof data.message === 'string' ? data.message : '';
  const levelRaw = data.level;
  const level: 'info' | 'warn' | 'error' =
    levelRaw === 'warn' || levelRaw === 'error' ? levelRaw : 'info';
  const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
  // Own-key lookup: a hostile/unknown wire phase like "constructor" must not
  // resolve inherited Object.prototype members.
  const phaseMessage = Object.hasOwn(STREAM_STATUS_PHASE_MESSAGES, phase)
    ? STREAM_STATUS_PHASE_MESSAGES[phase]
    : undefined;
  const keepWireMessage = phase === 'launch' && level !== 'info' && message.length > 0;
  const localizedMessage = !keepWireMessage && phaseMessage ? phaseMessage() : message;
  if (localizedMessage.length === 0) return;
  appStore.dispatch(
    streamStatusReceived(agentId, { phase, message: localizedMessage, level, timestamp }, false),
  );
}

/**
 * `agent:stream:start` (PROTOCOL §6.6 / §7) announces an implicit
 * agent-initiated turn: `{ agentId, messageId, reason: "harness-wake" }`.
 * Prompt (user-initiated) turns never emit this event — for those,
 * `chatSendStarted` is dispatched by the send path itself. A wake turn has no
 * send, so the bridge dispatches it here to open the same streaming UI
 * (Thinking indicator, busy state, active Stop/interrupt via the
 * `isStreaming`/`isProcessing` session flags) WITHOUT an optimistic user
 * message row — `chatSendStarted` only flips flags; the user row is added by
 * the lifecycle send path, which never runs for a wake turn. The wake turn's
 * transcript itself (assistant message + blocks) arrives via the standing
 * `chat.subscribe` delta stream (§7.1) — the bridge creates no placeholder.
 *
 * A duplicate delivery for the same `messageId` (at-least-once, e.g. across a
 * reconnect) is a no-op: re-dispatching `chatSendStarted` mid-turn would wipe
 * `statusEvents`/`receivedFirstChunk` and restart the Thinking elapsed timer.
 * `agent:stream:end` + `agent:idle` clear the flags through the existing
 * paths.
 */
function handleStreamStartEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const messageId = data.messageId;
  if (
    typeof agentId !== 'string' ||
    agentId.length === 0 ||
    typeof messageId !== 'string' ||
    messageId.length === 0
  ) {
    return;
  }
  if (wakeTurnMessageIdByAgent.get(agentId) === messageId) return;
  wakeTurnMessageIdByAgent.set(agentId, messageId);
  appStore.dispatch(chatSendStarted(agentId, workspaceId));
}

/**
 * `agent:stream:end` no longer feeds transcript assembly: the streamed
 * blocks, the §7 `trailingBlocks` (Agent Q&A), and the interrupted-turn
 * metadata (`stopReason: "interrupted"` → the Stopped indicator) all arrive
 * through the standing `chat.subscribe` delta stream (§7.1), which delivers
 * the persisted final message. What remains is the non-transcript
 * bookkeeping: `streamEnded` drives the chat-state reducer
 * (`statusEvents`/timer clears, the #965 interrupted retry-record clear) and
 * the agent-session busy-flag clears, and the per-agent dedup maps are
 * dropped so the next turn starts fresh. Transcript-bearing terminal emits
 * also carry the final `lastAgentResponse`/`digest` preview values
 * (intentd#792) — pushed into the session so a preview tracked via the
 * throttled activity signal lands on the turn's true final state.
 */
function handleStreamEndEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== 'string') return;
  // Optional interrupt marker (PROTOCOL §7): `agent.stop` mid-turn emits the
  // terminal `agent:stream:end` with `stopReason: "interrupted"`; absence
  // means a normal turn end. Forwarded for the reducer's #965 inline clear.
  const stopReason = typeof data?.stopReason === 'string' ? data.stopReason : undefined;
  toolStatusByAgent.delete(agentId);
  wakeTurnMessageIdByAgent.delete(agentId);
  appStore.dispatch(streamEnded(agentId, stopReason));
  applyStreamPreviewFields(
    agentId,
    typeof data?.lastAgentResponse === 'string' ? data.lastAgentResponse : undefined,
    typeof data?.digest === 'string' ? data.digest : undefined,
  );
}

function handleAgentFailedStream(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  const error = data?.error;
  if (typeof agentId !== 'string') return;

  toolStatusByAgent.delete(agentId);
  wakeTurnMessageIdByAgent.delete(agentId);

  // Content-free failure bookkeeping: the chat-state reducer clears
  // statusEvents/streamingStartTime and supplies the default interrupted
  // message when the event carries no explicit error; the agent-session
  // reducer clears the session busy flags.
  appStore.dispatch(streamFailed(agentId));

  // Set chat error when agent:failed arrives so the StreamingStatus component
  // displays the failure message and Retry button. Dispatch this even when no
  // stream state exists (e.g., agent spawn failed before streaming started).
  // The failure also lands in the cross-workspace aggregation registry so the
  // grouped-failure toast layer can surface it — UNLESS the payload carries a
  // non-empty `parentAgentId` (PROTOCOL §6.5): a delegated agent's failure is
  // the parent's to handle and escalate, so no failure toast. Gate strictly on
  // the payload field (no local session lookups); absent → toast shows, which
  // keeps older daemons working. The daemon's turn-correlation id (PROTOCOL
  // §6.6) rides along when present so the failure can be attributed to the
  // exact turn (monorepo#1057).
  if (typeof error === 'string' && error.length > 0) {
    const turnId = typeof data?.turnId === 'string' ? data.turnId : undefined;
    const parentAgentId = data?.parentAgentId;
    const hasParent = typeof parentAgentId === 'string' && parentAgentId.length > 0;
    if (!hasParent) {
      recordAgentFailure({ agentId, workspaceId, error });
    }
    appStore.dispatch(chatSendFailed(agentId, error, turnId));
  }
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
  if (typeof agentId !== 'string' || agentId.length === 0) return;
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
  if (typeof agentId !== 'string' || agentId.length === 0) return;
  if (typeof name !== 'string') return;
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
  if (typeof agentId !== 'string' || agentId.length === 0) return;
  void ensureAgentSession(agentId);
}

/**
 * `agent:queue:updated` (§5.5 / §6.5) carries the **current** queue snapshot
 * `{ agentId, queue: QueuedMessage[] }` — self-sufficient per the §6.7
 * event-design rule — so the renderer mirrors the BE queue directly without a
 * follow-up `agent.getQueue`. The reducer's recently-removed-id tombstone
 * suppresses messages the user just deleted but the BE has not yet self-drained
 * out of the snapshot, preventing flicker. The chat-state reducer also syncs
 * still-present entries' daemon-authoritative content into their parked retry
 * records (#1011); retry-record promotion rides `agent:queue:processing`
 * instead (monorepo#1057).
 */
function handleQueueUpdatedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const queue = data.queue;
  if (typeof agentId !== 'string' || !Array.isArray(queue)) return;
  appStore.dispatch(replaceAgentQueue(agentId, queue as QueuedMessage[]));
}

/**
 * `agent:queue:processing` (§6.5) carries `{ agentId, messageId, content,
 * turnId? }` — the drain-start signal emitted right after `agent:queue:updated`
 * when the daemon dequeues an entry to run its turn. It covers
 * `persisted: true` redrives that skip the user-row `agent:message` echo, so
 * it is the exact promotion signal for retry records (monorepo#1057). The
 * reducer matches on `turnId` alone, but `messageId` stays part of the
 * malformed-payload gate so a contract regression is rejected rather than
 * silently no-oping. `turnId` should always be present on the pinned daemon
 * (legacy pre-#1022 rows are backfilled on rehydration); the reducer no-ops
 * defensively when it is not.
 */
function handleQueueProcessingEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  if (typeof agentId !== 'string' || typeof data.messageId !== 'string') return;
  const turnId = typeof data.turnId === 'string' ? data.turnId : undefined;
  appStore.dispatch(chatQueueProcessingReceived(agentId, turnId));
}

/**
 * `agent:process:queued` (§6.5) carries `{ agentId, used, cap }` — emitted when
 * an agent spawn is queued waiting for a free process slot (maxConcurrent limit).
 * The payload is self-sufficient per §6.7, so the renderer sets the hint directly
 * without a follow-up read.
 *
 * The Redux reducer's updateSessionFields is a no-op when the session doesn't
 * exist yet, but during normal operation the agent:created or agent:updated
 * event will have already hydrated the session before agent:process:queued
 * arrives. If the event arrives during reconnect before the session is in Redux,
 * the hint will be silently dropped (acceptable — the hint is transient UI state
 * and will resolve once the agent resumes).
 */
function handleProcessQueuedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const used = data.used;
  const cap = data.cap;
  if (typeof agentId !== 'string' || typeof used !== 'number' || typeof cap !== 'number') {
    return;
  }
  appStore.dispatch(setProcessQueueHint(agentId, used, cap));
}

/**
 * `agent:process:resumed` (§6.5) carries `{ agentId, used, cap }` — emitted when
 * a queued agent spawn resumes (a slot freed). The renderer clears the hint so
 * the UI no longer shows the waiting message.
 */
function handleProcessResumedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  if (typeof agentId !== 'string') return;
  appStore.dispatch(clearProcessQueueHint(agentId));
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
    typeof dataWorkspaceId === 'string' && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : workspaceIdOf(event);
  const tokenUsage = data.tokenUsage;
  if (!workspaceId || !tokenUsage || typeof tokenUsage !== 'object') return;
  appStore.dispatch(tokenUsageReceived(workspaceId, tokenUsage as TokenUsage));
}

/**
 * `workspace:context-changed` (§5.1 / §6.5) carries the full recomputed
 * `{ workspaceId, items: ContextItem[] }` — self-sufficient per §6.7 — so the
 * renderer mirrors it straight into the context slice via `hydrateContextItems`
 * without a follow-up `workspace.getContext` read.
 */
function handleContextChangedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const dataWorkspaceId = data.workspaceId;
  const workspaceId =
    typeof dataWorkspaceId === 'string' && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : workspaceIdOf(event);
  const items = data.items;
  if (!workspaceId || !Array.isArray(items)) return;
  // The context slice keys items by `id` and discriminates variants by `type`,
  // so filter out rows that lack either — they would silently corrupt the
  // Collection. Provider-specific fields still round-trip verbatim per §5.1.
  const filtered = items.filter((item): item is ContextItem => {
    if (!item || typeof item !== 'object') return false;
    const record = item as { id?: unknown; type?: unknown };
    return (
      typeof record.id === 'string' &&
      record.id.length > 0 &&
      typeof record.type === 'string' &&
      record.type.length > 0
    );
  });
  appStore.dispatch(hydrateContextItems(workspaceId, filtered));
}

/**
 * `task:agent-linked` (§5.4 / §6.5) carries the self-sufficient
 * `{ workspaceId, noteId, taskKey, link: TaskAgentLink }` payload. We
 * normalize the wire row into the renderer `TaskAgentAssociation` and
 * dispatch the daemon-authoritative `applyTaskAgentLinked` action, which the
 * mutation middleware ignores (avoiding an echo back to `task.linkAgent`).
 */
function handleTaskAgentLinkedEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const noteId = data.noteId;
  const link = data.link;
  if (typeof noteId !== 'string' || !link || typeof link !== 'object') return;
  const raw = link as Record<string, unknown>;
  const taskKey = raw.taskKey;
  const taskText = raw.taskText;
  const agentId = raw.agentId;
  const createdAt = raw.createdAt;
  if (
    typeof taskKey !== 'string' ||
    typeof taskText !== 'string' ||
    typeof agentId !== 'string' ||
    typeof createdAt !== 'number'
  ) {
    return;
  }
  const association: TaskAgentAssociation = {
    noteId,
    taskKey,
    taskText,
    agentId,
    createdAt,
  };
  appStore.dispatch(applyTaskAgentLinked(workspaceId, noteId, association));
}

/**
 * `task:agent-unlinked` (§5.4 / §6.5) carries `{ workspaceId, noteId, taskKey }`.
 * Dispatched as `applyTaskAgentUnlinked` so the mutation middleware does not
 * echo the removal back to `task.unlinkAgent`.
 */
function handleTaskAgentUnlinkedEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const noteId = data.noteId;
  const taskKey = data.taskKey;
  if (typeof noteId !== 'string' || typeof taskKey !== 'string') return;
  appStore.dispatch(applyTaskAgentUnlinked(workspaceId, noteId, taskKey));
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
    typeof requestId !== 'string' ||
    requestId.length === 0 ||
    typeof sessionId !== 'string' ||
    sessionId.length === 0 ||
    typeof title !== 'string'
  ) {
    return;
  }
  const rawOptions = Array.isArray(data.options) ? data.options : [];
  const options: PermissionRequest['options'] = [];
  for (const raw of rawOptions) {
    if (!raw || typeof raw !== 'object') continue;
    const id = (raw as { id?: unknown }).id;
    const label = (raw as { label?: unknown }).label;
    if (typeof id !== 'string' || typeof label !== 'string') continue;
    const description = (raw as { description?: unknown }).description;
    const destructive = (raw as { destructive?: unknown }).destructive;
    options.push({
      id,
      label,
      ...(typeof description === 'string' ? { description } : {}),
      ...(typeof destructive === 'boolean' ? { destructive } : {}),
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
    description: typeof description === 'string' || description === null ? description : undefined,
    options,
    ...(typeof agentName === 'string' ? { agentName } : {}),
    ...(riskLevelRaw === 'low' || riskLevelRaw === 'medium' || riskLevelRaw === 'high'
      ? { riskLevel: riskLevelRaw }
      : {}),
    timestamp: typeof timestamp === 'number' ? timestamp : Date.now(),
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
  if (typeof requestId !== 'string' || requestId.length === 0) return;
  appStore.dispatch(removePermissionRequest(requestId));
}

/**
 * `agent:attention-requested` (§6.5) carries the self-sufficient payload
 * `{ workspaceId, agentId, agentName, kind, reason }` — an agent raised a
 * discussion request or blocker report via `ws.agent.requestDiscussion` /
 * `reportBlocker`. Route it to the attention-toast service, which shows a
 * STICKY kind-flavored toast with a "Switch To" action that navigates to the
 * reporting workspace and focuses that agent's conversation. Deliberately NOT
 * gated on the focused workspace: the bridge firehose spans every workspace,
 * so attention requests surface no matter what is on screen.
 *
 * IS gated on the payload's optional `parentAgentId` (PROTOCOL §6.5): a
 * delegated agent's attention request wakes its parent, which handles it and
 * escalates to the user itself if needed — so no sticky toast. The gate reads
 * strictly the payload field (no local session lookups); absent → toast shows,
 * which keeps older daemons working. The caller still falls through to the
 * activity-timeline dispatch and the session refetch either way.
 */
function handleAttentionRequestedEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  const agentName = data.agentName;
  const kind = data.kind;
  const reason = data.reason;
  if (
    typeof agentId !== 'string' ||
    agentId.length === 0 ||
    typeof agentName !== 'string' ||
    (kind !== 'discussion' && kind !== 'blocker') ||
    typeof reason !== 'string' ||
    reason.length === 0
  ) {
    logger.warn('agent:attention-requested with malformed payload', { data });
    return;
  }
  const parentAgentId = data.parentAgentId;
  if (typeof parentAgentId === 'string' && parentAgentId.length > 0) {
    return;
  }
  // Prefer the payload's own workspaceId (self-sufficient per the contract),
  // falling back to the envelope's workspace scope.
  const targetWorkspaceId =
    typeof data.workspaceId === 'string' && data.workspaceId.length > 0
      ? data.workspaceId
      : workspaceId;
  // Prefer the payload's own timestamp, falling back to the event envelope's.
  // An empty/whitespace payload timestamp is treated as missing so the
  // envelope timestamp can still be used instead of dropping it.
  const rawTimestamp =
    typeof data.timestamp === 'string' && data.timestamp.trim().length > 0
      ? data.timestamp
      : event.timestamp;
  const timestamp =
    typeof rawTimestamp === 'string' && rawTimestamp.trim().length > 0 ? rawTimestamp : undefined;
  void showAgentAttentionToast({
    workspaceId: targetWorkspaceId,
    agentId,
    agentName,
    kind,
    reason,
    timestamp,
  });
}

/**
 * `note:*` (§7 workspace-scoped) carries `{ noteId, path, action, ... }` — the
 * daemon-authoritative "something changed" ping (PROTOCOL §7 note events do
 * NOT embed the full note body). The handler routes to `applyNoteFromEvent`,
 * which fetches the fresh note via `notes.list(workspaceId)` on
 * `note:created`/`note:updated` and dispatches the matching `applyNote*`
 * action, or dispatches `applyNoteDeleted` immediately on `note:deleted`.
 *
 * Task notes are plain notes (task state lives in note metadata), so these
 * events can also change the BE-owned `task.list` stats rollup without any
 * `task:status-changed` edge — e.g. a NEW task note appended to a workspace
 * whose stats showed `completed === total` left the sidebar stuck on
 * "Complete". Trigger a debounced workspace-tasks refetch as well.
 */
function handleNoteEvent(
  event: WorkspaceEvent,
  workspaceId: string,
  type: 'note:created' | 'note:updated' | 'note:deleted',
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const noteId = data?.noteId;
  if (typeof noteId !== 'string' || noteId.length === 0) return;
  applyNoteFromEvent(workspaceId, noteId, type);
  debouncedWorkspaceTasksRefresh(workspaceId);
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
  if (typeof noteId !== 'string' || typeof newStatus !== 'string') return;
  appStore.dispatch(applyTaskStatusChanged(workspaceId, noteId, newStatus as TaskStatus));
  // STAB-8: Force refetch task list (including BE-owned stats) so sidebar updates live
  appStore.dispatch(loadWorkspaceTasksRequested(workspaceId));
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
  kind: 'added' | 'resolved',
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const noteId = data?.noteId;
  if (typeof noteId !== 'string' || noteId.length === 0) return;
  applyCommentFromEvent(workspaceId, noteId, kind);
}

/**
 * `pr:linked` (§7.6) carries `{ workspaceId, prNumber, prUrl, prStatus,
 * activePullRequest, pullRequests }`; `pr:updated` carries the same shape
 * minus `prUrl`; and `pr:unlinked` carries only `{ workspaceId }`. All three
 * converge into a single `updateWorkspaceEntity` dispatch so the sidebar PR
 * pill / PR list / progress card refresh live without waiting for the
 * workspace list to refetch. `pullRequests` is the daemon-owned per-branch PR
 * list (§6.5) folded verbatim; `pr:unlinked` does not touch it — the daemon
 * owns the array and retains merged/closed history across unlinks. This
 * replaces the legacy `relayLegacyIpcEvent` `workspace:updated` re-emit for
 * PR events — Redux is now the single source of truth for PR pill state.
 */
function handlePrEvent(
  event: WorkspaceEvent,
  workspaceId: string,
  type: 'pr:linked' | 'pr:updated' | 'pr:unlinked',
): void {
  const data = (event as { data?: Record<string, unknown> }).data ?? {};
  const changes: Partial<Workspace> =
    type === 'pr:unlinked'
      ? ({
          prNumber: undefined,
          prUrl: undefined,
          prStatus: undefined,
          activePullRequest: null,
        } as Partial<Workspace>)
      : {};
  if (type !== 'pr:unlinked') {
    if (typeof data.prNumber === 'number') changes.prNumber = data.prNumber;
    if (typeof data.prUrl === 'string') changes.prUrl = data.prUrl;
    if (typeof data.prStatus === 'string') changes.prStatus = data.prStatus as PullRequestStatus;
    if (data.activePullRequest !== undefined) {
      changes.activePullRequest = data.activePullRequest as PullRequestInfo | null;
    }
    if (Array.isArray(data.pullRequests)) {
      changes.pullRequests = data.pullRequests as PullRequestInfo[];
    }
    if (Object.keys(changes).length === 0) return;
  }
  // `updateWorkspaceEntity` has no standalone reducer case — the workspace
  // slice folds it through `bulkUpdateWorkspaceEntities`, which is the shared
  // path for partial merges (see workspace-slice `.with(bulkUpdateWorkspaceEntities, ...)`).
  appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, changes)]));
}

/**
 * `workspace:activity-changed` (PROTOCOL §6.5 / §10.1) carries the
 * self-sufficient payload `{ workspaceId, activity }` — the daemon emits this
 * only on the `Idle ↔ AgentRunning` edge (count `0 ↔ 1` transitions), so the
 * FE mirrors the new value directly into the workspace entity without a
 * follow-up `workspace.get`. The wire value matches the FE type exactly
 * (`"idle" | "agent_running"`), so no mapping is needed.
 */
function handleActivityChangedEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const activity = data.activity;
  if (activity !== 'idle' && activity !== 'agent_running') return;
  appStore.dispatch(
    bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { activity })]),
  );
}

/**
 * `workspace:displayStatus-changed` (intent-hq/intentd#600) carries the
 * self-sufficient transition payload `{ workspaceId, displayStatus }` — the
 * daemon emits it only when its BE-owned current-cycle rollup changes, so the
 * FE mirrors the new value directly into the workspace entity without a
 * follow-up `workspace.get`. The wire values are snake_case and match the FE
 * type exactly, so no mapping is needed. Like the tokenUsage/context handlers,
 * the payload's own `data.workspaceId` wins over the envelope id when present.
 */
function handleDisplayStatusChangedEvent(event: WorkspaceEvent, envelopeWorkspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const dataWorkspaceId = data.workspaceId;
  const workspaceId =
    typeof dataWorkspaceId === 'string' && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : envelopeWorkspaceId;
  const displayStatus = data.displayStatus;
  if (!isWorkspaceDisplayStatus(displayStatus)) return;
  appStore.dispatch(
    bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { displayStatus })]),
  );
}

/**
 * Reconcile workspace.activity when a missed edge is detected. The daemon only
 * emits `workspace:activity-changed` on the 0↔1 edge; for coordinator-only
 * workspaces that edge can fire before the FE bridge subscribed or before the
 * workspace entity exists, leaving it stuck at `idle` even while the
 * coordinator is mid-turn. When we observe busy-implying agent events
 * (`agent:status-changed` with isResponding/isStreaming, `agent:stream:*`)
 * and the cached entity's activity is not `agent_running`, refetch
 * `workspace.get` and merge the fresh activity value. On `agent:idle` we
 * always refetch — the daemon knows if other agents remain busy.
 */
async function reconcileWorkspaceActivity(
  workspaceId: string,
  impliesBusy: boolean,
): Promise<void> {
  const { getItem } = await import('$lib/store-shim/utils/collections/collection-utils');
  const state = appStore.state as { workspace: { workspaces: unknown } };
  const current = getItem(state.workspace.workspaces as never, workspaceId as never) as
    | { activity?: 'idle' | 'agent_running' }
    | undefined;

  // If the entity doesn't exist yet, or if we see a busy signal and activity
  // isn't already agent_running, or if we see an idle signal (always refetch
  // on idle — the daemon's live count is authoritative), fetch workspace.get
  // and merge the fresh activity.
  if (!current || (impliesBusy && current.activity !== 'agent_running') || !impliesBusy) {
    const { backendRequest } = await import('$lib/client/live/backend-transport');
    try {
      const response = (await backendRequest('workspace.get', { workspaceId })) as
        | { workspace?: Workspace }
        | undefined;
      const workspace = response?.workspace;
      if (!workspace) return;

      const fetchedActivity = workspace.activity;
      if (fetchedActivity !== 'idle' && fetchedActivity !== 'agent_running') return;
      // Type narrowing: fetchedActivity is now 'idle' | 'agent_running'
      const activity: 'idle' | 'agent_running' = fetchedActivity;

      // If the entity already exists, use bulkUpdateWorkspaceEntities for a
      // partial merge. Otherwise, seed the full workspace entity with
      // setWorkspaceEntity so future events can merge into it.
      if (current) {
        appStore.dispatch(
          bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { activity })]),
        );
      } else {
        const { setWorkspaceEntity } =
          await import('$store/renderer/slices/workspace/workspace-slice');
        appStore.dispatch(setWorkspaceEntity(workspace));
      }
    } catch (_error) {
      // Workspace might have been deleted or transport error; no-op is safe.
    }
  }
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
  if (!wireChanges || typeof wireChanges !== 'object') return;
  const raw = wireChanges as Record<string, unknown>;
  const changes: Partial<Workspace> = {};
  if (typeof raw.title === 'string') changes.title = raw.title;
  if (typeof raw.statusMessage === 'string') changes.statusMessage = raw.statusMessage;
  // `statusImageAssetId` is clearable on the wire (PROTOCOL §5.1): a present
  // string sets the status screenshot, an explicit JSON null clears it, and a
  // missing key leaves it untouched. Same merge semantics as `archivedAt`.
  if (typeof raw.statusImageAssetId === 'string') {
    changes.statusImageAssetId = raw.statusImageAssetId;
  } else if (raw.statusImageAssetId === null) {
    changes.statusImageAssetId = undefined;
  }
  if (typeof raw.branch === 'string') changes.branch = raw.branch;
  if (typeof raw.baseRef === 'string') changes.baseRef = raw.baseRef;
  if (typeof raw.baseCommitSha === 'string') changes.baseCommitSha = raw.baseCommitSha;
  if (
    typeof raw.status === 'string' &&
    (Object.values(WorkspaceStatus) as string[]).includes(raw.status)
  ) {
    changes.status = raw.status as WorkspaceStatus;
  }
  if (Array.isArray(raw.tags) && raw.tags.every((t) => typeof t === 'string')) {
    changes.tags = raw.tags as string[];
  }
  if (typeof raw.path === 'string') changes.path = raw.path;
  if (typeof raw.repositoryPath === 'string') changes.repositoryPath = raw.repositoryPath;
  if (typeof raw.repositoryOwner === 'string') changes.repositoryOwner = raw.repositoryOwner;
  if (typeof raw.repositoryName === 'string') changes.repositoryName = raw.repositoryName;
  if (typeof raw.worktreePath === 'string') changes.worktreePath = raw.worktreePath;
  if (typeof raw.scope === 'string') changes.scope = raw.scope;
  // `skipIsolation` is the canonical wire name for the skip toggle in the
  // `workspace.update` delta (PROTOCOL §5.1); `skipWorktree` is the deprecated
  // pre-CoW alias emitted by older daemons. The FE `Workspace` entity field
  // keeps its `skipWorktree` name, matching the daemon's persisted column.
  if (typeof raw.skipIsolation === 'boolean') {
    changes.skipWorktree = raw.skipIsolation;
  } else if (typeof raw.skipWorktree === 'boolean') {
    changes.skipWorktree = raw.skipWorktree;
  }
  if (typeof raw.setupScript === 'string') changes.setupScript = raw.setupScript;
  if (typeof raw.isRemote === 'boolean') changes.isRemote = raw.isRemote;
  if (typeof raw.defaultModel === 'string') changes.defaultModel = raw.defaultModel;
  if (typeof raw.prNumber === 'number') changes.prNumber = raw.prNumber;
  if (typeof raw.prUrl === 'string') changes.prUrl = raw.prUrl;
  if (typeof raw.lastActivity === 'string') changes.lastActivity = raw.lastActivity;
  if (typeof raw.archived === 'boolean') changes.archived = raw.archived;
  // `archivedAt` is nullable on the wire: archive sends the persisted ISO
  // timestamp, unarchive sends an explicit JSON null. Keep the key present on
  // null so the entity merge (`{ ...existing, ...changes }`) drops the stale
  // timestamp instead of retaining it.
  if (typeof raw.archivedAt === 'string') {
    changes.archivedAt = raw.archivedAt;
  } else if (raw.archivedAt === null) {
    changes.archivedAt = undefined;
  }
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
 * and pass it in the payload. When the deleted workspace is the one on
 * screen (deleted by another client), also close its tab and route away —
 * this event path fires in both live and legacy modes, unlike the
 * workspace-list snapshot diff, which live-state suppresses post-boot
 * (intent-hq/monorepo#775; see workspace-list-subscription.ts).
 */
function handleWorkspaceDeletedEvent(workspaceId: string): void {
  const state = appStore.state as {
    agentSessions?: { agentIdsByWorkspace: Record<string, string[]> };
  };
  const agentIds = state.agentSessions?.agentIdsByWorkspace[workspaceId] ?? [];
  appStore.dispatch(workspaceDeleted(workspaceId, [...agentIds]));
  navigateAwayIfViewing(workspaceId).catch((error) => {
    logger.warn('navigateAwayIfViewing failed after workspace:deleted', error);
  });
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
    if (!entry || typeof entry !== 'object') continue;
    const path = (entry as { path?: unknown }).path;
    if (typeof path !== 'string' || path.length === 0) continue;
    const value = (entry as { value?: unknown }).value;
    changes.push({ path, value });
  }
  if (changes.length > 0) applySettingsChanges(changes);
}

/**
 * Per-script streaming UTF-8 decoders keyed by `workspaceId:scriptId`.
 * `decode(bytes, { stream: true })` carries a multibyte character split
 * across two `script:output` chunks over the boundary instead of emitting
 * U+FFFD for each half. Entries are dropped when the script leaves the
 * `running` state (PTY stream ended) and on test reset; a decoder holds at
 * most 3 buffered bytes, so the map stays negligible either way.
 */
const scriptOutputDecoders = new Map<string, TextDecoder>();

/**
 * Decode a base64 `chunk` (PROTOCOL §6.5 `script:output` payload) into a
 * UTF-8 string using the script's streaming decoder. Runs in the renderer,
 * so `atob` is available; the two-step conversion via `Uint8Array` preserves
 * multibyte characters that a naive `atob(...).split('')` would corrupt.
 */
function decodeBase64Chunk(decoderKey: string, chunk: string): string | null {
  try {
    const binary = atob(chunk);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
      bytes[i] = binary.charCodeAt(i);
    }
    let decoder = scriptOutputDecoders.get(decoderKey);
    if (!decoder) {
      decoder = new TextDecoder('utf-8');
      scriptOutputDecoders.set(decoderKey, decoder);
    }
    return decoder.decode(bytes, { stream: true });
  } catch {
    return null;
  }
}

/**
 * `script:output` (§6.5) carries `{ scriptId, chunk }` where `chunk` is the
 * base64 of raw PTY bytes. The decoded text is appended to the scripts
 * slice verbatim — never line-split — so xterm can replay the exact PTY
 * stream (spinner `\r` redraws, ANSI sequences split across chunks, the
 * daemon's in-band restart separators). The daemon PTY is a single unified
 * stream (§5.8).
 */
function handleScriptOutputEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const scriptId = data.scriptId;
  const chunk = data.chunk;
  if (typeof scriptId !== 'string' || typeof chunk !== 'string') return;
  const text = decodeBase64Chunk(`${workspaceId}:${scriptId}`, chunk);
  if (text === null || text === '') return;
  appStore.dispatch(
    appendScriptOutput(workspaceId, scriptId, { text, timestamp: new Date().toISOString() }),
  );
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
  if (typeof scriptId !== 'string') return;
  // PTY stream ended — drop the streaming decoder so a later run starts fresh.
  if (rest.status !== 'running') scriptOutputDecoders.delete(`${workspaceId}:${scriptId}`);
  appStore.dispatch(updateRuntimeState(workspaceId, scriptId, rest as Partial<ScriptRuntimeState>));
}

/** Remove an exited PTY from the transient terminal strip and release any live adapter. */
function handleTerminalExitEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const terminalId = data?.terminalId;
  if (typeof terminalId !== 'string' || terminalId.length === 0) return;

  appStore.dispatch(removeTerminal(workspaceId, terminalId));
  void import('$features/terminal/terminal-manager.svelte')
    .then(({ terminalManager }) => terminalManager.disposeExitedTerminal(terminalId))
    .catch((error: unknown) => {
      logger.warn('Failed to release exited terminal adapter', { terminalId, error });
    });
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
    case 'agent:status-changed':
      emitMockIpcEvent('agent:status-changed', event);
      return;
    case 'agent:idle':
      emitMockIpcEvent('agent:idle', event);
      return;
    case 'task:ready-tasks-changed':
      emitMockIpcEvent('task:ready-tasks-changed', event);
      return;
    case 'changes:git-status':
      emitMockIpcEvent('git:status-changed', { workspaceId });
      return;
    case 'changes:tracked':
      emitMockIpcEvent('file-tracking:changes-updated', { workspaceId });
      return;
    case 'line-attribution:updated':
      emitMockIpcEvent('line-attribution:updated', {
        workspaceId,
        noteId: data.noteId,
        attributions: data.attributions,
      });
      return;
    case 'workspace:updated':
      emitMockIpcEvent('workspace:updated', { workspaceId, changes: data });
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
    case 'running':
      return 'connected';
    case 'starting':
      return 'configured';
    case 'stopped':
      return 'stopped';
    case 'error':
      return 'error';
    default:
      return null;
  }
}

/**
 * `github:auth-changed` (§6.5) carries `data = { status }` on device-flow
 * terminal transitions and `github.revoke`. Global (empty `workspaceId`),
 * never carries a token or code. The github-auth middleware turns the
 * dispatched action into the state updates (fetch identity on `authorized`,
 * error on `expired`/`denied`/`error`, signed-out on `revoked`).
 */
function handleGitHubAuthChangedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const status = data?.status;
  if (
    status === 'authorized' ||
    status === 'expired' ||
    status === 'denied' ||
    status === 'error' ||
    status === 'revoked'
  ) {
    appStore.dispatch(githubAuthChanged(status));
  }
}

function handleMcpServerStatusChangedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const serverId = data.serverId;
  const status = data.status as { state?: unknown; lastError?: unknown } | undefined;
  if (typeof serverId !== 'string' || !serverId || !status || typeof status !== 'object') {
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
  if (mapped === 'error' && typeof lastError === 'string' && lastError.length > 0) {
    appStore.dispatch(setServerErrorMessage(match.name, lastError));
  } else {
    appStore.dispatch(clearServerErrorMessage(match.name));
  }
}

/**
 * Debounced changes-slice refresh for git/changes events (`git:commit`,
 * `git:pull`, `changes:tracked`). These events can fire very frequently during
 * agent activity, so we debounce ~1s per workspace to avoid redundant
 * refreshRequested dispatches. Mirrors the precedent in
 * WorkspaceProgressCard.svelte line ~213.
 */
function debouncedChangesRefresh(workspaceId: string): void {
  const existing = changesRefreshTimersByWorkspace.get(workspaceId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    appStore.dispatch(refreshRequested(workspaceId));
    changesRefreshTimersByWorkspace.delete(workspaceId);
  }, CHANGES_REFRESH_DEBOUNCE_MS);
  changesRefreshTimersByWorkspace.set(workspaceId, timer);
}

/**
 * Debounced workspace-tasks refetch for `note:*` events. A created/updated/
 * deleted note can change the BE-owned `task.list` stats rollup (task state
 * lives in note metadata), so refetch via `loadWorkspaceTasksRequested` —
 * but only for workspaces whose workspace-tasks slice is already initialized.
 * Uninitialized workspaces have never been viewed; eagerly loading their
 * tasks would fan out one `task.list` per note event across all workspaces.
 */
function debouncedWorkspaceTasksRefresh(workspaceId: string): void {
  const initialized =
    appStore.state.workspaceTasks?.byWorkspaceId[workspaceId]?.initialized === true;
  if (!initialized) return;
  const existing = tasksRefreshTimersByWorkspace.get(workspaceId);
  if (existing) {
    clearTimeout(existing);
  }
  const timer = setTimeout(() => {
    tasksRefreshTimersByWorkspace.delete(workspaceId);
    // Re-check at fire time: the slice may have been cleared (workspace
    // unmounted/deleted) during the debounce window.
    const stillInitialized =
      appStore.state.workspaceTasks?.byWorkspaceId[workspaceId]?.initialized === true;
    if (!stillInitialized) return;
    appStore.dispatch(loadWorkspaceTasksRequested(workspaceId));
  }, TASKS_REFRESH_DEBOUNCE_MS);
  tasksRefreshTimersByWorkspace.set(workspaceId, timer);
}

/**
 * `app:ui-navigate` (§6.5 Chief-workspace UI navigation) — carries
 * `{ route, workspaceId?, highlightId?, durationMs? }`. Navigate the app UI to
 * the specified route and optionally pulse the highlight target with the given
 * duration. If highlightId is present, dispatch requestUiHighlight after
 * navigation settles.
 */
function handleAppUiNavigateEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const rawRoute = data.route;
  if (typeof rawRoute !== 'string') return;
  const route = rawRoute.trim();
  if (route.length === 0) return;

  const highlightId = typeof data.highlightId === 'string' ? data.highlightId.trim() : '';
  const durationMs =
    typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs > 0
      ? data.durationMs
      : undefined;

  import('$lib/utils/navigation.client')
    .then(({ navigateToRoute }) => navigateToRoute(route))
    .then(() => {
      if (highlightId) {
        // Defer the highlight dispatch slightly so the target element has time
        // to render after navigation completes.
        requestAnimationFrame(() => {
          appStore.dispatch(
            requestUiHighlight(highlightId, durationMs ? { durationMs } : undefined),
          );
        });
      }
    })
    .catch((error: unknown) => {
      logger.warn('[app:ui-navigate] Navigation failed', { route, error });
    });
}

/**
 * `app:ui-highlight` (§6.5 Chief-workspace UI highlight) — carries
 * `{ id, workspaceId?, durationMs? }`. Pulse the specified highlight target
 * with the given duration. Dispatches requestUiHighlight action to the
 * ui-highlight slice.
 */
function handleAppUiHighlightEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const id = data.id;
  if (typeof id !== 'string' || id.trim().length === 0) return;

  const highlightId = id.trim();
  const durationMs =
    typeof data.durationMs === 'number' && Number.isFinite(data.durationMs) && data.durationMs > 0
      ? data.durationMs
      : undefined;

  appStore.dispatch(requestUiHighlight(highlightId, durationMs ? { durationMs } : undefined));
}

/**
 * `app:workspace-open` (§6.5 Chief-workspace workspace-open) — carries
 * `{ workspaceId, openInNewWindow? }`. Open the specified workspace in the
 * current window (navigate to /workspace/:id) or in a new window if
 * openInNewWindow is true. Uses the IPC window.open-new channel when
 * openInNewWindow is set, falling back to in-window navigation on failure.
 */
function handleAppWorkspaceOpenEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const rawWorkspaceId = data.workspaceId;
  if (typeof rawWorkspaceId !== 'string') return;
  const workspaceId = rawWorkspaceId.trim();
  if (workspaceId.length === 0) return;

  const openInNewWindow = data.openInNewWindow === true;
  const route = `/workspace/${workspaceId}`;

  if (openInNewWindow) {
    // Try to open in new window via IPC, fall back to navigation if it fails
    invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route })
      .then(async (result: unknown) => {
        // window:open-new resolves {success: false, error} on failure
        if (
          typeof result === 'object' &&
          result !== null &&
          'success' in result &&
          result.success === false
        ) {
          logger.warn('[app:workspace-open] New window open returned failure, navigating instead', {
            workspaceId,
            error: 'error' in result ? result.error : undefined,
          });
          const { navigateToRoute } = await import('$lib/utils/navigation.client');
          return navigateToRoute(route);
        }
      })
      .catch(async (error: unknown) => {
        logger.warn('[app:workspace-open] New window open rejected, navigating instead', {
          workspaceId,
          error,
        });
        const { navigateToRoute } = await import('$lib/utils/navigation.client');
        return navigateToRoute(route);
      })
      .catch(() => {
        // Ignore final goto failure - already logged
      });
  } else {
    import('$lib/utils/navigation.client')
      .then(({ navigateToRoute }) => navigateToRoute(route))
      .catch((error: unknown) => {
        logger.warn('[app:workspace-open] Navigation failed', { workspaceId, error });
      });
  }
}

function handleNotification(method: string, params: unknown): void {
  if (method !== 'events.event') return;
  // Fan-out scope gate (see file header): drop notifications delivered through
  // a different subscription on the same socket so chunk-append/queue/idle
  // handlers never apply the same event twice. Flat/legacy envelopes (no
  // `subscriptionId` on params) are still accepted for back-compat.
  const envelopeSubscriptionId = extractSubscriptionId(params);
  if (envelopeSubscriptionId !== undefined && envelopeSubscriptionId !== ownSubscriptionId) {
    return;
  }
  const event = extractEvent(params);
  if (!event || typeof event !== 'object') return;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== 'string') return;

  // `settings:changed` (§6.5) is global — no `workspaceId` envelope is
  // expected, so it must be routed BEFORE the workspace-id gate below.
  if (type === 'settings:changed') {
    handleSettingsChangedEvent(event);
    return;
  }

  // Chief-workspace app-UI events (§6.5) — global control events emitted when
  // Chief agents call ws.app.ui.navigate/highlight or ws.app.workspaces.open.
  // These are routed before the workspace-id gate because they carry their
  // workspaceId inside `data` (if present) rather than in the event envelope.
  if (type === 'app:ui-navigate') {
    handleAppUiNavigateEvent(event);
    return;
  }
  if (type === 'app:ui-highlight') {
    handleAppUiHighlightEvent(event);
    return;
  }
  if (type === 'app:workspace-open') {
    handleAppWorkspaceOpenEvent(event);
    return;
  }

  // `workspace:tokenUsage-changed` (§5.23) carries its workspaceId inside
  // `data`, so it is routed before the envelope workspace-id gate too.
  if (type === 'workspace:tokenUsage-changed') {
    handleTokenUsageChangedEvent(event);
    return;
  }

  // `workspace:context-changed` (§5.1) carries `data.workspaceId`, so it
  // also runs before the envelope workspace-id gate below.
  if (type === 'workspace:context-changed') {
    handleContextChangedEvent(event);
    return;
  }

  // `mcp.servers:status-changed` (§6.5) is global — no `workspaceId` envelope
  // — so it must also run before the workspace-id gate below.
  if (type === 'mcp.servers:status-changed') {
    handleMcpServerStatusChangedEvent(event);
    return;
  }

  // `github:auth-changed` (§6.5) is global — no `workspaceId` envelope — so
  // it must also run before the workspace-id gate below.
  if (type === 'github:auth-changed') {
    handleGitHubAuthChangedEvent(event);
    return;
  }

  const workspaceId = workspaceIdOf(event);
  if (!workspaceId) return;

  // Workspace lifecycle: purge every Redux trace of the deleted workspace so a
  // recreated same-slug workspace does not surface ghost agents (§7).
  if (type === 'workspace:deleted') {
    handleWorkspaceDeletedEvent(workspaceId);
    return;
  }
  if (type === 'workspace:created') {
    handleWorkspaceCreatedEvent(workspaceId);
    // fall through so the activity timeline records the creation.
  }
  // `workspace:updated` (§6.5) — merge the applied delta onto the workspace
  // entity so agent-driven `workspace.setTitle` / `workspace.update` writes
  // reflect in the sidebar/header live. Side effect, never an early return:
  // `relayLegacyIpcEvent` below still fans out to the mock-IPC channel that
  // `WorkspaceProgressCard` listens on, and the timeline dispatch below still
  // records the update.
  if (type === 'workspace:updated') {
    handleWorkspaceUpdatedEvent(event, workspaceId);
  }
  // `workspace:activity-changed` (§6.5 / §10.1) — merge the new activity
  // value onto the workspace entity so the sidebar running indicator / grouping
  // updates live without a refetch. Side effect, never an early return.
  if (type === 'workspace:activity-changed') {
    handleActivityChangedEvent(event, workspaceId);
  }
  // `workspace:displayStatus-changed` (intent-hq/intentd#600) — merge the
  // BE-owned current-cycle status onto the workspace entity so the sidebar
  // status grouping updates live without a refetch. Side effect, never an
  // early return.
  if (type === 'workspace:displayStatus-changed') {
    handleDisplayStatusChangedEvent(event, workspaceId);
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

  // STAB-9: Agent lifecycle events (status-changed, idle) should refresh the
  // agent list so the sidebar shows live status/last-activity updates.
  if (type === 'agent:status-changed' || type === 'agent:idle') {
    appStore.dispatch(hydrateAgentsRequested(workspaceId));
  }

  // Failure-registry lifecycle: drop an agent from the failure aggregation
  // registry when its status leaves error/failed (recovered or retried) or
  // when it is deleted, so the grouped-failure toast reflects live failures
  // only. Side effects, never early returns — both events fall through to the
  // timeline dispatch below.
  if (type === 'agent:status-changed') {
    const data = (event as { data?: Record<string, unknown> }).data;
    const agentId = data?.agentId;
    const status = data?.status;
    if (
      typeof agentId === 'string' &&
      typeof status === 'string' &&
      status !== 'error' &&
      status !== 'failed'
    ) {
      removeAgentFailure(agentId);
    }
  }
  if (type === 'agent:deleted') {
    const data = (event as { data?: Record<string, unknown> }).data;
    if (typeof data?.agentId === 'string') {
      removeAgentFailure(data.agentId);
    }
  }

  // monorepo#1106: a redrive that bypasses chat-send-service — coordinator
  // `agent.sendMessage`, another client's `agent.retry`, or this FE's own
  // failure-toast Retry (also `agent.retry`, which never routes through
  // dispatchToLifecycle) — starts a new turn without the #1044
  // enqueue-success clear, so the previous turn's failure banner persists
  // over the live turn ("errored" and "processing" simultaneously). Keyed
  // off the turn-start status edges here (with `agent:stream:start` /
  // `agent:queue:processing` as the other turn-start clears), NOT the send
  // path, so every redrive shape is covered. Clear the stale `chatError` /
  // `modelUnavailable` when the agent leaves the error state for a
  // turn-starting one. Two wire shapes cover the redrive family:
  //   - `agent.sendMessage` on an errored agent goes straight error→active;
  //   - `agent.retry` persists Pending BEFORE draining (persist_retry_status),
  //     so the FE sees error→pending (isActive:false) first — that edge
  //     consumes the error prior status, so `pending` must clear too or the
  //     follow-up pending→active tick reads priorStatus 'pending' and never
  //     fires. An empty-queue retry goes error→idle instead, which correctly
  //     keeps the banner (nothing was redriven).
  // Gated on the PRIOR session status (read before the `eventReceived`
  // dispatch below applies the transition) so a mid-turn status tick — e.g.
  // an isStreaming flag change while an enqueue-failure banner is up — never
  // wipes a banner set while the agent was already active (#1044/#999
  // semantics preserved). Retry records stay parked: their promotion remains
  // turnId-exact via `agent:queue:processing` (monorepo#1057). Side effect
  // only — falls through to the timeline dispatch below.
  if (type === 'agent:status-changed') {
    const data = (event as { data?: Record<string, unknown> }).data;
    const agentId = data?.agentId;
    const status = typeof data?.status === 'string' ? data.status : undefined;
    const startsTurn =
      data?.isActive === true ||
      status === 'active' ||
      status === 'responding' ||
      status === 'pending';
    if (
      typeof agentId === 'string' &&
      status !== 'error' &&
      status !== 'failed' &&
      startsTurn
    ) {
      const priorStatus: string | undefined =
        appStore.state.agentSessions.byAgentId[agentId]?.status;
      if (priorStatus === 'error' || priorStatus === 'failed') {
        const chatAgent = appStore.state.chatState?.byAgentId[agentId];
        if (chatAgent?.error) {
          appStore.dispatch(chatErrorCleared(agentId));
        }
        if (chatAgent?.modelUnavailable) {
          appStore.dispatch(chatModelUnavailableCleared(agentId));
        }
      }
    }
  }

  // Activity reconciliation: busy-implying agent events may indicate a missed
  // `workspace:activity-changed` edge (coordinator-only workspace starting
  // before the bridge subscribed). On busy signals (status-changed with
  // isResponding/isStreaming, stream chunk/status), reconcile activity to
  // agent_running if stale. On agent:idle, always refetch — the daemon knows
  // if other agents remain busy.
  if (type === 'agent:status-changed') {
    const data = (event as { data?: Record<string, unknown> }).data;
    const isBusy = data?.isResponding === true || data?.isStreaming === true;
    if (isBusy) {
      void reconcileWorkspaceActivity(workspaceId, true);
    }
  }
  if (type === 'agent:idle') {
    void reconcileWorkspaceActivity(workspaceId, false);
  }
  if (
    type === 'agent:stream:start' ||
    type === 'agent:stream:activity' ||
    type === 'agent:stream:status'
  ) {
    void reconcileWorkspaceActivity(workspaceId, true);
  }

  // Note domain events (§7 workspace-scoped) live-apply to the
  // workspace-notes slice so agent-side note writes (add_to_note etc.) show
  // up in the notes panel without a manual refresh.
  if (type === 'note:created' || type === 'note:updated' || type === 'note:deleted') {
    handleNoteEvent(event, workspaceId, type);
    return;
  }

  // Task/comment/PR domain events converge into their owning slices so the
  // task pane, inline comment thread, and workspace PR pill refresh without a
  // reload.
  if (type === 'task:status-changed') {
    handleTaskStatusChangedEvent(event, workspaceId);
    return;
  }
  if (type === 'task:agent-linked') {
    handleTaskAgentLinkedEvent(event, workspaceId);
    return;
  }
  if (type === 'task:agent-unlinked') {
    handleTaskAgentUnlinkedEvent(event, workspaceId);
    return;
  }
  if (type === 'comment:added') {
    handleCommentEvent(event, workspaceId, 'added');
    return;
  }
  if (type === 'comment:resolved') {
    handleCommentEvent(event, workspaceId, 'resolved');
    return;
  }
  if (type === 'pr:linked' || type === 'pr:updated' || type === 'pr:unlinked') {
    handlePrEvent(event, workspaceId, type);
    return;
  }

  // Git/changes events (`git:commit`, `git:pull`, `changes:tracked`) should
  // refresh the changes slice so daemon-originated commits appear live in the
  // sidebar Changes panel. Debounce per workspace (~1s) because
  // `changes:tracked` can fire very frequently during agent activity.
  if (type === 'git:commit' || type === 'git:pull' || type === 'changes:tracked') {
    debouncedChangesRefresh(workspaceId);
    // Fall through to the relayLegacyIpcEvent + eventReceived dispatches below
    // so the legacy mock-IPC listeners and activity timeline still work.
  }

  // Live stream family — content-free chat-state bookkeeping only (the
  // transcript is owned by the chat.subscribe delta stream). `agent:failed`
  // flows through both paths: it finalizes the stream bookkeeping AND
  // forwards the lifecycle to `eventReceived` so the session status
  // transitions to "failed".
  if (type === 'agent:stream:start') {
    handleStreamStartEvent(event, workspaceId);
    return;
  }
  if (type === 'agent:stream:activity') {
    handleStreamActivityEvent(event);
    return;
  }
  if (type === 'agent:tool:call') {
    handleToolCallEvent(event);
    return;
  }
  if (type === 'agent:stream:status') {
    handleStreamStatusEvent(event);
    return;
  }
  if (type === 'agent:stream:end') {
    handleStreamEndEvent(event);
    return;
  }
  if (type === 'agent:queue:updated') {
    handleQueueUpdatedEvent(event);
    return;
  }
  if (type === 'agent:queue:processing') {
    handleQueueProcessingEvent(event);
    return;
  }
  if (type === 'agent:permission:request') {
    handlePermissionRequestEvent(event);
    // fall through to the storage dispatch below so the activity timeline
    // records the prompt alongside the slice update.
  }
  if (type === 'agent:permission:resolved') {
    handlePermissionResolvedEvent(event);
    // fall through to the storage dispatch below so the activity timeline
    // records the outcome.
  }
  if (type === 'agent:attention-requested') {
    handleAttentionRequestedEvent(event, workspaceId);
    // fall through to the storage dispatch below so the activity timeline
    // records the attention request alongside the sticky toast.
  }
  // Script output/state (§6.5) — script:output feeds the live buffer the
  // `ScriptOutputViewer` xterm reads from, script:state mirrors the
  // recomputed `ScriptRuntimeState` into the scripts slice. Both fall
  // through to the storage dispatch below so the activity timeline still
  // records that they happened.
  if (type === 'script:output') {
    handleScriptOutputEvent(event, workspaceId);
    // Chunks are noise for the activity timeline (one per PTY read); skip
    // the storage dispatch so we do not fill the 100-event cap with them.
    return;
  }
  if (type === 'script:state') {
    handleScriptStateEvent(event, workspaceId);
    // fall through to the lifecycle dispatch below
  }
  if (type === 'terminal:exit') {
    handleTerminalExitEvent(event, workspaceId);
    // fall through so the activity timeline records the exit
  }
  if (type === 'agent:failed') {
    handleAgentFailedStream(event, workspaceId);
    // fall through to the lifecycle dispatch below
  }
  // Session-mutation lifecycle (§5.5): keep the sidebar/agents index in sync
  // as new agents are created and existing ones renamed/updated mid-session.
  // Each handler falls through so `eventReceived` still records the event in
  // the activity timeline.
  if (type === 'agent:created') {
    handleAgentCreatedEvent(event);
  }
  if (type === 'agent:renamed') {
    handleAgentRenamedEvent(event);
  }
  if (type === 'agent:updated') {
    handleAgentUpdatedEvent(event);
  }
  // `agent:attention-requested` (requestDiscussion / reportBlocker) — the
  // daemon persists the attention-request fields on the session and also
  // emits `agent:updated`, but re-fetch here too so the sidebar/footer
  // indicator appears even if that companion event is missed. Same
  // metadata-only refresh as handleAgentUpdatedEvent (transcript preserved).
  if (type === 'agent:attention-requested') {
    handleAgentUpdatedEvent(event);
  }
  // STAB-22: agent:message events with role="assistant" should trigger a
  // conversation refetch so AgentCard preview updates for watched agents whose
  // tab was never opened. The event payload is { agentId, messageId, role }.
  // Guard for role="assistant": refetch when the session is missing or the
  // persisted row's messageId is absent from the transcript (checking both
  // `id` and `appMessageId`, matching the message-dedup merge identity) —
  // this self-heals transcripts that hydrated before the row persisted
  // (#1019). When the event carries no messageId, only refetch for an
  // empty session (avoid redundant fetches for already-hydrated transcripts).
  // QUEUED-MESSAGES: also handle role="user" — if the session is missing or its
  // messages do not contain the messageId, refetch to fold in dequeued and
  // agent-to-agent messages.
  //
  // KEPT despite the standing chat.subscribe transcript path: the standing
  // subscription only exists for the VIEWED agent (chat-subscribe-service
  // opens one per opened chat and closes the rest on switch), so
  // watched-but-never-opened agents still depend on this echo refetch for
  // their sidebar preview. While the standing subscription IS live for the
  // event's agent it is the sole transcript writer and delivers the persisted
  // row itself — skip the redundant refetch (`hasLiveChatSubscription` is
  // false until the first emit, so a failed/slow registration degrades to
  // the refetch instead of a dead preview).
  if (type === 'agent:message') {
    const { agentId, messageId, role } = event.data ?? {};
    if (typeof agentId === 'string' && !hasLiveChatSubscription(agentId)) {
      if (role === 'assistant') {
        const session = appStore.state.agentSessions.byAgentId[agentId];
        const hasMessage =
          typeof messageId === 'string'
            ? (session?.messages.some((m) => m.id === messageId || m.appMessageId === messageId) ??
              false)
            : (session?.messages.length ?? 0) > 0;
        if (!session || !hasMessage) {
          void loadChatTranscript(agentId);
        }
      } else if (role === 'user' && typeof messageId === 'string') {
        const session = appStore.state.agentSessions.byAgentId[agentId];
        // Trigger refetch if session doesn't exist OR messageId is not present
        if (!session || !session.messages.some((m) => m.id === messageId)) {
          void loadChatTranscript(agentId);
        }
      }
    }
  }
  // Process-queue events (§6.5): agent:process:queued sets the hint,
  // agent:process:resumed clears it, agent:process:evicted clears it. These are
  // transient UI hints and should not clutter the activity timeline, so they
  // return early rather than falling through to eventReceived.
  if (type === 'agent:process:queued') {
    handleProcessQueuedEvent(event);
    return;
  }
  if (type === 'agent:process:resumed') {
    handleProcessResumedEvent(event);
    return;
  }
  if (type === 'agent:process:evicted') {
    // Evicted means the agent was removed from the queue (e.g., cancelled/failed
    // before resuming). Clear the hint so the UI doesn't show a stale waiting state.
    const data = (event as { data?: Record<string, unknown> }).data;
    if (data && typeof data.agentId === 'string') {
      appStore.dispatch(clearProcessQueueHint(data.agentId));
    }
    return;
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
  'agent:*',
  'file:*',
  'note:*',
  'comment:*',
  'script:*',
  'terminal:*',
  'settings:changed',
  'workspace:tokenUsage-changed',
  // `workspace:context-changed` (§5.1 / §6.5) — chat-context attachment
  // list migrated off FE localStorage; the daemon emits the full new items
  // list so the FE folds it via `hydrateContextItems` in the bridge.
  'workspace:context-changed',
  // `workspace:activity-changed` (§6.5 / §10.1) — self-sufficient activity
  // state changes (idle ↔ agent_running) so the FE can update the workspace
  // entity without a refetch.
  'workspace:activity-changed',
  // `workspace:displayStatus-changed` (intent-hq/intentd#600) — BE-owned
  // current-cycle display status transitions so the sidebar grouping updates
  // without a refetch.
  'workspace:displayStatus-changed',
  'workspace:updated',
  'workspace:created',
  'workspace:deleted',
  // Daemon filter is exact-match unless the pattern ends in `:*`; a bare
  // `task:ready-tasks-changed` therefore silently drops `task:status-changed`
  // and every other task family the bridge's reducers act on. Use the
  // wildcard so any future `task:*` event added on the BE reaches the FE
  // without another subscribe change.
  'task:*',
  // Taxonomy parity with the reference `WorkspaceEventType` — the daemon
  // emits `git:commit` / `git:pull` (and future `git:*` events) as workspace
  // activity, and the bridge's activity-timeline reducer already handles
  // them; without a matching subscribe filter the daemon never routes them.
  'git:*',
  'changes:git-status',
  'changes:tracked',
  'line-attribution:updated',
  'pr:*',
  'mcp.servers:status-changed',
  // `github:auth-changed` (§6.5) — device-flow terminal transitions and
  // `github.revoke`; global, so the connect UX converges without polling.
  'github:auth-changed',
  // Chief-workspace app-UI control events (§6.5 daemon emission) — the daemon
  // emits these when Chief agents call ws.app.ui.navigate/highlight or
  // ws.app.workspaces.open, bridged here into the FE's routing + highlight
  // systems. Without the subscription the FE never sees them.
  'app:ui-navigate',
  'app:ui-highlight',
  'app:workspace-open',
] as const;

/**
 * Issue the firehose `events.subscribe` and stash the resulting id on
 * `ownSubscriptionId` for the notification-scope gate. Shared by the one-shot
 * install and the post-reconnect replay so both go through the same code path.
 */
async function subscribeFirehose(): Promise<void> {
  try {
    const result = (await backendRequest('events.subscribe', {
      eventTypes: [...BRIDGE_SUBSCRIBE_EVENT_TYPES],
    })) as { subscriptionId?: string } | undefined;
    if (typeof result?.subscriptionId === 'string' && result.subscriptionId.length > 0) {
      ownSubscriptionId = result.subscriptionId;
    } else {
      logger.warn('events.subscribe returned no subscriptionId', result);
    }
  } catch (error) {
    logger.error('events.subscribe (bridge firehose + legacy relay families) failed', error);
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
      logger.error('daemon-events-bridge notification handler threw', error);
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
      logger.error('backend notification off() threw', error);
    }
    try {
      offReconnect();
    } catch (error) {
      logger.error('backend reconnect off() threw', error);
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

/** Test-only — tear down the singleton subscription and per-agent dedup maps. */
export function __resetDaemonEventsBridgeForTests(): void {
  if (cleanup) cleanup();
  cleanup = null;
  installed = false;
  ownSubscriptionId = undefined;
  toolStatusByAgent.clear();
  wakeTurnMessageIdByAgent.clear();
  // Clear all pending debounce timers so tests start from a clean slate
  for (const timer of changesRefreshTimersByWorkspace.values()) {
    clearTimeout(timer);
  }
  changesRefreshTimersByWorkspace.clear();
  for (const timer of tasksRefreshTimersByWorkspace.values()) {
    clearTimeout(timer);
  }
  tasksRefreshTimersByWorkspace.clear();
  scriptOutputDecoders.clear();
}
