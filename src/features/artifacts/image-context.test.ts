import { beforeEach, describe, expect, it, vi } from 'vitest';
vi.mock('$lib/client/live/backend-transport', () => ({ backendRequest: vi.fn() }));
import { backendRequest } from '$lib/client/live/backend-transport';
import { artifactImageContextItems, readArtifactImage } from './image-context';
const request = vi.mocked(backendRequest);
beforeEach(() => vi.clearAllMocks());
describe('artifact image context', () => {
  it('resolves asset bytes through the scoped daemon contract', async () => {
    request.mockResolvedValueOnce({
      assetId: 'shot.png',
      mimeType: 'image/png',
      data: 'AAAA',
      sizeKb: 1,
    });
    await expect(readArtifactImage('ws', 'workspace-asset://ws/shot.png')).resolves.toEqual(
      expect.objectContaining({ mimeType: 'image/png', data: 'AAAA' }),
    );
    expect(request).toHaveBeenCalledWith('note.readAsset', {
      workspaceId: 'ws',
      asset: 'shot.png',
    });
  });
  it('rejects cross-workspace assets and traversal before issuing any read', async () => {
    await expect(readArtifactImage('ws', 'workspace-asset://other/shot.png')).rejects.toThrow();
    await expect(readArtifactImage('ws', 'intent://local/file/../shot.png')).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
  });
  it('loads complete workspace image bytes and refuses truncated/oversized content', async () => {
    request.mockResolvedValueOnce({ content: 'AAAA', bytesRead: 3, size: 3 });
    await expect(readArtifactImage('ws', 'intent://local/file/screens/shot.png')).resolves.toEqual({
      data: 'AAAA',
      mimeType: 'image/png',
    });
    expect(request).toHaveBeenCalledWith('file.readChunk', {
      workspaceId: 'ws',
      path: 'screens/shot.png',
      offset: 0,
      length: 8388608,
    });
    request.mockResolvedValueOnce({ content: 'AAAA', bytesRead: 3, size: 9000000 });
    await expect(readArtifactImage('ws', 'intent://local/file/screens/shot.png')).rejects.toThrow();
  });
  it('attaches actual pixels once for a selected image rather than only its URL', async () => {
    const items = await artifactImageContextItems('ws', {
      id: 'selected',
      type: 'selection',
      label: 'Screenshot',
      metadata: { artifactSelection: { image: { src: 'data:image/png;base64,AAAA' }, items: [] } },
    });
    expect(items).toEqual([
      {
        id: 'selected-image-0',
        type: 'file',
        label: 'Screenshot',
        imageData: 'AAAA',
        imageMimeType: 'image/png',
      },
    ]);
  });
  it('normalizes JPEG aliases and wrapped base64 for image attachments', async () => {
    await expect(readArtifactImage('ws', 'data:image/jpg;base64,AA AA')).resolves.toEqual({
      data: 'AAAA',
      mimeType: 'image/jpeg',
    });
  });
});
