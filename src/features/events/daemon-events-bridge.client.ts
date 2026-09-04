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
 *      (`agent:stream:start`, `agent:stream:chunk`, `agent:tool:call`,
 *      `agent:stream:end`, `agent:failed`), so the `agent-stream-service`
 *      middleware grows the in-flight assistant message live and finalizes it
 *      in place. Without this wire the assistant reply only appears after a
 *      manual refresh (the chat-read-service hydration via
 *      `agents.getConversation`). `agent:stream:start` (§6.6, agent-initiated
 *      harness-wake turns only) additionally dispatches `chatSendStarted` so
 *      the busy/Thinking UI opens without a user send — see
 *      `handleStreamStartEvent`. `agent:stream:activity` (§7 — the content-free
 *      liveness ping that superseded `agent:stream:chunk`, PROTOCOL §7 /
 *      intentd#775) is routed separately, not into this accumulator: it feeds
 *      `chatState/streamActivityReceived` bookkeeping and push-applies the
 *      server-derived `lastAgentResponse`/`digest`/`lastToolUse` preview
 *      fields (intentd#792) onto the agent-session slice — see
 *      `handleStreamActivityEvent`.
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
 *      (`launch` / `init` / `session-create` / `session-load` / `prompt`) —
 *      flows through the same dispatch with its exact daemon message and
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
 * The stream family is accumulated per agent (one in-flight assistant per
 * agent) using the BE's monotonic `blockIndex` so the candidate transcript
 * always grows. Post-intentd#775 the accumulator is text-starved (tool blocks
 * only), so the stream saga merges each dispatch into the message's current
 * blocks by block identity (`resolveStreamContentBlocks` →
 * `mergeStreamContentBlocks`) instead of replacing them — updates the blocks
 * this bridge knows about without deleting subscription-owned text blocks
 * (monorepo#2814). Cleanup runs on `agent:stream:end` / `agent:failed` so a
 * subsequent prompt turn starts from a clean slate. Dedup on hydration is
 * preserved by carrying the BE-canonical `messageId` as `assistantMessageId`
 * so the in-flight message id matches the one `agents.getConversation`
 * returns later.
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
 * canonical agent list for the new workspace. A created ID unknown to the
 * workspace collection (created by another client on the same daemon)
 * dispatches `loadWorkspacesRequested` so the open window refetches the list
 * and shows the new row without a reload (intent-hq/monorepo#3558).
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
 * `terminal:*` deliveries. The gate accepts a SET of expected ids because the
 * daemon-events-saga owns two subscriptions on the socket: the global
 * firehose plus the active-workspace-scoped `file:*` lease (monorepo#1853).
 */
import { m } from '$shared/paraglide/messages.js';
import type {
  AgentSession,
  ContentBlock,
  MessageMetadata,
  PullRequestInfo,
  PullRequestStatus,
  QueuedMessage,
  TaskStatus,
  Workspace,
} from '$shared/types';
import {
  WorkspaceStatus,
  isProposal,
  isWorkspaceAttention,
  isWorkspaceDisplayStatus,
} from '$shared/types';
import {
  PROPOSAL_RESOURCE_MIME_TYPE,
  createProposalResource,
} from '$shared/types/proposal-resource';
import { dedupeResourceBlocks, getResourceContents } from '$shared/types/resource-block-identity';
import { hasStandingChatSubscription } from '$features/agent/utils/chat-subscription-registry';
import type { AppliedSettingChange } from '$lib/client/app-client';
import { store as appStore } from '$store/renderer/store';
import { eventReceived } from '$store/renderer/slices/workspace-events/workspace-events-slice';
import { agentStreamUpdateReceived } from '$store/renderer/slices/workspace-agents/workspace-agents-stream-slice';
import {
  streamStatusReceived,
  chatErrorCleared,
  chatModelUnavailableCleared,
  chatQueueProcessingReceived,
  chatSendFailed,
  chatSendStarted,
  streamActivityReceived,
} from '$store/renderer/slices/chat-state/chat-state-slice';
import { replaceAgentQueue } from '$store/renderer/slices/agent-queue/agent-queue-slice';
import {
  bulkUpsertSessions,
  removeSession,
  renameSession,
  setProcessQueueHint,
  clearProcessQueueHint,
  processEvicted,
  updateSession,
  updateAgentDigest,
  upsertSession,
} from '$store/renderer/slices/agent-session/agent-session-slice';
import { workspaceDeleted } from '$store/renderer/slices/workspace-lifecycle/workspace-lifecycle-slice';
import {
  adjustRetiredCount,
  hydrateAgentsRequested,
  removeAgent,
} from '$store/renderer/slices/workspace-agents/workspace-agents-slice';
import { removeWatchedAgent } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  destroyOwnedTabsForWorkspace,
  destroyTabsByOwnerAgent,
  pruneRecentlyClosed,
} from '$store/renderer/slices/panel-layout/panel-layout-slice';
import { selectHiddenTabs } from '$store/renderer/slices/panel-layout/panel-layout-selectors';
import {
  applyTaskStatusChanged,
  loadWorkspaceTasksRequested,
} from '$store/renderer/slices/workspace-tasks/workspace-tasks-slice';
import { refreshRequested } from '$store/renderer/slices/changes/changes-slice';
import { setAgentLockState } from '$store/renderer/slices/agent-lock/agent-lock-slice';
import { toLockRecord } from '$features/file-tracking/file-tracking.client';
import {
  bulkUpdateWorkspaceEntities,
  clearWorkspacePendingDeletion,
  loadWorkspacesRequested,
  markWorkspacePendingDeletion,
  removeWorkspaceEntity,
  updateWorkspaceEntity,
} from '$store/renderer/slices/workspace/workspace-slice';
import {
  closeWorkspaceTabAndNavigateAway,
  navigateAwayIfViewing,
} from '$features/workspace/navigate-away-if-viewing';
import { restoreWorkspaceTab } from '$store/renderer/slices/tab-state/tab-state-slice';
import { applyNoteFromEvent } from '$features/notes/notes-read-service';
import { applyCommentFromEvent } from '$features/comments/comments-read-service';
import {
  ensureAgentSession,
  refreshAgentSessionAfterEvent,
} from '$features/agent/agent-read-service';
import { deriveAgentHasUnread } from '$shared/utils/agent-unread';
import {
  getPendingAgentDeletion,
  isAgentDeletionPending,
  removePendingAgentDeletion,
  setPendingAgentDeletion,
} from '$features/agent/utils/pending-agent-deletions';
import { notifyInterruptedAgentUpdated } from '$features/agent/interrupted-agents-service';
import {
  getAgentFailureEntry,
  listAgentFailureEntries,
  recordAgentFailure,
  removeAgentFailure,
} from '$features/agent/agent-failure-registry';
import {
  showAgentAttentionToast,
  showWorkspaceAutoUnarchiveToast,
} from '$features/agent/agent-attention-toast-service';
import { refreshWorkspaceSubscriptionEntriesRequested } from '$store/renderer/slices/agent-subscription-ui/agent-subscription-ui-slice';
import {
  permissionRequestReceived,
  removePermissionRequest,
  type PermissionRequest,
} from '$store/renderer/slices/permission/permission-slice';
import { tokenUsageReceived } from '$store/renderer/slices/token-usage/token-usage-slice';
import {
  workspaceCreateProgressDone,
  workspaceCreateProgressReceived,
} from '$store/renderer/slices/workspace-create-progress/workspace-create-progress-slice';
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
  refreshScripts,
  updateRuntimeState,
} from '$store/renderer/slices/scripts/scripts-slice';
import type { ScriptRuntimeState } from '$store/renderer/slices/scripts/scripts-types';
import { removeTerminal } from '$store/renderer/slices/terminals/terminals-slice';
import {
  clearServerErrorMessage,
  setServerErrorMessage,
  setServerStatus,
  setWorkspaceMcpServerDisabled,
} from '$store/renderer/slices/mcp-settings/mcp-settings-slice';
import { mapDaemonMcpState } from '$store/renderer/slices/mcp-settings/mcp-settings-normalization';
import { githubAuthChanged } from '$store/renderer/slices/github-auth/github-auth-slice';
import {
  hydrateAgentQueue,
  noteAgentQueueEventSnapshotApplied,
} from '$features/agent/agent-queue-read-service';
import { emitMockIpcEvent } from '$shared/ipc-mock-router';
import type { WorkspaceEvent } from '$features/events/types';
import { createLogger } from '$lib/utils/client-logger';
import {
  reportStreamLifecycle,
  streamTurnCorrelation,
} from '$lib/utils/stream-lifecycle-telemetry';
import { requestUiHighlight } from '$store/renderer/slices/ui-highlight/ui-highlight-slice';
import { resolveHashToTarget } from '$shared/app-ui-targets';
import { invoke } from '$lib/electron-bridge';
import { IPC_CHANNELS } from '$shared/ipc-registry';

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
  /**
   * `tool_use` index → standalone resource blocks (PROTOCOL §7.1) appended
   * right after that tool's `tool_result`. The daemon-claimed canonical batch
   * carried on the `agent:tool:call` event (`registeredAttachments`,
   * deterministic attach) wins; otherwise the FE lifts a proposal-MIME
   * resource item out of the echoed output (`crates/intent-services/src/
   * tool_block.rs::lift_proposal_resource`), mirroring the daemon's
   * `subscriptions.rs` delta path so the live transcript matches the
   * persisted one and the card renders mid-stream.
   */
  attachmentsByUseIndex: Map<number, ContentBlock[]>;
}

const streamsByAgent = new Map<string, StreamState>();

/**
 * Per-agent turn tracking for the push-applied preview digest: the last
 * `agent:stream:activity` / `agent:stream:end` messageId seen. When an
 * activity ping arrives for a NEW messageId (a new turn), the previous turn's
 * `session.digest` and `lastToolUse` are cleared before the ping's own fields
 * apply, so a stale summary/tool can't outrank this turn's live text in the
 * AgentCard preview (monorepo#1327). `agent:stream:end` also stamps its
 * turn's messageId here (not just activity pings): a straggler same-turn
 * activity ping delivered after the terminal event must not look like a new
 * turn and wipe the final digest `agent:stream:end` just applied, and a
 * stale/out-of-order `agent:stream:end` for an EARLIER turn than the one
 * already tracked must not clobber a newer turn's live preview either — see
 * the ordering guards in `handleStreamActivityEvent` /
 * `handleStreamEndEvent`.
 */
const previewTurnMessageIdByAgent = new Map<string, string>();

/**
 * Per-agent messageId of the last turn whose terminal `agent:stream:end` was
 * applied. An activity ping is self-sufficient evidence of a live turn (it
 * opens the sticky `liveTurnOpen` bit so a never-hydrated delegated agent's
 * footer preview goes live without an `agent:status-changed` edge), but a
 * same-turn straggler ping delivered after the terminal event must not
 * re-open the bit `agent:idle` / the terminal fold just closed — this map is
 * how the activity handler tells a mid-turn ping from that straggler.
 */
const previewTurnEndedMessageIdByAgent = new Map<string, string>();

/**
 * True once this bridge has delivered an `agent:last-message` event — the
 * §6.5 content-bearing companion the daemon emits alongside EVERY
 * `agent:message`. While false (older daemon), the lean id-only
 * `agent:message` echo falls back to a light `agent.get` refresh
 * (`refreshAgentSessionCoalesced`) so previews still converge; once true, the
 * companion carries the preview projections directly and the fallback
 * retires. Reset with the rest of the routing state (the next daemon after a
 * backend switch may be older).
 */
let daemonEmitsLastMessage = false;

/**
 * Single-flight + trailing-coalesce wrapper over `ensureAgentSession` for the
 * `agent:message` back-compat refresh (per the event-driven refetch rule):
 * triggers during an in-flight fetch collapse into at most ONE follow-up
 * fetch after it settles. `ensureAgentSession` never rejects, so the chain
 * always advances.
 */
const agentSessionRefreshInFlight = new Set<string>();
const agentSessionRefreshFollowUpWanted = new Set<string>();
function refreshAgentSessionCoalesced(agentId: string): void {
  if (agentSessionRefreshInFlight.has(agentId)) {
    agentSessionRefreshFollowUpWanted.add(agentId);
    return;
  }
  agentSessionRefreshInFlight.add(agentId);
  void ensureAgentSession(agentId).then(() => {
    agentSessionRefreshInFlight.delete(agentId);
    if (agentSessionRefreshFollowUpWanted.delete(agentId)) {
      refreshAgentSessionCoalesced(agentId);
    }
  });
}

/**
 * Debounce timers for changes-slice refresh per workspace. Change events can
 * fire very frequently during agent activity (matching the note in
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

function ensureStream(agentId: string, messageId: string, workspaceId: string): StreamState {
  const existing = streamsByAgent.get(agentId);
  if (existing && existing.messageId === messageId) return existing;
  const fresh: StreamState = {
    messageId,
    workspaceId,
    blocksByIndex: new Map(),
    toolResultsByUseIndex: new Map(),
    attachmentsByUseIndex: new Map(),
  };
  streamsByAgent.set(agentId, fresh);
  return fresh;
}

/**
 * Parse the daemon blockIndex out of a stable `{messageId}:{blockIndex}` block
 * id (PROTOCOL §7.1). Bare unsigned decimal only — mirrors the
 * `{messageId}:{index}` scheme produced by the daemon's `Transcript::block_id`
 * (agent_session.rs). Returns undefined for id-less or foreign-shaped ids.
 */
function parseBlockIndexFromId(blockId: unknown): number | undefined {
  if (typeof blockId !== 'string') return undefined;
  const separator = blockId.lastIndexOf(':');
  if (separator < 0) return undefined;
  const suffix = blockId.slice(separator + 1);
  if (!/^[0-9]+$/.test(suffix)) return undefined;
  return Number(suffix);
}

/**
 * REJOIN-STREAM SEEDING: prime the stream accumulator with the TOOL blocks
 * from a chat.subscribe snapshot's in-flight assistant message so subsequent
 * agent:tool:call dispatches carry the already-completed tool prefix instead
 * of only the post-rejoin suffix. Called by the chat-subscribe saga after
 * merging the snapshot's partial assistant into the hydrated transcript.
 *
 * TOOL BLOCKS ONLY (monorepo#2818): post-intentd#775 the agent:* firehose
 * carries no text updates, so a seeded text/thinking block would be frozen at
 * its seed-time copy while the standing subscription keeps advancing it in
 * the store — the next tool tick's dispatch would then regress the fresher
 * text via the identity merge (`mergeStreamContentBlocks`, same stable block
 * id). Text/thinking blocks are subscription-owned and never seeded; the
 * merge preserves them in the store regardless (monorepo#2814).
 *
 * tool_use blocks seed under their daemon blockIndex (parsed from the stable
 * `{messageId}:{blockIndex}` id, PROTOCOL §7.1) so a later agent:tool:call
 * tick — whose blockIndex is the daemon's — merges into the seeded block. The
 * daemon's index space is shared by all block kinds (text, tool_use,
 * tool_result, resource; `Transcript::block_id` in agent_session.rs), so a
 * faithful snapshot array has position == id suffix; parsing from the id
 * keeps seeding correct even if the array is ever partial or reordered
 * relative to daemon indices. tool_result blocks ride `toolResultsByUseIndex`
 * keyed by their paired tool_use (tool_use_id ↔ toolCallId, §7.1 synthesized
 * pairing), matching how live completions land — never `blocksByIndex`, so
 * `buildContentBlocks` cannot emit them twice. Blocks whose pairing cannot be
 * resolved are skipped: the subscription still owns the full transcript.
 *
 * NO-OP when the message has no content blocks or when a different message id
 * already holds the stream slot.
 */
export function seedStreamFromSnapshot(
  agentId: string,
  inFlightMessage: { id?: string; contentBlocks?: ContentBlock[] },
  workspaceId: string,
): void {
  const messageId =
    typeof inFlightMessage.id === 'string' && inFlightMessage.id.length > 0
      ? inFlightMessage.id
      : null;
  if (!messageId) return;
  const existing = streamsByAgent.get(agentId);
  if (existing && existing.messageId !== messageId) return;
  const blocks = Array.isArray(inFlightMessage.contentBlocks) ? inFlightMessage.contentBlocks : [];
  if (blocks.length === 0) return;
  const state = ensureStream(agentId, messageId, workspaceId);
  const useIndexByToolCallId = new Map<string, number>();
  for (const block of blocks) {
    if (block.type === 'tool_use') {
      const blockIndex = parseBlockIndexFromId((block as { id?: unknown }).id);
      if (blockIndex === undefined) continue;
      state.blocksByIndex.set(blockIndex, block);
      const toolCallId = (block as { toolCallId?: unknown }).toolCallId;
      if (typeof toolCallId === 'string' && toolCallId.length > 0) {
        useIndexByToolCallId.set(toolCallId, blockIndex);
      }
    } else if (block.type === 'tool_result') {
      const toolUseId = (block as { tool_use_id?: unknown }).tool_use_id;
      if (typeof toolUseId !== 'string' || toolUseId.length === 0) continue;
      const useIndex = useIndexByToolCallId.get(toolUseId);
      if (useIndex === undefined) continue;
      state.toolResultsByUseIndex.set(useIndex, block);
    }
  }
}

function buildContentBlocks(state: StreamState): ContentBlock[] {
  const sortedKeys = [...state.blocksByIndex.keys()].sort((a, b) => a - b);
  const result: ContentBlock[] = [];
  for (const key of sortedKeys) {
    result.push(state.blocksByIndex.get(key)!);
    const toolResult = state.toolResultsByUseIndex.get(key);
    if (toolResult) result.push(toolResult);
    const attachments = state.attachmentsByUseIndex.get(key);
    if (attachments) result.push(...attachments);
  }
  // The same logical resource can reach the accumulator twice — e.g. a
  // tool-call-claimed attachment (`registeredAttachments`) plus the terminal
  // `agent:stream:end` trailingBlocks copy; collapse to one card per logical
  // resource, preferring the daemon-canonical variant.
  return dedupeResourceBlocks(result);
}

/**
 * Find the first well-formed proposal resource item in a completed tool's
 * `output` array — `{ type: "resource", resource: { mimeType: <proposal MIME>,
 * text: <string> } }` — mirroring the daemon's
 * `crates/intent-services/src/tool_block.rs::find_proposal_resource` (§7.1).
 * Returns null for non-array output, no matching item, or a malformed resource.
 */
function findProposalResourceItem(output: unknown): Record<string, unknown> | null {
  if (!Array.isArray(output)) return null;
  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as { type?: unknown; resource?: { mimeType?: unknown; text?: unknown } };
    if (
      candidate.type === 'resource' &&
      candidate.resource &&
      typeof candidate.resource === 'object' &&
      candidate.resource.mimeType === PROPOSAL_RESOURCE_MIME_TYPE &&
      typeof candidate.resource.text === 'string'
    ) {
      return item as Record<string, unknown>;
    }
  }
  return null;
}

