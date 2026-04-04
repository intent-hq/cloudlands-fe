import { describe, it, expect } from 'vitest';
import {
  fileExplorerReducer,
  initialState,
  setFileExplorerWorkspacePath,
  setRootNode,
  addExpandedPath,
  removeExpandedPath,
  setGitStatusMap,
  setFileExplorerLoading,
  setFileExplorerError,
  clearExpandedPathsExceptRoot,
  setChildrenAtPathAction,
  clearFileExplorerForWorkspace,
} from '$lib/store/slices/file-explorer/file-explorer-slice';
import type { FileNode } from '$shared/types';
import {
  shouldHide,
  checkGitignored,
  sortNodes,
} from '$lib/store/slices/file-explorer/file-explorer-utils';

describe('FileExplorerReducer', () => {
  const wsId = 'test-ws';

  it('should return initial state', () => {
    const state = fileExplorerReducer(undefined, { type: '@@INIT' });
    expect(state).toEqual(initialState);
    expect(state.byWorkspaceId).toEqual({});
  });

  it('should set workspace path and reset tree', () => {
    const state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(wsId, '/test/path'));
    const ws = state.byWorkspaceId[wsId];
    expect(ws.workspacePath).toBe('/test/path');
    expect(ws.rootNode).toBeNull();
    expect(ws.expandedPaths).toEqual([]);
  });

  it('should set root node', () => {
    const root: FileNode = { name: 'root', path: '/test', type: 'directory', children: [] };
    const state = fileExplorerReducer(initialState, setRootNode(wsId, root));
    expect(state.byWorkspaceId[wsId].rootNode).toEqual(root);
  });

  it('should add and remove expanded paths', () => {
    let state = fileExplorerReducer(initialState, addExpandedPath(wsId, '/a'));
    expect(state.byWorkspaceId[wsId].expandedPaths).toContain('/a');

    state = fileExplorerReducer(state, addExpandedPath(wsId, '/b'));
    expect(state.byWorkspaceId[wsId].expandedPaths).toEqual(['/a', '/b']);

    state = fileExplorerReducer(state, removeExpandedPath(wsId, '/a'));
    expect(state.byWorkspaceId[wsId].expandedPaths).toEqual(['/b']);
  });

  it('should not duplicate expanded paths', () => {
    let state = fileExplorerReducer(initialState, addExpandedPath(wsId, '/a'));
    state = fileExplorerReducer(state, addExpandedPath(wsId, '/a'));
    expect(state.byWorkspaceId[wsId].expandedPaths).toEqual(['/a']);
  });

  it('should set git status', () => {
    const gitStatus = { 'file.ts': { status: 'M ', additions: 5, deletions: 2 } };
    const state = fileExplorerReducer(initialState, setGitStatusMap(wsId, gitStatus));
    expect(state.byWorkspaceId[wsId].gitStatus).toEqual(gitStatus);
  });

  it('should set loading and clear error', () => {
    let state = fileExplorerReducer(initialState, setFileExplorerError(wsId, 'some error'));
    expect(state.byWorkspaceId[wsId].error).toBe('some error');

    state = fileExplorerReducer(state, setFileExplorerLoading(wsId, true));
    expect(state.byWorkspaceId[wsId].isLoading).toBe(true);
    expect(state.byWorkspaceId[wsId].error).toBeNull();
  });

  it('should clear workspace state', () => {
    let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(wsId, '/test'));
    state = fileExplorerReducer(state, addExpandedPath(wsId, '/test'));
    state = fileExplorerReducer(state, clearFileExplorerForWorkspace(wsId));
    expect(state.byWorkspaceId[wsId]).toBeUndefined();
  });

  it('should collapse all except root', () => {
    let state = fileExplorerReducer(initialState, setFileExplorerWorkspacePath(wsId, '/root'));
    state = fileExplorerReducer(state, addExpandedPath(wsId, '/root'));
    state = fileExplorerReducer(state, addExpandedPath(wsId, '/root/a'));
    state = fileExplorerReducer(state, addExpandedPath(wsId, '/root/b'));
    state = fileExplorerReducer(state, clearExpandedPathsExceptRoot(wsId));
    expect(state.byWorkspaceId[wsId].expandedPaths).toEqual(['/root']);
  });

  it('should set children at path', () => {
    const root: FileNode = {
      name: 'root', path: '/root', type: 'directory',
      children: [{ name: 'src', path: '/root/src', type: 'directory', children: [] }],
    };
    let state = fileExplorerReducer(initialState, setRootNode(wsId, root));
    const newChildren: FileNode[] = [
      { name: 'index.ts', path: '/root/src/index.ts', type: 'file' },
    ];
    state = fileExplorerReducer(state, setChildrenAtPathAction(wsId, '/root/src', newChildren));
    expect(state.byWorkspaceId[wsId].rootNode?.children?.[0].children).toEqual(newChildren);
  });
});

// ---------------------------------------------------------------------------
// Gitignore / shouldHide unit tests
//
// These test the gitignore filtering logic directly using the utility functions
// without requiring IPC calls or Redux store.
// ---------------------------------------------------------------------------

/** Helper: create a mock FileNode */
function mockNode(name: string, workspacePath: string, isDirectory = false): FileNode {
  return {
    name,
    path: `${workspacePath}/${name}`,
    type: isDirectory ? 'directory' : 'file',
    size: 100,
    modified: '2025-01-01T00:00:00Z',
    children: isDirectory ? [] : undefined,
  };
}

