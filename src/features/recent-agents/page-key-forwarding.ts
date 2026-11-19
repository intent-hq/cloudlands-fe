/**
 * Switcher keys forwarded by main from a browser-panel page (keys typed in a `<webview>` never
 * reach the app's document). Returns the unsubscribe; a no-op outside the desktop app.
 */
import { RECENT_AGENTS_PAGE_KEY_EVENT, type RecentAgentPageKey } from '$shared/recent-agents';

export function onRecentAgentPageKey(handler: (key: RecentAgentPageKey) => void): () => void {
  const api = typeof window !== 'undefined' ? window.electronAPI : undefined;
  if (!api?.on) return () => {};
  const listenerId = api.on(RECENT_AGENTS_PAGE_KEY_EVENT, handler);
  return () => api.offById(RECENT_AGENTS_PAGE_KEY_EVENT, listenerId);
}
