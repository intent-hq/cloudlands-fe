import { describe, expect, it } from 'vitest';
import { buildWorkspaceContextString, extractAttachmentBlocks } from './composer-submission';

// Failure inventory: persisted image references must not send a synthetic MIME;
// binary files must stay reference blocks; checked panel/selection context must
// preserve the main composer's formatting and selected-text truncation.
describe('shared production composer submission projection', () => {
  it('preserves inline images, restored references, and binary file metadata', () => {
    expect(
      extractAttachmentBlocks([
        {
          id: 'inline',
          type: 'file',
          label: 'inline',
          imageData: 'aGk=',
          imageMimeType: 'image/png',
        },
        {
          id: 'reference',
          type: 'file',
          label: 'restored',
          attachmentId: 'image-id',
          imageMimeType: 'image',
        },
        {
          id: 'file',
          type: 'file',
          label: 'notes.pdf',
          attachmentId: 'file-id',
          attachmentMimeType: 'application/pdf',
          attachmentSize: 5,
        },
      ]),
    ).toEqual({
      imageBlocks: [
        { type: 'image', data: 'aGk=', mimeType: 'image/png' },
        { type: 'image', attachmentId: 'image-id' },
      ],
      fileBlocks: [
        {
          type: 'file',
          attachmentId: 'file-id',
          fileName: 'notes.pdf',
          mimeType: 'application/pdf',
          size: 5,
        },
      ],
    });
  });
  it('retains exact checked file and selected text context formatting', () => {
    expect(
      buildWorkspaceContextString(
        [],
        [
          {
            id: 'file',
            panelId: 'p',
            tabId: 't',
            type: 'file',
            label: 'file',
            filePath: '/src/a.ts',
            checked: true,
          },
        ],
        [
          {
            id: 'selection',
            panelId: 'p',
            tabId: 't',
            sourceType: 'file',
            sourceLabel: 'a.ts',
            text: ' hi ',
            checked: true,
            timestamp: 1,
          },
        ],
      ),
    ).toBe('[Currently viewing file: /src/a.ts]\n[Selected text from a.ts:\n```\nhi\n```]');
  });
});
