/**
 * Daemon-delivered dismissal notification rows (`agent.dismissQuestions`).
 *
 * When the user dismisses an agent's pending questions, intentd delivers a
 * system-origin message ("User dismissed your N questions without answering")
 * tagged with metadata `{ type: "questions_dismissed", source: "system",
 * dismissedQuestionsMessageId }` — on the row's `metadata` and on the
 * persisted text block's `messageMetadata`. The FE renders the delivered row
 * as a compact chip instead of a plain message bubble. Absent or malformed
 * metadata returns `null` so every other message renders unchanged.
 */

import type { ContentBlock } from '$shared/types/content-block';

interface MessageLike {
  metadata?: Record<string, unknown> | null;
  contentBlocks?: ContentBlock[];
}

export interface QuestionsDismissedNoticeInfo {
  /** Message id of the dismissed question set (may be empty when omitted). */
  dismissedQuestionsMessageId: string;
}

function fromMetadata(metadata: unknown): QuestionsDismissedNoticeInfo | null {
  if (!metadata || typeof metadata !== 'object') return null;
  const md = metadata as Record<string, unknown>;
  if (md.type !== 'questions_dismissed') return null;
  const dismissedQuestionsMessageId =
    typeof md.dismissedQuestionsMessageId === 'string' ? md.dismissedQuestionsMessageId : '';
  return { dismissedQuestionsMessageId };
}

/**
 * Returns the dismissal-notice info when the message is a daemon-delivered
 * questions-dismissed row, or null for every other message. Discriminates on
 * `type === "questions_dismissed"` from the row's `metadata` first, falling
 * back to the text blocks' `messageMetadata` (same dual check as hook wakes)
 * and staying tolerant of the exact role the daemon persists.
 */
export function getQuestionsDismissedNotice(
  message: MessageLike | null | undefined,
): QuestionsDismissedNoticeInfo | null {
  if (!message) return null;
  const fromRow = fromMetadata(message.metadata);
  if (fromRow) return fromRow;
  const blocks = Array.isArray(message.contentBlocks) ? message.contentBlocks : [];
  for (const block of blocks) {
    if (block.type === 'text') {
      const fromBlock = fromMetadata(block.messageMetadata);
      if (fromBlock) return fromBlock;
    }
  }
  return null;
}
