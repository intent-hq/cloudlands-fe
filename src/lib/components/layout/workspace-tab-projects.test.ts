import { describe, expect, it } from 'vitest';
import type { Workspace } from '$shared/types';
import { resolveWorkspaceTabProjects } from './workspace-tab-projects';

const workspace = (id: string, fields: Partial<Workspace>) => ({ id, ...fields }) as Workspace;

describe('resolveWorkspaceTabProjects', () => {
  it('names groups by repository and uses the full label when names collide', () => {
    expect(
      resolveWorkspaceTabProjects([
        workspace('a', {
          repositoryOwner: 'acme',
          repositoryName: 'app',
          repositoryPath: '/r/app',
        }),
        workspace('b', { repositoryPath: '/r/app' }),
        workspace('c', { repositoryOwner: 'acme', repositoryName: 'web' }),
        workspace('d', { repositoryOwner: 'other', repositoryName: 'web' }),
        workspace('e', { repositoryPath: '/local/tools' }),
        workspace('f', {}),
      ]),
    ).toEqual({
      a: { key: 'acme/app', name: 'app' },
      b: { key: 'acme/app', name: 'app' },
      c: { key: 'acme/web', name: 'acme/web' },
      d: { key: 'other/web', name: 'other/web' },
      e: { key: '/local/tools', name: 'tools' },
    });
  });
});
