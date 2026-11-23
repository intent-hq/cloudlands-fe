/**
 * The user agent of Intent's browser panel. Electron's default names Electron
 * and the app (`Electron/x`, `intent-cloudlands/x`); Google sign-in and account
 * pages reject such a browser as unsupported. Drop those tokens so the panel
 * reads as the Chrome it is.
 */
export function browserPanelUserAgent(defaultUserAgent: string, appName: string): string {
  const appToken = appName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return defaultUserAgent
    .replace(new RegExp(`\\s+(?:Electron|${appToken})/\\S+`, 'gi'), '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}
