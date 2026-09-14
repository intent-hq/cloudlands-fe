import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import { dropTailResidentRows } from '$lib/components/chat/chat-scrollback-composition';
import { createLogger } from '$lib/utils/client-logger';
import { degradeLegacyFileBlocks } from '$lib/utils/user-message-presentation';
import type { AgentMessage, ContentBlock } from '$shared/types';
import { isFileBlock } from '$shared/types/content-block.guards';
import { m } from '$shared/paraglide/messages.js';
import type { AgentSessionSendMessageOptions } from '../agent-session-types';
import {
  agentSessionEditAndRegenerateRequested,
  agentSessionRegenerateFromMessageRequested,
} from '../agent-session-slice';
import {
  selectAgentHistoryMessages,
  selectAgentSession,
  selectHistorySegmentMeta,
} from '../agent-session-selectors';

const logger = createLogger('RegenerateFromMessageSaga');
type RegenerateAction = ReturnType<typeof agentSessionRegenerateFromMessageRequested>;
type ImageBlocks = NonNullable<AgentSessionSendMessageOptions['imageBlocks']>;
type FileBlocks = NonNullable<AgentSessionSendMessageOptions['fileBlocks']>;

/**
 * The user message a regenerate request replays: the target itself when it
 * is a user message, otherwise the nearest user message preceding it.
 *
 * Resolved against the same composed transcript ChatPanel renders (hydrated
 * scrollback history + live tail, history rows the tail also holds dropped
 * first), so a Regenerate on a paged-in history row finds its source too.
 * When the history→tail hole is open the walk never crosses the junction:
 * the rows in the hole are not hydrated, so a preceding user message cannot
 * be known — better no source than the wrong one.
 */
function findRegenerateSource(
  history: AgentMessage[],
  tail: AgentMessage[],
  gapToTail: boolean,
  messageId: string,
): AgentMessage | undefined {
  history = dropTailResidentRows(history, tail);
  const messages = [...history, ...tail];
  const index = messages.findIndex((message) => message.id === messageId);
  if (index < 0) return undefined;
  const floor = gapToTail && index >= history.length ? history.length : 0;
  for (let cursor = index; cursor >= floor; cursor -= 1) {
    if (messages[cursor].role === 'user') return messages[cursor];
  }
  return undefined;
}

/**
 * Stored user text, unchanged (no presentation stripping — this is a replay,
 * not an edit). A legacy inline file block (no `attachmentId`; pre-10.0
 * daemon) is text now: it is projected in place to the same
 * `Attached file: <name>` text a 10.0 daemon serves, so the replay text is
 * identical whichever daemon served the row.
 */
function storedText(blocks: ContentBlock[]): string {
  return degradeLegacyFileBlocks(blocks)
    .filter((block) => block.type === 'text')
    .map((block) => block.text ?? block.content ?? '')
    .join('');
}

/** A fail-closed abort raised before the edit saga is delegated to (it owns later failures). */
class RegenerateAbortedError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly detail: Record<string, unknown>,
  ) {
    super(message);
  }
}

class UnreplayableBlockError extends RegenerateAbortedError {
  constructor(reason: string, detail: Record<string, unknown>) {
    super(m.agent_regenerate_attachmentsUnavailable_error(), reason, detail);
  }
}

class NoRegenerateSourceError extends RegenerateAbortedError {
  constructor(reason: string, detail: Record<string, unknown>) {
    super(m.agent_regenerate_sourceUnavailable_error(), reason, detail);
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
// references. A file block without an attachmentId is text (see
// storedText), never a block. An image with neither bytes nor reference —
// something the wire cannot carry — fails closed rather than silently
// dropping the attachment from the regenerated message.
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
    } else if (isFileBlock(stored)) {
      fileBlocks.push({
        type: 'file',
        attachmentId: stored.attachmentId,
        fileName: stored.fileName,
        ...(stored.mimeType ? { mimeType: stored.mimeType } : {}),
        ...(stored.size !== undefined ? { size: stored.size } : {}),
      });
    }
  }
  return { imageBlocks, fileBlocks };
}

function* regenerateFromMessage(action: RegenerateAction): SagaGenerator<void> {
  const [agentId, wsId, messageId, rawOptions] = action.payload;
  let settled = false;
  try {
    const session = yield* selectAgentSession.effect(agentId);
    const history = yield* selectAgentHistoryMessages.effect(agentId);
    const { gapToTail } = yield* selectHistorySegmentMeta.effect(agentId);
    const source = session
      ? findRegenerateSource(history, session.messages, gapToTail, messageId)
      : undefined;
    if (!source) {
      throw new NoRegenerateSourceError('no user message to regenerate from', {
        messageId,
        gapToTail,
      });
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
    if (error instanceof RegenerateAbortedError) {
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
