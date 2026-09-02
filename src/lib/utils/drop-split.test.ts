import { describe, expect, it } from 'vitest';
import { splitDroppedItems } from './drop-split';

function makeItem(file: File, entry: { isDirectory: boolean } | null | undefined) {
  return {
    kind: 'file',
    getAsFile: () => file,
    ...(entry !== undefined ? { webkitGetAsEntry: () => entry } : {}),
  } as unknown as DataTransferItem;
}

function makeDataTransfer(items: DataTransferItem[], files: File[] = []): DataTransfer {
  return { items, files } as unknown as DataTransfer;
}

describe('splitDroppedItems', () => {
  const regular = new File(['x'], 'cat.png', { type: 'image/png' });
  const folder = new File([], 'my-folder', { type: '' });

  it('returns empty arrays for a null dataTransfer', () => {
    expect(splitDroppedItems(null)).toEqual({ files: [], folderFiles: [] });
  });

  it('splits files from directories using webkitGetAsEntry', () => {
    const dt = makeDataTransfer([
      makeItem(regular, { isDirectory: false }),
      makeItem(folder, { isDirectory: true }),
    ]);

    expect(splitDroppedItems(dt)).toEqual({ files: [regular], folderFiles: [folder] });
  });

  it('treats a null entry as a regular file', () => {
    const dt = makeDataTransfer([makeItem(regular, null)]);

    expect(splitDroppedItems(dt)).toEqual({ files: [regular], folderFiles: [] });
  });

  it('treats items as regular files when webkitGetAsEntry is unavailable', () => {
    const dt = makeDataTransfer([makeItem(regular, undefined)]);

    expect(splitDroppedItems(dt)).toEqual({ files: [regular], folderFiles: [] });
  });

  it('skips non-file items (e.g. dragged text)', () => {
    const textItem = { kind: 'string' } as unknown as DataTransferItem;
    const dt = makeDataTransfer([textItem, makeItem(folder, { isDirectory: true })]);

    expect(splitDroppedItems(dt)).toEqual({ files: [], folderFiles: [folder] });
  });

  it('falls back to dataTransfer.files when the items list is empty (synthetic events)', () => {
    const dt = makeDataTransfer([], [regular]);

    expect(splitDroppedItems(dt)).toEqual({ files: [regular], folderFiles: [] });
  });

  it('falls back to dataTransfer.files when items is missing entirely', () => {
    const dt = { files: [regular] } as unknown as DataTransfer;

    expect(splitDroppedItems(dt)).toEqual({ files: [regular], folderFiles: [] });
  });

  it('falls back to dataTransfer.files when every getAsFile() returns null (deferred call)', () => {
    // e.g. the split is invoked after the event loop turns — the items are
    // still listed but getAsFile() yields null; the drop must not be
    // silently swallowed while dataTransfer.files still holds the files.
    const deadItem = {
      kind: 'file',
      getAsFile: () => null,
      webkitGetAsEntry: () => null,
    } as unknown as DataTransferItem;
    const dt = makeDataTransfer([deadItem], [regular]);

    expect(splitDroppedItems(dt)).toEqual({ files: [regular], folderFiles: [] });
  });
});
