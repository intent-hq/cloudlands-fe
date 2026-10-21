import { describe, expect, it } from 'vitest';

import type { Workspace } from '$shared/types';
import {
  buildCreatePrefill,
  findWorkspaceForFolder,
  folderTitle,
  normalizeFolderPath,
} from './deep-link-workspace';

const ws = (id: string, extra: Partial<Workspace>): Workspace =>
  ({ id, title: id, status: 'Active', createdAt: '', updatedAt: '', ...extra }) as Workspace;

describe('normalizeFolderPath', () => {
  it('drops trailing separators but keeps the filesystem root', () => {
    expect(normalizeFolderPath('/Users/me///')).toBe('/Users/me');
    expect(normalizeFolderPath('C:\\code\\repo\\')).toBe('C:/code/repo');
    expect(normalizeFolderPath('/')).toBe('/');
  });
});

describe('findWorkspaceForFolder', () => {
  it('prefers the most recently updated of several matches', () => {
    const found = findWorkspaceForFolder(
      [
        ws('older', { repositoryPath: '/r', updatedAt: '2026-01-01T00:00:00Z' }),
        ws('newer', { repositoryPath: '/r/', updatedAt: '2026-06-01T00:00:00Z' }),
      ],
      '/r',
    );
    expect(found?.id).toBe('newer');
  });

  it('ignores remote, archived and deleted workspaces', () => {
    expect(
      findWorkspaceForFolder(
        [
          ws('remote', { repositoryPath: '/r', isRemote: true }),
          ws('archived', { repositoryPath: '/r', status: 'Archived' as Workspace['status'] }),
          ws('deleted', { repositoryPath: '/r', status: 'Deleted' as Workspace['status'] }),
        ],
        '/r',
      ),
    ).toBeUndefined();
  });

  it('does not match a repository to the worktree workspaces created from it', () => {
    expect(
      findWorkspaceForFolder(
        [ws('wt', { repositoryPath: '/repo', worktreePath: '/ws/wt/repo' })],
        '/repo',
      ),
    ).toBeUndefined();
  });
});

describe('folderTitle', () => {
  it('uses the last path segment, or the root itself', () => {
    expect(folderTitle('/Users/clement')).toBe('clement');
    expect(folderTitle('/')).toBe('/');
  });
});

describe('buildCreatePrefill', () => {
  it('never forwards autoCreate or unknown link params to the form', () => {
    expect(
      buildCreatePrefill({ githubUrl: 'https://github.com/o/r', autoCreate: 'true', evil: 'x' }),
    ).toEqual({ githubUrl: 'https://github.com/o/r' });
  });
});
