/**
 * Draft attachment serialization for chat input drafts (PROTOCOL §5.16).
 *
 * ChatPanel persists image context items alongside draft text via the opaque
 * `attachments` array on `drafts.set`, and rehydrates `contextItems` from a
 * PROTOCOL-shaped `drafts.get` response after a reload (no `File` handle —
 * thumbnails render from `imageData`/`imageMimeType`).
 */
import { describe, expect, it } from 'vitest';

import type { DraftAttachment } from '$lib/client/app-client';
import { deserializeDraftAttachments, serializeDraftAttachments } from '../chat-draft-attachments';
import { hasBlockingAttachments, type ContextItem } from '../input/context-api';
import { prepareRepositoryFileContext } from '../chat-repository-file-context';

const IMAGE_ITEM: ContextItem = {
  id: 'file-upload-1721650000000-screenshot.png',
  type: 'file',
  label: 'screenshot.png',
  description: 'image/png • 12.3 KB',
  path: 'screenshot.png',
  file: new File(['x'], 'screenshot.png', { type: 'image/png' }),
  imageData: 'iVBORw0KGgoAAAANSUhEUg==',
  imageMimeType: 'image/png',
};

describe('serializeDraftAttachments', () => {
  it('projects malformed repository display fields to renderable strings without inferring identity', () => {
    const malformed = {
      id: { bad: true },
      type: 'file',
      label: 42,
      description: { body: 'private' },
      repositoryFile: null,
      content: 'private',
    } as unknown as ContextItem;
    const expected = {
      id: '',
      type: 'file',
      label: '',
      repositoryFile: { workspaceId: '', rootPath: '', path: '' },
    };
    expect(serializeDraftAttachments([malformed])).toEqual([expected]);
    const restored = deserializeDraftAttachments([malformed as DraftAttachment]);
    expect(restored).toEqual([expected]);
    expect(prepareRepositoryFileContext('workspace', '/repo', restored)).toEqual({
      ok: false,
      itemId: '',
      reason: 'invalid-reference',
    });
  });

  it('round-trips repository identities while dropping every upload and body field', () => {
    const repositoryFile = { workspaceId: 'workspace', rootPath: '/repo', path: 'src/main.ts' };
    const item: ContextItem = {
      ...IMAGE_ITEM,
      id: 'repository-pill',
      label: 'main.ts',
      repositoryFile,
      content: 'stale text',
      metadata: { content: 'another stale copy' },
      attachmentId: 'unrelated-upload',
      attachmentMimeType: 'text/plain',
      attachmentSize: 25,
      sourcePath: '/repo/src/main.ts',
      placementStatus: 'placing',
      placementAttachmentId: 'placed-image',
      placementIdempotencyKey: 'upload-key',
    };
    const expected = {
      id: 'repository-pill',
      type: 'file',
      label: 'main.ts',
      description: IMAGE_ITEM.description,
      repositoryFile,
    };
    const persisted = serializeDraftAttachments([item]);
    expect(persisted).toEqual([expected]);
    expect(deserializeDraftAttachments(JSON.parse(JSON.stringify(persisted)))).toEqual([expected]);
    expect(deserializeDraftAttachments([item as DraftAttachment])).toEqual([expected]);
  });

  it.each([undefined, null, {}, { workspaceId: 'workspace', rootPath: '/repo', path: 42 }])(
    'keeps malformed repository marker %j visible and blocked after persistence',
    (repositoryFile) => {
      const item = { ...IMAGE_ITEM, repositoryFile } as ContextItem;
      for (const restored of [
        deserializeDraftAttachments(serializeDraftAttachments([item])),
        deserializeDraftAttachments([item as DraftAttachment]),
      ]) {
        expect(restored).toHaveLength(1);
        expect(restored[0]).toHaveProperty('repositoryFile');
        expect(restored[0]).not.toHaveProperty('imageData');
        expect(restored[0]).not.toHaveProperty('file');
        expect(prepareRepositoryFileContext('workspace', '/repo', restored)).toEqual({
          ok: false,
          itemId: item.id,
          reason: 'invalid-reference',
        });
      }
    },
  );

  it('persists and restores note identity and display metadata without note bodies or file data', () => {
    const item: ContextItem = {
      id: 'note-pill',
      type: 'note',
      label: 'Research',
      description: 'Workspace note',
      noteId: 'note-identity',
      workspaceId: 'workspace-identity',
      content: 'full private body',
      metadata: { cachedNote: { content: 'stale copy' } },
      path: 'not-a-note-identity',
      file: new File(['secret'], 'note.txt'),
      imageData: 'bytes',
      imageMimeType: 'image/png',
      attachmentId: 'not-a-file',
    };
    const expected = {
      id: 'note-pill',
      type: 'note',
      label: 'Research',
      description: 'Workspace note',
      noteId: 'note-identity',
      workspaceId: 'workspace-identity',
    };
    const persisted = serializeDraftAttachments([item]);
    expect(persisted).toEqual([expected]);
    expect(deserializeDraftAttachments(JSON.parse(JSON.stringify(persisted)))).toEqual([expected]);
    // Also project an older/external row through the same whitelist on restore.
    expect(deserializeDraftAttachments([item as DraftAttachment])).toEqual([expected]);
    expect(serializeDraftAttachments([{ ...item, noteId: 'another-note' }])).not.toEqual(persisted);
    expect(serializeDraftAttachments([{ ...item, workspaceId: 'another-workspace' }])).not.toEqual(
      persisted,
    );
  });

  it('projects image context items to wire-safe attachments, dropping the File handle', () => {
    const attachments = serializeDraftAttachments([IMAGE_ITEM]);

    expect(attachments).toEqual([
      {
        id: 'file-upload-1721650000000-screenshot.png',
        type: 'file',
        label: 'screenshot.png',
        description: 'image/png • 12.3 KB',
        path: 'screenshot.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUg==',
        imageMimeType: 'image/png',
      },
    ]);
    expect('file' in attachments[0]).toBe(false);
  });

  it('skips context items without image data, attachmentId, or sourcePath', () => {
    const nonImage: ContextItem = {
      id: 'file-upload-1-notes.txt',
      type: 'file',
      label: 'notes.txt',
      path: 'notes.txt',
      file: new File(['x'], 'notes.txt', { type: 'text/plain' }),
    };

    expect(serializeDraftAttachments([nonImage])).toEqual([]);
    expect(serializeDraftAttachments([nonImage, IMAGE_ITEM])).toHaveLength(1);
  });

  it('persists an in-flight (placing) item as sourcePath + a FAILED marker — no bytes', () => {
    // A placement still in flight cannot survive a reload, so the draft
    // records it as failed: the restore renders a blocking, retryable pill
    // instead of silently dropping the attachment from the send.
    const staged: ContextItem = {
      id: 'staged-file-1721650000000-0',
      type: 'file',
      label: 'notes.txt',
      description: 'text/plain • 1.0 KB',
      path: 'notes.txt',
      attachmentMimeType: 'text/plain',
      attachmentSize: 1024,
      sourcePath: '/home/user/notes.txt',
      placementStatus: 'placing',
      file: new File(['x'], 'notes.txt', { type: 'text/plain' }),
    };

    const attachments = serializeDraftAttachments([staged]);

    expect(attachments).toEqual([
      {
        id: 'staged-file-1721650000000-0',
        type: 'file',
        label: 'notes.txt',
        description: 'text/plain • 1.0 KB',
        path: 'notes.txt',
        attachmentMimeType: 'text/plain',
        attachmentSize: 1024,
        sourcePath: '/home/user/notes.txt',
        placementStatus: 'failed',
      },
    ]);
    expect('file' in attachments[0]).toBe(false);
    expect('imageData' in attachments[0]).toBe(false);
  });

  it('persists placed-attachment items as UUID + metadata — no bytes', () => {
    const placed: ContextItem = {
      id: 'attachment-att-uuid-1',
      type: 'file',
      label: 'dump.har',
      description: 'application/json • 12 MB',
      path: '.intent/attachments/dump.har',
      attachmentId: 'att-uuid-1',
      attachmentMimeType: 'application/json',
      attachmentSize: 12_582_912,
    };

    const attachments = serializeDraftAttachments([placed]);

    expect(attachments).toEqual([
      {
        id: 'attachment-att-uuid-1',
        type: 'file',
        label: 'dump.har',
        description: 'application/json • 12 MB',
        path: '.intent/attachments/dump.har',
        attachmentId: 'att-uuid-1',
        attachmentMimeType: 'application/json',
        attachmentSize: 12_582_912,
      },
    ]);
    expect('imageData' in attachments[0]).toBe(false);
  });

  it('serializes to plain JSON (survives the wire round-trip verbatim)', () => {
    const attachments = serializeDraftAttachments([IMAGE_ITEM]);

    expect(JSON.parse(JSON.stringify(attachments))).toEqual(attachments);
  });
});

