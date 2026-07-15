import { describe, it, expect } from 'vitest';

/**
 * Unit tests for ChatPanel imageBlocks transformation helper (STAB-7 fix).
 *
 * Verifies that context items with imageData/imageMimeType → imageBlocks mapping works correctly.
 * This tests the transformation step that handleSend/handleForceSubmit use.
 */

// Helper function extracted from ChatPanel transformation logic
// Updated to accept ALL context items with imageData/imageMimeType (not just inline-image type)
function extractImageBlocks(contextItems: any[]): any[] {
  return contextItems
    .filter(
      (item) =>
        typeof item.imageData === 'string' &&
        typeof item.imageMimeType === 'string',
    )
    .map((item) => ({
      type: 'image' as const,
      data: item.imageData,
      mimeType: item.imageMimeType,
    }));
}

describe('ChatPanel imageBlocks transformation helper (STAB-7)', () => {

  it('transforms file-type context items with imageData into imageBlocks', () => {
    const contextItems = [
      {
        id: 'file-upload-123-screenshot.png',
        type: 'file' as const,
        label: 'screenshot.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
        imageMimeType: 'image/png',
      },
      { id: 'ctx-1', type: 'file' as const, label: 'README.md' },
    ];

    const imageBlocks = extractImageBlocks(contextItems);

    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0]).toEqual({
      type: 'image',
      data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==',
      mimeType: 'image/png',
    });
  });

  it('filters out context items without imageData/imageMimeType', () => {
    const contextItems = [
      {
        id: 'file-upload-1',
        type: 'file' as const,
        label: 'photo.jpg',
        imageData: 'base64data',
        imageMimeType: 'image/jpeg',
      },
      {
        id: 'file-2',
        type: 'file' as const,
        label: 'Regular file',
      },
      {
        id: 'file-3',
        type: 'file' as const,
        label: 'Image without mimeType',
        imageData: 'base64data2',
      },
    ];

    const imageBlocks = extractImageBlocks(contextItems);

    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0].data).toBe('base64data');
    expect(imageBlocks[0].mimeType).toBe('image/jpeg');
  });

  it('handles multiple image attachments', () => {
    const contextItems = [
      {
        id: 'file-upload-1',
        type: 'file' as const,
        label: 'first.png',
        imageData: 'data1',
        imageMimeType: 'image/png',
      },
      {
        id: 'file-upload-2',
        type: 'file' as const,
        label: 'second.jpg',
        imageData: 'data2',
        imageMimeType: 'image/jpeg',
      },
    ];

    const imageBlocks = extractImageBlocks(contextItems);

    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0]).toEqual({ type: 'image', data: 'data1', mimeType: 'image/png' });
    expect(imageBlocks[1]).toEqual({ type: 'image', data: 'data2', mimeType: 'image/jpeg' });
  });

  it('supports legacy inline-image type as fallback', () => {
    const contextItems = [
      {
        id: 'inline-img-1',
        type: 'inline-image' as const,
        label: 'Legacy inline',
        imageData: 'legacydata',
        imageMimeType: 'image/png',
      },
      {
        id: 'file-upload-1',
        type: 'file' as const,
        label: 'Modern attachment',
        imageData: 'newdata',
        imageMimeType: 'image/jpeg',
      },
    ];

    const imageBlocks = extractImageBlocks(contextItems);

    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0]).toEqual({ type: 'image', data: 'legacydata', mimeType: 'image/png' });
    expect(imageBlocks[1]).toEqual({ type: 'image', data: 'newdata', mimeType: 'image/jpeg' });
  });
});
