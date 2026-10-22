/**
 * Tests the pure New Workspace draft payload builder and reserved sentinel
 * keys. Saga production-behavior tests own drafts.get/set/clear coverage.
 */
import { describe, expect, it } from 'vitest';

import type { ContextItem } from '$lib/components/chat/input/context-api';
import {
  MAX_DRAFT_ATTACHMENTS_BYTES,
  NEW_WORKSPACE_DRAFT_AGENT_ID,
  NEW_WORKSPACE_DRAFT_WORKSPACE_ID,
  buildNewWorkspaceDraftPayload,
} from '../new-workspace-draft';

const imageItem: ContextItem = {
  id: 'image-1721650000000-0',
  type: 'file',
  label: 'screenshot.png',
  file: new File(['x'], 'screenshot.png', { type: 'image/png' }),
  imageData: 'iVBORw0KGgoAAAANSUhEUg==',
  imageMimeType: 'image/png',
};

const plainItem: ContextItem = { id: 'ctx-1', type: 'file', label: 'README.md' };

describe('buildNewWorkspaceDraftPayload', () => {
  it('serializes image context items into the drafts.set attachments array', () => {
    expect(buildNewWorkspaceDraftPayload('hello', [imageItem, plainItem])).toEqual({
      text: 'hello',
      attachments: [
        {
          id: 'image-1721650000000-0',
          type: 'file',
          label: 'screenshot.png',
          imageData: 'iVBORw0KGgoAAAANSUhEUg==',
          imageMimeType: 'image/png',
        },
      ],
    });
  });

  it('omits the attachments field when no image items are present', () => {
    const payload = buildNewWorkspaceDraftPayload('text only', [plainItem]);

    expect(payload).toEqual({ text: 'text only' });
    expect('attachments' in payload!).toBe(false);
  });

  it('drops attachments (keeping text) when the serialized payload exceeds the size guard', () => {
    const oversizedItem: ContextItem = {
      ...imageItem,
      imageData: 'a'.repeat(MAX_DRAFT_ATTACHMENTS_BYTES + 1),
    };

    const payload = buildNewWorkspaceDraftPayload('still saved', [oversizedItem]);

    expect(payload).toEqual({ text: 'still saved' });
    expect('attachments' in payload!).toBe(false);
  });

  it('keeps the attachments that fit when one exceeds the size guard', () => {
    // An image accepted at the 30 MiB reference cap exceeds the 20 MiB
    // draft guard — it must be dropped alone, not take the fitting
    // attachments down with it.
    const oversizedItem: ContextItem = {
      ...imageItem,
      id: 'image-oversized',
      imageData: 'a'.repeat(MAX_DRAFT_ATTACHMENTS_BYTES + 1),
    };

    const payload = buildNewWorkspaceDraftPayload('still saved', [oversizedItem, imageItem]);

    expect(payload!.text).toBe('still saved');
    expect(payload!.attachments).toHaveLength(1);
    expect(payload!.attachments![0].id).toBe(imageItem.id);
  });

  it('guards on text + attachments combined, not attachments alone', () => {
    const nearLimitItem: ContextItem = {
      ...imageItem,
      imageData: 'a'.repeat(MAX_DRAFT_ATTACHMENTS_BYTES - 200),
    };
    const longText = 'b'.repeat(400);

    const payload = buildNewWorkspaceDraftPayload(longText, [nearLimitItem]);

    expect(payload).toEqual({ text: longText });
    expect('attachments' in payload!).toBe(false);
  });

  it('returns null (skip persistence) when the text alone exceeds the size guard', () => {
    const hugeText = 'a'.repeat(MAX_DRAFT_ATTACHMENTS_BYTES + 1);

    expect(buildNewWorkspaceDraftPayload(hugeText, [])).toBeNull();
  });
});

describe('sentinel constants', () => {
  it('match the reserved sentinel pair documented in PROTOCOL §5.16', () => {
    expect(NEW_WORKSPACE_DRAFT_WORKSPACE_ID).toBe('__new-workspace__');
    expect(NEW_WORKSPACE_DRAFT_AGENT_ID).toBe('__initializer__');
  });
});
