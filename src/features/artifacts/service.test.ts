import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ArtifactDocument } from '$shared/types/visual-artifact';
vi.mock('$lib/client', () => ({ appClient: { notes: {} } }));
vi.mock('$lib/client/live/backend-transport', () => ({
  backendRequest: vi.fn(),
  onBackendNotification: vi.fn(),
  onBackendReconnected: vi.fn(),
}));
import { backendRequest } from '$lib/client/live/backend-transport';
import { LiveNotesClient } from '$lib/client/live/live-notes-client';
import {
  ArtifactConflictError,
  artifactSelectionToContextItem,
  createArtifactService,
} from './service';
import { serializeArtifactBlock } from './model';

const document: ArtifactDocument = {
  version: 1,
  id: 'design',
  title: 'Options',
  kind: 'options',
  items: [{ id: 'a', type: 'card', text: 'A', x: 0, y: 0, width: 100, height: 100 }],
  connections: [],
  annotations: [],
};
const request = vi.mocked(backendRequest);
const service = createArtifactService(new LiveNotesClient());
const note = (rev: number, doc = document) => ({
  id: 'note-1',
  workspaceId: 'ws-1',
  title: 'Options',
  content: serializeArtifactBlock({ document: doc }),
  rev,
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  tags: ['artifact'],
});

beforeEach(() => vi.resetAllMocks());
describe('artifact persistence through the production note transport', () => {
  it('reads the exact workspace and saves conditionally without adopting a later writer document', async () => {
    request.mockResolvedValueOnce({ note: note(3) });
    const loaded = await service.loadArtifact('ws-1', 'note-1', 'design');
    expect(request).toHaveBeenLastCalledWith('note.get', { workspaceId: 'ws-1', noteId: 'note-1' });
    const next = { ...document, chosenIds: ['a'] };
    request.mockResolvedValueOnce({ ok: true });
    const result = await service.saveArtifact('ws-1', 'note-1', loaded, next);
    expect(request).toHaveBeenNthCalledWith(2, 'note.edit', {
      workspaceId: 'ws-1',
      noteId: 'note-1',
      old: loaded.rawBlock,
      new: serializeArtifactBlock({ document: next }),
      expectedVersion: 3,
    });
    expect(request).toHaveBeenCalledTimes(2);
    expect(result.revision).toBe(4);
    expect(result.document.chosenIds).toEqual(['a']);
  });
  it('preserves a draft and refuses an overwrite on a real conflict response', async () => {
    request.mockResolvedValueOnce({ note: note(3) });
    const loaded = await service.loadArtifact('ws-1', 'note-1', 'design');
    request.mockRejectedValueOnce(
      Object.assign(new Error('Conflict'), {
        rpcCode: -32005,
        data: { code: 'conflict', current: note(4) },
      }),
    );
    await expect(
      service.saveArtifact('ws-1', 'note-1', loaded, { ...document, chosenIds: ['a'] }),
    ).rejects.toBeInstanceOf(ArtifactConflictError);
    expect(loaded.revision).toBe(3);
    expect(request).toHaveBeenCalledTimes(2);
  });
  it('creates a tagged canonical note and returns daemon-owned identity', async () => {
    request.mockResolvedValueOnce({ note: note(0) });
    await expect(service.createArtifact('ws-1', document)).resolves.toEqual({
      noteId: 'note-1',
      artifactId: 'design',
    });
    expect(request).toHaveBeenCalledWith(
      'note.create',
      expect.objectContaining({
        workspaceId: 'ws-1',
        title: 'Options',
        tags: ['artifact'],
        content: serializeArtifactBlock({ document }),
        idempotencyKey: expect.any(String),
      }),
    );
  });
  it('includes explicit selection identity, revision, and snapshot in composer context', () => {
    const item = artifactSelectionToContextItem(
      document,
      { itemIds: ['a'] },
      { workspaceId: 'ws-1', noteId: 'note-1', artifactId: 'design', revision: 3 },
      'Prefer A',
    );
    expect(item.type).toBe('selection');
    expect(item.metadata?.semanticId).toBe('artifact:note-1/design#items:a');
    expect(item.content).toContain('"revision": 3');
    expect(item.content).toContain('"comment": "Prefer A"');
  });
  it('keeps pixels out of model text while retaining them for image attachment', () => {
    const src = 'data:image/png;base64,AAAA';
    const item = artifactSelectionToContextItem(
      { ...document, kind: 'image', image: { src, alt: 'Screenshot' } },
      { itemIds: [] },
      { workspaceId: 'ws-1', artifactId: 'design' },
    );
    expect(item.content).not.toContain(src);
    expect(item.content).toContain('[attached image/png image]');
    expect(item.metadata?.artifactSelection?.image?.src).toBe(src);
  });
});