/**
 * Size cap for the collapsed-output fallback parse — mirrors the daemon's
 * `COLLAPSED_PROPOSAL_MAX_BYTES` (tool_block.rs): a stringified
 * `{ok, proposal}` payload larger than this is never a real proposal echo.
 */
const COLLAPSED_PROPOSAL_MAX_BYTES = 256 * 1024;

/**
 * Extract the candidate stringified payload from a provider-collapsed tool
 * output: `{ "output": "<string>" }` (auggie's shape) or a bare string —
 * mirrors the daemon's `collapsed_output_text` (tool_block.rs).
 */
function collapsedOutputText(output: unknown): string | null {
  if (typeof output === 'string') return output;
  if (output && typeof output === 'object' && !Array.isArray(output)) {
    const nested = (output as { output?: unknown }).output;
    if (typeof nested === 'string') return nested;
  }
  return null;
}

/**
 * WRAP REPAIR: strip raw control characters (U+0000–U+001F) that appear
 * inside JSON string literals, leaving everything outside strings (including
 * pretty-print newlines) untouched. Some providers hard-wrap the collapsed
 * `{ok, proposal}` payload at 1000 columns, injecting raw newlines into
 * string values (even mid-word / mid-escape); raw control characters are
 * invalid inside JSON string literals, so JSON.parse throws and the lift
 * silently skips. The scan is a state machine honoring escapes: a control
 * character between a backslash and its escaped character is stripped
 * without consuming the escape. Returns null when nothing was stripped
 * (repair cannot help). Mirrors the daemon's wrap repair in
 * `tool_block.rs::rebuild_collapsed_proposal_resource`.
 */
function stripRawControlsInJsonStrings(text: string): string | null {
  let out = '';
  let changed = false;
  let inString = false;
  let escapePending = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inString) {
      if (text.charCodeAt(i) < 0x20) {
        changed = true;
        continue;
      }
      if (escapePending) {
        escapePending = false;
      } else if (ch === '\\') {
        escapePending = true;
      } else if (ch === '"') {
        inString = false;
      }
    } else if (ch === '"') {
      inString = true;
      escapePending = false;
    }
    out += ch;
  }
  return changed ? out : null;
}

/**
 * §7.1 collapsed-output fallback — mirrors the daemon's
 * `rebuild_collapsed_proposal_resource` (tool_block.rs). Some providers (e.g.
 * auggie) flatten the daemon's dual text+resource MCP content items into a
 * single `{ "output": "<stringified {ok, proposal}>" }` object, dropping the
 * resource item, so `findProposalResourceItem` finds nothing in the live
 * `agent:tool:call` output even though the daemon lifts the block into the
 * persisted transcript. Recover the proposal from the collapsed string under
 * the same guards (size cap, JSON object with `ok: true`, proposal passing
 * canonical validation) and rebuild the resource item with the same shape the
 * daemon's `build_proposal_resource_item` emits (`createProposalResource`).
 * Note the rebuilt uri/text may differ superficially from the persisted
 * block's (percent-encoding set, JSON key order); the daemon's re-hydrated
 * transcript replaces the live block after the turn completes.
 */
function rebuildCollapsedProposalResourceItem(output: unknown): Record<string, unknown> | null {
  const text = collapsedOutputText(output);
  if (!text || !text.trimStart().startsWith('{')) return null;
  // The cap is in BYTES like the daemon's; text.length counts UTF-16 code
  // units (each up to 3 UTF-8 bytes), so only encode when the cheap length
  // check cannot rule the payload in or out on its own.
  if (text.length > COLLAPSED_PROPOSAL_MAX_BYTES) return null;
  if (
    text.length * 3 > COLLAPSED_PROPOSAL_MAX_BYTES &&
    new TextEncoder().encode(text).length > COLLAPSED_PROPOSAL_MAX_BYTES
  ) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    // Provider-wrapped payload: retry once with raw control characters
    // stripped from inside string literals (see stripRawControlsInJsonStrings).
    const repaired = stripRawControlsInJsonStrings(text);
    if (repaired === null) return null;
    try {
      parsed = JSON.parse(repaired);
    } catch {
      return null;
    }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
  const envelope = parsed as { ok?: unknown; proposal?: unknown };
  if (envelope.ok !== true || !isProposal(envelope.proposal)) return null;
  // The shared isProposal is looser than the daemon's is_valid_proposal
  // (proposal.rs): match the daemon's extra requirements — non-empty
  // preview.title and a payload that is a JSON object (not an array) — so the
  // FE never lifts a block the daemon would decline to persist.
  const proposal = envelope.proposal;
  if (proposal.preview.title.length === 0 || Array.isArray(proposal.payload)) return null;
  return { type: 'resource', resource: createProposalResource(proposal) };
}

/**
 * Find or reconstruct the proposal resource item for a completed tool's
 * output (§7.1) — mirrors the daemon's `lift_proposal_resource`
 * (tool_block.rs): the array path first, then the collapsed-output fallback.
 */
function liftProposalResourceItem(output: unknown): Record<string, unknown> | null {
  return findProposalResourceItem(output) ?? rebuildCollapsedProposalResourceItem(output);
}

/**
 * Predict a standalone attachment block's stable id from the `tool_use`
 * blockId: the daemon appends `tool_result` at index + 1 and the Nth
 * attachment block at index + 2 + N (the `{messageId}:{index}` scheme
 * produced by the daemon's `Transcript::block_id`, agent_session.rs; §7.1
 * tool_delta). Returns undefined when the blockId does not follow that
 * scheme.
 */
function predictAttachmentBlockId(
  toolUseBlockId: unknown,
  attachmentOrdinal: number,
): string | undefined {
  if (typeof toolUseBlockId !== 'string') return undefined;
  const separator = toolUseBlockId.lastIndexOf(':');
  if (separator < 0) return undefined;
  // Bare unsigned decimal only — mirrors the `{messageId}:{index}` scheme
  // produced by the daemon's `Transcript::block_id` (agent_session.rs).
  const suffix = toolUseBlockId.slice(separator + 1);
  if (!/^[0-9]+$/.test(suffix)) return undefined;
  return `${toolUseBlockId.slice(0, separator)}:${Number(suffix) + 2 + attachmentOrdinal}`;
}

/**
 * Optional terminal fields of `agent:stream:end` (PROTOCOL §7 / §7.2) that
 * the finalized message's metadata mirrors: the interrupt marker with its
 * reason + sender attribution, and the abnormal finish reason. Every field is
 * omitted when absent on the wire — never defaulted or `null`ed.
 */
interface StreamEndMetadata {
  stopReason?: string;
  finishReason?: string;
  interruptReason?: MessageMetadata['interruptReason'];
  interruptedBy?: MessageMetadata['interruptedBy'];
}

/**
 * Read the §7.2 `interruptedBy` sender attribution off an `agent:stream:end`
 * payload: `{ kind: "user" }` or `{ kind: "agent", agentId?, name? }`. A value
 * that diverges from the documented shape is rejected whole rather than
 * partially absorbed — and logged, so a daemon/FE contract drift is visible
 * instead of silent (same posture as bare `trailingBlocks`).
 */
function readInterruptedBy(
  value: unknown,
  agentId: string,
): MessageMetadata['interruptedBy'] | undefined {
  if (value === undefined) return undefined;
  const parsed = parseInterruptedBy(value);
  if (parsed === undefined) {
    logger.debug('Dropping malformed agent:stream:end interruptedBy', { agentId, value });
  }
  return parsed;
}

function parseInterruptedBy(value: unknown): MessageMetadata['interruptedBy'] | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { kind, agentId, name } = value as Record<string, unknown>;
  if (kind === 'user') return { kind: 'user' };
  if (kind !== 'agent') return undefined;
  if (agentId !== undefined && typeof agentId !== 'string') return undefined;
  if (name !== undefined && typeof name !== 'string') return undefined;
  return {
    kind: 'agent',
    ...(agentId !== undefined ? { agentId } : {}),
    ...(name !== undefined ? { name } : {}),
  };
}

function streamEndMetadataFields(end: StreamEndMetadata | undefined): StreamEndMetadata {
  if (!end) return {};
  return {
    ...(end.stopReason ? { stopReason: end.stopReason } : {}),
    ...(end.finishReason ? { finishReason: end.finishReason } : {}),
    ...(end.interruptReason ? { interruptReason: end.interruptReason } : {}),
    ...(end.interruptedBy ? { interruptedBy: end.interruptedBy } : {}),
  };
}

function dispatchStreamUpdate(
  agentId: string,
  state: StreamState,
  eventType: 'chunk' | 'content-blocks' | 'complete' | 'error',
  end?: StreamEndMetadata,
): void {
  // SOLE-WRITER INVARIANT (PROTOCOL §7.1): when a standing chat.subscribe
  // registration covers this agent, the subscription owns message CONTENT —
  // omit the accumulator's blocks so this dispatch keeps only its bookkeeping
  // duties (streaming flags, stopReason/finishReason metadata, chat-state
  // resets). The terminal `complete` would otherwise replace the reconciled
  // transcript with the accumulator's text-starved stale set — with no later
  // emit to heal it, the turn's tail goes missing — and mid-turn
  // `content-blocks` ticks flicker subscription-owned rows. The accumulator
  // itself keeps accumulating regardless, so it stays the complete fallback
  // writer for agents whose coverage ends mid-turn. The apply-time guard in
  // agent-stream-saga re-checks coverage for dispatches buffered across a
  // registration install.
  const covered = hasStandingChatSubscription(agentId);
  const contentBlocks = covered ? undefined : buildContentBlocks(state);

  appStore.dispatch(
    agentStreamUpdateReceived({
      workspaceId: state.workspaceId,
      agentId,
      handlerSessionId: agentId,
      source: 'sendMessage',
      eventType,
      assistantMessageId: state.messageId,
      ...(contentBlocks ? { contentBlocks } : {}),
      ...streamEndMetadataFields(end),
    }),
  );
  reportStreamLifecycle({
    stage: 'bridge',
    event: `stream-${eventType}-dispatched`,
    turnCorrelation: streamTurnCorrelation(state.messageId),
    callbackResult: 'dispatched',
    ...(contentBlocks ? { blockCount: contentBlocks.length } : {}),
  });
}

/**
 * Extract the `lastToolUse` preview hint from an `agent:stream:activity`
 * tool-arm ping (PROTOCOL §7): `{ name, status? }`, omitted entirely on
 * text-chunk pings. `name` is required and non-empty; a payload that diverges
 * from the documented shape is rejected whole rather than partially absorbed.
 */
function readLastToolUse(value: unknown): { name: string; status?: string } | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { name, status } = value as { name?: unknown; status?: unknown };
  if (typeof name !== 'string' || name.trim().length === 0) return undefined;
  if (status !== undefined && typeof status !== 'string') return undefined;
  return status === undefined ? { name } : { name, status };
}

/**
 * Push-apply the server-derived live-preview fields carried on
 * `agent:stream:activity` / terminal `agent:stream:end` (intentd#792) into
 * the agent-session slice — no RPC, no client-side debounce (the daemon
 * already throttles the activity signal to 1s leading-edge). `updateSession`
 * is a no-op for unknown agents, so callers route this through
 * `withHydratedSession` (below) rather than calling it directly.
 */
function applyStreamPreviewFields(
  agentId: string,
  lastAgentResponse: string | undefined,
  digest: string | undefined,
  lastToolUse?: { name: string; status?: string },
): void {
  const updates: {
    lastAgentResponse?: string;
    digest?: string;
    lastToolUse?: { name: string; status?: string };
  } = {};
  if (typeof lastAgentResponse === 'string' && lastAgentResponse.trim()) {
    updates.lastAgentResponse = lastAgentResponse;
  }
  if (typeof digest === 'string' && digest.trim()) {
    updates.digest = digest;
  }
  if (lastToolUse) {
    updates.lastToolUse = lastToolUse;
  }
  if (Object.keys(updates).length === 0) return;
  appStore.dispatch(updateSession(agentId, updates));
}

