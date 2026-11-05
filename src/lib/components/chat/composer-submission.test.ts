import { describe, expect, it, vi } from 'vitest';
import {
  buildWorkspaceContextString,
  extractAttachmentBlocks,
  planChatSend,
} from './composer-submission';

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

describe('planChatSend', () => {
  const composer = () => ({
    contextItems: [
      {
        id: 'img',
        type: 'file' as const,
        label: 'a.png',
        imageData: 'aGk=',
        imageMimeType: 'image/png',
      },
    ],
    checkedPanels: [
      {
        id: 'p:t',
        panelId: 'p',
        tabId: 't',
        type: 'file' as const,
        label: 'a.ts',
        filePath: '/src/a.ts',
        checked: true,
      },
    ],
    checkedSelections: [],
    noteIds: ['spec'],
    pickedMentions: { mentionTokens: ['@a'] },
  });

  it('sends a suggested prompt bare without reading or clearing the composer', () => {
    const readComposer = vi.fn(composer);
    const plan = planChatSend('suggested-prompt', 'Run the tests', readComposer);
    expect(readComposer).not.toHaveBeenCalled();
    expect(plan.fields).toEqual({});
    expect(plan.hasAttachments).toBe(false);
    expect(plan.cleanup).toEqual({ clearInput: false, followBottom: true, historyText: null });
  });

  it('folds the composer context into a composer send and clears it afterwards', () => {
    const plan = planChatSend('composer', 'hello', composer);
    expect(plan.fields).toEqual({
      contextItems: composer().contextItems,
      workspaceContextStr: '[Currently viewing file: /src/a.ts]',
      noteIds: ['spec'],
      imageBlocks: [{ type: 'image', data: 'aGk=', mimeType: 'image/png' }],
      messageMetadata: { mentionTokens: ['@a'] },
    });
    expect(plan.hasAttachments).toBe(true);
    expect(plan.cleanup).toEqual({ clearInput: true, followBottom: true, historyText: 'hello' });
  });
});
