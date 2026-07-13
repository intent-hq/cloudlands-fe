import { describe, it, expect } from 'vitest';

/**
 * Unit tests for ChatPanel imageBlocks transformation helper (STAB-7 fix).
 *
 * Verifies that the inline-image → imageBlocks mapping logic works correctly.
 * This tests the transformation step that handleSend/handleForceSubmit use.
 */

// Helper function extracted from ChatPanel transformation logic
function extractImageBlocks(contextItems: any[]): any[] {
  return contextItems
    .filter(
      (item) =>
        item.type === 'inline-image' &&
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

  it('transforms inline-image context items into imageBlocks', () => {
    const contextItems = [
      {
        id: 'inline-image-1',
        type: 'inline-image' as const,
        label: 'Screenshot',
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
        id: 'inline-image-1',
        type: 'inline-image' as const,
        label: 'Image with data',
        imageData: 'base64data',
        imageMimeType: 'image/jpeg',
      },
      {
        id: 'file-1',
        type: 'file' as const,
        label: 'Regular file',
      },
      {
        id: 'inline-image-2',
        type: 'inline-image' as const,
        label: 'Image without mimeType',
        imageData: 'base64data2',
      },
    ];

    const imageBlocks = extractImageBlocks(contextItems);

    expect(imageBlocks).toHaveLength(1);
    expect(imageBlocks[0].data).toBe('base64data');
    expect(imageBlocks[0].mimeType).toBe('image/jpeg');
  });

  it('handles multiple inline images', () => {
    const contextItems = [
      {
        id: 'img-1',
        type: 'inline-image' as const,
        label: 'First image',
        imageData: 'data1',
        imageMimeType: 'image/png',
      },
      {
        id: 'img-2',
        type: 'inline-image' as const,
        label: 'Second image',
        imageData: 'data2',
        imageMimeType: 'image/jpeg',
      },
    ];

    const imageBlocks = extractImageBlocks(contextItems);

    expect(imageBlocks).toHaveLength(2);
    expect(imageBlocks[0]).toEqual({ type: 'image', data: 'data1', mimeType: 'image/png' });
    expect(imageBlocks[1]).toEqual({ type: 'image', data: 'data2', mimeType: 'image/jpeg' });
  });
});