/**
 * A live-stream event can arrive for an agent the agent-session slice does
 * not know yet — e.g. a delegated sub-agent whose session was never hydrated
 * in this window. `updateSession` no-ops for unknown agents, so agent-session
 * writes (push-applied preview fields, digest/lastToolUse clears) would be
 * silently dropped rather than just deferred. `ensureAgentSession` is async
 * (it fetches + hydrates the store), so `apply` runs immediately when the
 * session is already known, otherwise it is deferred until hydration settles
 * — `ensureAgentSession` coalesces concurrent calls per agent via its
 * in-flight map and the daemon throttles activity to ≤1/s, so this cannot
 * stampede, and it never rejects (errors are swallowed/logged), so `apply`
 * always runs even after a failed fetch (a still-unknown session then makes
 * the deferred writes no-ops, same as today).
 */
function withHydratedSession(agentId: string, apply: () => void): void {
  if (appStore.state.agentSessions?.byAgentId[agentId]) {
    apply();
    return;
  }
  void ensureAgentSession(agentId).then(apply);
}

/**
 * `agent:stream:activity` (PROTOCOL §7) is the content-free liveness ping —
 * no raw transcript content, leading-edge throttled per agent (first ping of
 * a turn immediate, then ≤1/s until the turn ends). The standing
 * `chat.subscribe` delta stream (§7.1) is the transcript writer. Two jobs
 * remain: chat-state bookkeeping (the `receivedFirstChunk` flip that
 * auto-appends the "Streaming response…" status entry once response text
 * exists, plus the stall-detection timestamps) and the push-applied
 * live-preview fields (`lastAgentResponse`/`digest`, intentd#792, plus
 * `lastToolUse` for tool-only stretches) so a non-viewed watched agent's
 * footer preview advances mid-turn without a fetch. The preview fields are
 * omitted until derivable (pre-first-token / pre-first-tool) — an omission
 * means "nothing to preview yet this turn", so the ping only refreshes
 * timestamps. The wire guard mirrors the §7 payload (`agentId`/`messageId`,
 * both required non-empty strings) so malformed events stay inert.
 */
function handleStreamActivityEvent(event: WorkspaceEvent, workspaceId: string): void {
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
  // Drop an ended-turn straggler outright: a ping for the turn whose terminal
  // `agent:stream:end` already applied — or for an even earlier turn
  // (messageId is a UUIDv7, so lexicographic order mirrors turn order, same
  // as `handleStreamEndEvent`'s guard) — carries nothing valid. The terminal
  // event already applied the turn's final preview fields, so letting the
  // straggler through would re-open liveness (`liveTurnOpen`, or a
  // `lastToolUse.status: "running"` that `isAgentRunningState` reads as
  // active evidence) and, for an older turn, masquerade as a new turn and
  // clear the current digest.
  const endedMessageId = previewTurnEndedMessageIdByAgent.get(agentId);
  if (endedMessageId !== undefined && messageId <= endedMessageId) {
    return;
  }
  const lastAgentResponse =
    typeof data.lastAgentResponse === 'string' ? data.lastAgentResponse : undefined;
  const digest = typeof data.digest === 'string' ? data.digest : undefined;
  // Meaningful `lastAgentResponse` text means the turn has streamed response
  // text — the signal for the "Streaming response…" flip; a pre-text ping
  // only refreshes timestamps. The predicate mirrors the empty/whitespace
  // drop in `applyStreamPreviewFields` so the bookkeeping never advances into
  // the text-streaming path without a preview actually applying.
  const hasResponseText = lastAgentResponse !== undefined && lastAgentResponse.trim().length > 0;
  appStore.dispatch(streamActivityReceived(agentId, hasResponseText));
  // First ping of a new turn (fresh messageId): drop the previous turn's
  // digest so it can't masquerade as this turn's summary (monorepo#1327), and
  // the previous turn's `lastToolUse` for the same reason — the wire omits it
  // before this turn's first tool call, so an omission cannot be distinguished
  // from "older daemon" and a carried-over tool would render as live. Values
  // carried on this very ping are re-applied right below; idle agents keep
  // their last digest as the preview fallback because no ping arrives until
  // the next turn starts. The map write itself is synchronous bookkeeping
  // (no store dependency) — only the resulting agent-session dispatches below
  // wait on hydration.
  const isNewTurn = previewTurnMessageIdByAgent.get(agentId) !== messageId;
  if (isNewTurn) {
    previewTurnMessageIdByAgent.set(agentId, messageId);
  }
  // The ping itself proves a turn is in flight (the daemon only emits it
  // mid-turn), so open the sticky `liveTurnOpen` bit — the same one the
  // `agent:status-changed` running fold sets — stamping the event's own
  // daemon timestamp as the ordering signal. Without this, a delegated agent
  // whose running edge predates hydration (or was missed) never reads as
  // live even while pings stream in. `updatedAt` is daemon-owned and left
  // untouched. (Ended-turn stragglers never reach here — dropped above.)
  const eventTimestamp = (event as { timestamp?: unknown }).timestamp;
  withHydratedSession(agentId, () => {
    // Re-check at execution time: `withHydratedSession` defers this callback
    // across an async hydration fetch when the session isn't known yet, and
    // the turn's terminal `agent:stream:end` may stamp the ended-turn map
    // (synchronously) in that window — a then-stale ping must not re-open
    // the liveness the terminal fold just closed.
    const endedAtDispatch = previewTurnEndedMessageIdByAgent.get(agentId);
    if (endedAtDispatch !== undefined && messageId <= endedAtDispatch) {
      return;
    }
    if (isNewTurn) {
      appStore.dispatch(updateAgentDigest(workspaceId, agentId, null));
      appStore.dispatch(updateSession(agentId, { lastToolUse: undefined }));
    }
    appStore.dispatch(
      updateSession(agentId, {
        liveTurnOpen: true,
        ...(typeof eventTimestamp === 'string' ? { liveTurnOpenedAt: eventTimestamp } : {}),
      }),
    );
    applyStreamPreviewFields(agentId, lastAgentResponse, digest, readLastToolUse(data.lastToolUse));
  });
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
    typeof agentId !== 'string' ||
    typeof messageId !== 'string' ||
    typeof blockIndex !== 'number'
  ) {
    return;
  }
  const state = ensureStream(agentId, messageId, workspaceId);

  if (blockType === 'text' && typeof content === 'string') {
    const prior = state.blocksByIndex.get(blockIndex);
    const priorText = prior && prior.type === 'text' ? (prior.text ?? prior.content ?? '') : '';
    const next: ContentBlock = {
      type: 'text',
      ...(typeof blockId === 'string' ? { id: blockId } : {}),
      text: priorText + content,
    };
    state.blocksByIndex.set(blockIndex, next);
  } else if (content && typeof content === 'object') {
    state.blocksByIndex.set(blockIndex, content as ContentBlock);
  } else {
    return;
  }

  dispatchStreamUpdate(agentId, state, 'chunk');
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
  const registeredAttachments = data.registeredAttachments;
  if (
    typeof agentId !== 'string' ||
    typeof messageId !== 'string' ||
    typeof blockIndex !== 'number' ||
    typeof toolCallId !== 'string'
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
    (ContentBlock & { toolCallId?: string }) | undefined;
  const priorIsSameToolUse = prior?.type === 'tool_use' && prior.toolCallId === toolCallId;
  // A non-empty `toolName` on the wire signals an authoritative update
  // (the daemon's `map_tool_call_update` only supplies a `title` when the
  // upstream ACP update carries one); an empty string is the mapper's default
  // for a status-only tick, in which case we preserve every non-status field
  // on the prior block. This mirrors the persisted transcript on the daemon
  // side (`record_tool` only patches `metadata.status` on repeats).
  const isProgressOnlyUpdate =
    priorIsSameToolUse && (typeof toolName !== 'string' || toolName.length === 0);
  const priorMetadata =
    priorIsSameToolUse && typeof (prior as { metadata?: unknown }).metadata === 'object'
      ? ((prior as { metadata?: Record<string, unknown> }).metadata ?? {})
      : {};
  const nextName = isProgressOnlyUpdate
    ? ((prior as { name?: string }).name ?? '')
    : typeof toolName === 'string'
      ? toolName
      : '';
  const nextInput = isProgressOnlyUpdate
    ? ((prior as { input?: Record<string, unknown> | undefined }).input ?? undefined)
    : input !== undefined && input !== null
      ? (input as Record<string, unknown>)
      : undefined;
  const nextToolKind = isProgressOnlyUpdate
    ? (priorMetadata as { toolKind?: string }).toolKind
    : typeof toolKind === 'string' && toolKind.length > 0
      ? toolKind
      : undefined;

  const toolUseBlock: ContentBlock = {
    type: 'tool_use',
    ...(typeof blockId === 'string' ? { id: blockId } : {}),
    name: nextName,
    input: nextInput,
    toolCallId,
    metadata: {
      ...(typeof nextToolKind === 'string' ? { toolKind: nextToolKind } : {}),
      ...(typeof status === 'string' ? { status } : {}),
    },
  } as ContentBlock;
  state.blocksByIndex.set(blockIndex, toolUseBlock);

  if ((status === 'completed' || status === 'error') && output !== undefined) {
    state.toolResultsByUseIndex.set(blockIndex, {
      type: 'tool_result',
      tool_use_id: toolCallId,
      output: output as ContentBlock['output'],
      is_error: status === 'error',
    } as ContentBlock);

    // §7.1: append the standalone resource block(s) right after the
    // tool_result of a COMPLETED tool, mirroring the daemon's persisted
    // transcript (`record_tool`) and live delta stream (subscriptions.rs) so
    // the card renders mid-stream. The daemon-claimed canonical batch carried
    // on the event (`registeredAttachments`, deterministic attach) wins;
    // otherwise fall back to the FE lift of a proposal-MIME resource item out
    // of the echoed output — including the collapsed-output/wrap-repair
    // fallback for providers that flatten the MCP content-item array. A tool
    // that ends in `error` never surfaces a standalone block.
    if (status === 'completed') {
      // Deliberate deviation from the daemon's own delta path
      // (subscriptions.rs::tool_delta uses the array wholesale): items are
      // validated through getResourceContents and the lift fallback fires
      // when ALL are malformed. Defensive only — every item the daemon sends
      // today is well-formed by construction (TurnAttachment::resource_item);
      // revisit if the batch shape ever grows new item variants.
      const registered = Array.isArray(registeredAttachments)
        ? registeredAttachments.filter((item) => getResourceContents(item) !== null)
        : [];
      const items =
        registered.length > 0
          ? registered
          : ([liftProposalResourceItem(output)].filter(Boolean) as Record<string, unknown>[]);
      if (items.length > 0) {
        state.attachmentsByUseIndex.set(
          blockIndex,
          items.map((item, ordinal) => {
            const attachmentBlockId = predictAttachmentBlockId(blockId, ordinal);
            return {
              ...(item as Record<string, unknown>),
              ...(attachmentBlockId ? { id: attachmentBlockId } : {}),
            } as unknown as ContentBlock;
          }),
        );
      }
    }
  }

  dispatchStreamUpdate(agentId, state, 'content-blocks');

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
 * `agent:stream:status` (PROTOCOL §6.5 / §7 pre-first-token hints) carries the
 * self-sufficient `{ agentId, workspaceId, phase, message, level, timestamp }`
 * payload the daemon emits while a turn is starting (`launch` / `init` /
 * `session-create` / `session-load` / `prompt`). Map it to
 * `streamStatusReceived` so the chat spinner surfaces the current phase —
 * "Sent prompt…" and friends — before the first `agent:stream:chunk` arrives.
 *
 * Phase, message, level, and timestamp round-trip verbatim. The renderer uses
 * the machine-readable phase only to select motion and never infers or rewrites
 * the daemon-authored message.
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
  if (message.length === 0) return;
  const levelRaw = data.level;
  const level: 'info' | 'warn' | 'error' =
    levelRaw === 'warn' || levelRaw === 'error' ? levelRaw : 'info';
  const timestamp = typeof data.timestamp === 'number' ? data.timestamp : Date.now();
  // `stalled` events carry the additive `silentMs` (monorepo#3402): the
  // silence already measured at emission, so the UI can anchor its live
  // counter at `timestamp - silentMs` instead of understating by the
  // detection threshold.
  const silentMs =
    typeof data.silentMs === 'number' && Number.isFinite(data.silentMs) && data.silentMs >= 0
      ? data.silentMs
      : undefined;
  appStore.dispatch(
    streamStatusReceived(
      agentId,
      silentMs !== undefined
        ? { phase, message, level, timestamp, silentMs }
        : { phase, message, level, timestamp },
      false,
    ),
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
 * the lifecycle send path, which never runs for a wake turn.
 *
 * The accumulator is primed under the wake turn's `messageId` and a `started`
 * stream update creates the in-flight assistant placeholder, mirroring the
 * user-initiated flow in `agent-stream-lifecycle.sendMessage`. A stale
 * prior-turn accumulator is finalized as-is first (mirroring
 * `handleStreamEndEvent`) so the old in-flight assistant message does not stay
 * `isStreaming` until the next `agents.getConversation` reconcile. A duplicate
 * delivery for the same `messageId` (at-least-once, e.g. across a reconnect)
 * is a no-op: re-dispatching `chatSendStarted` mid-turn would wipe
 * `statusEvents`/`receivedFirstChunk` and restart the Thinking elapsed timer.
 * Subsequent `agent:stream:chunk` / `agent:tool:call` events carry the same
 * `messageId` and grow that message in place; `agent:stream:end` +
 * `agent:idle` finalize and clear the flags through the existing paths.
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
  const prior = streamsByAgent.get(agentId);
  if (prior && prior.messageId === messageId) return;
  if (prior) {
    dispatchStreamUpdate(agentId, prior, 'complete');
    streamsByAgent.delete(agentId);
  }
  ensureStream(agentId, messageId, workspaceId);
  appStore.dispatch(chatSendStarted(agentId, workspaceId));
  appStore.dispatch(
    agentStreamUpdateReceived({
      workspaceId,
      agentId,
      handlerSessionId: agentId,
      source: 'sendMessage',
      eventType: 'started',
      assistantMessageId: messageId,
      contentBlocks: [{ type: 'text', text: '' }],
      createInitialPlaceholder: true,
    }),
  );
  reportStreamLifecycle({
    stage: 'bridge',
    event: 'stream-start-dispatched',
    turnCorrelation: streamTurnCorrelation(messageId),
    callbackResult: 'dispatched',
    blockCount: 0,
  });
}

function handleStreamEndEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== 'string') return;
  // Optional interrupt marker (PROTOCOL §7): `agent.stop` mid-turn emits the
  // terminal `agent:stream:end` with `stopReason: "interrupted"` (+ the turn's
  // `messageId`); absence means a normal turn end.
  const stopReason = typeof data?.stopReason === 'string' ? data.stopReason : undefined;
  // Optional abnormal finish reason (PROTOCOL §7.3): the turn-worker terminal
  // emit carries `finishReason` when the turn completed with a non-`end_turn`
  // ACP stop reason (`refusal` | `max_tokens` | `max_turn_requests`); absent
  // on normal completions. The same value is persisted on the assistant row
  // as `metadata.finishReason`, so stamping it here just makes the notice
  // render live without waiting for a reconcile.
  const finishReason = typeof data?.finishReason === 'string' ? data.finishReason : undefined;
  // Interrupt cause + sender attribution (PROTOCOL §7.2): the interrupt-path
  // emit always carries `interruptReason` (`user_stop` | `preempted_by_message`)
  // and `interruptedBy` on an attributable preemption. Both mirror the
  // persisted row's metadata, so stamping them here makes the reason-specific
  // Stopped label ("Interrupted by <agent>" …) resolve live instead of the
  // generic "Stopped" until the transcript reloads.
  const interruptReason =
    typeof data?.interruptReason === 'string' ? data.interruptReason : undefined;
  const interruptedBy = readInterruptedBy(data?.interruptedBy, agentId);
  const endMetadata: StreamEndMetadata = {
    stopReason,
    finishReason,
    interruptReason,
    interruptedBy,
  };
  const messageId = typeof data?.messageId === 'string' ? data.messageId : undefined;
  // LIVE Q&A DELIVERY (PROTOCOL §7): the terminal `agent:stream:end` carries
  // `trailingBlocks` — the standalone resource blocks the daemon appended to
  // the turn's final assistant message after the text stream finished (Agent
  // Q&A questions today), byte-identical to the persisted transcript. Append
  // them into the accumulator before finalizing so the wizard triggers live
  // without a refetch. `buildContentBlocks`'s `dedupeResourceBlocks` keeps
  // this idempotent against tool-call-claimed copies of the same canonical
  // block (stamped `attachmentId` nonce).
  const trailingBlocks = Array.isArray(data?.trailingBlocks)
    ? (data.trailingBlocks.filter((b) => b !== null && typeof b === 'object') as ContentBlock[])
    : [];
  // Terminal live-preview values (intentd#792, PROTOCOL §7): every
  // transcript-bearing terminal emit re-derives `lastAgentResponse`/`digest`
  // from the turn's full streamed text (no newline clipping, unlike the
  // throttled mid-turn ping), so push-applying it here lands the preview on
  // the turn's true final state without an `agent.get` refetch. `lastToolUse`
  // describes a running turn only — clear it now that the turn is over.
  //
  // Ordering guard: the turn's assistant `messageId` is a UUIDv7 (minted at
  // turn start, `Uuid::now_v7()` in agent_session.rs), so lexicographic
  // comparison mirrors chronological turn order. A `messageId`-bearing
  // `stream:end` for a turn OLDER than the one `previewTurnMessageIdByAgent`
  // already tracks (a delayed/out-of-order terminal delivery) must not
  // clobber the newer turn's live preview/lastToolUse — skip the preview
  // writes and let the newer turn's own state stand; an unstamped/older
  // (falsy-comparison) terminal or one with no messageId still applies
  // (matches pre-existing behavior for daemons that omit messageId).
  const trackedMessageId = previewTurnMessageIdByAgent.get(agentId);
  const isStaleTerminalForPreview =
    messageId !== undefined && trackedMessageId !== undefined && messageId < trackedMessageId;
  if (!isStaleTerminalForPreview) {
    if (messageId !== undefined) {
      previewTurnMessageIdByAgent.set(agentId, messageId);
      // Record the ended turn so a straggler same-turn (or older-turn)
      // activity ping cannot re-open the sticky liveTurnOpen bit the
      // terminal choreography closes — see handleStreamActivityEvent.
      previewTurnEndedMessageIdByAgent.set(agentId, messageId);
    }
    withHydratedSession(agentId, () => {
      applyStreamPreviewFields(
        agentId,
        typeof data?.lastAgentResponse === 'string' ? data.lastAgentResponse : undefined,
        typeof data?.digest === 'string' ? data.digest : undefined,
      );
      appStore.dispatch(updateSession(agentId, { lastToolUse: undefined }));
    });
  }
  const state = streamsByAgent.get(agentId);
  reportStreamLifecycle({
    stage: 'bridge',
    event: 'agent-stream-end-received',
    turnCorrelation: streamTurnCorrelation(messageId ?? state?.messageId),
    callbackResult: 'received',
    blockCount: trailingBlocks.length,
  });
  if (state && (!messageId || state.messageId === messageId)) {
    if (trailingBlocks.length > 0) {
      const maxIndex = Math.max(-1, ...state.blocksByIndex.keys());
      trailingBlocks.forEach((block, ordinal) => {
        state.blocksByIndex.set(maxIndex + 1 + ordinal, block);
      });
    }
    dispatchStreamUpdate(agentId, state, 'complete', endMetadata);
    streamsByAgent.delete(agentId);
    return;
  }
  if (state) {
    // Accumulator holds a DIFFERENT turn's message: finalize it as-is and
    // fall through so the trailing blocks land under their own messageId.
    // The stopReason/finishReason/interrupt attribution belong to THIS
    // event's messageId — do not stamp the Stopped badge / finish notice onto
    // the unrelated accumulated turn.
    dispatchStreamUpdate(agentId, state, 'complete');
    streamsByAgent.delete(agentId);
  }
  // No local stream state for this turn (pre-first-token): the daemon
  // persisted an assistant row under `messageId` anyway — a synthetic empty
  // interrupted row on `agent.stop`, a zero-output abnormal turn (refusal /
  // token-limit marker row carrying `finishReason`), or a turn whose ONLY
  // content is the trailing blocks (e.g. questions with no streamed text).
  // Finalize a matching placeholder so the Stopped indicator / finish notice /
  // question wizard appears live. A later `agents.getConversation` reconcile
  // dedupes by message id. SOLE-WRITER INVARIANT: for a subscription-covered
  // agent the terminal §7.1 reconcile delivers the drained question blocks as
  // `added` blocks itself, so the firehose copy is omitted (same gate as
  // `dispatchStreamUpdate`) and only the metadata/flag bookkeeping applies.
  if (messageId && (trailingBlocks.length > 0 || stopReason === 'interrupted' || finishReason)) {
    appStore.dispatch(
      agentStreamUpdateReceived({
        workspaceId,
        agentId,
        handlerSessionId: agentId,
        source: 'sendMessage',
        eventType: 'complete',
        assistantMessageId: messageId,
        ...(hasStandingChatSubscription(agentId)
          ? {}
          : { contentBlocks: dedupeResourceBlocks(trailingBlocks) }),
        ...streamEndMetadataFields(endMetadata),
      }),
    );
    reportStreamLifecycle({
      stage: 'bridge',
      event: 'stream-complete-dispatched',
      turnCorrelation: streamTurnCorrelation(messageId),
      callbackResult: 'dispatched',
      blockCount: trailingBlocks.length,
    });
    return;
  }
  if (trailingBlocks.length > 0) {
    // Daemon/FE version skew: PROTOCOL §7 pairs trailingBlocks with messageId,
    // so a bare delivery has nowhere to land. Log instead of dropping silently.
    logger.debug('Dropping agent:stream:end trailingBlocks without a messageId', {
      agentId,
      trailingBlockCount: trailingBlocks.length,
    });
  }
  reportStreamLifecycle({
    stage: 'bridge',
    event: 'agent-stream-end-ignored',
    turnCorrelation: streamTurnCorrelation(messageId),
    callbackResult: 'ignored',
    blockCount: trailingBlocks.length,
  });
}

