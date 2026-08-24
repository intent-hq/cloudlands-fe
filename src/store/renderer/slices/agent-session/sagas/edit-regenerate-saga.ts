import { call, cancelled, put, takeEvery, type SagaGenerator } from 'typed-redux-saga';

import { appClient } from '$lib/client';
import {
  toImageReferenceBlocks,
  type WireImageBlock,
} from '$lib/components/chat/input/image-attachment-placement';
import { createLogger } from '$lib/utils/client-logger';
import { m } from '$shared/paraglide/messages.js';
import {
  chatLastAttemptedMessageSet,
  chatQueuedRetryRecordsCleared,
  chatSendStarted,
} from '../../chat-state/chat-state-slice';
import { CHIEF_WORKSPACE_ID } from '../../sidebar-nav/sidebar-nav-types';
import { agentSessionEditAndRegenerateRequested, replaceMessages } from '../agent-session-slice';
import { selectAgentSession } from '../agent-session-selectors';

const logger = createLogger('EditRegenerateSaga');
type EditAction = ReturnType<typeof agentSessionEditAndRegenerateRequested>;

function editError(error: unknown): Error {
  if (error instanceof Error) return error;
  return new Error(error ? String(error) : m.agent_editRegenerate_failed_error());
}

async function showEditError(message: string): Promise<void> {
  try {
    const { toast } = await import('svelte-sonner');
    toast.error(message);
  } catch (error) {
    logger.error('Failed to surface edit-and-regenerate error', error);
  }
}

function* editAndRegenerate(action: EditAction): SagaGenerator<void> {
  const [agentId, wsId, messageId, newText, rawOptions] = action.payload;
  let settled = false;
  try {
    // Pre-upload any inline image blocks and swap to attachment references
    // (monorepo#3338) — blocks already carrying an attachmentId (restored
    // from the original message) pass through without re-uploading. A
    // placement failure aborts BEFORE the destructive daemon-side
    // truncation, surfacing the per-image reason. The chief virtual
    // workspace has no attachment registry, so its edits keep the inline
    // arm (mirrors chat-send-saga's gate).
    let options = rawOptions;
    if ((options?.imageBlocks?.length ?? 0) > 0 && wsId !== CHIEF_WORKSPACE_ID) {
      options = {
        ...options,
        imageBlocks: yield* call(
          toImageReferenceBlocks,
          wsId,
          options!.imageBlocks as WireImageBlock[],
        ),
      };
    }
    const result = yield* call([appClient.agents, appClient.agents.editAndRegenerate], {
      agentId,
      workspaceId: wsId,
      messageId,
      content: newText,
      ...(options?.model !== undefined ? { model: options.model } : {}),
      // Attachment blocks ride the regenerated message (PROTOCOL §5.5) so an
      // edit does not silently drop the original message's attachments.
      ...(options?.imageBlocks !== undefined ? { imageBlocks: options.imageBlocks } : {}),
      ...(options?.fileBlocks !== undefined ? { fileBlocks: options.fileBlocks } : {}),
    });
    if (!result.success) throw new Error(result.error || m.agent_editRegenerate_failed_error());

    const session = yield* selectAgentSession.effect(agentId);
    const index = session?.messages.findIndex((message) => message.id === messageId) ?? -1;
    if (session && index >= 0) {
      yield* put(replaceMessages(agentId, session.messages.slice(0, index)));
    }
    yield* put(chatQueuedRetryRecordsCleared(agentId));
    yield* put(chatSendStarted(agentId, wsId));
    const hasBlocks =
      (options?.imageBlocks?.length ?? 0) > 0 || (options?.fileBlocks?.length ?? 0) > 0;
    yield* put(
      chatLastAttemptedMessageSet(agentId, {
        text: newText,
        // Record the attachment blocks so "Try again" resends them verbatim.
        ...(hasBlocks
          ? {
              options: {
                ...(options?.imageBlocks?.length ? { imageBlocks: options.imageBlocks } : {}),
                ...(options?.fileBlocks?.length ? { fileBlocks: options.fileBlocks } : {}),
              },
            }
          : {}),
      }),
    );
    yield* put(action.success(undefined as never));
    settled = true;
  } catch (error) {
    const resolved = editError(error);
    yield* call(showEditError, resolved.message);
    yield* put(action.failure(resolved));
    settled = true;
  } finally {
    if (!settled && (yield* cancelled())) {
      yield* put(action.failure(new Error(m.agent_editRegenerate_failed_error())));
    }
  }
}

export function* editRegenerateSaga(): SagaGenerator<void> {
  yield* takeEvery(agentSessionEditAndRegenerateRequested, editAndRegenerate);
}
