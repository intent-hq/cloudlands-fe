import type { QueuedMessage } from '$shared/types';
import type { ImageBlock, FileBlock, MutationResult } from '../app-client';
import type { createBackendRuntime } from './backend-transport-runtime';
import { mutationErrorMessage, createRunMutation } from './backend-mutation';
import { isForbiddenErrorResponse } from './backend-transport-types';
export function createBackendChatCommands(
  backendRequest: ReturnType<typeof createBackendRuntime>['backendRequest'],
) {
  const runMutation = createRunMutation(backendRequest);
  return {
    async queue(
      agentId: string,
      message: string,
      options?: {
        workspaceId?: string;
        messageId?: string;
        imageBlocks?: ImageBlock[];
        fileBlocks?: FileBlock[];
        messageMetadata?: Record<string, unknown>;
      },
    ): Promise<MutationResult> {
      // `agent.queueMessage` returns `{ success, queuedMessage, turnId }`
      // (§5.5); we surface `queuedMessage` on the MutationResult so callers can
      // render the queue position / id without an extra `agent.getQueue`
      // round-trip, plus the entry's turn-correlation id (monorepo#1057 —
      // top-level `turnId` preferred, `queuedMessage.turnId` as the fallback).
      // Optional `imageBlocks` / `fileBlocks` / `messageMetadata` only ride
      // along when supplied so the daemon sees an omitted param otherwise.
      try {
        const params: Record<string, unknown> = {
          agentId,
          content: message,
          ...(options?.workspaceId !== undefined ? { workspaceId: options.workspaceId } : {}),
        };
        if (options?.messageId !== undefined) params.messageId = options.messageId;
        if (options?.imageBlocks !== undefined) params.imageBlocks = options.imageBlocks;
        if (options?.fileBlocks !== undefined) params.fileBlocks = options.fileBlocks;
        if (options?.messageMetadata !== undefined)
          params.messageMetadata = options.messageMetadata;
        const result = await backendRequest<
          | { success?: boolean; error?: string; queuedMessage?: QueuedMessage; turnId?: unknown }
          | undefined
        >('agent.queueMessage', params);
        if (result?.success === false) return { success: false, error: result.error };
        const queuedMessage = result?.queuedMessage;
        const turnId =
          typeof result?.turnId === 'string'
            ? result.turnId
            : typeof queuedMessage?.turnId === 'string'
              ? queuedMessage.turnId
              : undefined;
        const mutation: MutationResult = { success: true };
        if (queuedMessage) mutation.queuedMessage = queuedMessage;
        if (turnId !== undefined) mutation.turnId = turnId;
        return mutation;
      } catch (error) {
        // Correlated callers retain recoverable content in their catch path and
        // reconcile before retrying. Only request/method/parameter validation or
        // access refusal proves rejection; a generic server error can follow enqueue.
        const rpcCode =
          error && typeof error === 'object' ? (error as { rpcCode?: unknown }).rpcCode : undefined;
        const rejected =
          rpcCode === -32600 ||
          rpcCode === -32601 ||
          rpcCode === -32602 ||
          isForbiddenErrorResponse(error);
        if (options?.messageId !== undefined && !rejected) throw error;
        return { success: false, error: error instanceof Error ? error.message : String(error) };
      }
    },
    async sendQueuedNow(params: {
      agentId: string;
      workspaceId: string;
      messageId: string;
    }): Promise<MutationResult> {
      // `agent.sendQueuedMessageNow` (§5.5) atomically dequeues the persisted
      // entry and delivers its content as an interrupt send. NOT idempotent:
      // a missing entry (already drained/removed) rejects with -32602, folded
      // into `{ success: false, error }` — callers surface it non-destructively
      // (the entry is gone; nothing to roll back). The delivered arm carries
      // `turnId` (the entry's preserved turn-correlation id). The processing event
      // carries the authoritative consumed entries; this response remains a legacy
      // promotion fallback (§5.5),
      // surfaced on the MutationResult (monorepo#1057).
      try {
        const result = await backendRequest<{
          success: boolean;
          queued: boolean;
          quarantined?: boolean;
          queuedMessage?: QueuedMessage;
          turnId?: string;
        }>('agent.sendQueuedMessageNow', {
          agentId: params.agentId,
          workspaceId: params.workspaceId,
          messageId: params.messageId,
        });
        return {
          success: result.success,
          queued: result.queued,
          ...(result.quarantined !== undefined ? { quarantined: result.quarantined } : {}),
          ...(result.queuedMessage ? { queuedMessage: result.queuedMessage } : {}),
          ...(!result.queued && result.turnId ? { turnId: result.turnId } : {}),
        };
      } catch (error) {
        // Same error shaping as `runMutation` (which this method bypassed to
        // extract `turnId`): fold JSON-RPC "Internal error" + `data.detail`
        // into an actionable message.
        return { success: false, error: mutationErrorMessage(error) };
      }
    },
    async getQueue(agentId: string, workspaceId?: string): Promise<QueuedMessage[]> {
      // `agent.getQueue` (§5.5/§6.6) returns `{ success, queue }`; hand the
      // daemon's queue array through verbatim (incl. optional `messageMetadata`).
      // Errors propagate as rejections, like the other reads.
      const result = await backendRequest<{ queue?: QueuedMessage[] }>('agent.getQueue', {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
      return Array.isArray(result?.queue) ? result.queue : [];
    },
    async stop(agentId: string, workspaceId?: string): Promise<MutationResult> {
      // `agent.stop` (§5.5) takes `{ agentId }` and acks `{ success: true }`.
      // The daemon cancels the in-flight stream and emits the terminal
      // `agent:stream:end` (§7), which converges the FE streaming state.
      return runMutation('agent.stop', {
        agentId,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      });
    },
    async rename(
      agentId: string,
      name: string,
      workspaceId?: string,
      options?: { skipIfExplicitlySet?: boolean },
    ): Promise<MutationResult> {
      // `agent.rename` (§5.5) takes `{ agentId, name }` (name non-empty) and
      // returns `{ success: true, name }`; an applied rename emits
      // `agent:renamed` (in AGENT_LIFECYCLE_EVENTS), which reconciles the list.
      // The optional `skipIfExplicitlySet` guard only rides along when a caller
      // opts in (automated renames such as the chief first-message rename); a
      // user-initiated rename omits it — a user rename always wins. workspaceId
      // carries the captured origin when the caller supplied it.
      const params: Record<string, unknown> = {
        agentId,
        name,
        ...(workspaceId !== undefined ? { workspaceId } : {}),
      };
      if (options?.skipIfExplicitlySet === true) params.skipIfExplicitlySet = true;
      return runMutation('agent.rename', params);
    },
  };
}
