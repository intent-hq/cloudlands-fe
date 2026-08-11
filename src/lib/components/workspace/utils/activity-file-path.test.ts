import { describe, expect, it } from 'vitest';
import { normalizeActivityFilePath } from './activity-file-path';

const workspace = {
  worktreePath: '/Users/test/intent/workspaces/sandbox-polish-2/repo',
  repositoryPath: '/Users/test/projects/toolcraft',
  path: '/Users/test/intent/workspaces/sandbox-polish-2',
};

describe('normalizeActivityFilePath', () => {
  it('removes a workspace-container worktree prefix', () => {
    expect(normalizeActivityFilePath('repo/src/main.ts', workspace)).toBe('src/main.ts');
  });

  it('makes absolute worktree paths repository-relative', () => {
    expect(
      normalizeActivityFilePath(
        '/Users/test/intent/workspaces/sandbox-polish-2/repo/src/main.ts',
        workspace,
      ),
    ).toBe('src/main.ts');
  });

  it('preserves an already repository-relative path', () => {
    expect(normalizeActivityFilePath('src/main.ts', workspace)).toBe('src/main.ts');
  });

  it('normalizes Windows separators before matching the worktree root', () => {
    expect(normalizeActivityFilePath('repo\\src\\main.ts', workspace)).toBe('src/main.ts');
  });
});
