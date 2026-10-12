import { describe, expect, it } from 'vitest';
import type { QueuedMessage } from '$shared/types';
import { deduplicateAgentMessages } from '$shared/utils/message-dedup';
import {
  pendingSubmissionMessage,
  processingSubmissionMessage,
} from './pending-submission-message';

const id = 'user-msg-868b24f0-0c82-448c-9fd0-1882343cd19c';
const queuedAt = '2026-10-06T08:30:00.000Z';
const row: QueuedMessage = {
  id,
  appMessageId: 'logical-retry-message',
  content: 'Please try again after the provider failure.',
  queuedAt,
  position: 0,
  imageBlocks: [{ type: 'image', attachmentId: 'image-reference', mimeType: 'image/png' }],
  fileBlocks: [
    {
      type: 'file',
      attachmentId: 'file-reference',
      fileName: 'report.txt',
      mimeType: 'text/plain',
      size: 42,
    },
  ],
  messageMetadata: {
    submissionIds: [id],
    type: 'agent_message',
    fromAgentId: 'agent-sender',
    fromAgentName: 'Sender',
  },
};

describe('daemon submission display', () => {
  it.each(['pending', 'processing'] as const)(
    'renders a %s user-msg submission without changing its identity or payload',
    (phase) => {
      const input = structuredClone(row);
      const message =
        phase === 'pending'
          ? pendingSubmissionMessage({ ...input, createdAt: Date.parse(queuedAt) })
          : processingSubmissionMessage(input);

      expect(message).toEqual({
        id,
        appMessageId: 'logical-retry-message',
        role: 'user',
        timestamp: queuedAt,
        contentBlocks: [
          { type: 'text', text: 'Please try again after the provider failure.' },
          { type: 'image', attachmentId: 'image-reference', mimeType: 'image/png' },
          {
            type: 'file',
            attachmentId: 'file-reference',
            fileName: 'report.txt',
            mimeType: 'text/plain',
            size: 42,
          },
        ],
        metadata: {
          submissionIds: [id],
          type: 'agent_message',
          fromAgentId: 'agent-sender',
          fromAgentName: 'Sender',
        },
      });
      expect(input).toEqual(row);
      const canonical = { ...message, seq: 5 };
      expect(deduplicateAgentMessages([message, canonical])).toHaveLength(1);
      expect(deduplicateAgentMessages([message, canonical])[0].id).toBe(id);
    },
  );

  it('keeps attachment-only submissions and the pending timestamp fallback', () => {
    const message = pendingSubmissionMessage({ ...row, content: '' });
    expect(message.timestamp).toBe('1970-01-01T00:00:00.000Z');
    expect(message.contentBlocks).toEqual([...row.imageBlocks!, ...row.fileBlocks!]);
  });

  describe.each(['pending', 'processing'] as const)('%s identity', (phase) => {
    it.each([
      'caller:retry/42',
      'opaque submission with spaces',
      'é'.repeat(128),
      'x'.repeat(256),
      '868b24f0-0c82-448c-9fd0-1882343cd19c',
      'msg_legacy',
    ])('preserves an admitted opaque or legacy submission ID: %s', (submissionId) => {
      const input = { ...row, id: submissionId };
      const message =
        phase === 'pending' ? pendingSubmissionMessage(input) : processingSubmissionMessage(input);
      expect(message.id).toBe(submissionId);
      expect(message.metadata).toEqual(row.messageMetadata);
      expect(deduplicateAgentMessages([message, { ...message }])).toHaveLength(1);
    });
  });
});
