import type { QueuedMessage } from '$shared/types';
import type { PendingQueueDisplayRow } from '$store/renderer/slices/pending-submissions/pending-submissions-projection';
import { m } from '$shared/paraglide/messages.js';
import { formatInteger } from '$lib/i18n/format';

/** Render/attachment inputs only. Mutation permissions and counts use confirmed records. */
export function queuePresentationMessages(rows: PendingQueueDisplayRow[]): QueuedMessage[] {
  return rows.map((row) => ({
    queuedAt: '',
    position: 0,
    ...row.confirmed,
    id: row.key,
    content: row.content,
    imageBlocks: row.imageBlocks,
    fileBlocks: row.fileBlocks,
    contextItems: row.contextItems,
  }));
}

export function queuePresentationLabel(confirmedCount: number, sending: boolean): string {
  if (sending) return m.chat_queuedMessages_sending_label();
  if (confirmedCount === 0) return m.chat_queuedMessages_sendingWhenIdle_label();
  return confirmedCount === 1
    ? m.chat_queuedMessages_header_one()
    : m.chat_queuedMessages_header_many({ count: formatInteger(confirmedCount) });
}
