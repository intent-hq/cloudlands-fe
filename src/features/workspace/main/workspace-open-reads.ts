/** Main-private dependencies for one enriched OPEN; never stored in Redux or IPC. */
export interface WorkspaceOpenReads {
  request<T = unknown>(
    method: 'workspace.get' | 'git.getConfig' | 'settings.get',
    params: Readonly<Record<string, unknown>>,
  ): Promise<T>;
  accessWorktree(path: string): Promise<void>;
}
