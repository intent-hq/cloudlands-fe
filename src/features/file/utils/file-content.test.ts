import { describe, expect, it } from 'vitest';
import type { FileContent, FileContentEntry } from '$store/renderer/slices/files/files-types';
import { editableText, fileContentData, fileSnapshot } from './file-content';

function entry(content: FileContent, truncated = false): FileContentEntry {
  return {
    ...fileContentData(content),
    path: 'a',
    absolutePath: '/repo/a',
    lastUpdated: 0,
    loading: false,
    saving: false,
    error: null,
    truncated,
  };
}

describe('file content capabilities', () => {
  it('retains empty text as editable and restorable', () => {
    const empty = entry(editableText(''));
    expect(empty).toMatchObject({ kind: 'editable-text', localContent: '', originalContent: '' });
    expect(fileSnapshot(empty)).toEqual({
      kind: 'restorable-snapshot',
      content: '',
      isBinary: false,
    });
  });

  it('captures the current text draft for editor Undo', () => {
    const text = entry(editableText('disk'));
    if (text.kind !== 'editable-text') throw new Error('expected editable text');
    text.localContent = 'draft';
    expect(fileSnapshot(text)).toEqual({
      kind: 'restorable-snapshot',
      content: 'draft',
      isBinary: false,
    });
  });

  it('preserves exact readable binary bytes independently of any local draft', () => {
    const binary = entry({
      kind: 'restorable-snapshot',
      content: '\b\u0001\ufeff\r\n',
      isBinary: true,
    });
    if (binary.kind !== 'restorable-snapshot') throw new Error('expected binary snapshot');
    binary.localContent = 'stale text draft';
    const snapshot = fileSnapshot(binary);
    expect(snapshot).toEqual({
      kind: 'restorable-snapshot',
      content: '\b\u0001\ufeff\r\n',
      isBinary: true,
    });
    expect(Array.from(new TextEncoder().encode(snapshot?.content))).toEqual([
      8, 1, 239, 187, 191, 13, 10,
    ]);
  });

  it('never invents a snapshot for unavailable or truncated contents', () => {
    expect(fileSnapshot(undefined)).toBeUndefined();
    expect(fileSnapshot(entry({ kind: 'preview-only', isBinary: true }))).toBeUndefined();
    expect(fileSnapshot(entry({ kind: 'preview-only', isBinary: false }))).toBeUndefined();
    expect(fileSnapshot(entry(editableText('partial'), true))).toBeUndefined();
    expect(
      fileSnapshot(entry({ kind: 'restorable-snapshot', content: '\b', isBinary: true }, true)),
    ).toBeUndefined();
  });
});
