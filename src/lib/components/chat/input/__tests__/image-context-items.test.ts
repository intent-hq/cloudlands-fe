/**
 * Shared image File → ContextItem conversion: size-cap enforcement with the
 * too-large toast, data-URL parsing into imageData/imageMimeType, generated
 * filename fallback, and per-file failure toasts on unreadable input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'svelte-sonner';
import { imageFilesToContextItems } from '../image-context-items';

vi.mock('svelte-sonner', () => ({
  toast: { success: vi.fn(), error: vi.fn() },
}));

const PNG_B64 = 'iVBORw0KGgoAAAANSUhEUg==';

function makeImageFile(name: string, bytes: number, type = 'image/png'): File {
  return new File([new Uint8Array(bytes)], name, { type });
}

const readAsPngDataUrl = async () => `data:image/png;base64,${PNG_B64}`;

beforeEach(() => {
  vi.clearAllMocks();
});

describe('imageFilesToContextItems', () => {
  it('converts an image file into a ContextItem with imageData/imageMimeType', async () => {
    const file = makeImageFile('shot.png', 3);
    const items = await imageFilesToContextItems([file], {
      maxBytes: 1024,
      readFile: readAsPngDataUrl,
    });

    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'file',
      label: 'shot.png',
      path: 'shot.png',
      file,
      imageData: PNG_B64,
      imageMimeType: 'image/png',
    });
    expect(items[0].id).toMatch(/^file-upload-\d+-\d+-shot\.png$/);
    expect(items[0].description).toContain('image/png');
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).not.toHaveBeenCalled();
  });

  it('rejects files over maxBytes with one too-large toast and no items', async () => {
    const readFile = vi.fn(readAsPngDataUrl);
    const items = await imageFilesToContextItems(
      [makeImageFile('big-a.png', 11), makeImageFile('big-b.png', 12)],
      { maxBytes: 10, readFile },
    );

    expect(items).toHaveLength(0);
    expect(readFile).not.toHaveBeenCalled();
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('big-a.png, big-b.png');
    expect(toast.success).not.toHaveBeenCalled();
  });

  it('keeps files at exactly maxBytes and drops only the oversized ones', async () => {
    const items = await imageFilesToContextItems(
      [makeImageFile('fits.png', 10), makeImageFile('big.png', 11)],
      { maxBytes: 10, readFile: readAsPngDataUrl },
    );

    expect(items.map((i) => i.label)).toEqual(['fits.png']);
    expect(toast.success).toHaveBeenCalledTimes(1);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('big.png');
  });

  it('falls back to a generated file name derived from the mime type', async () => {
    const items = await imageFilesToContextItems([makeImageFile('', 3, 'image/webp')], {
      maxBytes: 1024,
      readFile: async () => `data:image/webp;base64,${PNG_B64}`,
    });

    expect(items).toHaveLength(1);
    expect(items[0].label).toMatch(/^image-\d+\.webp$/);
    expect(items[0].path).toBe(items[0].label);
  });

  it('toasts a per-file failure on an invalid data URL and continues', async () => {
    const items = await imageFilesToContextItems(
      [makeImageFile('broken.png', 3), makeImageFile('ok.png', 3)],
      {
        maxBytes: 1024,
        readFile: async (file) =>
          file.name === 'broken.png' ? 'not-a-data-url' : readAsPngDataUrl(),
      },
    );

    expect(items.map((i) => i.label)).toEqual(['ok.png']);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(toast.error).mock.calls[0][0]).toContain('broken.png');
    expect(toast.success).toHaveBeenCalledTimes(1);
  });

  it('toasts a per-file failure when reading the file rejects', async () => {
    const items = await imageFilesToContextItems([makeImageFile('unreadable.png', 3)], {
      maxBytes: 1024,
      readFile: async () => {
        throw new Error('Failed to read file');
      },
    });

    expect(items).toHaveLength(0);
    expect(toast.error).toHaveBeenCalledTimes(1);
    expect(toast.success).not.toHaveBeenCalled();
  });
});
