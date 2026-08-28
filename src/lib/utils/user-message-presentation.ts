import type { AgentMessage } from '$shared/types';
import { extractAllContent } from '$shared/types';
import { getAgentMessageAttribution, stripAgentMessageHeader } from './agent-message-attribution';
import { getQueueInfo } from './queue-info';

const ISO_TIMESTAMP = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})`;
const WAIT_DURATION = String.raw`(?:\d+s|\d+m \d+s|\d+h \d+m)`;
const DEQUEUE_WAIT_NOTE = String.raw`\[SYSTEM NOTE\] This message was queued at ${ISO_TIMESTAMP} and waited ${WAIT_DURATION} before delivery\.`;
const STALE_REDRIVE_NOTE = String.raw`\[SYSTEM NOTE\] This message was queued before you completed; your completion report was already delivered to your parent at ${ISO_TIMESTAMP}\. Only call reportToParent again if this message materially changes the outcome — do not re-send the same report\.`;

function trailingNotePattern(note: string): RegExp {
  return new RegExp(String.raw`(?:^|(?:\r?\n){2,})${note}[\t ]*(?:\r?\n)?$`, 'u');
}

const TRAILING_DEQUEUE_WAIT_NOTE = trailingNotePattern(DEQUEUE_WAIT_NOTE);
const TRAILING_STALE_REDRIVE_NOTE = trailingNotePattern(STALE_REDRIVE_NOTE);

/**
 * Remove only daemon-authored delivery annotations from a presentation copy.
 * The canonical AgentMessage and its content blocks stay byte-identical.
 *
 * Current rows carry structured queue/sender metadata. Restored legacy rows
 * can lack it, so the fallback accepts only the daemon's exact trailing note
 * signatures. Arbitrary `[SYSTEM NOTE]` prose, quotes, and fenced code remain.
 */
export function stripInternalDeliveryNotes(text: string, metadata?: unknown): string {
  let presented = text;
  const patterns = getQueueInfo(metadata)
    ? [TRAILING_DEQUEUE_WAIT_NOTE, TRAILING_STALE_REDRIVE_NOTE]
    : [TRAILING_STALE_REDRIVE_NOTE, TRAILING_DEQUEUE_WAIT_NOTE];
  let previous: string;
  do {
    previous = presented;
    for (const pattern of patterns) presented = presented.replace(pattern, '');
  } while (presented !== previous);
  return presented;
}

const QUEUE_NOTE_STEM = '[SYSTEM NOTE] This message was queued';

/**
 * Best-effort removal of a trailing delivery note chopped mid-note by
 * server-side preview truncation (`agent.listUserMessages` previews, §5.5).
 * Applies only when `metadata.queueInfo` proves the daemon appended a note;
 * the trailing paragraph is dropped when it is a prefix of — or extends —
 * the shared queue-note stem. Full texts use `stripInternalDeliveryNotes`.
 */
export function stripTruncatedTrailingDeliveryNote(text: string, metadata?: unknown): string {
  if (!getQueueInfo(metadata)) return text;
  const match = /(?:\r?\n){2,}(\[[^\n]*)$/u.exec(text);
  if (!match) return text;
  const fragment = match[1];
  if (!fragment.startsWith(QUEUE_NOTE_STEM) && !QUEUE_NOTE_STEM.startsWith(fragment)) return text;
  return text.slice(0, match.index);
}

/** Return immutable user-authored text for rendering and other UI surfaces. */
export function getPresentedUserMessageText(message: AgentMessage): string {
  // Rows sent by another agent carry the daemon-stamped sender header in
  // content; the attribution chip conveys the sender, so presentation copies
  // (render, preview, copy) drop the leading header line.
  const presentLeadingHeader = getAgentMessageAttribution(message.metadata)
    ? stripAgentMessageHeader
    : (text: string) => text;

  const textParts = message.contentBlocks
    ?.filter((block) => block.type === 'text')
    .map((block) => block.text ?? '');
  if (!textParts?.length)
    return presentLeadingHeader(
      stripInternalDeliveryNotes(extractAllContent(message), message.metadata),
    );

  for (let index = textParts.length - 1; index >= 0; index -= 1) {
    const stripped = stripInternalDeliveryNotes(textParts[index], message.metadata);
    textParts[index] = stripped;
    if (stripped.trim()) break;
  }
  return presentLeadingHeader(stripInternalDeliveryNotes(textParts.join(''), message.metadata));
}
