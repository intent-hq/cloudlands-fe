import { describe, expect, it } from 'vitest';
import { readMentionChip } from './chip';

function chip(attrs: Record<string, string>, text = ''): Parameters<typeof readMentionChip>[0] {
  return {
    getAttribute: (name) => (name in attrs ? attrs[name] : null),
    textContent: text,
  };
}

describe('readMentionChip', () => {
  it('ignores elements that are not mention chips', () => {
    expect(readMentionChip(null)).toBeNull();
    expect(readMentionChip(chip({ 'data-type': 'file' }))).toBeNull();
  });

  it('reads a file chip path and line from its meta', () => {
    const read = readMentionChip(
      chip({
        'data-mention': 'true',
        'data-type': 'file',
        'data-id': 'src/a.ts',
        'data-label': 'src/a.ts:12',
        'data-meta': JSON.stringify({ fullPath: 'src/a.ts', line: 12, lineSuffix: ':12' }),
      }),
    );
    expect(read).toMatchObject({ type: 'file', filePath: 'src/a.ts', line: 12 });
  });

  it('reads a folder chip path without its trailing slash', () => {
    const saved = readMentionChip(
      chip({
        'data-mention': 'true',
        'data-type': 'folder',
        'data-id': 'src/lib',
        'data-label': 'src/lib/',
        'data-meta': JSON.stringify({ fullPath: 'src/lib' }),
      }),
    );
    expect(saved).toMatchObject({ type: 'folder', folderPath: 'src/lib' });
    expect(saved?.filePath).toBeUndefined();

    const picked = readMentionChip(
      chip({
        'data-mention': 'true',
        'data-type': 'source-folder',
        'data-label': 'lib',
        'data-meta': JSON.stringify({ path: 'src/lib/' }),
      }),
    );
    expect(picked).toMatchObject({ folderPath: 'src/lib' });
  });

  it('prefers meta.path and meta.filename over the label', () => {
    const byName = readMentionChip(
      chip({
        'data-mention': 'true',
        'data-type': 'file',
        'data-label': 'README.md:3',
        'data-meta': JSON.stringify({ filename: 'README.md', line: 3 }),
      }),
    );
    expect(byName).toMatchObject({ filePath: 'README.md', line: 3 });
  });

  it('falls back to the label or visible text for older chips, without @ or suffix', () => {
    expect(
      readMentionChip(
        chip({ 'data-mention': 'true', 'data-type': 'file', 'data-label': '@src/a.ts#L3-7' }),
      ),
    ).toMatchObject({ filePath: 'src/a.ts' });
    expect(
      readMentionChip(
        chip({ 'data-mention': 'true', 'data-type': 'file', 'data-id': 'a.ts' }, '@src/lib/a.ts'),
      ),
    ).toMatchObject({ filePath: 'src/lib/a.ts' });
  });

  it('prefers an id that names a directory over a base-name label', () => {
    expect(
      readMentionChip(
        chip({
          'data-mention': 'true',
          'data-type': 'file',
          'data-id': 'src/lib/foo.ts',
          'data-label': 'foo.ts',
        }),
      ),
    ).toMatchObject({ filePath: 'src/lib/foo.ts' });
  });

  it('reads the line from startLine or a composer range', () => {
    expect(
      readMentionChip(
        chip({
          'data-mention': 'true',
          'data-type': 'file-range',
          'data-meta': JSON.stringify({ fullPath: 'a.ts', range: { start: 4, end: 9 } }),
        }),
      ),
    ).toMatchObject({ filePath: 'a.ts', line: 4 });
    expect(
      readMentionChip(
        chip({
          'data-mention': 'true',
          'data-type': 'file',
          'data-meta': JSON.stringify({ fullPath: 'a.ts', startLine: 8 }),
        }),
      ),
    ).toMatchObject({ line: 8 });
  });

  it('reads same-workspace and cross-workspace notes', () => {
    expect(
      readMentionChip(chip({ 'data-mention': 'true', 'data-type': 'note', 'data-id': 'n1' }))?.note,
    ).toEqual({ id: 'n1' });
    expect(
      readMentionChip(
        chip({
          'data-mention': 'true',
          'data-type': 'note',
          'data-id': 'n1',
          'data-meta': JSON.stringify({ workspaceId: 'ws-2', isExternalLink: true }),
        }),
      )?.note,
    ).toEqual({ id: 'n1', workspaceId: 'ws-2' });
    // A workspace id without the external flag is the current workspace.
    expect(
      readMentionChip(
        chip({
          'data-mention': 'true',
          'data-type': 'note',
          'data-id': 'n1',
          'data-meta': JSON.stringify({ workspaceId: 'ws-1' }),
        }),
      )?.note,
    ).toEqual({ id: 'n1' });
  });

  it('exposes an intent:// link from data-uri or meta.fullUrl', () => {
    expect(
      readMentionChip(
        chip({
          'data-mention': 'true',
          'data-type': 'note',
          'data-id': 'n1',
          'data-meta': JSON.stringify({ fullUrl: 'intent://local/note/n1' }),
        }),
      )?.intentUrl,
    ).toBe('intent://local/note/n1');
  });

  it('survives malformed meta', () => {
    expect(
      readMentionChip(
        chip({ 'data-mention': 'true', 'data-type': 'note', 'data-id': 'n', 'data-meta': '{' }),
      ),
    ).toMatchObject({ meta: {}, note: { id: 'n' } });
  });
});
