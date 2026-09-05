import { describe, expect, it, vi } from 'vitest';
import { stageNewWorkspaceFiles } from './new-workspace-attachments';

describe('new workspace attachments', () => {
  it('stages host files and preserves converted images in one draft edit', async () => {
    const document = new File(['notes'], 'notes.txt', { type: 'text/plain' });
    const image = new File(['image'], 'diagram.png', { type: 'image/png' });
    const convertedImage = { id: 'image-1', type: 'file' as const, label: 'diagram.png' };
    const convertImages = vi.fn().mockResolvedValue([convertedImage]);

    const items = await stageNewWorkspaceFiles([document, image], {
      getPathForFile: (file) => (file === document ? '/tmp/notes.txt' : ''),
      convertImages,
      now: () => 10,
    });

    expect(items).toEqual([
      expect.objectContaining({
        id: 'staged-file-10-0',
        label: 'notes.txt',
        sourcePath: '/tmp/notes.txt',
      }),
      convertedImage,
    ]);
    expect(convertImages).toHaveBeenCalledWith([image], { maxBytes: 30 * 1024 * 1024 });
  });

  it('marks files without a resolvable host path as failed', async () => {
    const file = new File(['notes'], 'notes.txt', { type: 'text/plain' });

    const [item] = await stageNewWorkspaceFiles([file], {
      getPathForFile: () => '',
      convertImages: vi.fn().mockResolvedValue([]),
    });

    expect(item).toMatchObject({ sourcePath: '', placementStatus: 'failed' });
  });
});
