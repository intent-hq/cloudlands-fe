import {
  describe,
  expect,
  it,
  vi,
} from 'vitest';

import { createFileRequested } from '$lib/store/slices/app-layout/app-layout-slice';

import {
  dispatchCreateFileRequest,
  getCreateFileRootPath,
  handleCommandPaletteCreateFile,
} from '../create-file-command';

describe('create-file-command', () => {
  it('prefers the worktree path and falls back to repository or legacy workspace paths', () => {
    expect(
      getCreateFileRootPath({
        worktreePath: '/workspace/worktree',
        repositoryPath: '/workspace/repo',
        path: '/workspace/legacy',
      }),
    ).toBe('/workspace/worktree');
    expect(getCreateFileRootPath({ repositoryPath: '/workspace/repo', path: '/workspace/legacy' })).toBe(
      '/workspace/repo',
    );
    expect(getCreateFileRootPath({ path: '/workspace/legacy' })).toBe('/workspace/legacy');
  });

  it('opens the existing create-file flow with the preferred resolved workspace root path', () => {
    const onCreateFile = vi.fn();

    expect(
      handleCommandPaletteCreateFile(
        {
          worktreePath: '/workspace/worktree',
          repositoryPath: '/workspace/repo',
          path: '/workspace/legacy',
        },
        onCreateFile,
      ),
    ).toBe(true);
    expect(onCreateFile).toHaveBeenCalledWith('/workspace/worktree');
  });

  it('does nothing when the workspace has no usable root path', () => {
    const onCreateFile = vi.fn();

    expect(handleCommandPaletteCreateFile({}, onCreateFile)).toBe(false);
    expect(onCreateFile).not.toHaveBeenCalled();
  });

  it('bridges command palette new-file through dialog confirmation into createFileRequested', () => {
    const dispatch = vi.fn();
    let folderPath = '';
    const workspace = {
      id: 'ws-create-file',
      worktreePath: '/workspace/worktree',
      repositoryPath: '/workspace/repo',
    };

    expect(
      handleCommandPaletteCreateFile(workspace, (nextFolderPath) => {
        folderPath = nextFolderPath;
      }),
    ).toBe(true);

    expect(dispatchCreateFileRequest(workspace, folderPath, 'feature.ts', dispatch)).toBe(true);
    expect(dispatch).toHaveBeenCalledWith(
      createFileRequested('ws-create-file', '/workspace/worktree', 'feature.ts'),
    );
  });

  it('does not dispatch createFileRequested without a workspace id', () => {
    const dispatch = vi.fn();

    expect(
      dispatchCreateFileRequest(
        { repositoryPath: '/workspace/repo' },
        '/workspace/repo',
        'feature.ts',
        dispatch,
      ),
    ).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
});