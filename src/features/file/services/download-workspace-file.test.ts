import { beforeEach, describe, expect, it, vi } from 'vitest';
import { invoke } from '$lib/electron-bridge';
import { downloadWorkspaceFile } from './download-workspace-file';

beforeEach(() => vi.clearAllMocks());

describe('workspace file downloads', () => {
  it.each([
    ['/remote/work/docs/report #1.pdf', '/remote/work', 'docs/report #1.pdf', 'report #1.pdf'],
    ['C:\\Work\\docs\\Report.PDF', 'c:\\work', 'docs/Report.PDF', 'Report.PDF'],
    ['\\\\server\\share\\work\\image.png', '\\\\SERVER\\share\\work', 'image.png', 'image.png'],
    ['notes/café.txt', undefined, 'notes/café.txt', 'café.txt'],
    ['/file.txt', '/', 'file.txt', 'file.txt'],
  ])(
    'sends %s as a workspace-relative source and preserves its filename',
    async (filePath, root, path, fileName) => {
      vi.mocked(invoke).mockResolvedValue({ success: false, canceled: true });
      const result = await downloadWorkspaceFile('workspace-1', filePath, root);
      expect(invoke).toHaveBeenCalledExactlyOnceWith('file:download-attachment', {
        workspaceId: 'workspace-1',
        path,
        fileName,
      });
      expect(result).toEqual({ success: false, canceled: true });
    },
  );

  it.each([
    ['/remote/work-other/file.pdf', '/remote/work'],
    ['../secret', '/remote/work'],
    ['/remote/work/../secret', '/remote/work'],
    ['dir/./file', '/remote/work'],
    ['/remote/work/file', undefined],
    ['/remote/work', '/remote/work'],
    ['~/secret', '/remote/work'],
    ['dir//file', '/remote/work'],
    ['bad\0file', '/remote/work'],
    ['C:secret', '/remote/work'],
  ])('rejects %s without invoking native IPC', async (filePath, root) => {
    await expect(downloadWorkspaceFile('workspace-1', filePath, root)).rejects.toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
