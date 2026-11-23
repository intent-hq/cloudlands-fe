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

const BRAND_LIST_HEADERS = ['sec-ch-ua', 'sec-ch-ua-full-version-list'];

/**
 * Add a "Google Chrome" brand, at the Chromium version, to a client-hint brand
 * list (`Sec-CH-UA`, `Sec-CH-UA-Full-Version-List`). Electron sends only
 * Chromium and a placeholder brand, which Google reads as a non-Chrome browser.
 */
export function withChromeBrand(brandList: string): string {
  if (/"Google Chrome"/.test(brandList)) return brandList;
  const chromium = /"Chromium";v="([^"]+)"/.exec(brandList);
  if (!chromium) return brandList;
  return brandList.replace(chromium[0], `${chromium[0]}, "Google Chrome";v="${chromium[1]}"`);
}

/** Rewrite the client-hint brand headers of a request in place; returns the headers. */
export function withChromeBrandHeaders(headers: Record<string, string>): Record<string, string> {
  for (const name of Object.keys(headers)) {
    if (BRAND_LIST_HEADERS.includes(name.toLowerCase())) {
      headers[name] = withChromeBrand(headers[name]);
    }
  }
  return headers;
}
