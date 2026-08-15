import { describe, expect, it } from 'vitest';
import { isFileDragEvent } from './drop-guard';

function makeDragEvent(types?: string[]): DragEvent {
  return {
    dataTransfer: types ? ({ types } as unknown as DataTransfer) : null,
  } as unknown as DragEvent;
}

describe('isFileDragEvent (editorProps.handleDrop guard)', () => {
  it('returns true when the drag carries OS files (e.g. image from Finder)', () => {
    expect(isFileDragEvent(makeDragEvent(['Files']))).toBe(true);
  });

  it('returns true when files are dragged alongside other types', () => {
    expect(isFileDragEvent(makeDragEvent(['text/uri-list', 'Files']))).toBe(true);
  });

  it('returns false for text/content drags within the editor', () => {
    expect(isFileDragEvent(makeDragEvent(['text/plain', 'text/html']))).toBe(false);
  });

  it('returns false when the drag has no types', () => {
    expect(isFileDragEvent(makeDragEvent([]))).toBe(false);
  });

  it('returns false when dataTransfer is missing', () => {
    expect(isFileDragEvent(makeDragEvent(undefined))).toBe(false);
  });
});
