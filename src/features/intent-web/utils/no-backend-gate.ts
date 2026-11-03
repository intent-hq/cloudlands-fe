/**
 * Whether the app area shows "Add your first machine" instead of the route:
 * intent-web bound no machine to this tab, and the user is not in Settings,
 * which stays reachable so the first machine can be added there.
 */
export function showsNoBackendScreen(noBackendBound: boolean, pathname: string): boolean {
  if (!noBackendBound) return false;
  return pathname !== '/settings' && !pathname.startsWith('/settings/');
}
