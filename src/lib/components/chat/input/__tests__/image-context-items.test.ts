/**
 * Shared image File → ContextItem conversion: size-cap enforcement with the
 * too-large toast, data-URL parsing into imageData/imageMimeType, generated
 * filename fallback, and per-file failure toasts on unreadable input.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { notify } from '$lib/components/patterns/notify';
import type { ContextItem } from '../context-api';
import { admitImageItems, imageFilesToContextItems } from '../image-context-items';

vi.mock('$lib/components/patterns/notify', () => ({
  notify: { success: vi.fn(), error: vi.fn() },
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
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).not.toHaveBeenCalled();
  });

  it('rejects files over maxBytes with one too-large toast and no items', async () => {
    const readFile = vi.fn(readAsPngDataUrl);
    const items = await imageFilesToContextItems(
      [makeImageFile('big-a.png', 11), makeImageFile('big-b.png', 12)],
      { maxBytes: 10, readFile },
    );

    expect(items).toHaveLength(0);
    expect(readFile).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify.error).mock.calls[0][0]).toContain('big-a.png, big-b.png');
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('keeps files at exactly maxBytes and drops only the oversized ones', async () => {
    const items = await imageFilesToContextItems(
      [makeImageFile('fits.png', 10), makeImageFile('big.png', 11)],
      { maxBytes: 10, readFile: readAsPngDataUrl },
    );

    expect(items.map((i) => i.label)).toEqual(['fits.png']);
    expect(notify.success).not.toHaveBeenCalled();
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify.error).mock.calls[0][0]).toContain('big.png');
  });

  it('admits images until the message total reaches maxBytes', async () => {
    const [existing] = await imageFilesToContextItems([makeImageFile('old.png', 3)], {
      maxBytes: 10,
      readFile: readAsPngDataUrl,
    });
    const added = await imageFilesToContextItems(
      [makeImageFile('a.png', 4), makeImageFile('b.png', 4), makeImageFile('c.png', 2)],
      { maxBytes: 10, readFile: readAsPngDataUrl },
    );

    const admitted = admitImageItems([existing], added, 10);

    expect(admitted.map((i) => i.label)).toEqual(['a.png', 'c.png']);
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify.error).mock.calls[0][0]).toContain('b.png');
  });

  it('counts unsupported formats, which are still sent as image references', async () => {
    const added = await imageFilesToContextItems(
      [makeImageFile('scan.tiff', 8, 'image/tiff'), makeImageFile('shot.png', 8)],
      { maxBytes: 10, readFile: async (file) => `data:${file.type};base64,${PNG_B64}` },
    );

    expect(added[0].placementFileName).toBe('scan.tiff');
    expect(admitImageItems([], added, 10).map((i) => i.label)).toEqual(['scan.tiff']);
  });

  it('rejects the later of two overlapping reads that together exceed the total', async () => {
    let composer: ContextItem[] = [];
    const deferred: Array<() => void> = [];
    const readFile = () =>
      new Promise<string>((resolve) =>
        deferred.push(() => resolve(`data:image/png;base64,${PNG_B64}`)),
      );
    const drop = async (name: string) => {
      const read = await imageFilesToContextItems([makeImageFile(name, 6)], {
        maxBytes: 10,
        readFile,
      });
      composer = [...composer, ...admitImageItems(composer, read, 10)];
    };

    const first = drop('first.png');
    const second = drop('second.png');
    await vi.waitFor(() => expect(deferred).toHaveLength(2));
    deferred[1]();
    await second;
    deferred[0]();
    await first;

    expect(composer.map((i) => i.label)).toEqual(['second.png']);
    expect(vi.mocked(notify.error).mock.calls[0][0]).toContain('first.png');
  });

  it('counts pasted images by their decoded base64 size', async () => {
    const pasted: ContextItem = { id: 'p', type: 'file', label: 'p', imageData: PNG_B64 };
    const added = await imageFilesToContextItems([makeImageFile('a.png', 6)], {
      maxBytes: 100,
      readFile: readAsPngDataUrl,
    });

    expect(admitImageItems([pasted], added, 21)).toHaveLength(0);
    expect(admitImageItems([pasted], added, 22)).toHaveLength(1);
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
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(vi.mocked(notify.error).mock.calls[0][0]).toContain('broken.png');
    expect(notify.success).not.toHaveBeenCalled();
  });

  it('toasts a per-file failure when reading the file rejects', async () => {
    const items = await imageFilesToContextItems([makeImageFile('unreadable.png', 3)], {
      maxBytes: 1024,
      readFile: async () => {
        throw new Error('Failed to read file');
      },
    });

    expect(items).toHaveLength(0);
    expect(notify.error).toHaveBeenCalledTimes(1);
    expect(notify.success).not.toHaveBeenCalled();
  });
});

it('retains SVG source bytes and the original placement name', async () => {
  const data = btoa('<svg xmlns="http://www.w3.org/2000/svg"/>');
  const file = makeImageFile('diagram.svg', 3, 'image/svg+xml');
  const items = await imageFilesToContextItems([file], {
    maxBytes: 1024,
    readFile: async () => `data:image/svg+xml;base64,${data}`,
  });
  expect(items[0]).toMatchObject({
    label: 'diagram.svg',
    placementFileName: 'diagram.svg',
    imageData: data,
    imageMimeType: 'image/svg+xml',
    file,
  });
});

it('uses an SVG extension for an unnamed SVG', async () => {
  const items = await imageFilesToContextItems([makeImageFile('', 3, 'image/svg+xml')], {
    maxBytes: 1024,
    readFile: async () => 'data:image/svg+xml;base64,PHN2Zy8+',
  });
  expect(items[0].label).toMatch(/^image-\d+\.svg$/);
});