function handleAgentFailedStream(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  const error = data?.error;
  if (typeof agentId !== 'string') return;

  const state = streamsByAgent.get(agentId);
  const turnId = typeof data?.turnId === 'string' ? data.turnId : undefined;
  const turnCorrelation = streamTurnCorrelation(state?.messageId);
  const turnIdCorrelation = streamTurnCorrelation(turnId);
  const failureCorrelation =
    turnCorrelation || turnIdCorrelation
      ? {
          ...(turnCorrelation ? { turnCorrelation } : {}),
          ...(turnIdCorrelation ? { turnIdCorrelation } : {}),
        }
      : undefined;
  reportStreamLifecycle({
    stage: 'bridge',
    event: 'agent-failed-received',
    ...failureCorrelation,
    correlationBasis: turnCorrelation
      ? 'assistant-message'
      : turnIdCorrelation
        ? 'turn'
        : 'unjoinable',
    callbackResult: 'received',
  });
  if (state) {
    dispatchStreamUpdate(agentId, state, 'error');
    streamsByAgent.delete(agentId);
  }

  // Set chat error when agent:failed arrives so the StreamingStatus component
  // displays the failure message and Retry button. Dispatch this even when no
  // stream state exists (e.g., agent spawn failed before streaming started).
  // The failure also lands in the cross-workspace aggregation registry so the
  // grouped-failure toast layer can surface it — UNLESS the payload carries a
  // non-empty `parentAgentId` (PROTOCOL §6.5): a delegated agent's failure is
  // the parent's to handle and escalate, so no failure toast (monorepo#1991).
  // Gate strictly on the payload field (no local session lookups); absent →
  // toast shows, which keeps older daemons working. The daemon's
  // turn-correlation id (PROTOCOL §6.6) rides along when present so the
  // failure can be attributed to the exact turn (monorepo#1057).
  if (typeof error === 'string' && error.length > 0) {
    const parentAgentId = data?.parentAgentId;
    const hasParent = typeof parentAgentId === 'string' && parentAgentId.length > 0;
    if (!hasParent) {
      recordAgentFailure({ agentId, workspaceId, error });
    }
    appStore.dispatch(chatSendFailed(agentId, error, turnId, failureCorrelation));
    reportStreamLifecycle({
      stage: 'bridge',
      event: 'agent-failed-dispatched',
      ...failureCorrelation,
      correlationBasis: turnCorrelation
        ? 'assistant-message'
        : turnIdCorrelation
          ? 'turn'
          : 'unjoinable',
      callbackResult: 'dispatched',
    });
  } else if (!state) {
    reportStreamLifecycle({
      stage: 'bridge',
      event: 'agent-failed-ignored',
      ...failureCorrelation,
      correlationBasis: turnCorrelation
        ? 'assistant-message'
        : turnIdCorrelation
          ? 'turn'
          : 'unjoinable',
      callbackResult: 'ignored',
    });
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
 * projection via `refreshAgentSessionAfterEvent` — which preserves the local
 * transcript and schedules one trailing read when another read is already in
 * flight, so rapid marker updates converge to the newest AgentLite projection.
 */
function handleAgentUpdatedEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) return;
  void refreshAgentSessionAfterEvent(agentId);
  // Cross-window InterruptedAgentsModal reconciliation (§5.35):
  // agent.resolveInterrupted emits agent:updated per resolved agent, so an
  // open modal listing this agent re-checks agent.listInterrupted (debounced;
  // no-op when the modal is closed or the agent is not listed).
  notifyInterruptedAgentUpdated(agentId);
}

/**
 * Parse the persisted `lastToolUse` preview carried on `agent:last-message`
 * (§6.5) / `AgentLite` (§5.5): `{ name, input?, inputTruncated?, inputBytes? }`
 * with `input` bounded by the slim-projection budget. `name` is required and
 * non-empty; a payload diverging from the documented shape is rejected whole.
 */
function readPersistedLastToolUse(
  value: unknown,
):
  | { name: string; input?: Record<string, unknown>; inputTruncated?: boolean; inputBytes?: number }
  | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const { name, input, inputTruncated, inputBytes } = value as {
    name?: unknown;
    input?: unknown;
    inputTruncated?: unknown;
    inputBytes?: unknown;
  };
  if (typeof name !== 'string' || name.trim().length === 0) return undefined;
  if (
    input !== undefined &&
    (typeof input !== 'object' || input === null || Array.isArray(input))
  ) {
    return undefined;
  }
  if (inputTruncated !== undefined && typeof inputTruncated !== 'boolean') return undefined;
  if (inputBytes !== undefined && typeof inputBytes !== 'number') return undefined;
  return {
    name,
    ...(input !== undefined ? { input: input as Record<string, unknown> } : {}),
    ...(inputTruncated !== undefined ? { inputTruncated } : {}),
    ...(inputBytes !== undefined ? { inputBytes } : {}),
  };
}

/**
 * `agent:last-message` (§6.5, additive) — the content-bearing companion the
 * daemon emits alongside EVERY `agent:message`, carrying the persisted
 * preview projections the write just computed (the same values the §5.5
 * `AgentLite` projection serves). A user/assistant row's echo carries
 * `lastMessageRole` + `lastMessageId` plus its role-specific preview —
 * `lastAgentResponse` (assistant) or `lastUserMessage` (user) — and
 * `lastToolUse`, whose ABSENCE means the persisted preview is now cleared
 * (the newest message carries no tool call). The role-specific preview has
 * the same absence-means-cleared semantics: the daemon overwrites the
 * persisted preview column unconditionally on every user/assistant append,
 * deriving the payload field from the appended row itself, so an assistant
 * echo WITHOUT `lastAgentResponse` (a tool-only / text-free row) means the
 * persisted preview is now empty — clear it so a stale previous response
 * cannot outrank the fresh tool chip (same outcome as the `agent.get`
 * replace-ingest path). The OTHER role's preview column was not touched by
 * the append, so it is left alone. System (and other) rows keep the
 * base id-only echo shape (the preview columns were not touched), so they
 * only flip the daemon-capability flag. The apply is a metadata-only
 * `updateSession` merge — ZERO follow-up RPCs, and a loaded transcript is
 * never clobbered (`updateSession` leaves `messages` untouched). `hasUnread`
 * is re-derived from the freshness fields so the unread badge converges
 * without an `agent.get` (same derivation as wire ingest, monorepo#1597).
 */
function handleAgentLastMessageEvent(event: WorkspaceEvent): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const agentId = data.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) return;
  // The daemon emits this companion event: retire the `agent:message`
  // back-compat `agent.get` refresh for the rest of this bridge's lifetime.
  daemonEmitsLastMessage = true;
  const role = data.role;
  if (role !== 'user' && role !== 'assistant') return;
  const updates: Partial<AgentSession> = {
    lastToolUse: readPersistedLastToolUse(data.lastToolUse),
  };
  if (data.lastMessageRole === 'user' || data.lastMessageRole === 'assistant') {
    updates.lastMessageRole = data.lastMessageRole;
  }
  if (typeof data.lastMessageId === 'string' && data.lastMessageId.length > 0) {
    updates.lastMessageId = data.lastMessageId;
  }
  if (role === 'assistant') {
    updates.lastAgentResponse =
      typeof data.lastAgentResponse === 'string' ? data.lastAgentResponse : undefined;
  } else {
    updates.lastUserMessage =
      typeof data.lastUserMessage === 'string' ? data.lastUserMessage : undefined;
  }
  withHydratedSession(agentId, () => {
    const session = appStore.state.agentSessions?.byAgentId[agentId];
    if (!session) return;
    appStore.dispatch(
      updateSession(agentId, {
        ...updates,
        hasUnread: deriveAgentHasUnread({
          lastMessageRole: updates.lastMessageRole ?? session.lastMessageRole,
          lastMessageId: updates.lastMessageId ?? session.lastMessageId,
          isBackground: session.isBackground,
          metadata: session.metadata,
        }),
      }),
    );
  });
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
  // Mark the snapshot so an in-flight hydrate fetch that started before this
  // event discards its (now stale) response instead of overwriting it.
  noteAgentQueueEventSnapshotApplied(agentId);
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
 * `agent:process:queued` (§6.5) carries `{ agentId, used, cap, reason }` —
 * emitted when an agent spawn is queued waiting for admission: a free process
 * slot (maxConcurrent limit, reason `"slots"`) or memory headroom under the
 * aggregate budget (reason `"memory-budget"`, intent-hq/intentd#1196). The
 * payload is self-sufficient per §6.7, so the renderer sets the hint directly
 * without a follow-up read. An absent `reason` (older daemons) is normalized
 * to `"slots"`, the pre-#1196 behavior; a present-but-unrecognized value (a
 * hypothetical future constraint) also falls back to `"slots"` but logs a
 * warning so the divergence is observable rather than silently absorbed.
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
  if (data.reason !== undefined && data.reason !== 'slots' && data.reason !== 'memory-budget') {
    logger.warn('agent:process:queued with unrecognized reason; falling back to slots', {
      agentId,
      reason: data.reason,
    });
  }
  const reason = data.reason === 'memory-budget' ? 'memory-budget' : 'slots';
  appStore.dispatch(setProcessQueueHint(agentId, used, cap, reason));
}

