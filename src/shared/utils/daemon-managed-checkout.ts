/**
 * Daemon-managed cache/clone checkouts are internal paths, never
 * user-pickable repos — recents readers exclude them. Matches both
 * forward- and backslash-separated paths, mirroring intentd's own filter
 * (intent-acp mcp_server/bindings/app/workspaces.rs), so Windows-style
 * paths from `repo.list`/the registry can't leak into recents.
 */
export function isDaemonManagedCheckoutPath(path: string): boolean {
  return (
    path.includes('/.clones/') ||
    path.includes('\\.clones\\') ||
    path.includes('/.repo-cache/') ||
    path.includes('\\.repo-cache\\')
  );
}
