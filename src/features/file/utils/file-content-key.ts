/** Keep read-only registered-root content separate from ordinary workspace drafts. */
export function fileContentKey(path: string, gitRootId?: string): string {
  return gitRootId ? JSON.stringify(['git-root', gitRootId, path]) : path;
}