/**
 * `agent:process:resumed` (§6.5) carries `{ agentId, used, cap, reason }` —
 * emitted when a queued agent spawn resumes (a slot freed / memory freed);
 * `reason` echoes the constraint the spawn originally queued under. The
 * renderer clears the hint so the UI no longer shows the waiting message.
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
 * `git:clone:progress` / `git:clone:done` (§5.1 / §6.5) — provisioning
 * progress for an in-flight `workspace.create` that carried an FE-minted
 * `progressId`, echoed back on `data.progressId`. Correlation is by
 * progressId only (the envelope `workspaceId` is server-minted mid-create and
 * unknown to the FE until the RPC returns, and standalone `git.clone` frames
 * carry an empty one), so these route BEFORE the workspace-id gate. Frames
 * without a `progressId` (plain `git.clone`, older daemons) are left for the
 * requestId-correlated legacy consumers.
 */
function handleCloneProgressEvent(event: WorkspaceEvent, type: string): boolean {
  const data = (event as { data?: Record<string, unknown> }).data;
  const progressId = data?.progressId;
  if (typeof progressId !== 'string' || progressId.length === 0) return false;
  if (type === 'git:clone:progress') {
    const phase = data?.phase;
    const percent = data?.percent;
    if (typeof phase !== 'string' || typeof percent !== 'number') return true;
    appStore.dispatch(
      workspaceCreateProgressReceived(progressId, {
        phase,
        percent,
        message: typeof data?.message === 'string' ? data.message : undefined,
      }),
    );
    return true;
  }
  appStore.dispatch(
    workspaceCreateProgressDone(progressId, {
      ok: data?.ok === true,
      error: typeof data?.error === 'string' ? data.error : undefined,
      errorCode: typeof data?.errorCode === 'string' ? data.errorCode : undefined,
    }),
  );
  return true;
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
 * which fetches the fresh note via a targeted `notes.get(noteId, workspaceId)`
 * on `note:created`/`note:updated` and dispatches the matching `applyNote*`
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
 * `task:created` (§6.5) carries `{ noteId, noteTitle, status, createdAt,
 * agentId? }` — a new task changes the BE-owned `task.list` rollup, so refetch
 * through the same debounced, initialized-workspaces-only path `note:*` uses.
 * The new task itself arrives with that refetch; the HUD feed row is rendered
 * off the HUD's own feed subscription.
 */
function handleTaskCreatedEvent(workspaceId: string): void {
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
 * list (§6.5); the event payload carries the *stored* (unmerged) list, so the
 * slice URL-unions it with the entity's current pool instead of replacing —
 * background cards keep git-root / monitor PRs the daemon only folds into
 * `workspace.list` (§6.9; monorepo#2951). `pr:unlinked` does not touch it —
 * the daemon owns the array and retains merged/closed history across unlinks. This
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
 * `changes:agent-locks` (§6.5, protocol v8.8) carries the self-sufficient
 * daemon-computed agent-lock snapshot `{ workspaceId, autoCommitEnabled,
 * lockedAgentIds: string[], lockedFilePaths: string[] }` — which agents' files
 * must not be manually staged/reverted (agent actively working + auto-commit
 * enabled). The wire arrays fold into the slice's `Record<string, true>`
 * lookup shape and dispatch straight into the agent-lock slice; the payload's
 * own `data.workspaceId` wins over the envelope id when present (same
 * convention as the tokenUsage/context handlers). Hydration on workspace
 * switch goes through the same-shaped `file-tracking.getAgentLocks` read
 * (§5.19, `hydrateAgentLocks` in file-tracking.client).
 */
function handleAgentLocksEvent(event: WorkspaceEvent, envelopeWorkspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const dataWorkspaceId = data.workspaceId;
  const workspaceId =
    typeof dataWorkspaceId === 'string' && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : envelopeWorkspaceId;
  if (!Array.isArray(data.lockedAgentIds) || !Array.isArray(data.lockedFilePaths)) return;
  appStore.dispatch(
    setAgentLockState(
      workspaceId,
      toLockRecord(data.lockedAgentIds),
      toLockRecord(data.lockedFilePaths),
    ),
  );
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
  // The partial merge is a silent no-op when the entity is not hydrated yet —
  // recover the dropped delta via a targeted workspace.get (see
  // {@link hydrateWorkspaceEntityIfMissing}).
  void hydrateWorkspaceEntityIfMissing(workspaceId);
}

/**
 * `workspace:attention-changed` (PROTOCOL §6.5 / §9.9) carries the
 * self-sufficient payload `{ workspaceId, attention }` — the daemon emits it
 * only on an actual change, so the FE mirrors the new value directly into the
 * workspace entity without a follow-up `workspace.get`. The wire values are
 * snake_case and match the FE type exactly, so no mapping is needed. The
 * HUD consumes this same event through its own subscription
 * (`hud-subscription.ts`) with independent bucket semantics — this handler
 * only feeds the workspace entity store. Like the tokenUsage/context/
 * displayStatus handlers, the payload's own `data.workspaceId` wins over the
 * envelope id when present.
 */
function handleAttentionChangedEvent(event: WorkspaceEvent, envelopeWorkspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const dataWorkspaceId = data.workspaceId;
  const workspaceId =
    typeof dataWorkspaceId === 'string' && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : envelopeWorkspaceId;
  const attention = data.attention;
  if (!isWorkspaceAttention(attention)) return;
  appStore.dispatch(
    bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { attention })]),
  );
  // The partial merge is a silent no-op when the entity is not hydrated yet —
  // recover the dropped delta via a targeted workspace.get (see
  // {@link hydrateWorkspaceEntityIfMissing}).
  void hydrateWorkspaceEntityIfMissing(workspaceId);
  // An unread raise is NOT auto-cleared for the workspace on screen: unread is
  // daemon-derived from per-agent seen markers (§5.1) and only reading each
  // agent's conversation clears it. When the raising agent's conversation is
  // the visible tab of a focused window, the per-agent turn-finish trigger
  // (`agent.markSeen`, see mark-agent-seen.ts) already marks it seen; a raise
  // for any other agent keeps the badge up by design.
}

/**
 * `workspace:waiting-changed` (PROTOCOL §5.1 / §6.5) carries the
 * self-sufficient payload `{ workspaceId, waiting }` — the daemon emits it
 * only on an actual transition of the orthogonal waiting flag (agents purely
 * waiting on hooks / PR monitors / watched agents), so the FE mirrors the new
 * boolean directly into the workspace entity without a follow-up
 * `workspace.get`. Like the attention/displayStatus handlers, the payload's
 * own `data.workspaceId` wins over the envelope id when present — and because
 * the payload is self-sufficient, an envelope whose `workspaceId` was
 * stripped by a relay still applies (routed before the envelope gate with
 * `envelopeWorkspaceId: null`).
 */
function handleWaitingChangedEvent(
  event: WorkspaceEvent,
  envelopeWorkspaceId: string | null,
): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const dataWorkspaceId = data.workspaceId;
  const workspaceId =
    typeof dataWorkspaceId === 'string' && dataWorkspaceId.length > 0
      ? dataWorkspaceId
      : envelopeWorkspaceId;
  const waiting = data.waiting;
  if (!workspaceId || typeof waiting !== 'boolean') return;
  appStore.dispatch(bulkUpdateWorkspaceEntities([updateWorkspaceEntity(workspaceId, { waiting })]));
  // The partial merge is a silent no-op when the entity is not hydrated yet —
  // recover the dropped delta via a targeted workspace.get (see
  // {@link hydrateWorkspaceEntityIfMissing}).
  void hydrateWorkspaceEntityIfMissing(workspaceId);
}

/**
 * Recover a dropped partial merge when the target workspace entity is not in
 * this window's store. The `bulkUpdateWorkspaceEntities` reducer is a no-op
 * for unknown ids, so a self-sufficient transition payload
 * (`workspace:attention-changed` / `workspace:waiting-changed` /
 * `workspace:displayStatus-changed`) arriving before the entity hydrates
 * (workspace created by another client on the same daemon, or the event
 * racing the initial `workspace.list`) would otherwise be silently lost until
 * an unrelated refetch. When the entity is missing, fetch `workspace.get` and
 * seed the full entity via `setWorkspaceEntity` — the fresh projection
 * carries the flag the dropped delta announced. Single-flighted with trailing
 * coalesce per workspaceId (AGENTS.md "Event-driven refetches — single-flight
 * and coalesced"): a burst of deltas for one missing workspace produces at
 * most one immediate fetch plus at most one trailing follow-up. Workspaces
 * with a pending local deletion are skipped so a tombstoned row is not
 * resurrected.
 */
const missingEntityFetchInFlightByWorkspace = new Set<string>();
const missingEntityFetchFollowUpWantedByWorkspace = new Set<string>();

async function runHydrateMissingWorkspaceEntityFetch(workspaceId: string): Promise<void> {
  const { backendRequest } = await import('$lib/client/live/backend-transport');
  try {
    const response = (await backendRequest('workspace.get', { workspaceId })) as
      { workspace?: Workspace } | undefined;
    const workspace = response?.workspace;
    if (workspace) {
      const { setWorkspaceEntity } =
        await import('$store/renderer/slices/workspace/workspace-slice');
      appStore.dispatch(setWorkspaceEntity(workspace));
    }
  } catch (_error) {
    // Workspace might have been deleted or transport error; no-op is safe.
  } finally {
    // Trailing coalesce: one or more triggers arrived while this fetch was in
    // flight — run exactly one follow-up fetch to pick up the latest state,
    // regardless of how many triggers piled up. The in-flight marker stays
    // set across the trailing fetch so triggers arriving during it keep
    // coalescing instead of starting a parallel fetch; it is only cleared
    // when no follow-up is pending.
    if (missingEntityFetchFollowUpWantedByWorkspace.delete(workspaceId)) {
      void runHydrateMissingWorkspaceEntityFetch(workspaceId);
    } else {
      missingEntityFetchInFlightByWorkspace.delete(workspaceId);
    }
  }
}

