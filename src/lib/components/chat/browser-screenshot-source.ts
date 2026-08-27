export type BrowserScreenshotMimeType = 'image/jpeg' | 'image/png';

interface BrowserScreenshotData {
  screenshotBase64?: string;
  screenshotUrl?: string;
}

const SAFE_SCREENSHOT_URL = /^(?:https?:\/\/|workspace-asset:\/\/)/i;
const BASE64 = /^[A-Za-z0-9+/]+={0,2}$/;

export function inferBrowserScreenshotMimeType(
  base64: string | undefined,
): BrowserScreenshotMimeType | undefined {
  const value = base64?.trim();
  if (!value || !BASE64.test(value) || value.length % 4 === 1) return undefined;
  if (value.startsWith('/9j/')) return 'image/jpeg';
  if (value.startsWith('iVBORw0KGgo')) return 'image/png';
  return undefined;
}

export function resolveBrowserScreenshotSource(
  screenshot: BrowserScreenshotData | null | undefined,
): string | null {
  const assetUrl = screenshot?.screenshotUrl?.trim();
  if (assetUrl && SAFE_SCREENSHOT_URL.test(assetUrl)) return assetUrl;

  const base64 = screenshot?.screenshotBase64?.trim();
  const mimeType = inferBrowserScreenshotMimeType(base64);
  return base64 && mimeType ? `data:${mimeType};base64,${base64}` : null;
}
