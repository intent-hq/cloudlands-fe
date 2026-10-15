import { createBackendAgentSeen } from './backend-agent-seen';
const markAgentSeen = createBackendAgentSeen((...args) => backendRequest(...args));
import { createBackendAgentCreator } from './backend-agent-creator';
import { createBackendChatCommands } from './backend-chat-commands';
const chatCommands = createBackendChatCommands((...args) => backendRequest(...args));
import { createConversationReader } from './backend-conversation-reader';
/**
 * Live agents domain backed by the intentd daemon.
 *
 * Reads resolve via `agent.list({ workspaceId })` / `agent.get({ agentId })`.
 * `subscribe` aggregates agents across workspaces, converging via one typed
 * per-workspace `agent.subscribe` channel per workspace (PROTOCOL §6.9) —
 * the sole data path (intent-hq/monorepo#1697); there is no legacy
 * events-driven `agent.list` refetch.
 */
import { isAgentNotFoundError } from '$features/agent/utils/agent-not-found-error';
import { createMessageBlockReader } from './backend-message-block-reader';
import { getKnownAgentWorkspace } from './agent-normalization';
import { createBackendAgentClient } from './backend-agent-client';
import { createBackendPermissionClient } from './backend-permission-client';
import { onBackendNotification, onBackendReconnected } from './backend-transport';
export { normalizeAgent } from './agent-normalization';
// Keep call-time source lookup until the Svelte AppClient compatibility facade retires.
const agentReads = createBackendAgentClient({
  backendRequest: <T>(...args: Parameters<typeof backendRequest>) => backendRequest<T>(...args),
  onBackendNotification: (...args) => onBackendNotification(...args),
  onBackendReconnected: (...args) => onBackendReconnected(...args),
});
import type { AgentSession } from '$shared/types';
import type { QueuedMessage } from '$shared/types/agent-session';
import type {
  AgentCancelDeleteResult,
  AgentDeleteResult,
  AgentListOptions,
  AgentListResult,
  AgentRetireResult,
  AgentsClient,
  FileBlock,
  ImageBlock,
  MutationResult,
  PermissionOutcome,
  RespondPermissionResult,
  SubscriptionHandler,
  Unsubscribe,
  UserMessageIndexItem,
  UserMessageIndexResult,
} from '../app-client';
import { backendRequest } from './backend-transport';
import { isForbiddenErrorResponse } from './backend-transport-types';
import {
  mutationErrorMessage,
  newIdempotencyKey,
  runMutation,
  subscribeWorkspaceIds,
} from './live-support';

/**
 * agentId → workspaceId cache populated by every `normalizeAgent` call (so any
 * `list`/`get`/subscribe ingest also primes it). `agent.sendMessage` (§5.5)
 * requires `workspaceId`, but the seam's `send(agentId, message)` does not
 * carry it — this index lets us recover it without changing the public method
 * signature. Miss → fall back to a fresh `agent.get`.
 */

export class LiveAgentsClient implements AgentsClient {
  private retirementCapabilityRequest: { generation: number; promise: Promise<boolean> } | null =
    null;

  supportsRetirement(connectionGeneration = 0): Promise<boolean> {
    if (this.retirementCapabilityRequest?.generation !== connectionGeneration) {
      const promise = backendRequest<{
        server?: { capabilities?: { agentRetire?: number } };
      }>('client.hello', {})
        .then((result) => result?.server?.capabilities?.agentRetire === 1)
        .catch(() => false)
        .finally(() => {
          if (this.retirementCapabilityRequest?.promise === promise)
            this.retirementCapabilityRequest = null;
        });
      this.retirementCapabilityRequest = { generation: connectionGeneration, promise };
    }
    return this.retirementCapabilityRequest.promise;
  }

  async list(workspaceId: string, options?: AgentListOptions): Promise<AgentSession[]> {
    const { agents } = await this.listWithMeta(workspaceId, options);
    return agents;
  }

  // Svelte AppClient compatibility until cutover; list retains dynamic this.listWithMeta dispatch.
  listWithMeta(workspaceId: string, options?: AgentListOptions): Promise<AgentListResult> {
    return agentReads.listWithMeta(workspaceId, options);
  }

