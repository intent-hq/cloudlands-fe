import { afterEach, describe, expect, it, vi } from 'vitest';

import { appClient } from '$lib/client';
import { backendRequest } from '$lib/client/live/backend-transport';
import type { FileNode } from '$shared/types';
import { resolveFileBySuffix } from './resolve-file-by-suffix';

vi.mock('$lib/client/live/backend-transport', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/client/live/backend-transport')>();
  return { ...actual, backendRequest: vi.fn() };
});

const file = (name: string): FileNode => ({ name, path: name, type: 'file' });
const directory = (name: string): FileNode => ({ name, path: name, type: 'directory' });

function mockArtifactTree(entries: Record<string, FileNode[]>) {
  return vi
    .spyOn(appClient.files, 'listDirectory')
    .mockImplementation(async (_workspaceId, path) => entries[path] ?? []);
}

describe('resolveFileBySuffix', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.mocked(backendRequest).mockReset();
    vi.restoreAllMocks();
  });

  it.each(['frontend-preview.png', 'frontend-preview.gif', 'frontend-preview.webm'])(
    'finds an ignored nested %s only through bounded artifact directory listings',
    async (name) => {
      const list = mockArtifactTree({
        '.demo-artifacts': [directory('20260824T234627Z-frontend-preview')],
        '.demo-artifacts/20260824T234627Z-frontend-preview': [
          file('frontend-preview.png'),
          file('frontend-preview.gif'),
          file('frontend-preview.webm'),
        ],
      });

      await expect(
        resolveFileBySuffix('ws-1', `20260824T234627Z-frontend-preview/${name}`),
      ).resolves.toEqual({
        candidates: [`.demo-artifacts/20260824T234627Z-frontend-preview/${name}`],
        truncated: false,
      });
      expect(backendRequest).toHaveBeenCalledWith('search.fileNames', {
        workspaceId: 'ws-1',
        pattern: `20260824T234627Z-frontend-preview/${name}`,
        limit: 50,
      });
      expect(list.mock.calls.map(([, path]) => path)).toEqual([
        '.demo-artifacts',
        'artifacts',
        '.demo-artifacts/20260824T234627Z-frontend-preview',
      ]);
    },
  );

  it('does not run a workspace-wide search or invent a candidate for missing user examples', async () => {
    const list = mockArtifactTree({});

    await expect(
      resolveFileBySuffix(
        'ws-1',
        '.demo-artifacts/20260825-0251-compact-indicator/compact-indicator-full.png',
      ),
    ).resolves.toEqual({ candidates: [], truncated: false });
    await expect(
      resolveFileBySuffix('ws-1', 'artifacts/workspace-hover-card-demo/hover-card-demo.mp4'),
    ).resolves.toEqual({ candidates: [], truncated: false });

    expect(backendRequest).not.toHaveBeenCalled();
    expect(list).toHaveBeenCalledTimes(4);
  });

  it('surfaces duplicate ignored basenames as ambiguous candidates', async () => {
    mockArtifactTree({
      '.demo-artifacts': [directory('one'), directory('two')],
      '.demo-artifacts/one': [file('preview.png')],
      '.demo-artifacts/two': [file('preview.png')],
    });

    await expect(resolveFileBySuffix('ws-1', 'preview.png')).resolves.toEqual({
      candidates: ['.demo-artifacts/one/preview.png', '.demo-artifacts/two/preview.png'],
      truncated: false,
    });
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('rejects traversal and escaped absolute paths without any backend call', async () => {
    const list = vi.spyOn(appClient.files, 'listDirectory');

    await expect(resolveFileBySuffix('ws-1', '../preview.png')).resolves.toEqual({
      candidates: [],
      truncated: false,
    });
    await expect(resolveFileBySuffix('ws-1', '/other/preview.png')).resolves.toEqual({
      candidates: [],
      truncated: false,
    });
    expect(list).not.toHaveBeenCalled();
    expect(backendRequest).not.toHaveBeenCalled();
  });

  it('keeps normal source suffix searches and does not list artifact roots', async () => {
    const list = vi.spyOn(appClient.files, 'listDirectory');
    vi.mocked(backendRequest).mockResolvedValue({
      files: ['packages/cloudlands-fe/src/features/navigation/link-handler.ts'],
    });

    await expect(
      resolveFileBySuffix('ws-1', 'src/features/navigation/link-handler.ts'),
    ).resolves.toEqual({
      candidates: ['packages/cloudlands-fe/src/features/navigation/link-handler.ts'],
      truncated: false,
    });
    expect(list).not.toHaveBeenCalled();
  });

  it('marks a depth-limited artifact scan as truncated', async () => {
    mockArtifactTree({
      '.demo-artifacts': [directory('one')],
      '.demo-artifacts/one': [directory('two')],
      '.demo-artifacts/one/two': [directory('three')],
      '.demo-artifacts/one/two/three': [directory('four')],
      '.demo-artifacts/one/two/three/four': [directory('five')],
    });

    await expect(resolveFileBySuffix('ws-1', 'preview.webm')).resolves.toEqual({
      candidates: [],
      truncated: true,
    });
  });

  it('stops after the bounded number of directory calls', async () => {
    const directories = Array.from({ length: 30 }, (_, index) => directory(`run-${index}`));
    const list = mockArtifactTree({ '.demo-artifacts': directories });

    await expect(resolveFileBySuffix('ws-1', 'preview.webm')).resolves.toEqual({
      candidates: [],
      truncated: true,
    });
    expect(list).toHaveBeenCalledTimes(24);
  });

  it('stops after the bounded number of directory entries', async () => {
    const files = Array.from({ length: 257 }, (_, index) => file(`capture-${index}.png`));
    const list = mockArtifactTree({ '.demo-artifacts': files });

    await expect(resolveFileBySuffix('ws-1', 'missing.png')).resolves.toEqual({
      candidates: [],
      truncated: true,
    });
    expect(list).toHaveBeenCalledOnce();
  });

  it('stops a stalled directory listing at the latency bound', async () => {
    vi.useFakeTimers();
    const list = vi
      .spyOn(appClient.files, 'listDirectory')
      .mockReturnValue(new Promise<FileNode[]>(() => undefined));

    const resolution = resolveFileBySuffix('ws-1', 'preview.webm');
    await vi.advanceTimersByTimeAsync(750);

    await expect(resolution).resolves.toEqual({ candidates: [], truncated: true });
    expect(list).toHaveBeenCalledOnce();
  });
});
