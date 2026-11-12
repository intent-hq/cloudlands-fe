/**
 * What a copy puts on the clipboard for each composer tile: a screenshot as shown
 * (marks drawn in) plus its raw pixels and editable marks; a finished recording's
 * file; a pasted image as itself; nothing for a live or unplaced recording.
 */
import { describe, expect, it, vi } from 'vitest';
import { defaultDockMediaEdit, type DockMediaSource } from '$shared/dock-media-edit';
import { dockMediaCopyRequest, type DockMediaCopySource } from './dock-media-clipboard';

const base64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const mark = {
  id: 'mark-1',
  imageId: 'img-1',
  tool: 'arrow' as const,
  geometry: { kind: 'arrow' as const, from: { x: 1, y: 1 }, to: { x: 9, y: 9 } },
  bounds: { x: 1, y: 1, w: 8, h: 8 },
  element: null,
  createdAt: 5,
};
function source(overrides: Partial<DockMediaCopySource> = {}): DockMediaCopySource {
  return {
    workspaceId: 'ws-1',
    view: {
      tiles: [
        {
          image: {
            id: 'img-1',
            contextItemId: 'dock-evidence:img-1',
            width: 800,
            height: 600,
            displayScale: 2,
            capturedAt: '2026-11-03T12:00:00.000Z',
            source: 'capture',
          },
          marks: [{ n: 1, mark }],
        },
      ],
      clips: [
        {
          id: 'clip-1',
          status: 'ready',
          startedAt: 1,
          durationMs: 42_000,
          hasMicAudio: true,
          contextItemId: 'dock-evidence:clip-1',
          path: '.intent/attachments/clip-1.mp4',
        },
        { id: 'clip-2', status: 'recording', startedAt: 1, durationMs: 0, hasMicAudio: false },
      ],
    } as never,
    items: [
      {
        id: 'dock-evidence:img-1',
        type: 'file',
        label: 'screenshot-1.png',
        imageData: base64([7, 7]),
        imageMimeType: 'image/png',
      },
      {
        id: 'dock-evidence:clip-1',
        type: 'file',
        label: 'clip-1.mp4',
        attachmentMimeType: 'video/mp4',
      },
      {
        id: 'pasted',
        type: 'file',
        label: 'photo.jpg',
        imageData: base64([1, 2, 3]),
        imageMimeType: 'image/jpeg',
      },
      { id: 'doc', type: 'file', label: 'notes.pdf' },
    ] as never,
    previews: { 'img-1': 'blob:composited' },
    fetchBytes: vi.fn(async (url: string) => new TextEncoder().encode(url)),
    ...overrides,
  };
}

describe('dockMediaCopyRequest', () => {
  it('copies a screenshot as shown, with its raw pixels and editable marks', async () => {
    const request = await dockMediaCopyRequest('dock-evidence:img-1', source());
    expect(request).toEqual({
      kind: 'image',
      name: 'screenshot-1.png',
      mimeType: 'image/png',
      bytes: new TextEncoder().encode('blob:composited'),
      intent: {
        pixels: {
          mimeType: 'image/png',
          width: 800,
          height: 600,
          displayScale: 2,
          capturedAt: '2026-11-03T12:00:00.000Z',
        },
        raw: new Uint8Array([7, 7]),
        marks: [{ tool: 'arrow', geometry: mark.geometry, bounds: mark.bounds, element: null }],
      },
    });
  });

  // Failure paths: stale displayed preview, raw/private pixels resurfacing on paste,
  // legacy marks painted twice, wrong cropped dimensions, render/read failure on Cut.
  it('copies saved edits from a fresh render, with only flattened pixels for internal paste', async () => {
    const input = source();
    const canonical: DockMediaSource = {
      id: 'source-1',
      revision: 1,
      kind: 'screenshot',
      attachmentId: 'attachment-1',
      path: '.intent/attachments/raw.png',
      durationMs: 0,
      width: 800,
      height: 600,
      audio: 'none',
      batches: [],
      visuals: 'clean',
    };
    const edit = {
      ...defaultDockMediaEdit(canonical, [], null),
      crop: { x: 50, y: 20, w: 300.4, h: 200.6 },
      blurRegions: [{ id: 'blur-1', x: 60, y: 30, w: 20, h: 20 }],
    };
    input.view.tiles[0].image.media = { source: canonical, saved: edit, transcript: null };
    const rendered = new Uint8Array([8, 6, 4]);
    const createSavedPreviewUrl = vi.fn(async () => 'blob:fresh-edited');
    const revokeUrl = vi.fn();
    input.createSavedPreviewUrl = createSavedPreviewUrl;
    input.revokeUrl = revokeUrl;
    input.fetchBytes = vi.fn(async () => rendered);
    const request = await dockMediaCopyRequest('img-1', input);
    expect(createSavedPreviewUrl).toHaveBeenCalledWith('ws-1', {
      source: canonical,
      saved: edit,
      transcript: null,
    });
    expect(input.fetchBytes).toHaveBeenCalledExactlyOnceWith('blob:fresh-edited');
    expect(request).toMatchObject({
      kind: 'image',
      bytes: rendered,
      intent: {
        raw: rendered,
        marks: [],
        pixels: { mimeType: 'image/png', width: 300, height: 201 },
      },
    });
    expect(revokeUrl).toHaveBeenCalledExactlyOnceWith('blob:fresh-edited');
    input.fetchBytes = vi.fn().mockRejectedValue(new Error('read failed'));
    await expect(dockMediaCopyRequest('img-1', input)).rejects.toThrow('read failed');
    expect(revokeUrl).toHaveBeenCalledTimes(2);
    createSavedPreviewUrl.mockRejectedValueOnce(new Error('render failed'));
    await expect(dockMediaCopyRequest('img-1', input)).rejects.toThrow('render failed');
  });

  it('copies a finished recording from its playback file', async () => {
    const movie = new Uint8Array([0, 0, 0, 24, 102, 116, 121, 112, 105, 115, 111, 109]);
    const fetchBytes = vi.fn(async () => movie);
    const request = await dockMediaCopyRequest('clip-1', source({ fetchBytes }));
    expect(request).toMatchObject({
      kind: 'clip',
      name: 'clip-1.mp4',
      mimeType: 'video/mp4',
      durationMs: 42_000,
      hasMicAudio: true,
    });
    expect(fetchBytes.mock.calls[0]![0]).toContain('clip-1.mp4');
  });

  it('copies a pasted image as itself, and refuses what has no media to copy', async () => {
    expect(await dockMediaCopyRequest('pasted', source())).toEqual({
      kind: 'image',
      name: 'photo.jpg',
      mimeType: 'image/jpeg',
      bytes: new Uint8Array([1, 2, 3]),
    });
    expect(await dockMediaCopyRequest('clip-2', source())).toBeNull();
    expect(await dockMediaCopyRequest('doc', source())).toBeNull();
    expect(await dockMediaCopyRequest('img-1', source({ previews: {} }))).toBeNull();
  });
});
