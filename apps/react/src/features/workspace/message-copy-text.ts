import type { AgentMessage } from '$shared/types';
import { getContentBlockText } from '$shared/utils/content-block-helpers';
import { getStoredMessageText } from '$lib/utils/parseStoredMessage';
import { getPresentedUserMessageText } from '$lib/utils/user-message-presentation';

/** Text/Markdown only. Slim tool/media bodies are deliberately not an export source.
 * The daemon's slim projection leaves text intact; sequence alone does not prove
 * a terminal, non-provisional response. Do not fetch missing content for copying. */
export function getCopyableMessageText(
  message: AgentMessage,
  ownerPrincipalId?: string,
): string | null {
  if (
    !['user', 'assistant'].includes(message.role) ||
    !Number.isSafeInteger(message.seq) ||
    message.seq! < 0 ||
    message.provisional ||
    message.isStreaming ||
    message.streamingComplete === false ||
    message.metadata?.streamComplete === false ||
    message.metadata?.interrupted ||
    message.metadata?.finishReason ||
    message.error ||
    !message.contentBlocks?.length ||
    message.contentBlocks.some((block) => block.type === 'code')
  )
    return null;
  const blocks = message.contentBlocks.filter((block) => block.type === 'text');
  if (!blocks.length || blocks.some((block) => typeof (block.text ?? block.content) !== 'string'))
    return null;
  // Avoid the presentation helper's attachment-only fallback, while preserving
  // its exact sender/delivery-note policy and the legacy text alias.
  const presented =
    message.role === 'user'
      ? getConversationUserText({ ...message, contentBlocks: blocks }, ownerPrincipalId)
      : blocks
          .map(getContentBlockText)
          .filter((part) => part.trim())
          .join('\n\n');
  return presented.trim() ? presented : null;
}

/** Normalize supported text aliases before applying the shared user policy.
 * Both visible ordinary rows and text-only copying use this presentation. */
export function getConversationUserText(message: AgentMessage, ownerPrincipalId?: string): string {
  return getStoredMessageText(
    getPresentedUserMessageText(
      {
        ...message,
        contentBlocks: message.contentBlocks?.map((block) =>
          block.type === 'text' ? { ...block, text: getContentBlockText(block) } : block,
        ),
      },
      ownerPrincipalId,
    ),
  );
}