async function hydrateWorkspaceEntityIfMissing(workspaceId: string): Promise<void> {
  const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
  const state = appStore.state as {
    workspace: { workspaces: unknown; pendingDeletions: Record<string, boolean> };
  };
  if (state.workspace.pendingDeletions[workspaceId]) return;
  // The in-flight check runs BEFORE the entity-presence check: if another
  // path (e.g. a workspace.list response) hydrated the entity while a
  // missing-entity fetch is still in flight, a delta arriving now merges into
  // the present entity but the older fetch can resolve last and overwrite the
  // merged flag with its stale projection — queuing a trailing fetch (whose
  // projection postdates this delta) guarantees convergence.
  if (missingEntityFetchInFlightByWorkspace.has(workspaceId)) {
    missingEntityFetchFollowUpWantedByWorkspace.add(workspaceId);
    return;
  }
  if (getItem(state.workspace.workspaces as never, workspaceId as never)) return;
  missingEntityFetchInFlightByWorkspace.add(workspaceId);
  await runHydrateMissingWorkspaceEntityFetch(workspaceId);
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
/**
 * Single-flight + trailing-coalesce state for
 * {@link reconcileWorkspaceActivity}, keyed per workspaceId (AGENTS.md
 * "Event-driven refetches — single-flight and coalesced"). An N-event agent
 * burst for one workspace (e.g. an `agent:idle` burst when a multi-agent
 * delegation group settles, or per-agent `agent:stream:*` liveness pings
 * while the entity is stale) must produce at most one immediate
 * `workspace.get` plus at most one trailing follow-up — never one
 * independent fetch per event, since unordered resolution could let a stale
 * response that resolves last overwrite a newer `activity` value.
 */
const activityFetchInFlightByWorkspace = new Set<string>();
const activityFetchFollowUpWantedByWorkspace = new Set<string>();

async function runReconcileWorkspaceActivityFetch(workspaceId: string): Promise<void> {
  const { backendRequest } = await import('$lib/client/live/backend-transport');
  try {
    const response = (await backendRequest('workspace.get', { workspaceId })) as
      { workspace?: Workspace } | undefined;
    const workspace = response?.workspace;
    if (!workspace) return;

    const fetchedActivity = workspace.activity;
    if (fetchedActivity !== 'idle' && fetchedActivity !== 'agent_running') return;
    // Type narrowing: fetchedActivity is now 'idle' | 'agent_running'
    const activity: 'idle' | 'agent_running' = fetchedActivity;

    // If the entity already exists, use bulkUpdateWorkspaceEntities for a
    // partial merge. Otherwise, seed the full workspace entity with
    // setWorkspaceEntity so future events can merge into it. Re-read the
    // store here (not at trigger time) so the trailing fetch sees the
    // current entity state.
    const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
    const state = appStore.state as { workspace: { workspaces: unknown } };
    const current = getItem(state.workspace.workspaces as never, workspaceId as never);
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
  } finally {
    // Trailing coalesce: one or more triggers arrived while this fetch was in
    // flight — run exactly one follow-up fetch to pick up the latest state,
    // regardless of how many triggers piled up. The in-flight marker stays
    // set across the trailing fetch so triggers arriving during it keep
    // coalescing instead of starting a parallel fetch; it is only cleared
    // when no follow-up is pending.
    if (activityFetchFollowUpWantedByWorkspace.delete(workspaceId)) {
      void runReconcileWorkspaceActivityFetch(workspaceId);
    } else {
      activityFetchInFlightByWorkspace.delete(workspaceId);
    }
  }
}

async function reconcileWorkspaceActivity(
  workspaceId: string,
  impliesBusy: boolean,
): Promise<void> {
  const { getItem } = await import('@augmentcode/themis/utils/collections/collection-utils');
  const state = appStore.state as { workspace: { workspaces: unknown } };
  const current = getItem(state.workspace.workspaces as never, workspaceId as never) as
    { activity?: 'idle' | 'agent_running' } | undefined;

  // If the entity doesn't exist yet, or if we see a busy signal and activity
  // isn't already agent_running, or if we see an idle signal (always refetch
  // on idle — the daemon's live count is authoritative), fetch workspace.get
  // and merge the fresh activity. Single-flighted with trailing coalesce per
  // workspaceId (see {@link activityFetchInFlightByWorkspace}): the leading
  // edge fetches immediately, and any triggers that arrive while that fetch
  // is in flight collapse into at most one trailing follow-up.
  if (!current || (impliesBusy && current.activity !== 'agent_running') || !impliesBusy) {
    if (activityFetchInFlightByWorkspace.has(workspaceId)) {
      activityFetchFollowUpWantedByWorkspace.add(workspaceId);
      return;
    }
    activityFetchInFlightByWorkspace.add(workspaceId);
    await runReconcileWorkspaceActivityFetch(workspaceId);
  }
}

/**
 * Single-flight + trailing-coalesce state for
 * {@link reconcileWorkspaceAgentSummary}, keyed per workspaceId (AGENTS.md
 * "Event-driven refetches — single-flight and coalesced"). A burst of
 * `agent:deleted` events for the same workspace (e.g. a multi-agent cleanup)
 * must produce at most one immediate `workspace.get` plus at most one
 * trailing follow-up — never one independent fetch per event, since
 * unordered resolution could let a stale response that resolves last
 * restore an already-deleted agent into `agentSummary`.
 */
const agentSummaryFetchInFlightByWorkspace = new Set<string>();
const agentSummaryFetchFollowUpWantedByWorkspace = new Set<string>();

async function runReconcileWorkspaceAgentSummaryFetch(workspaceId: string): Promise<void> {
  const { backendRequest } = await import('$lib/client/live/backend-transport');
  try {
    const response = (await backendRequest('workspace.get', { workspaceId })) as
      { workspace?: Workspace } | undefined;
    const workspace = response?.workspace;
    if (workspace) {
      const { setWorkspaceEntity } =
        await import('$store/renderer/slices/workspace/workspace-slice');
      appStore.dispatch(setWorkspaceEntity(workspace));
    }
  } catch (_error) {
    // Workspace might have been deleted or transport error; no-op is safe.
  } finally {
    agentSummaryFetchInFlightByWorkspace.delete(workspaceId);
    // Trailing coalesce: one or more triggers arrived while this fetch was in
    // flight — run exactly one follow-up fetch to pick up the latest state,
    // regardless of how many triggers piled up.
    if (agentSummaryFetchFollowUpWantedByWorkspace.delete(workspaceId)) {
      void runReconcileWorkspaceAgentSummaryFetch(workspaceId);
    }
  }
}

/**
 * Refresh the workspace entity's BE-owned `agentSummary` aggregate (PROTOCOL
 * §5.1) after an `agent:deleted` event. The HUD card agent rows are built
 * from `workspace.agentSummary.agents` (`agentInfosOf` in hud-selectors.ts),
 * which the `agent.list` hydration path does NOT touch — without this
 * refetch a deleted agent lingers on its card until an unrelated workspace
 * refetch. Fetch `workspace.get` and merge the fresh entity via
 * `setWorkspaceEntity` (the `mergeWorkspaceEnrichment` path takes the
 * incoming `agentSummary` when present). Single-flighted with trailing
 * coalesce per workspaceId (see {@link agentSummaryFetchInFlightByWorkspace}):
 * the leading edge fetches immediately, and any triggers that arrive while
 * that fetch is in flight collapse into at most one trailing follow-up.
 */
async function reconcileWorkspaceAgentSummary(workspaceId: string): Promise<void> {
  if (agentSummaryFetchInFlightByWorkspace.has(workspaceId)) {
    agentSummaryFetchFollowUpWantedByWorkspace.add(workspaceId);
    return;
  }
  agentSummaryFetchInFlightByWorkspace.add(workspaceId);
  await runReconcileWorkspaceAgentSummaryFetch(workspaceId);
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
 * blind-spread, so unknown fields are dropped rather than leaking into the
 * entity (`attention` is deliberately absent from the whitelist — its changes
 * arrive via the dedicated `workspace:attention-changed` event). Field
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
  // `mcpServerToggled` (§5.22 per-workspace disable) is a non-column delta —
  // a self-sufficient notification of a workspace-scoped `mcp.servers.toggle`,
  // never a `Workspace` field — so it routes to the mcp-settings slice and is
  // excluded from the entity whitelist below. Resolve serverId → name via the
  // current server list (same pattern as `mcp.servers:status-changed`); when
  // the list has not loaded the id yet, drop the update — the sidebar's
  // hydrate on mount converges the state.
  handleWorkspaceMcpServerToggled(raw, workspaceId);
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

  // Tab-bar sync: the daemon `workspace:updated` event is the single driver
  // for archive transitions. Archived → close the tab unconditionally (the
  // reducer no-ops when it is not open) and navigate away only when the
  // archived workspace is on screen; Active/unarchive → restore the tab in
  // the background (no focus steal). Deltas carrying neither field leave tab
  // state untouched — `changes` only holds fields the wire delta explicitly
  // carried.
  if (changes.status === WorkspaceStatus.Archived || changes.archived === true) {
    closeWorkspaceTabAndNavigateAway(workspaceId).catch((error) => {
      logger.warn('closeWorkspaceTabAndNavigateAway failed after workspace:updated archive', error);
    });
    // Workspace archive discards all tabs (protocol §5.9, monorepo#2857):
    // destroy the agent-owned browser tabs — visible and hidden — whose
    // pinned webviews would otherwise stay mounted offscreen indefinitely,
    // and drop main's CDP/ownership registrations for their owners.
    const ownerAgentIds = collectOwnedTabAgentIds(workspaceId);
    appStore.dispatch(destroyOwnedTabsForWorkspace(workspaceId));
    for (const agentId of ownerAgentIds) {
      void invoke(IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId }).catch((error: unknown) => {
        logger.warn('Failed to clear main-process registrations for archived workspace tabs', {
          workspaceId,
          agentId,
          error,
        });
      });
    }
  } else if (changes.status === WorkspaceStatus.Active || changes.archived === false) {
    appStore.dispatch(restoreWorkspaceTab(workspaceId));
  }

  // Auto-unarchive stamp: an additive field the daemon attaches to the
  // unarchive delta when an agent turn start unarchived the workspace
  // (absent on manual `workspace.unarchive` / `workspace.restore`). Surface
  // one transient toast naming the workspace and the agent that became
  // active; malformed or unknown-reason stamps are ignored.
  const autoUnarchive = raw.autoUnarchive;
  if (autoUnarchive && typeof autoUnarchive === 'object') {
    const stamp = autoUnarchive as Record<string, unknown>;
    if (
      stamp.reason === 'agent_activity' &&
      typeof stamp.agentId === 'string' &&
      typeof stamp.agentName === 'string'
    ) {
      void showWorkspaceAutoUnarchiveToast({
        workspaceId,
        agentId: stamp.agentId,
        agentName: stamp.agentName,
      });
    }
  }
}

/**
 * `mcpServerToggled` on a `workspace:updated` delta (PROTOCOL §5.22
 * per-workspace disable / §6.5): `{ serverId, workspaceDisabled }` — emitted
 * on every workspace-scoped `mcp.servers.toggle`, so other windows (and
 * agent-driven toggles) mirror the per-workspace state without a follow-up
 * `mcp.servers.list` read. The slice keys the map by server *name*, so the
 * daemon id resolves via the current server list; an unresolvable id is
 * dropped (the sidebar's mount hydrate converges the state later).
 */
function handleWorkspaceMcpServerToggled(raw: Record<string, unknown>, workspaceId: string): void {
  const toggled = raw.mcpServerToggled;
  if (!toggled || typeof toggled !== 'object') return;
  const { serverId, workspaceDisabled } = toggled as Record<string, unknown>;
  if (typeof serverId !== 'string' || !serverId || typeof workspaceDisabled !== 'boolean') {
    return;
  }
  const servers = appStore.state.mcpSettings.servers;
  const match = servers.find((s) => s.id === serverId);
  if (!match) return;
  appStore.dispatch(setWorkspaceMcpServerDisabled(workspaceId, match.name, workspaceDisabled));
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
 * (intent-hq/monorepo#775; see the workspace-list saga).
 */
function handleWorkspaceDeletedEvent(workspaceId: string): void {
  const state = appStore.state as {
    agentSessions?: { agentIdsByWorkspace: Record<string, string[]> };
  };
  const agentIds = state.agentSessions?.agentIdsByWorkspace[workspaceId] ?? [];
  // Resolve owned-tab agents BEFORE the purge: `workspaceDeleted` drops the
  // whole panel-layout entry (destroying the pinned webviews), so main's
  // CDP/ownership registrations must be collected first (monorepo#2857).
  const ownerAgentIds = collectOwnedTabAgentIds(workspaceId);
  appStore.dispatch(workspaceDeleted(workspaceId, [...agentIds]));
  for (const agentId of ownerAgentIds) {
    void invoke(IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId }).catch((error: unknown) => {
      logger.warn('Failed to clear main-process registrations for deleted workspace tabs', {
        workspaceId,
        agentId,
        error,
      });
    });
  }
  navigateAwayIfViewing(workspaceId).catch((error) => {
    logger.warn('navigateAwayIfViewing failed after workspace:deleted', error);
  });
}

/**
 * Owner agent IDs of the agent-owned browser tabs (visible and hidden) in a
 * workspace's panel layout — the set whose main-process CDP/ownership
 * registrations need clearing when the workspace's tabs are discarded on
 * archive/delete (monorepo#2857).
 */
function collectOwnedTabAgentIds(workspaceId: string): Set<string> {
  const layout = (
    appStore.state as {
      panelLayout?: {
        byWorkspaceId: Record<
          string,
          {
            panels: Record<string, { tabs: Array<{ type: string; ownerAgentId?: string }> }>;
          }
        >;
      };
    }
  ).panelLayout?.byWorkspaceId[workspaceId];
  const ownerAgentIds = new Set<string>();
  if (!layout) return ownerAgentIds;
  for (const panel of Object.values(layout.panels)) {
    for (const tab of panel.tabs) {
      if (tab.type === 'browser' && typeof tab.ownerAgentId === 'string') {
        ownerAgentIds.add(tab.ownerAgentId);
      }
    }
  }
  for (const tab of selectHiddenTabs.select(appStore.state, workspaceId)) {
    if (tab.type === 'browser' && typeof tab.ownerAgentId === 'string') {
      ownerAgentIds.add(tab.ownerAgentId);
    }
  }
  return ownerAgentIds;
}

/**
 * `workspace:created` (PROTOCOL §7) — recycled-ID guard. A create may reuse
 * the ID of a previously deleted workspace; if the store still carries
 * agent/chat state under that ID (e.g. the `workspace:deleted` event was
 * missed), purge it exactly like a delete would, then dispatch
 * `hydrateAgentsRequested` so the lifecycle-read-service refetches the
 * daemon's canonical agent list for the new workspace.
 * Either way, lift any deletion tombstone first: a recycled ID must not stay
 * blocked from the store for the remainder of the post-delete grace window.
 *
 * Unknown-ID convergence: when the created ID is absent from the workspace
 * collection (created/imported by ANOTHER client on the same daemon — the
 * originating window seeds its own entity from the `workspace.create`
 * response), dispatch `loadWorkspacesRequested` so the already-open window
 * refetches the list and the new row appears without a reload. The event
 * payload is not used as the row source — `workspace.list` stays the single
 * canonical shape. The lifecycle-read-saga services the action single-flight
 * with trailing coalesce, so a create arriving mid-fetch queues one follow-up
 * refetch instead of being dropped.
 */
function handleWorkspaceCreatedEvent(workspaceId: string): void {
  const tombstoneTimer = workspaceDeleteTombstoneTimers.get(workspaceId);
  if (tombstoneTimer) {
    clearTimeout(tombstoneTimer);
    workspaceDeleteTombstoneTimers.delete(workspaceId);
  }
  appStore.dispatch(clearWorkspacePendingDeletion(workspaceId));
  const state = appStore.state as {
    agentSessions?: { agentIdsByWorkspace: Record<string, string[]> };
    workspaceAgents?: { byWorkspaceId: Record<string, unknown> };
    workspace?: {
      workspaces: { ids: string[] };
      pendingCreations: Record<string, unknown>;
    };
  };
  const isKnownWorkspace =
    state.workspace === undefined ||
    state.workspace.workspaces.ids.includes(workspaceId) ||
    state.workspace.pendingCreations[workspaceId] !== undefined;
  if (!isKnownWorkspace) {
    appStore.dispatch(loadWorkspacesRequested());
  }
  const agentIds = state.agentSessions?.agentIdsByWorkspace[workspaceId] ?? [];
  const hasLocalState =
    agentIds.length > 0 || state.workspaceAgents?.byWorkspaceId[workspaceId] !== undefined;
  if (!hasLocalState) return;
  appStore.dispatch(workspaceDeleted(workspaceId, [...agentIds]));
  appStore.dispatch(hydrateAgentsRequested(workspaceId));
}

/**
 * How long a bridge-armed pending-delete tombstone outlives the daemon's
 * commit deadline, so stale `list`/`get` responses computed before the commit
 * cannot resurrect the row. Mirrors WORKSPACE_DELETION_TOMBSTONE_TTL_MS /
 * AGENT_DELETION_TOMBSTONE_TTL_MS in the owning sagas (kept local — the
 * bridge stays saga-import-free).
 */
const DELETE_TOMBSTONE_TTL_MS = 60_000;
/** Fallback window used when a schedule event carries no parsable deleteAt. */
const DELETE_GRACE_FALLBACK_MS = 15_000;

/** Bridge-armed tombstone-clear timers, keyed by workspaceId / agentId. */
const workspaceDeleteTombstoneTimers = new Map<string, ReturnType<typeof setTimeout>>();
const agentDeleteTombstoneTimers = new Map<string, ReturnType<typeof setTimeout>>();

/** ms until `deleteAt` + the tombstone TTL (fallback window when unparsable). */
function tombstoneClearDelayMs(deleteAt: unknown): number {
  const deadline = typeof deleteAt === 'string' ? Date.parse(deleteAt) : Number.NaN;
  const untilDeadline = Number.isFinite(deadline)
    ? Math.max(0, deadline - Date.now())
    : DELETE_GRACE_FALLBACK_MS;
  return untilDeadline + DELETE_TOMBSTONE_TTL_MS;
}

/**
 * `workspace:delete-scheduled` (PROTOCOL §5.1 delete grace window, v6.7) —
 * `{ workspaceId, deleteAt }`. In the originating window the operations saga
 * already hid the row and set the tombstone, so the dispatches below are
 * idempotent no-ops there; in OTHER windows/clients this is the only signal,
 * so hide the row and set the `pendingDeletions` tombstone — the tombstone is
 * what stops a stale `workspace.get`/`list` response (computed before the
 * schedule, arriving after) from resurrecting the row via
 * `setWorkspaceEntity` (monorepo#1977). Local agent/chat state is deliberately
 * NOT purged: a cancel must restore instantly, and the commit's
 * `workspace:deleted` performs the purge. The tombstone is cleared on
 * `workspace:delete-cancelled`, on `workspace:created` (recycled ID), or by
 * the timer at deleteAt + grace — the timer only lifts the tombstone (nothing
 * refetches here), so after a missed cancel event the row converges back on
 * the next workspace-list refetch rather than instantly.
 *
 * Late-delivery race: if the originating window's undo completes before this
 * event is delivered (slow delivery / reconnect replay), the row is
 * transiently re-hidden — but `delete-scheduled`/`delete-cancelled` are
 * ordered on the stream, so the cancelled event that must follow lifts the
 * tombstone and its refetch restores the row.
 */
function handleWorkspaceDeleteScheduledEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  appStore.dispatch(removeWorkspaceEntity(workspaceId));
  appStore.dispatch(markWorkspacePendingDeletion(workspaceId));
  navigateAwayIfViewing(workspaceId).catch((error) => {
    logger.warn('navigateAwayIfViewing failed after workspace:delete-scheduled', error);
  });
  const existing = workspaceDeleteTombstoneTimers.get(workspaceId);
  if (existing) clearTimeout(existing);
  const timer = setTimeout(() => {
    workspaceDeleteTombstoneTimers.delete(workspaceId);
    appStore.dispatch(clearWorkspacePendingDeletion(workspaceId));
  }, tombstoneClearDelayMs(data?.deleteAt));
  workspaceDeleteTombstoneTimers.set(workspaceId, timer);
}