  get(agentId: string, workspaceId?: string): Promise<AgentSession | null> {
    return agentReads.get(agentId, workspaceId);
  }

  // The list/get payloads carry message COUNTS only; the real transcript comes
  // from `agent.getConversation` (§5.5), which returns one page of messages
  // (oldest→newest within the page). The daemon clamps `limit` to `[1,200]` —
  // `pageToken` walks backward to older pages, and `nextToken` is `null` once
  // the oldest message has been returned. The chat-read-service loops on
  // `nextToken` to assemble the full transcript. `aroundMessageId` (§5.5 seek,
  // additive) takes precedence over any token daemon-side and resolves to the
  // page containing that message; seek pages carry `prevToken` (forward cursor
  // toward the live tail — normalized to null on legacy backward pages, which
  // never include the key). `aroundIndex` (§5.5 ordinal seek, additive) is the
  // 0-based ordinal from the OLDEST message — out-of-range clamps daemon-side,
  // and daemons predating the param reject it with -32602 (the scrollback saga
  // handles the fallback). Every read opts into the §5.5 slim projection
  // (`projection: "slim"`, additive `agent.getConversation` param): oversized tool/image block
  // bodies arrive as bounded previews with `*Truncated`/`*Bytes` flags so a
  // large transcript never produces multi-MB frames (an older daemon ignores
  // the unknown param and serves full blocks — same additive convention as
  // `chat.subscribe`'s `deltaEncoding`). `messages` is returned raw; the
  // agent-session reducer normalizes/sorts/dedups/prunes on ingest.
  getConversation = createConversationReader({
    backendRequest: <T>(...args: Parameters<typeof backendRequest>) => backendRequest<T>(...args),
  });

  // One FULL content block by id (`agent.getMessageBlock`, §5.5) — the
  // on-demand counterpart of the slim projection: fetches the complete body
  // of a `*Truncated` slim block. The daemon returns `{ block }`; a missing
  // or malformed envelope rejects (callers rely on a real block or an error,
  // never a silent empty object).
  getMessageBlock = createMessageBlockReader({
    backendRequest: <T>(...args: Parameters<typeof backendRequest>) => backendRequest<T>(...args),
  });