/**
 * Helper: build nodes from entries and apply shouldHide + checkGitignored
 * to mimic what the saga does when loading a directory.
 */
function buildFilteredNodes(
  names: Array<{ name: string; isDir?: boolean }>,
  gitignorePatterns: string[],
  workspacePath = '/workspace',
): FileNode[] {
  const nodes: FileNode[] = [];
  for (const { name, isDir } of names) {
    const fullPath = `${workspacePath}/${name}`;
    if (shouldHide(fullPath)) continue;
    const ignored = checkGitignored(fullPath, workspacePath, gitignorePatterns);
    nodes.push({
      ...mockNode(name, workspacePath, isDir),
      ...(ignored && { isGitignored: true }),
    });
  }
  return sortNodes(nodes);
}

describe('gitignore semantics — shouldHide + isGitignored', () => {
  it('should show default-ignored files as gitignored (dimmed), not hidden', () => {
    const entries = [
      { name: 'src', isDir: true },
      { name: 'node_modules', isDir: true },
      { name: 'dist', isDir: true },
      { name: '.DS_Store' },
      { name: 'Thumbs.db' },
      { name: 'package.json' },
      { name: 'debug.log' },
    ];

    const children = buildFilteredNodes(entries, []);
    const names = children.map((n) => n.name);

    expect(names).toContain('src');
    expect(names).toContain('package.json');
    expect(names).toContain('node_modules');
    expect(names).toContain('dist');
    expect(names).toContain('.DS_Store');
    expect(names).toContain('Thumbs.db');
    expect(names).toContain('debug.log');

    const byName = (name: string) => children.find((n) => n.name === name)!;
    expect(byName('node_modules').isGitignored).toBe(true);
    expect(byName('dist').isGitignored).toBe(true);
    expect(byName('.DS_Store').isGitignored).toBe(true);
    expect(byName('Thumbs.db').isGitignored).toBe(true);
    expect(byName('debug.log').isGitignored).toBe(true);

    expect(byName('src').isGitignored).toBeFalsy();
    expect(byName('package.json').isGitignored).toBeFalsy();
  });

  it('should allow negation patterns to override defaults (e.g. !dist)', () => {
    const entries = [
      { name: 'dist', isDir: true },
      { name: 'build', isDir: true },
      { name: 'src', isDir: true },
    ];

    const children = buildFilteredNodes(entries, ['!dist']);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('dist').isGitignored).toBeFalsy();
    expect(byName('src').isGitignored).toBeFalsy();
    expect(byName('build').isGitignored).toBe(true);
  });

  it('should respect last-match-wins for negation then re-ignore', () => {
    const entries = [
      { name: 'important.log' },
      { name: 'debug.log' },
    ];

    const children = buildFilteredNodes(entries, ['!important.log', 'important.log']);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('important.log').isGitignored).toBe(true);
    expect(byName('debug.log').isGitignored).toBe(true);
  });

  it('should completely hide .git (even with negation) — not just dim it', () => {
    const entries = [
      { name: '.git', isDir: true },
      { name: 'src', isDir: true },
    ];

    const children = buildFilteredNodes(entries, ['!.git']);
    const names = children.map((n) => n.name);

    expect(names).not.toContain('.git');
    expect(names).toContain('src');
  });

  it('should show dotfiles that are not in any ignore pattern (not gitignored)', () => {
    const entries = [
      { name: '.prettierrc' },
      { name: '.eslintrc.json' },
      { name: '.npmrc' },
      { name: '.gitignore' },
      { name: '.editorconfig' },
    ];

    const children = buildFilteredNodes(entries, []);

    for (const child of children) {
      expect(child.isGitignored).toBeFalsy();
    }
  });

  it('should mark dotfiles in gitignore as gitignored, respect negation', () => {
    const entries = [
      { name: '.env' },
      { name: '.env.local' },
      { name: '.env.example' },
      { name: '.npmrc' },
    ];

    const children = buildFilteredNodes(entries, ['.env', '.env.local', '.env.example', '!.env.example']);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('.env').isGitignored).toBe(true);
    expect(byName('.env.local').isGitignored).toBe(true);
    expect(byName('.env.example').isGitignored).toBeFalsy();
    expect(byName('.npmrc').isGitignored).toBeFalsy();
  });

  it('should handle glob patterns from gitignore', () => {
    const entries = [
      { name: 'app.min.js' },
      { name: 'app.js' },
      { name: 'styles.min.css' },
      { name: 'styles.css' },
    ];

    const children = buildFilteredNodes(entries, ['*.min.*']);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(byName('app.min.js').isGitignored).toBe(true);
    expect(byName('styles.min.css').isGitignored).toBe(true);
    expect(byName('app.js').isGitignored).toBeFalsy();
    expect(byName('styles.css').isGitignored).toBeFalsy();
  });

  it('should apply default ignores even with no gitignore file (empty patterns)', () => {
    const entries = [
      { name: 'src', isDir: true },
      { name: 'node_modules', isDir: true },
      { name: 'package.json' },
    ];

    const children = buildFilteredNodes(entries, []);
    const byName = (name: string) => children.find((n) => n.name === name)!;

    expect(children.map((n) => n.name)).toContain('node_modules');
    expect(byName('node_modules').isGitignored).toBe(true);
    expect(byName('src').isGitignored).toBeFalsy();
    expect(byName('package.json').isGitignored).toBeFalsy();
  });
});
