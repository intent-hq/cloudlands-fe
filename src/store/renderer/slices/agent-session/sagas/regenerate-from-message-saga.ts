import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

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
export function findRegenerateSource(
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

// Mirrors the edit strip's block restoration (ChatMessage handleStartEdit →
// handleConfirmEditSubmit) so a regenerate carries exactly what an
// unchanged edit would: image references pass through by attachmentId,
// inline images ride inline (the edit saga places them), and
// attachment-reference file blocks are re-sent as references.
function storedBlocks(blocks: ContentBlock[]): {
  imageBlocks: ImageBlocks;
  fileBlocks: FileBlocks;
} {
  const imageBlocks: ImageBlocks = [];
  const fileBlocks: FileBlocks = [];
  for (const block of blocks) {
    if (block.type === 'image' && block.attachmentId) {
      imageBlocks.push({
        type: 'image',
        attachmentId: block.attachmentId,
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
      });
    } else if (block.type === 'image' && block.data && block.mimeType) {
      imageBlocks.push({ type: 'image', data: block.data, mimeType: block.mimeType });
    } else if (block.type === 'file' && block.attachmentId && block.fileName) {
      fileBlocks.push({
        type: 'file',
        attachmentId: block.attachmentId,
        fileName: block.fileName,
        ...(block.mimeType ? { mimeType: block.mimeType } : {}),
        ...(block.size !== undefined ? { size: block.size } : {}),
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
    const { imageBlocks, fileBlocks } = storedBlocks(blocks);
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
