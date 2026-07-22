/**
 * Draft attachment serialization for chat input drafts (PROTOCOL §5.16).
 *
 * ChatPanel persists image context items alongside draft text via the opaque
 * `attachments` array on `drafts.set`, and rehydrates `contextItems` from a
 * PROTOCOL-shaped `drafts.get` response after a reload (no `File` handle —
 * thumbnails render from `imageData`/`imageMimeType`).
 */
import { describe, expect, it } from 'vitest';

import type { DraftAttachment } from '$lib/client/app-client';
import {
  deserializeDraftAttachments,
  serializeDraftAttachments,
} from '../chat-draft-attachments';
import type { ContextItem } from '../input/context-api';

const IMAGE_ITEM: ContextItem = {
  id: 'file-upload-1721650000000-screenshot.png',
  type: 'file',
  label: 'screenshot.png',
  description: 'image/png • 12.3 KB',
  path: 'screenshot.png',
  file: new File(['x'], 'screenshot.png', { type: 'image/png' }),
  imageData: 'iVBORw0KGgoAAAANSUhEUg==',
  imageMimeType: 'image/png',
};

describe('serializeDraftAttachments', () => {
  it('projects image context items to wire-safe attachments, dropping the File handle', () => {
    const attachments = serializeDraftAttachments([IMAGE_ITEM]);

    expect(attachments).toEqual([
      {
        id: 'file-upload-1721650000000-screenshot.png',
        type: 'file',
        label: 'screenshot.png',
        description: 'image/png • 12.3 KB',
        path: 'screenshot.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUg==',
        imageMimeType: 'image/png',
      },
    ]);
    expect('file' in attachments[0]).toBe(false);
  });

  it('skips context items without image data (only image attachments persist)', () => {
    const nonImage: ContextItem = {
      id: 'file-upload-1-notes.txt',
      type: 'file',
      label: 'notes.txt',
      path: 'notes.txt',
      file: new File(['x'], 'notes.txt', { type: 'text/plain' }),
    };

    expect(serializeDraftAttachments([nonImage])).toEqual([]);
    expect(serializeDraftAttachments([nonImage, IMAGE_ITEM])).toHaveLength(1);
  });

  it('serializes to plain JSON (survives the wire round-trip verbatim)', () => {
    const attachments = serializeDraftAttachments([IMAGE_ITEM]);

    expect(JSON.parse(JSON.stringify(attachments))).toEqual(attachments);
  });
});

describe('deserializeDraftAttachments', () => {
  it('rehydrates context items from a PROTOCOL-shaped drafts.get response', () => {
    // §5.16: { text, attachments?, updatedAt } — attachments present only when non-empty.
    const draft = {
      text: 'draft in progress',
      attachments: [
        {
          id: 'file-upload-1721650000000-screenshot.png',
          type: 'file',
          label: 'screenshot.png',
          description: 'image/png • 12.3 KB',
          path: 'screenshot.png',
          imageData: 'iVBORw0KGgoAAAANSUhEUg==',
          imageMimeType: 'image/png',
        } satisfies DraftAttachment,
      ],
      updatedAt: '2026-07-22T12:00:00.000Z',
    };

    const items = deserializeDraftAttachments(draft.attachments);

    expect(items).toEqual([
      {
        id: 'file-upload-1721650000000-screenshot.png',
        type: 'file',
        label: 'screenshot.png',
        description: 'image/png • 12.3 KB',
        path: 'screenshot.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUg==',
        imageMimeType: 'image/png',
      },
    ]);
    expect(items[0].file).toBeUndefined();
  });

  it('round-trips serialize → deserialize losslessly (minus the File handle)', () => {
    const { file: _file, ...expected } = IMAGE_ITEM;

    const items = deserializeDraftAttachments(serializeDraftAttachments([IMAGE_ITEM]));

    expect(items).toEqual([expected]);
  });
});