/**
 * `workspace:delete-cancelled` (PROTOCOL §5.1, v6.7) — `{ workspaceId }`. Lift
 * the tombstone and refetch the workspace so a window that hid the pending row
 * restores it promptly instead of waiting for the next unrelated refetch. The
 * payload carries no row, so reuse the single-flighted `workspace.get` →
 * `setWorkspaceEntity` fetch. In the originating window the undo saga already
 * restored its snapshot; the refetch simply reconciles.
 */
function handleWorkspaceDeleteCancelledEvent(workspaceId: string): void {
  const timer = workspaceDeleteTombstoneTimers.get(workspaceId);
  if (timer) {
    clearTimeout(timer);
    workspaceDeleteTombstoneTimers.delete(workspaceId);
  }
  appStore.dispatch(clearWorkspacePendingDeletion(workspaceId));
  void reconcileWorkspaceAgentSummary(workspaceId);
}

/**
 * `agent:delete-scheduled` (PROTOCOL §5.5 delete grace window, v6.7) —
 * `{ agentId, workspaceId, deleteAt }`. In the originating window the agent
 * mutation saga already soft-hid the session and registered the pending entry
 * (before the RPC resolved, so before this event can arrive) — skip so the
 * saga's own snapshot/tombstone lifecycle stays authoritative. In OTHER
 * windows, mirror the saga's soft-hide and ALWAYS register a registry entry —
 * with a snapshot when the session is hydrated locally (instant restore on
 * cancel), and without one otherwise, so the id is still tombstoned against a
 * stale `agent.get`/`list` begun before the schedule (no `pendingDeleteAt` on
 * the row) that resolves after it; a snapshot-less entry restores via the
 * cancel handler's reconcile refetch. The bridge timer lifts the entry at
 * deleteAt + grace — after the commit's `agent:deleted` the entry is exactly
 * the stale-refetch tombstone, and if a cancel event was missed the agent
 * converges back on the next refetch once the entry lifts. Same
 * late-delivery race note as the workspace handler above: an undo completing
 * before this event lands transiently re-hides, and the ordered cancelled
 * event restores.
 */
function handleAgentDeleteScheduledEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) return;
  if (isAgentDeletionPending(agentId)) return;
  const snapshot = appStore.state.agentSessions?.byAgentId[agentId];
  appStore.dispatch(removeAgent(workspaceId, agentId));
  appStore.dispatch(removeSession(agentId));
  appStore.dispatch(removeWatchedAgent(workspaceId, agentId));
  appStore.dispatch(pruneRecentlyClosed(workspaceId, { agentId }));
  // Always register the tombstone — even without a locally hydrated session.
  // An `agent.get`/`agent.list` begun before this event (no `pendingDeleteAt`
  // on the row) can resolve after it; without an entry that stale read would
  // resurrect the agent. Snapshot-less entries restore via the cancel
  // handler's reconcile refetch instead of an instant snapshot.
  registerAgentDeleteTombstone(
    workspaceId,
    agentId,
    tombstoneClearDelayMs(data?.deleteAt),
    snapshot,
  );
}

/**
 * Register (or replace) an agent's pending-deletion entry and arm the timer
 * that lifts it after `clearDelayMs`. Shared by the schedule handler above and
 * the immediate `agent:deleted` cleanup (which has no schedule event, so the
 * entry is the only tombstone against a stale `agent.get`/`list` begun before
 * the delete resolving after it).
 */
function registerAgentDeleteTombstone(
  workspaceId: string,
  agentId: string,
  clearDelayMs: number,
  snapshot?: AgentSession,
): void {
  setPendingAgentDeletion({ wsId: workspaceId, agentId, snapshot });
  const existing = agentDeleteTombstoneTimers.get(agentId);
  if (existing) clearTimeout(existing);
  const entry = getPendingAgentDeletion(agentId);
  const timer = setTimeout(() => {
    agentDeleteTombstoneTimers.delete(agentId);
    // Only lift the exact entry this timer was armed for — a later
    // re-delete's fresh entry (own saga or a newer schedule event) must
    // keep its own lifecycle.
    if (getPendingAgentDeletion(agentId) === entry) {
      removePendingAgentDeletion(agentId);
    }
  }, clearDelayMs);
  agentDeleteTombstoneTimers.set(agentId, timer);
}

/**
 * `agent:delete-cancelled` (PROTOCOL §5.5, v6.7) — `{ agentId, workspaceId }`.
 * Restore the soft-hidden session from the registry snapshot when one exists
 * (instant, mirrors the undo saga's `restoreHiddenSession`), then refetch the
 * canonical agent list — this also covers a window that filtered the pending
 * row out of a wire response before ever holding a snapshot. In the
 * originating window the undo saga restores its own snapshot; the registry
 * entry is already gone by the time this event lands, so only the reconcile
 * refetch runs there.
 */
function handleAgentDeleteCancelledEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  const agentId = data?.agentId;
  if (typeof agentId !== 'string' || agentId.length === 0) return;
  const timer = agentDeleteTombstoneTimers.get(agentId);
  if (timer) {
    clearTimeout(timer);
    agentDeleteTombstoneTimers.delete(agentId);
  }
  const pending = getPendingAgentDeletion(agentId);
  if (pending) {
    removePendingAgentDeletion(agentId);
    if (pending.snapshot) {
      appStore.dispatch(bulkUpsertSessions([pending.snapshot]));
      appStore.dispatch(upsertSession(pending.snapshot));
      appStore.dispatch(refreshWorkspaceSubscriptionEntriesRequested(workspaceId));
    }
  }
  appStore.dispatch(hydrateAgentsRequested(workspaceId));
}

