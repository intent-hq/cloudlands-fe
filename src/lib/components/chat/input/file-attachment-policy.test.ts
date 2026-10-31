import { describe, expect, it } from 'vitest';
import type { ContextItem } from './context-api';
import { fileAttachmentRejection, type FileAttachmentPolicy } from './file-attachment-policy';

const file = (id: string): ContextItem => ({ id, type: 'file', label: id });
const policy: FileAttachmentPolicy = {
  enabled: true,
  limit: 10,
  unavailableMessage: 'Unavailable',
  limitMessage: 'Limit',
};

describe('optional host file policy', () => {
  it('counts placed, pending and failed files toward the same limit', () => {
    const items = Array.from({ length: 9 }, (_, i) => file(String(i)));
    expect(fileAttachmentRejection(items, policy)).toBeNull();
    for (const placementStatus of ['placed', 'placing', 'failed'] as const)
      expect(
        fileAttachmentRejection([...items, { ...file('last'), placementStatus }], policy),
      ).toBe('limit');
  });

  it('keeps images and the separately owned clip out of the ten file slots', () => {
    const items = [
      ...Array.from({ length: 9 }, (_, i) => file(String(i))),
      { ...file('image'), imageMimeType: 'image/png', imageData: 'pixels' },
      { ...file('clip'), attachmentMimeType: 'video/mp4' },
    ];
    expect(fileAttachmentRejection(items, { ...policy, excludedIds: ['clip'] })).toBeNull();
    expect(fileAttachmentRejection(items, policy)).toBe('limit');
  });

  it('leaves ordinary chat unchanged and rejects unavailable host attachments before placement', () => {
    expect(
      fileAttachmentRejection(Array.from({ length: 20 }, (_, i) => file(String(i)))),
    ).toBeNull();
    expect(fileAttachmentRejection([], { ...policy, enabled: false })).toBe('disabled');
  });
});