  // Full user-message index (`agent.listUserMessages`, §5.5): every
  // user-role row as a lightweight `{ id, preview, createdAt, metadata? }`
  // item, oldest→newest, deliberately unpaged. `previewChars` only rides
  // along when supplied so the daemon default (300) applies otherwise.
  // Failures fold into a typed result instead of throwing so the navigator
  // can silently degrade to its tail-derived items: -32601 (older daemon
  // lacking the method) is marked `unsupported: true`; any other failure
  // keeps `unsupported: false`.
  async listUserMessages(
    agentId: string,
    previewChars?: number,
    workspaceId?: string,
  ): Promise<UserMessageIndexResult> {
    const params: Record<string, unknown> = {
      agentId,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    };
    if (previewChars !== undefined) params.previewChars = previewChars;
    try {
      const result = await backendRequest<{ items?: unknown[]; total?: unknown } | undefined>(
        'agent.listUserMessages',
        params,
      );
      const rawItems = Array.isArray(result?.items) ? result.items : [];
      const items = rawItems
        .filter((raw): raw is Record<string, unknown> => !!raw && typeof raw === 'object')
        .map((raw) => {
          const item: UserMessageIndexItem = {
            id: String(raw.id ?? ''),
            preview: String(raw.preview ?? ''),
            createdAt: String(raw.createdAt ?? ''),
          };
          // `metadata` is the persisted messageMetadata passed through
          // verbatim when present (§5.5) — never defaulted when absent.
          if (raw.metadata && typeof raw.metadata === 'object') {
            item.metadata = raw.metadata as Record<string, unknown>;
          }
          return item;
        });
      const total = typeof result?.total === 'number' ? result.total : items.length;
      return { ok: true, items, total };
    } catch (error) {
      const unsupported =
        !!error &&
        typeof error === 'object' &&
        'rpcCode' in error &&
        (error as { rpcCode?: unknown }).rpcCode === -32601;
      return {
        ok: false,
        unsupported,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  // Mutations forward to the daemon (§7.2); daemon agent-lifecycle events
  // drive the reactive refresh. `create` returns the full session projection
  // (widened in P2-12a) so the caller can upsert without a follow-up `agent.get`.
  // Compatibility binding until the source AppClient retires; creation policy is shared.
  create = createBackendAgentCreator({
    backendRequest: <T>(...args: Parameters<typeof backendRequest>) => backendRequest<T>(...args),
  });

  async send(agentId: string, message: string, workspaceId?: string): Promise<MutationResult> {
    workspaceId ??= (await this.resolveAgentWorkspaceId(agentId)) ?? undefined;
    if (!workspaceId) {
      return { success: false, error: `Unknown workspace for agent ${agentId}` };
    }
    // The seam's `send(agentId, message)` does not carry a messageId, so we mint
    // a stable uuid here. The daemon echoes it back on `agent:user-message:sent`,
    // which the renderer can use to reconcile the optimistic message it inserted
    // (§10.3). `agent.sendMessage` auto-queues internally if the agent is
    // mid-stream — the seam's `queue` is the explicit-enqueue path.
    const messageId = newIdempotencyKey();
    return runMutation('agent.sendMessage', { agentId, content: message, workspaceId, messageId });
  }
  async editAndRegenerate(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
    content: string;
    model?: string;
    imageBlocks?: ImageBlock[];
    fileBlocks?: FileBlock[];
  }): Promise<MutationResult> {
    // `agent.editAndRegenerate` (§5.5 catalog-parity extension) edits a past
    // user message and regenerates from that point. The daemon truncates the
    // transcript to just before the edited message and emits `agent:updated`
    // with `{ truncatedCount, remainingCount }`; the fresh turn then follows
    // the normal `agent:message` / `agent:stream:*` lifecycle. `model`,
    // `imageBlocks`, and `fileBlocks` are only forwarded when the caller
    // supplied them so the daemon sees an omitted param rather than an
    // explicit null it would reject — attachment blocks ride the regenerated
    // message exactly like `agent.sendMessage` (§5.5).
    const rpcParams: Record<string, unknown> = {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      messageId: params.messageId,
      content: params.content,
    };
    if (params.model !== undefined) rpcParams.model = params.model;
    if (params.imageBlocks !== undefined) rpcParams.imageBlocks = params.imageBlocks;
    if (params.fileBlocks !== undefined) rpcParams.fileBlocks = params.fileBlocks;
    return runMutation('agent.editAndRegenerate', rpcParams);
  }
  queue(...args: Parameters<ReturnType<typeof createBackendChatCommands>['queue']>) {
    return chatCommands.queue(...args);
  }
  async editQueued(
    agentId: string,
    messageId: string,
    content: string,
    editing?: boolean,
    workspaceId?: string,
  ): Promise<MutationResult> {
    // `agent.editQueuedMessage` (§5.5) returns `{ success, queuedMessage }`
    // like `agent.queueMessage`; surface `queuedMessage` so callers can render
    // the updated entry. The `editing` flag (STAB-27) holds the message during
    // edit — daemon drain skips held entries — and is only forwarded when the
    // caller supplied it so older daemons see an omitted param.
    try {
      const params: Record<string, unknown> = {
        agentId,
        messageId,
        content,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      };
      if (editing !== undefined) params.editing = editing;
      const result = await backendRequest<{ queuedMessage?: QueuedMessage } | undefined>(
        'agent.editQueuedMessage',
        params,
      );
      const queuedMessage = result?.queuedMessage;
      return queuedMessage ? { success: true, queuedMessage } : { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : String(error) };
    }
  }
  sendQueuedNow(
    ...args: Parameters<ReturnType<typeof createBackendChatCommands>['sendQueuedNow']>
  ) {
    return chatCommands.sendQueuedNow(...args);
  }
  async sendQueuedMessagesNow(params: {
    agentId: string;
    workspaceId: string;
    messageIds: string[];
  }): Promise<MutationResult> {
    try {
      const result = await backendRequest<{
        success: boolean;
        queued: boolean;
        quarantined?: boolean;
        messageIds: string[];
        turnId?: string;
      }>('agent.sendQueuedMessagesNow', {
        agentId: params.agentId,
        workspaceId: params.workspaceId,
        messageIds: params.messageIds,
      });
      return {
        success: result.success,
        queued: result.queued,
        messageIds: result.messageIds,
        ...(result.quarantined !== undefined ? { quarantined: result.quarantined } : {}),
        ...(!result.queued && !result.quarantined && result.turnId
          ? { turnId: result.turnId }
          : {}),
      };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  }
  getQueue(...args: Parameters<ReturnType<typeof createBackendChatCommands>['getQueue']>) {
    return chatCommands.getQueue(...args);
  }
  removeQueued(...args: Parameters<ReturnType<typeof createBackendChatCommands>['removeQueued']>) {
    return chatCommands.removeQueued(...args);
  }
  stop(...args: Parameters<ReturnType<typeof createBackendChatCommands>['stop']>) {
    return chatCommands.stop(...args);
  }
  async cancelSubscriptions(params: {
    agentId: string;
    workspaceId: string;
    subscriptionId?: string;
    groupId?: string;
  }): Promise<MutationResult> {
    // `agent.cancelSubscriptions` (§5.5) takes `{ agentId, workspaceId }` plus
    // optional `subscriptionId` / `groupId` scoping. The optional keys are
    // omitted entirely when unset — the daemon rejects a present-but-non-string
    // id with `-32602` rather than coercing it into an unscoped cancel, so an
    // explicit `undefined` must never hit the wire. Scoped removals publish
    // `agent:subscriptions-changed` (§6.5), which reconciles the footer UI.
    const rpcParams: Record<string, unknown> = {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
    };
    if (params.subscriptionId !== undefined) rpcParams.subscriptionId = params.subscriptionId;
    if (params.groupId !== undefined) rpcParams.groupId = params.groupId;
    return runMutation('agent.cancelSubscriptions', rpcParams);
  }
  async dismissQuestions(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<MutationResult> {
    // `agent.dismissQuestions` (§5.5) takes `{ agentId, workspaceId,
    // messageId }` (all required — workspace mismatch surfaces as NotFound)
    // and returns `{ success: true, dismissedQuestionsMessageId }`. The daemon
    // persists the marker in session metadata (survives reload) and emits
    // `agent:updated`, which clears the pending question set so the sticky
    // wizard hides. Idempotent on the same messageId.
    return runMutation('agent.dismissQuestions', {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      messageId: params.messageId,
    });
  }
  async resolveProposal(params: {
    agentId: string;
    workspaceId: string;
    proposalId: string;
    outcome: 'applied' | 'dismissed';
    detail?: string;
  }): Promise<MutationResult> {
    // `agent.resolveProposal` (§5.5) takes `{ workspaceId, agentId,
    // proposalId, outcome }` plus optional `detail` (applied-notice context,
    // e.g. the created workspace id). `detail` is omitted entirely when unset
    // — never an explicit `undefined` on the wire. The daemon removes the id
    // from the `pendingProposals` metadata set, persists the resolution,
    // emits `agent:updated` (all clients converge), and delivers the
    // system-origin notice to the model for both outcomes. Idempotent on
    // re-resolution.
    const rpcParams: Record<string, unknown> = {
      workspaceId: params.workspaceId,
      agentId: params.agentId,
      proposalId: params.proposalId,
      outcome: params.outcome,
    };
    if (params.detail !== undefined) rpcParams.detail = params.detail;
    return runMutation('agent.resolveProposal', rpcParams);
  }
  // Source AppClient compatibility until renderer cutover; wire behavior has one owner.
  markSeen(params: {
    agentId: string;
    workspaceId: string;
    messageId: string;
  }): Promise<MutationResult> {
    return markAgentSeen(params);
  }
  setReasoningEffort(params: {
    agentId: string;
    workspaceId: string;
    reasoningEffort: string | null;
  }): Promise<MutationResult> {
    return agentReads.setReasoningEffort(params);
  }
  async setNotificationsMuted(params: {
    agentId: string;
    workspaceId: string;
    notificationsMuted: boolean;
  }): Promise<MutationResult> {
    // `agent.update` (§5.5) partial writer; `notificationsMuted` rides the
    // `changes` object as a boolean (the daemon rejects anything else with
    // -32602). The daemon persists the flag and emits `agent:updated`, whose
    // AgentLite push re-derives `hasUnread` through `normalizeAgent`.
    return runMutation('agent.update', {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      changes: { notificationsMuted: params.notificationsMuted },
    });
  }
  async setBackground(params: {
    agentId: string;
    workspaceId: string;
    isBackground: boolean;
  }): Promise<MutationResult> {
    return runMutation('agent.update', {
      agentId: params.agentId,
      workspaceId: params.workspaceId,
      changes: { isBackground: params.isBackground },
    });
  }
  async updateSpecialist(params: {
    agentId: string;
    workspaceId: string;
    specialist: string | null;
    rememberSpecialist?: boolean;
    model?: string | null;
    systemPrompt?: string | null;
  }): Promise<MutationResult> {
    const changes: Record<string, unknown> = { specialist: params.specialist };
    if (params.rememberSpecialist !== undefined)
      changes.rememberSpecialist = params.rememberSpecialist;
    if (params.model !== undefined) changes.model = params.model;
    if (params.systemPrompt !== undefined) changes.systemPrompt = params.systemPrompt;
    const request = { agentId: params.agentId, workspaceId: params.workspaceId, changes };
    try {
      await backendRequest('agent.update', request);
      return { success: true };
    } catch (error) {
      // Older daemons reject unknown change keys before applying any fields.
      // Retry only that refusal; all validation/storage failures keep rollback.
      if (
        params.rememberSpecialist !== undefined &&
        (error as { rpcCode?: number })?.rpcCode === -32602 &&
        mutationErrorMessage(error).includes(
          'agent.update: unknown field `rememberSpecialist` in `changes`',
        )
      ) {
        const legacyChanges = { ...changes };
        delete legacyChanges.rememberSpecialist;
        return runMutation('agent.update', { ...request, changes: legacyChanges });
      }
      return { success: false, error: mutationErrorMessage(error) };
    }
  }
  rename(...args: Parameters<ReturnType<typeof createBackendChatCommands>['rename']>) {
    return chatCommands.rename(...args);
  }
  async delete(
    agentId: string,
    workspaceId?: string,
    options?: { undoDelayMs?: number },
  ): Promise<AgentDeleteResult> {
    // `agent.delete` (§5.5) takes `agentId` (req) and an optional `workspaceId`;
    // the daemon preserves direct omission and is idempotent. We retain
    // supplied workspace routing context and rely on
    // the emitted `agent:deleted` event to reconcile the list. With
    // `undoDelayMs > 0` the daemon registers the delete grace window and
    // returns `{ success, scheduled, deleteAt }` — surfaced verbatim so the
    // caller can render the daemon-owned deadline. Without it, the immediate
    // delete request is byte-identical to the shape sent before the
    // `undoDelayMs` grace window existed.
    const undoDelayMs = options?.undoDelayMs;
    try {
      const result = await backendRequest<{ scheduled?: unknown; deleteAt?: unknown }>(
        'agent.delete',
        {
          agentId,
          ...(workspaceId !== undefined ? { workspaceId } : {}),
          ...(undoDelayMs && undoDelayMs > 0 ? { undoDelayMs } : {}),
        },
      );
      const scheduled = result?.scheduled === true;
      const deleteAt = typeof result?.deleteAt === 'string' ? result.deleteAt : undefined;
      return scheduled && deleteAt
        ? { success: true, scheduled: true, deleteAt }
        : { success: true };
    } catch (error) {
      return isForbiddenErrorResponse(error)
        ? { success: false, forbidden: true, error: mutationErrorMessage(error) }
        : { success: false, error: mutationErrorMessage(error) };
    }
  }
  async cancelDelete(agentId: string, workspaceId?: string): Promise<AgentCancelDeleteResult> {
    // `agent.cancelDelete` (§5.5, delete grace window). `{ cancelled: false }`
    // is a race-safe non-error: the deletion already committed or was never
    // scheduled — surfaced so the caller can show "could not undo" instead of
    // resurrecting the agent. workspaceId is optional on the wire; the daemon
    // resolves it for direct callers; workspace callers retain their origin.
    try {
      const result = await backendRequest<{ cancelled?: unknown }>('agent.cancelDelete', {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
      return { success: true, cancelled: result?.cancelled === true };
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  }
  async retire(agentId: string, workspaceId?: string): Promise<AgentRetireResult> {
    const params: { agentId: string; workspaceId?: string } = { agentId };
    if (workspaceId !== undefined) params.workspaceId = workspaceId;
    try {
      return await backendRequest<Extract<AgentRetireResult, { success: true }>>(
        'agent.retire',
        params,
      );
    } catch (error) {
      return { success: false, error: mutationErrorMessage(error) };
    }
  }
  async restore(agentId: string, workspaceId?: string): Promise<MutationResult> {
    // `agent.restore` (§5.5 soft retire) clears `retiredAt` and emits
    // `agent:restored`, which reconciles the list. Idempotent — restoring an
    // active agent succeeds. `workspaceId` is optional on the wire; it only
    // rides along when the caller supplied it.
    const params: Record<string, unknown> = {
      agentId,
      ...(workspaceId !== undefined ? { workspaceId } : {}),
    };
    return runMutation('agent.restore', params);
  }
  async retry(
    agentId: string,
    workspaceId: string,
  ): Promise<
    | { ok: true; redriven?: boolean; turnId?: string }
    | { ok: false; notFound?: boolean; error: string }
  > {
    // `agent.retry` redrives a failed agent spawn. Only valid when agent status
    // is `error`; returns `{ ok: false }` otherwise. On ok:true, `redriven`
    // reports whether a queued message existed and is being redriven (status
    // cleared to pending) or the queue was empty (status cleared to idle —
    // nothing to redrive). `turnId` (present only with redriven:true, §5.5)
    // is the redriven head entry's preserved turn-correlation id — the same
    // id the original send/enqueue RPC returned (monorepo#1057). Emits
    // agent:status-changed events.
    try {
      const result = await backendRequest<
        { ok?: unknown; redriven?: unknown; turnId?: unknown } | undefined
      >('agent.retry', { agentId, workspaceId });
      if (result?.ok !== true) {
        return { ok: false, error: 'Agent not in error status' };
      }
      const redriven = typeof result.redriven === 'boolean' ? result.redriven : undefined;
      const turnId = typeof result.turnId === 'string' ? result.turnId : undefined;
      return turnId !== undefined ? { ok: true, redriven, turnId } : { ok: true, redriven };
    } catch (error) {
      // Transport/RPC errors return { ok: false, error } rather than throwing so
      // callers can surface the error and keep the retry button visible. The
      // daemon's not-found rejection (-32602, data.code "not-found", §5.5) is
      // preserved as `notFound: true` — the agent was deleted, so callers can
      // drop their stale failure state instead of offering Retry forever
      // (monorepo#2806). Classification reuses isAgentNotFoundError (#1753),
      // whose rpcCode+message fallback deliberately diverges from §9's strict
      // data.code-only client rule to cover errors that lost the structured
      // code (older daemons, lossy re-wrapping); the lookalike surface here is
      // small since agent.retry only sends agentId/workspaceId.
      const errorMsg = error instanceof Error ? error.message : 'Failed to retry agent spawn';
      if (isAgentNotFoundError(error)) {
        return { ok: false, notFound: true, error: errorMsg };
      }
      return { ok: false, error: errorMsg };
    }
  }
  async respondPermission(
    requestId: string,
    outcome: PermissionOutcome,
    workspaceId?: string,
  ): Promise<RespondPermissionResult> {
    return createBackendPermissionClient(backendRequest).respondPermission(
      requestId,
      outcome,
      workspaceId,
    );
  }

  async listInterrupted(): Promise<import('../app-client').InterruptedAgent[]> {
    // `agent.listInterrupted` (wire contract in spec) returns agents interrupted by
    // daemon restart. Older daemons lacking this method throw -32601 (method not
    // found) — we silently return an empty array so the modal doesn't appear.
    try {
      const result = await backendRequest<{ agents?: unknown[] } | undefined>(
        'agent.listInterrupted',
        {},
      );
      const agents = Array.isArray(result?.agents) ? result.agents : [];
      return agents.map((raw) => {
        const a = raw as Record<string, unknown>;
        return {
          agentId: String(a.agentId ?? ''),
          workspaceId: String(a.workspaceId ?? ''),
          workspaceName: String(a.workspaceName ?? ''),
          agentName: String(a.agentName ?? ''),
          prevStatus: String(a.prevStatus ?? ''),
          interruptedAt: String(a.interruptedAt ?? ''),
        };
      });
    } catch (error) {
      // -32601 = method not found (older daemon). Fail silently per spec.
      if (error && typeof error === 'object' && 'rpcCode' in error && error.rpcCode === -32601) {
        return [];
      }
      throw error;
    }
  }

  async resolveInterrupted(params: {
    resume?: string[];
    abandon?: string[];
  }): Promise<import('../app-client').ResolveInterruptedResult> {
    // `agent.resolveInterrupted` resumes selected agents, abandons the rest. The
    // daemon is idempotent — calling with already-resolved IDs is safe.
    try {
      const result = await backendRequest<
        { resumed?: string[]; abandoned?: string[]; failed?: unknown[] } | undefined
      >('agent.resolveInterrupted', params);
      return {
        resumed: Array.isArray(result?.resumed) ? result.resumed : [],
        abandoned: Array.isArray(result?.abandoned) ? result.abandoned : [],
        failed: Array.isArray(result?.failed)
          ? result.failed.map((f) => {
              const obj = f as Record<string, unknown>;
              return {
                agentId: String(obj.agentId ?? ''),
                error: String(obj.error ?? ''),
              };
            })
          : [],
      };
    } catch (error) {
      // Transport/RPC errors propagate so callers can surface them.
      throw error;
    }
  }

  /**
   * Resolve the workspace this agent belongs to. Cached on every `normalizeAgent`
   * call (list/get/subscribe paths); on miss we lazily refetch via `agent.get`,
   * which normalizes the response and primes the cache as a side effect. Returns
   * null if the agent cannot be located — caller surfaces the error rather than
   * sending a malformed `agent.sendMessage` request.
   */
  private async resolveAgentWorkspaceId(agentId: string): Promise<string | null> {
    const cached = getKnownAgentWorkspace(agentId);
    if (cached) return cached;
    const agent = await this.get(agentId);
    if (!agent) return null;
    const resolved = String(agent.workspaceId ?? '');
    return resolved.length > 0 ? resolved : null;
  }

  /**
   * Subscribe to agents across every workspace.
   *
   * Typed §6.9 channel: one per-workspace `agent.subscribe` (bare
   * `{ workspaceId }` — the params shape that routes to the collection
   * channel rather than the deprecated `eventTypes` service alias) is
   * registered per id yielded by `subscribeWorkspaceIds` — the sole data
   * path (intent-hq/monorepo#1697). The channel carries `AgentLite`
   * entities; `agent:deleted` (the soft-hide-then-commit deletion flow's
   * convergence signal) arrives as a `removedIds` delta, which the reconciler
   * drops. Workspace add → a new channel registers and its snapshot merges
   * in; workspace delete → the channel unsubscribes and its agents are
   * evicted. Every push entity flows through `normalizeAgent`, so the
   * `agentWorkspaceIndex` cache is primed exactly like the list/get paths.
   */
  subscribe(handler: SubscriptionHandler<AgentSession[]>): Unsubscribe {
    return agentReads.subscribeWorkspaces(subscribeWorkspaceIds, (sessions) => handler(sessions));
  }
}