function handleSettingsChangedEvent(
  event: WorkspaceEvent,
  onSettingsChanges?: (changes: AppliedSettingChange[], revision?: number) => void,
): void {
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
  if (changes.length === 0) return;
  const revision = typeof data.revision === 'number' ? data.revision : undefined;
  if (onSettingsChanges) onSettingsChanges(changes, revision);
  else applySettingsChanges(changes);
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
 * hydrated yet by lifecycle hydration (matches the reference saga).
 */
function handleScriptStateEvent(event: WorkspaceEvent, workspaceId: string): void {
  const data = (event as { data?: Record<string, unknown> }).data;
  if (!data) return;
  const { scriptId, ...rest } = data as { scriptId?: unknown } & Record<string, unknown>;
  if (typeof scriptId !== 'string') return;
  // PTY stream ended — drop the streaming decoder so a later run starts fresh.
  if (rest.status !== 'running') scriptOutputDecoders.delete(`${workspaceId}:${scriptId}`);
  // The event is a full ScriptRuntimeState snapshot, but the reducer shallow-merges:
  // make the presence-detected marker explicit so an absent key clears a stale
  // `previouslyRunning` from an earlier `script.list` hydration.
  rest.previouslyRunning = rest.previouslyRunning === true;
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
 * - git/status-changing events → `git:status-changed { workspaceId }` — the
 *   listener only gates on workspaceId before a debounced reload.
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
    case 'git:commit':
    case 'git:pull':
    case 'changes:git-status':
      emitMockIpcEvent('git:status-changed', { workspaceId });
      return;
    case 'changes:tracked':
      emitMockIpcEvent('git:status-changed', { workspaceId });
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
 * The daemon-state → badge mapping is the shared `mapDaemonMcpState` from
 * mcp-settings-normalization (also used by the load saga's status fetch).
 */

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
 * `git:pull`, `changes:git-status`, `changes:tracked`). These can fire frequently during
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
 * Daemon-sent highlight ids may be legacy hash aliases (e.g.
 * `quickActions.defaultModel`); resolve them to the registry target id the
 * DOM carries as `data-highlight-id`, like NavLink does, falling back to the
 * raw id when unresolved.
 */
function resolveHighlightId(highlightId: string): string {
  return resolveHashToTarget(highlightId)?.id ?? highlightId;
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

  const rawHighlightId = typeof data.highlightId === 'string' ? data.highlightId.trim() : '';
  const highlightId = rawHighlightId ? resolveHighlightId(rawHighlightId) : '';
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

  const highlightId = resolveHighlightId(id.trim());
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
    invoke(IPC_CHANNELS.WINDOW.OPEN_NEW, { route, requestId: event.id })
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

export interface DaemonEventsRoutingOverrides {
  onSettingsChanges?: (changes: AppliedSettingChange[], revision?: number) => void;
}

export function routeDaemonEventsNotification(
  method: string,
  params: unknown,
  expectedSubscriptionIds: string | readonly string[] | undefined = undefined,
  overrides?: DaemonEventsRoutingOverrides,
): void {
  if (method !== 'events.event') return;
  // Fan-out scope gate (see file header): drop notifications delivered through
  // a different subscription on the same socket so chunk-append/queue/idle
  // handlers never apply the same event twice. The saga owns two leases
  // (firehose + scoped file:*), so the gate accepts a set of expected ids; a
  // bare string is still accepted for back-compat with older call sites.
  // Flat/legacy envelopes (no `subscriptionId` on params) always pass.
  const envelopeSubscriptionId = extractSubscriptionId(params);
  if (envelopeSubscriptionId !== undefined) {
    const expected =
      typeof expectedSubscriptionIds === 'string'
        ? [expectedSubscriptionIds]
        : (expectedSubscriptionIds ?? []);
    if (!expected.includes(envelopeSubscriptionId)) return;
  }
  const event = extractEvent(params);
  if (!event || typeof event !== 'object') return;
  const type = (event as { type?: unknown }).type;
  if (typeof type !== 'string') return;

  // `settings:changed` (§6.5) is global — no `workspaceId` envelope is
  // expected, so it must be routed BEFORE the workspace-id gate below.
  if (type === 'settings:changed') {
    handleSettingsChangedEvent(event, overrides?.onSettingsChanges);
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

  // `workspace:waiting-changed` (§5.1 / §6.5) also carries a self-sufficient
  // `data.workspaceId`, so an envelope with a stripped workspaceId must not
  // be gated out. Envelope-carrying events fall through to the gated
  // side-effect route below (keeping the timeline fan-out); only the
  // envelope-less shape is handled here.
  if (type === 'workspace:waiting-changed' && !workspaceIdOf(event)) {
    handleWaitingChangedEvent(event, null);
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

  // `git:clone:progress` / `git:clone:done` frames carrying a `data.progressId`
  // correlate to an in-flight `workspace.create` by progressId, not by
  // workspaceId (server-minted mid-create, unknown to the FE), so they route
  // before the workspace-id gate. Frames without a progressId fall through to
  // the legacy requestId-correlated consumers below.
  if (
    (type === 'git:clone:progress' || type === 'git:clone:done') &&
    handleCloneProgressEvent(event, type)
  ) {
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
  // Delete grace window (§5.1/§5.5, v6.7): schedule events hide the pending
  // row in every window (the originating one already did — idempotent), and
  // cancel events restore it promptly instead of waiting for the next
  // refetch (monorepo#1977).
  if (type === 'workspace:delete-scheduled') {
    handleWorkspaceDeleteScheduledEvent(event, workspaceId);
    return;
  }
  if (type === 'workspace:delete-cancelled') {
    handleWorkspaceDeleteCancelledEvent(workspaceId);
    return;
  }
  if (type === 'agent:delete-scheduled') {
    handleAgentDeleteScheduledEvent(event, workspaceId);
    return;
  }
  if (type === 'agent:delete-cancelled') {
    handleAgentDeleteCancelledEvent(event, workspaceId);
    return;
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
  // `workspace:attention-changed` (§6.5 / §9.9) — merge the BE-owned
  // dismissible attention flag onto the workspace entity so unread indicators
  // update live without a refetch. Side effect, never an early return.
  if (type === 'workspace:attention-changed') {
    handleAttentionChangedEvent(event, workspaceId);
  }
  // `workspace:waiting-changed` (§5.1 / §6.5) — merge the BE-derived orthogonal
  // waiting flag onto the workspace entity so waiting indicators update live
  // without a refetch. Side effect, never an early return.
  if (type === 'workspace:waiting-changed') {
    handleWaitingChangedEvent(event, workspaceId);
  }

  // Legacy mock-IPC re-emit (side effect, never an early return) — components
  // still listening on the legacy channels get the daemon event too.
  relayLegacyIpcEvent(type, event, workspaceId);

  // Completion-watch lifecycle subset (side effect, never an early return):
  // these events feed the daemon's AS-3/AS-4 fan-in, so refresh every tracked
  // agent-subscription-ui entry via `agent.getSubscriptions` — completion
  // counts tick live while a coordinator waits on `waitMode: after_all`.
  if (SUBSCRIPTION_REFRESH_EVENT_TYPES.has(type)) {
    appStore.dispatch(refreshWorkspaceSubscriptionEntriesRequested(workspaceId));
  }

  // STAB-9: Agent lifecycle events (status-changed, idle) refresh ONLY the
  // affected agent — `refreshAgentSessionAfterEvent` fetches `agent.get`
  // (single-flight per agent with one trailing coalesced read, transcript
  // preserved, same delete-tombstone + `pendingDeleteAt` guards as the list
  // path) — so the sidebar shows live status/last-activity updates without
  // refetching the whole workspace agent list on every per-agent tick (a
  // large-workspace `agent.list` frame head-of-line blocks the shared
  // connection — see the audit in the workspace spec). Whole-list hydration
  // stays reserved for list-membership changes: mount, reconnect,
  // `workspace:created`, and agent-delete recovery. A payload without an
  // agentId (unexpected per §6.5) falls back to the list refetch so
  // convergence is never lost.
  if (type === 'agent:status-changed' || type === 'agent:idle') {
    const data = (event as { data?: Record<string, unknown> }).data;
    const agentId = data?.agentId;
    if (typeof agentId === 'string' && agentId.length > 0) {
      void refreshAgentSessionAfterEvent(agentId);
    } else {
      appStore.dispatch(hydrateAgentsRequested(workspaceId));
    }
  }

  // Failure-registry lifecycle: drop an agent from the failure aggregation
  // registry when its status leaves error/failed (recovered or retried) or
  // when it is deleted, so the grouped-failure toast reflects live failures
  // only. A status-less payload with `isActive: true` counts as leaving the
  // error state too — the same edge the stale-banner clear below accepts —
  // so the grouped toast and the inline banner never diverge on it. Side
  // effects, never early returns — both events fall through to the timeline
  // dispatch below.
  if (type === 'agent:status-changed') {
    const data = (event as { data?: Record<string, unknown> }).data;
    const agentId = data?.agentId;
    const status = data?.status;
    const leavesError =
      typeof status === 'string'
        ? status !== 'error' && status !== 'failed'
        : data?.isActive === true;
    if (typeof agentId === 'string' && leavesError) {
      removeAgentFailure(agentId);
    }
  }
  if (type === 'agent:deleted') {
    const data = (event as { data?: Record<string, unknown> }).data;
    if (typeof data?.agentId === 'string') {
      removeAgentFailure(data.agentId);
      // Keep the lazy Retired bin's count (v8.2) consistent with deletion:
      // a known retired row nudges the count down in lockstep with its
      // removal below; an id with no local session at all may be a retired
      // row this client never lazily loaded (deleted by another client), so
      // re-baseline from the daemon-served `retiredCount` via a hydrate —
      // the local removals below would otherwise change nothing and the
      // count-first toggle would go stale.
      const deletedSession = appStore.state.agentSessions?.byAgentId[data.agentId];
      if (deletedSession?.retiredAt) {
        appStore.dispatch(adjustRetiredCount(workspaceId, -1));
      } else if (!deletedSession) {
        appStore.dispatch(hydrateAgentsRequested(workspaceId));
      }
      // Drop the local slice state for the deleted agent — mirroring
      // `handleAgentDeleteScheduledEvent` — so an immediate delete (no
      // `agent:delete-scheduled` grace window) converges without waiting for
      // a refetch.
      appStore.dispatch(removeAgent(workspaceId, data.agentId));
      appStore.dispatch(removeSession(data.agentId));
      appStore.dispatch(removeWatchedAgent(workspaceId, data.agentId));
      appStore.dispatch(pruneRecentlyClosed(workspaceId, { agentId: data.agentId }));
      // Owned browser tabs die with their agent (monorepo#2857): the
      // deletion COMMIT (not the schedule — agent.cancelDelete during the
      // grace window restores tabs intact) destroys visible and hidden owned
      // tabs, then clears main's CDP/ownership registrations.
      appStore.dispatch(destroyTabsByOwnerAgent(workspaceId, data.agentId));
      void invoke(IPC_CHANNELS.BROWSER.CLEAR_AGENT_TABS, { agentId: data.agentId }).catch(
        (error: unknown) => {
          logger.warn('Failed to clear main-process registrations for deleted agent tabs', {
            agentId: data.agentId,
            error,
          });
        },
      );
      // Tombstone the id so an `agent.get`/`agent.list` begun before this
      // event (returning the pre-delete row) cannot resurrect it after the
      // removals above. An immediate delete has no schedule event, so no
      // pending entry exists yet; a scheduled delete's existing entry is
      // replaced, which re-arms its lift timer for the post-commit grace.
      registerAgentDeleteTombstone(
        workspaceId,
        data.agentId,
        DELETE_TOMBSTONE_TTL_MS,
        getPendingAgentDeletion(data.agentId)?.snapshot,
      );
    }
    // Refresh the workspace entity's BE-owned `agentSummary` aggregate so the
    // HUD card rows drop the deleted agent immediately — the `agent.list`
    // hydration above does not touch it. Fire-and-forget side effect, falls
    // through to the timeline dispatch below.
    void reconcileWorkspaceAgentSummary(workspaceId);
  }

  // monorepo#1106/#1989: a redrive that bypasses chat-send-service —
  // coordinator `agent.sendMessage`, another client's `agent.retry`, or this
  // FE's own failure-toast Retry (also `agent.retry`, which never routes
  // through the send lifecycle) — starts a new turn without the #1044
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
    if (typeof agentId === 'string' && status !== 'error' && status !== 'failed' && startsTurn) {
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
  // isResponding/isStreaming, stream activity/status), reconcile activity to
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
  if (type === 'task:created') {
    handleTaskCreatedEvent(workspaceId);
    // Side effect, never an early return: the activity timeline still records
    // the creation via the `eventReceived` dispatch below.
  }
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

  // `changes:agent-locks` (§6.5, protocol v8.8) — the daemon-computed
  // agent-lock snapshot. Self-sufficient payload, folded straight into the
  // agent-lock slice; no timeline value, so no eventReceived dispatch.
  if (type === 'changes:agent-locks') {
    handleAgentLocksEvent(event, workspaceId);
    return;
  }

  // Git/changes events should
  // refresh the changes slice so daemon-originated commits appear live in the
  // sidebar Changes panel. Debounce per workspace (~1s) because
  // `changes:tracked` can fire very frequently during agent activity.
  if (
    type === 'git:commit' ||
    type === 'git:pull' ||
    type === 'changes:git-status' ||
    type === 'changes:tracked'
  ) {
    debouncedChangesRefresh(workspaceId);
    // Fall through to the relayLegacyIpcEvent + eventReceived dispatches below
    // so the legacy mock-IPC listeners and activity timeline still work.
  }

  // Live stream family — accumulate per-agent and grow the in-flight assistant
  // message. `agent:failed` flows through both paths: it finalizes any
  // in-flight stream AND forwards the lifecycle to `eventReceived` so the
  // session status transitions to "failed".
  if (type === 'agent:stream:start') {
    handleStreamStartEvent(event, workspaceId);
    return;
  }
  if (type === 'agent:stream:activity') {
    handleStreamActivityEvent(event, workspaceId);
    return;
  }
  if (type === 'agent:stream:chunk') {
    handleStreamChunkEvent(event, workspaceId);
    return;
  }
  if (type === 'agent:tool:call') {
    handleToolCallEvent(event, workspaceId);
    return;
  }
  if (type === 'agent:stream:status') {
    handleStreamStatusEvent(event);
    return;
  }
  if (type === 'agent:stream:end') {
    handleStreamEndEvent(event, workspaceId);
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
  // Script definition/output/state (§6.5) — definition mutations trigger a
  // canonical list refetch, output feeds the live buffer, and state mirrors
  // the recomputed runtime into the scripts slice.
  if (type === 'script:changed') {
    appStore.dispatch(refreshScripts(workspaceId));
    // fall through so the activity timeline records the mutation
  }
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
  // `agent:retired` / `agent:restored` (§6.5) — retire is a soft archive: the
  // row survives with `retiredAt` set, restore clears it. Both are pure
  // metadata mutations on a live row, so the same metadata-only `agent.get`
  // refresh converges `retiredAt` on the session (transcript preserved) and
  // the sidebar moves the agent into/out of the Retired bin without a
  // whole-list refetch. The retired-row count (v8.2 lazy Retired bin) is
  // nudged in lockstep so the collapsed toggle stays consistent even before
  // the lazy retired-only read runs; hydration re-baselines it from the
  // daemon-served `retiredCount`.
  if (type === 'agent:retired' || type === 'agent:restored') {
    handleAgentUpdatedEvent(event);
    appStore.dispatch(adjustRetiredCount(workspaceId, type === 'agent:retired' ? 1 : -1));
  }
  // `agent:attention-requested` (requestDiscussion / reportBlocker) — the
  // daemon persists the attention-request fields on the session and also
  // emits `agent:updated`, but re-fetch here too so the sidebar/footer
  // indicator appears even if that companion event is missed. Same
  // metadata-only refresh as handleAgentUpdatedEvent (transcript preserved).
  if (type === 'agent:attention-requested') {
    handleAgentUpdatedEvent(event);
  }
  // `agent:last-message` (§6.5, additive) — content-bearing companion of
  // every `agent:message`: applies the persisted preview projections straight
  // off the payload (ZERO follow-up RPCs) and marks the daemon as emitting
  // the event, retiring the back-compat refresh below. Returns early: the
  // paired `agent:message` already records the row in the activity timeline,
  // so the companion falling through would double-count every message.
  if (type === 'agent:last-message') {
    handleAgentLastMessageEvent(event);
    return;
  }
  // STAB-22 (rewired): `agent:message` no longer triggers a transcript fetch.
  // Non-viewed agents' previews ride `agent:last-message` (above) and viewed
  // transcripts ride the standing `chat.subscribe` delta stream (§7.1) —
  // paging the whole conversation per persisted row multiplied every message
  // into O(pages) `agent.getConversation` calls. Back-compat: until the
  // daemon proves it emits the companion event, fall back to a light
  // metadata-only `agent.get` refresh (single-flight + trailing-coalesce,
  // transcript preserved) so previews on older daemons still converge.
  if (type === 'agent:message' && !daemonEmitsLastMessage) {
    const { agentId, role } = event.data ?? {};
    if (typeof agentId === 'string' && (role === 'assistant' || role === 'user')) {
      refreshAgentSessionCoalesced(agentId);
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
    // Evicted means the process was parked, NOT that the agent ended (§6.5):
    // dropped from the spawn queue before resuming, or reaped by the idle TTL
    // sweep (reason "idle-ttl", intent-hq/intentd#1356) — the session row
    // survives and the next send transparently respawns it. The daemon only
    // evicts idle processes, so clear the queue hint AND any stale optimistic
    // busy flags that would otherwise render a phantom "Thinking" indicator,
    // and demote a stale RUNNING status to idle (monorepo#3040).
    const data = (event as { data?: Record<string, unknown> }).data;
    if (data && typeof data.agentId === 'string') {
      appStore.dispatch(processEvicted(data.agentId));
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
export const DAEMON_EVENTS_SUBSCRIBE_TYPES = [
  'agent:*',
  // `file:*` is deliberately ABSENT: system-actor watcher bursts from every
  // open workspace would otherwise reach every window. The daemon-events-saga
  // carries file events on a separate subscription scoped to the active
  // workspace (`workspaceId` + `replaceGroup`, §6.1 — monorepo#1853).
  'note:*',
  'comment:*',
  'script:*',
  // Narrowed to `terminal:exit` only (not the full `terminal:*` firehose):
  // `terminal:data` fires on every byte of terminal output and would flood
  // the 100-entry activity-timeline buffer (workspace-events-slice.ts),
  // evicting unrelated events. `terminal:exit` is the only terminal event
  // this bridge currently handles (handleTerminalExitEvent below).
  'terminal:exit',
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
  // `workspace:attention-changed` (§6.5 / §9.9) — self-sufficient dismissible
  // attention flag changes so unread indicators update without a refetch.
  'workspace:attention-changed',
  // `workspace:waiting-changed` (§5.1 / §6.5) — self-sufficient orthogonal
  // waiting flag transitions so waiting indicators update without a refetch.
  'workspace:waiting-changed',
  'workspace:updated',
  'workspace:created',
  'workspace:deleted',
  // Delete grace window (§5.1, v6.7): schedule/cancel events keep the hidden
  // pending row consistent across windows (monorepo#1977). The agent-side
  // counterparts are covered by the `agent:*` wildcard above.
  'workspace:delete-scheduled',
  'workspace:delete-cancelled',
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
  // `changes:agent-locks` (§6.5, protocol v8.8) — the daemon-computed
  // agent-lock snapshot folded into the agent-lock slice; without the
  // subscribe filter the gating in FileChangesSection never engages live.
  'changes:agent-locks',
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

export async function refreshDaemonEventsAfterReconnect(
  activeWorkspaceId: string | null,
): Promise<void> {
  const state = appStore.state as {
    workspaceAgents?: {
      byWorkspaceId: Record<string, { activeAgentId?: string | null }>;
    };
  };
  if (activeWorkspaceId) {
    appStore.dispatch(hydrateAgentsRequested(activeWorkspaceId));
    const activeAgentId =
      state.workspaceAgents?.byWorkspaceId[activeWorkspaceId]?.activeAgentId ?? null;
    if (activeAgentId) {
      // NO transcript fetch here: the standing `chat.subscribe` registration
      // re-registers on the same reconnect signal and its fresh seq-0
      // snapshot (§7.1) IS the reconciled transcript — an eager
      // `agent.getConversation` page walk would duplicate that transfer on
      // every reconnect. Queue rows drained while the connection was down
      // never re-emit `agent:queue:updated`; reconcile the mirror from
      // `agent.getQueue` (monorepo#1749).
      void hydrateAgentQueue(activeAgentId);
    }
  }
  // The failure registry converges via live `agent:deleted` /
  // `agent:status-changed` events only; deletions during the missed-event
  // window leave stale entries whose toast offers Retry against a deleted
  // agent forever (monorepo#2806). Reconcile survivors against the daemon.
  await reconcileAgentFailureRegistry();
}

/**
 * Drop failure-registry entries whose agent no longer exists on the daemon.
 * One `agent.list` per DISTINCT workspace holding entries (no per-entry
 * fan-out — AGENTS.md "Event-driven refetches"); a failed or unverifiable
 * list (missing/non-array `agents`) keeps that workspace's entries
 * (unverifiable ≠ deleted — live events converge them later). Only entries
 * from the snapshot taken BEFORE the list, still identical in the registry
 * (the same identity-guard convention as retryAgent in the toast saga), are
 * dropped: a failure recorded or replaced while the list was in flight
 * predates nothing the stale result can prove, so it is kept. Never throws,
 * so the reconnect refresh can await it safely.
 */
async function reconcileAgentFailureRegistry(): Promise<void> {
  const entries = listAgentFailureEntries();
  if (entries.length === 0) return;
  const { backendRequest } = await import('$lib/client/live/backend-transport');
  const workspaceIds = [...new Set(entries.map((entry) => entry.workspaceId))];
  await Promise.all(
    workspaceIds.map(async (workspaceId) => {
      let survivorIds: Set<string>;
      try {
        const response = (await backendRequest('agent.list', { workspaceId })) as
          { agents?: Array<{ id?: unknown }> } | undefined;
        if (!Array.isArray(response?.agents)) {
          logger.warn(
            'agent.list returned no verifiable agents array during failure-registry reconciliation — keeping entries',
            { workspaceId },
          );
          return;
        }
        survivorIds = new Set(
          response.agents
            .map((agent) => agent?.id)
            .filter((id): id is string => typeof id === 'string'),
        );
      } catch (error) {
        logger.warn('agent.list failed during failure-registry reconciliation — keeping entries', {
          workspaceId,
          error,
        });
        return;
      }
      for (const entry of entries) {
        if (entry.workspaceId !== workspaceId) continue;
        if (survivorIds.has(entry.agentId)) continue;
        // Identity guard: only drop the exact entry snapshotted before the
        // list. Removed mid-flight (live agent:deleted) → already gone;
        // replaced mid-flight (re-failure) → the fresh entry postdates the
        // list result, which proves nothing about it — keep it.
        if (getAgentFailureEntry(entry.agentId) !== entry) continue;
        logger.warn('Dropping failure entry for agent no longer on the daemon', {
          agentId: entry.agentId,
          workspaceId,
        });
        removeAgentFailure(entry.agentId);
      }
    }),
  );
}

export function disposeDaemonEventsRoutingState(): void {
  streamsByAgent.clear();
  previewTurnMessageIdByAgent.clear();
  previewTurnEndedMessageIdByAgent.clear();
  daemonEmitsLastMessage = false;
  agentSessionRefreshInFlight.clear();
  agentSessionRefreshFollowUpWanted.clear();
  for (const timer of changesRefreshTimersByWorkspace.values()) {
    clearTimeout(timer);
  }
  changesRefreshTimersByWorkspace.clear();
  for (const timer of tasksRefreshTimersByWorkspace.values()) {
    clearTimeout(timer);
  }
  tasksRefreshTimersByWorkspace.clear();
  for (const timer of workspaceDeleteTombstoneTimers.values()) {
    clearTimeout(timer);
  }
  workspaceDeleteTombstoneTimers.clear();
  for (const timer of agentDeleteTombstoneTimers.values()) {
    clearTimeout(timer);
  }
  agentDeleteTombstoneTimers.clear();
  scriptOutputDecoders.clear();
  agentSummaryFetchInFlightByWorkspace.clear();
  agentSummaryFetchFollowUpWantedByWorkspace.clear();
  activityFetchInFlightByWorkspace.clear();
  activityFetchFollowUpWantedByWorkspace.clear();
  missingEntityFetchInFlightByWorkspace.clear();
  missingEntityFetchFollowUpWantedByWorkspace.clear();
}

/** Test-only — reset stream accumulators and debounce state. */
export function __resetDaemonEventsBridgeForTests(): void {
  disposeDaemonEventsRoutingState();
}