describe('deserializeDraftAttachments', () => {
  it('rehydrates context items from a PROTOCOL-shaped drafts.get response', () => {
    // §5.16: { text, attachments?, updatedAt } — attachments present only when non-empty.
    const draft = {
      text: 'draft in progress',
      attachments: [
        {
          id: 'file-upload-1721650000000-screenshot.png',
          type: 'file',
          label: 'screenshot.png',
          description: 'image/png • 12.3 KB',
          path: 'screenshot.png',
          imageData: 'iVBORw0KGgoAAAANSUhEUg==',
          imageMimeType: 'image/png',
        } satisfies DraftAttachment,
      ],
      updatedAt: '2026-07-22T12:00:00.000Z',
    };

    const items = deserializeDraftAttachments(draft.attachments);

    expect(items).toEqual([
      {
        id: 'file-upload-1721650000000-screenshot.png',
        type: 'file',
        label: 'screenshot.png',
        description: 'image/png • 12.3 KB',
        path: 'screenshot.png',
        imageData: 'iVBORw0KGgoAAAANSUhEUg==',
        imageMimeType: 'image/png',
      },
    ]);
    expect(items[0].file).toBeUndefined();
  });

  it('round-trips serialize → deserialize losslessly (minus the File handle)', () => {
    const { file: _file, ...expected } = IMAGE_ITEM;

    const items = deserializeDraftAttachments(serializeDraftAttachments([IMAGE_ITEM]));

    expect(items).toEqual([expected]);
  });

  it('round-trips placed-attachment items so a reload restores the pill', () => {
    const placed: ContextItem = {
      id: 'attachment-att-uuid-1',
      type: 'file',
      label: 'dump.har',
      path: '.intent/attachments/dump.har',
      attachmentId: 'att-uuid-1',
      attachmentMimeType: 'application/json',
      attachmentSize: 12_582_912,
    };

    const items = deserializeDraftAttachments(serializeDraftAttachments([placed]));

    expect(items).toEqual([placed]);
  });

  it('round-trips a content-backed selection item and remains compatible without content', () => {
    const selection: ContextItem = {
      id: 'browser-capture-1-context',
      type: 'selection',
      label: '<button> · example.com',
      content:
        '<browser-element-capture>\nDOM path: html > body > button\n</browser-element-capture>',
    };

    expect(deserializeDraftAttachments(serializeDraftAttachments([selection]))).toEqual([
      selection,
    ]);
    expect(
      deserializeDraftAttachments([
        { id: 'legacy-selection', type: 'selection', label: 'Legacy selection' },
      ]),
    ).toEqual([{ id: 'legacy-selection', type: 'selection', label: 'Legacy selection' }]);
  });

  it('round-trips a dropped-folder item (path + label) so an onboarding reload keeps the pill', () => {
    // Folders are never placed (the daemon rejects directories) — they
    // persist path-only and ride contextReferences at create time.
    const folder: ContextItem = {
      id: 'staged-folder-/home/user/projects/my-folder',
      type: 'folder',
      label: 'my-folder',
      path: '/home/user/projects/my-folder',
    };

    const attachments = serializeDraftAttachments([folder]);
    expect(attachments).toEqual([
      {
        id: 'staged-folder-/home/user/projects/my-folder',
        type: 'folder',
        label: 'my-folder',
        path: '/home/user/projects/my-folder',
      },
    ]);

    const items = deserializeDraftAttachments(attachments);
    expect(items).toEqual([folder]);
    expect(hasBlockingAttachments(items)).toBe(false);
  });

  it('round-trips a staged non-image item path-only — no bytes, no placement status', () => {
    // Staged pre-workspace items (modal/onboarding) persist only the host
    // path they will be placed from at workspace.create redemption.
    const staged: ContextItem = {
      id: 'staged-file-1721650000000-0',
      type: 'file',
      label: 'server.log',
      description: 'text/plain • 4.0 MB',
      path: 'server.log',
      attachmentMimeType: 'text/plain',
      attachmentSize: 4_194_304,
      sourcePath: '/home/user/logs/server.log',
    };

    const attachments = serializeDraftAttachments([staged]);
    expect(attachments).toEqual([
      {
        id: 'staged-file-1721650000000-0',
        type: 'file',
        label: 'server.log',
        description: 'text/plain • 4.0 MB',
        path: 'server.log',
        attachmentMimeType: 'text/plain',
        attachmentSize: 4_194_304,
        sourcePath: '/home/user/logs/server.log',
      },
    ]);
    // No bytes and no transient placement status in the persisted shape.
    expect('imageData' in attachments[0]).toBe(false);
    expect('placementStatus' in attachments[0]).toBe(false);

    const items = deserializeDraftAttachments(attachments);
    expect(items).toEqual([staged]);
    expect(items[0].placementStatus).toBeUndefined();
  });

  it('restores a persisted placing/failed chat-input item as a BLOCKING failed pill', () => {
    // A chat-input item persisted while placing or failed must come back as
    // a failed pill that blocks send and retries from its sourcePath —
    // silent drop (no status, no block, no chip) is a spec violation.
    for (const status of ['placing', 'failed'] as const) {
      const item: ContextItem = {
        id: `attachment-pending-1721650000000-crash.log`,
        type: 'file',
        label: 'crash.log',
        path: 'crash.log',
        attachmentMimeType: 'text/plain',
        attachmentSize: 2048,
        sourcePath: '/home/user/crash.log',
        placementStatus: status,
      };

      const restored = deserializeDraftAttachments(serializeDraftAttachments([item]));

      expect(restored[0].placementStatus).toBe('failed');
      expect(restored[0].sourcePath).toBe('/home/user/crash.log');
      // The restored item blocks send until retried (re-places from
      // sourcePath) or removed.
      expect(hasBlockingAttachments(restored)).toBe(true);
    }
  });

  it('never restores a failed marker onto a placed attachment', () => {
    // Defensive: a draft row carrying both an attachmentId and a stale
    // failed marker rehydrates as the placed pill (the registry UUID wins).
    const row: DraftAttachment = {
      id: 'attachment-att-uuid-7',
      type: 'file',
      label: 'dump.har',
      attachmentId: 'att-uuid-7',
      attachmentMimeType: 'application/json',
      attachmentSize: 1024,
      placementStatus: 'failed',
    };

    const items = deserializeDraftAttachments([row]);

    expect(items[0].attachmentId).toBe('att-uuid-7');
    expect(items[0].placementStatus).toBeUndefined();
    expect(hasBlockingAttachments(items)).toBe(false);
  });
});
