import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { createLogger } from '$lib/utils/client-logger';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSessionSendMessageOptions } from '../agent-session-types';
import {
  agentSessionEditAndRegenerateRequested,
  agentSessionRegenerateFromMessageRequested,
} from '../agent-session-slice';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('RegenerateFromMessageSaga');
type RegenerateAction = ReturnType<typeof agentSessionRegenerateFromMessageRequested>;
type ImageBlocks = NonNullable<AgentSessionSendMessageOptions['imageBlocks']>;
type FileBlocks = NonNullable<AgentSessionSendMessageOptions['fileBlocks']>;

/**
 * The user message a regenerate request replays: the target itself when it
 * is a user message, otherwise the nearest user message preceding it.
 */
function findRegenerateSource(
  messages: AgentMessage[],
  messageId: string,
): AgentMessage | undefined {
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return undefined;
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (messages[cursor].role === 'user') return messages[cursor];
  }
  return undefined;
}

/** Stored user text, unchanged (no presentation stripping — this is a replay, not an edit). */
function storedText(blocks: ContentBlock[]): string {
  return blocks
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? block.content ?? '')
    .join('');
}

class UnreplayableBlockError extends Error {
  constructor(
    readonly reason: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(m.agent_regenerate_attachmentsUnavailable_error());
  }
}

async function showRegenerateError(message: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(message);
  } catch (error) {
    logger.error('Failed to surface regenerate error', error);
  }
}

/** A slim-projection inline image: its stored `data` is a write-time thumbnail or omitted (PROTOCOL §5.5). */
function isSlimInlineImage(block: ContentBlock): boolean {
  return (
    block.type === 'image' && !block.attachmentId && (block.dataTruncated === true || !block.data)
  );
}

/**
 * Fetch the canonical bytes of a slim inline image through
 * `agent.getMessageBlock` (the same seam `hydrateMessageBlockWorker` uses).
 * Throws when the fetch fails — the regenerate must not replace the message
 * with a thumbnail or drop the image.
 */
function* hydrateSlimImage(
  agentId: string,
  messageId: string,
  block: ContentBlock,
): SagaGenerator<ContentBlock> {
  const blockId = block.id;
  if (!blockId) {
    throw new UnreplayableBlockError('slim image block without id', { messageId });
  }
  try {
    return yield* call(
      [appClient.agents, appClient.agents.getMessageBlock],
      agentId,
      messageId,
      blockId,
    );
  } catch (error) {
    throw new UnreplayableBlockError('image hydration failed', {
      messageId,
      blockId,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

// Mirrors the edit strip's block restoration (ChatMessage handleStartEdit →
// handleConfirmEditSubmit) so a regenerate carries exactly what an
// unchanged edit would: image references pass through by attachmentId,
// inline images ride inline with their canonical bytes (the edit saga
// places them), and attachment-reference file blocks are re-sent as
// references. Anything the wire cannot carry — a legacy inline file (the
// `fileBlocks` contract has no bytes arm; the edit strip's fileData path
// drops those at submit), an image with neither bytes nor reference —
// fails closed rather than silently dropping the attachment from the
// regenerated message.
function* replayBlocks(
  agentId: string,
  messageId: string,
  blocks: ContentBlock[],
): SagaGenerator<{ imageBlocks: ImageBlocks; fileBlocks: FileBlocks }> {
  const imageBlocks: ImageBlocks = [];
  const fileBlocks: FileBlocks = [];
  for (const stored of blocks) {
    if (stored.type === 'image') {
      const block = isSlimInlineImage(stored)
        ? yield* hydrateSlimImage(agentId, messageId, stored)
        : stored;
      if (block.attachmentId) {
        imageBlocks.push({
          type: 'image',
          attachmentId: block.attachmentId,
          ...(block.mimeType ? { mimeType: block.mimeType } : {}),
        });
      } else if (block.dataTruncated !== true && block.data && block.mimeType) {
        imageBlocks.push({ type: 'image', data: block.data, mimeType: block.mimeType });
      } else {
        throw new UnreplayableBlockError('image block has no replayable bytes or reference', {
          messageId,
          blockId: stored.id,
        });
      }
    } else if (stored.type === 'file') {
      if (stored.attachmentId && stored.fileName) {
        fileBlocks.push({
          type: 'file',
          attachmentId: stored.attachmentId,
          fileName: stored.fileName,
          ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
          ...(stored.size !== undefined ? { size: stored.size } : {}),
        });
      } else {
        throw new UnreplayableBlockError('file block is not an attachment reference', {
          messageId,
          blockId: stored.id,
          fileName: stored.fileName,
        });
      }
    }
  }
  return { imageBlocks, fileBlocks };
}

function* regenerateFromMessage(action: RegenerateAction): SagaGenerator<void> {
  const [agentId, wsId, messageId, rawOptions] = action.payload;
  let settled = false;
  try {
    const session = yield* selectAgentSession.effect(agentId);
    const source = session ? findRegenerateSource(session.messages, messageId) : undefined;
    if (!source) {
      logger.warn('No user message to regenerate from; ignoring request', {
        agentId,
        messageId,
      });
      yield* put(action.success(undefined as never));
      settled = true;
      return;
    }
    const blocks = source.contentBlocks ?? [];
    const { imageBlocks, fileBlocks } = yield* replayBlocks(agentId, source.id, blocks);
    const options: AgentSessionSendMessageOptions | undefined =
      rawOptions || imageBlocks.length > 0 || fileBlocks.length > 0
        ? {
            ...rawOptions,
            ...(imageBlocks.length > 0 ? { imageBlocks } : {}),
            ...(fileBlocks.length > 0 ? { fileBlocks } : {}),
          }
        : undefined;
    // Reuse the edit flow with the stored text and blocks unchanged so its
    // truncation, streaming state, retry record, and error toast apply.
    const request = agentSessionEditAndRegenerateRequested(
      agentId,
      wsId,
      source.id,
      storedText(blocks),
      options,
    );
    yield* put(request);
    yield* call(() => request.promise);
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    if (error instanceof UnreplayableBlockError) {
      logger.warn(`Regenerate aborted before edit: ${error.reason}`, {
        agentId,
        ...error.detail,
      });
      // The edit saga never ran, so its error toast never fired; failures
      // after the put are already surfaced by the edit saga.
      yield* call(showRegenerateError, error.message);
    }
    const resolved =
      error instanceof Error
        ? error
        : new Error(error ? String(error) : m.agent_editRegenerate_failed_error());
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_editRegenerate_failed_error())));
    }
  }
}

export function* regenerateFromMessageSaga(): SagaGenerator<void> {
  yield* takeEvery(agentSessionRegenerateFromMessageRequested, regenerateFromMessage);
}
