import type { GitDiffsOptions } from '$lib/client';

export function commitDetailsKey(commitHash: string, gitRootId?: string): string {
  return JSON.stringify([gitRootId ?? '', commitHash]);
}

export function gitDiffReadKey(options: GitDiffsOptions = {}): string {
  return JSON.stringify([
    options.gitRootId ?? '',
    options.commitHash ?? '',
    options.staged === true,
    options.path ?? '',
    options.paths ?? [],
  ]);
}

export function gitFileReadKey(path: string, ref: string, gitRootId?: string): string {
  return JSON.stringify([gitRootId ?? '', ref, path]);
}

export function gitMutationKey(operation: string, scope = ''): string {
  return JSON.stringify([operation, scope]);
}
