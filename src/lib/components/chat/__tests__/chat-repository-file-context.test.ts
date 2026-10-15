import { describe, expect, it } from 'vitest';
import {
  formatRepositoryFileContext,
  prepareRepositoryFileContext,
} from '../chat-repository-file-context';
import type { ContextItem } from '../input/context-item';
import { hasComposerContextReferences } from '../../../../features/agent/agent-context';
import { extractAttachmentBlocks } from '../chat-attachment-blocks';

const workspaceId = 'workspace-1';
const rootPath = '/work/project';
const file: ContextItem = {
  id: 'repository-pill',
  type: 'file',
  label: 'A display label, never an identity',
  repositoryFile: { workspaceId, rootPath, path: 'src/main.ts' },
};

describe('repository file context', () => {
  it('never extracts an upload from an in-memory repository marker, even when malformed', () => {
    const markers = [undefined, null, {}, file.repositoryFile];
    const items = markers.flatMap((repositoryFile) => [
      { ...file, repositoryFile, imageData: 'private-inline-image', imageMimeType: 'image/png' },
      { ...file, repositoryFile, attachmentId: 'unrelated-image', imageMimeType: 'image/png' },
      { ...file, repositoryFile, attachmentId: 'unrelated-file' },
    ]) as ContextItem[];
    expect(extractAttachmentBlocks(items)).toEqual({ imageBlocks: [], fileBlocks: [] });
    expect(
      extractAttachmentBlocks([
        ...items,
        { id: 'upload', type: 'file', label: 'upload.txt', attachmentId: 'actual-upload' },
        {
          id: 'image',
          type: 'file',
          label: 'image.png',
          imageData: 'actual-image',
          imageMimeType: 'image/png',
        },
      ]),
    ).toEqual({
      imageBlocks: [{ type: 'image', data: 'actual-image', mimeType: 'image/png' }],
      fileBlocks: [{ type: 'file', attachmentId: 'actual-upload', fileName: 'upload.txt' }],
    });
  });

  it('emits unique explicit file pointers without copying bodies or inferring upload identities', () => {
    const prepared = prepareRepositoryFileContext(workspaceId, rootPath, [
      { ...file, content: 'private body', metadata: { cachedBody: 'stale body' } },
      { ...file, id: 'duplicate-pill' },
      { id: 'upload', type: 'file', label: 'upload', path: 'elsewhere.txt', attachmentId: 'uuid' },
      { id: 'note', type: 'note', label: 'Note', noteId: 'note-id', workspaceId },
    ]);
    expect(prepared).toEqual({
      ok: true,
      contextReferences: [
        { type: 'file', filePath: 'src/main.ts', metadata: { workspaceId, rootPath } },
      ],
      workspaceContextStr: '[Currently viewing file: src/main.ts]',
    });
    expect(formatRepositoryFileContext('/work/project/src/main.ts')).toBe(
      '[Currently viewing file: /work/project/src/main.ts]',
    );
  });

  it.each([
    { workspaceId: 'other', rootPath, path: 'src/main.ts', reason: 'cross-workspace' },
    { workspaceId, rootPath: '/work/secondary', path: 'src/main.ts', reason: 'cross-root' },
    { workspaceId, rootPath, path: '../outside.txt', reason: 'invalid-reference' },
    { workspaceId, rootPath, path: '/work/project/src/main.ts', reason: 'invalid-reference' },
    { workspaceId, rootPath, path: 'src/./main.ts', reason: 'invalid-reference' },
    { workspaceId, rootPath, path: 'src//main.ts', reason: 'invalid-reference' },
    { workspaceId, rootPath, path: 'src/main\0.ts', reason: 'invalid-reference' },
  ])('blocks the entire selection for $reason: $path', ({ reason, ...repositoryFile }) => {
    expect(
      prepareRepositoryFileContext(workspaceId, rootPath, [
        file,
        { ...file, id: 'bad', repositoryFile },
      ]),
    ).toEqual({ ok: false, itemId: 'bad', reason });
  });

  it.each([undefined, null, {}, { workspaceId, rootPath, path: 42 }])(
    'retains the pointer boundary for malformed identity %j',
    (repositoryFile) => {
      const item = {
        ...file,
        repositoryFile,
        path: 'src/main.ts',
        label: 'src/main.ts',
      } as ContextItem;
      expect(prepareRepositoryFileContext(workspaceId, rootPath, [item])).toEqual({
        ok: false,
        itemId: file.id,
        reason: 'invalid-reference',
      });
    },
  );

  it('preserves POSIX filename backslashes while requiring canonical Windows-relative paths', () => {
    const path = 'src/a\\b.ts';
    const prepared = prepareRepositoryFileContext(workspaceId, rootPath, [
      {
        ...file,
        repositoryFile: { workspaceId, rootPath, path },
      },
    ]);
    expect(prepared.ok && prepared.contextReferences[0].filePath).toBe(path);
    expect(
      prepareRepositoryFileContext(workspaceId, 'C:\\repo', [
        {
          ...file,
          repositoryFile: { workspaceId, rootPath: 'C:\\repo', path },
        },
      ]),
    ).toEqual({ ok: false, itemId: file.id, reason: 'invalid-reference' });
  });

  it('keeps legacy file hints separate from composer references, including malformed roots', () => {
    expect(hasComposerContextReferences([{ type: 'file', filePath: 'src/main.ts' }])).toBe(false);
    expect(hasComposerContextReferences([{ type: 'file', metadata: { rootPath: null } }])).toBe(
      true,
    );
    expect(hasComposerContextReferences([{ type: 'note', noteId: 'note' }])).toBe(true);
  });
});
