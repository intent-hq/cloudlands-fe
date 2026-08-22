import { describe, expect, it } from 'vitest';
import type { AgentMessage } from '$shared/types';
import {
  getPresentedUserMessageText,
  stripInternalDeliveryNotes,
  stripTruncatedTrailingDeliveryNote,
} from '../user-message-presentation';

const WAIT_NOTE =
  '[SYSTEM NOTE] This message was queued at 2026-08-17T05:00:00.123456Z and waited 1m 7s before delivery.';
const STALE_NOTE =
  '[SYSTEM NOTE] This message was queued before you completed; your completion report was already delivered to your parent at 2026-08-17T05:01:00Z. Only call reportToParent again if this message materially changes the outcome — do not re-send the same report.';

function user(text: string): AgentMessage {
  return {
    id: 'user-message',
    role: 'user',
    timestamp: '2026-08-17T05:00:00Z',
    contentBlocks: [{ type: 'text', text }],
    metadata: { queueInfo: { queuedAt: '2026-08-17T05:00:00.123456Z', waitedMs: 67_000 } },
  } as AgentMessage;
}

describe('user-message presentation sanitization', () => {
  it('removes one or multiple exact trailing delivery notes', () => {
    expect(stripInternalDeliveryNotes(`Ship café 你好 👩‍💻\n\n${WAIT_NOTE}`)).toBe(
      'Ship café 你好 👩‍💻',
    );
    expect(stripInternalDeliveryNotes(`Ship it\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`)).toBe('Ship it');
    expect(stripInternalDeliveryNotes(`Ship it\r\n\r\n${WAIT_NOTE}\r\n\r\n${STALE_NOTE}`)).toBe(
      'Ship it',
    );
  });

  it('preserves authored literals, quotes, Markdown, and code', () => {
    const authored =
      'Keep [SYSTEM NOTE] in this prose.\n\n> [SYSTEM NOTE] quoted text\n\n```text\n' +
      `${WAIT_NOTE}\n` +
      '```';
    expect(stripInternalDeliveryNotes(authored)).toBe(authored);
    expect(stripInternalDeliveryNotes('[SYSTEM NOTE] This is user-authored text.')).toBe(
      '[SYSTEM NOTE] This is user-authored text.',
    );
    expect(stripInternalDeliveryNotes(`${WAIT_NOTE}\n\nKeep this trailing user paragraph.`)).toBe(
      `${WAIT_NOTE}\n\nKeep this trailing user paragraph.`,
    );
  });

  it('does not mutate canonical stored content or attachments', () => {
    const message = user(`Review the attachment\n\n${STALE_NOTE}\n\n${WAIT_NOTE}`);
    message.contentBlocks!.push({
      type: 'file',
      attachmentId: 'attachment-1',
      fileName: 'proof.txt',
      mimeType: 'text/plain',
    });
    const snapshot = structuredClone(message);

    expect(getPresentedUserMessageText(message)).toBe('Review the attachment');
    expect(message).toEqual(snapshot);
  });

  it('removes delivery notes split into trailing text blocks around attachments', () => {
    const message = user('Review the attachment');
    message.contentBlocks = [
      { type: 'text', text: 'Review the attachment' },
      { type: 'file', attachmentId: 'attachment-1', fileName: 'proof.txt' },
      { type: 'text', text: STALE_NOTE },
      { type: 'text', text: WAIT_NOTE },
    ];

    expect(getPresentedUserMessageText(message)).toBe('Review the attachment');
    expect(message.contentBlocks).toHaveLength(4);
  });
});

describe('stripTruncatedTrailingDeliveryNote', () => {
  const queued = { queueInfo: { queuedAt: '2026-08-17T05:00:00Z', waitedMs: 8_000 } };

  it('drops a trailing note chopped mid-note by preview truncation', () => {
    expect(
      stripTruncatedTrailingDeliveryNote(
        'Keep this prompt\n\n[SYSTEM NOTE] This message was queued at 2026-08-17T0',
        queued,
      ),
    ).toBe('Keep this prompt');
    expect(
      stripTruncatedTrailingDeliveryNote('Keep this prompt\n\n[SYSTEM NOTE] This mess', queued),
    ).toBe('Keep this prompt');
  });

  it('keeps text without queueInfo metadata, authored brackets, and non-trailing notes', () => {
    const chopped = 'Keep this prompt\n\n[SYSTEM NOTE] This message was queued at 2026-08-17T0';
    expect(stripTruncatedTrailingDeliveryNote(chopped)).toBe(chopped);
    expect(stripTruncatedTrailingDeliveryNote(chopped, { queueInfo: {} })).toBe(chopped);
    expect(stripTruncatedTrailingDeliveryNote('Keep\n\n[SYSTEM NOTE] authored prose', queued)).toBe(
      'Keep\n\n[SYSTEM NOTE] authored prose',
    );
    expect(
      stripTruncatedTrailingDeliveryNote(`${WAIT_NOTE}\n\nKeep this trailing paragraph.`, queued),
    ).toBe(`${WAIT_NOTE}\n\nKeep this trailing paragraph.`);
  });
});
