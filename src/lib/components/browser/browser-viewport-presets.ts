import type { BrowserTabViewport } from '$store/renderer/slices/panel-layout/panel-layout-types';

export type BrowserViewportPresetCategory = 'phone' | 'tablet' | 'desktop';

export interface BrowserViewportPreset {
  id: string;
  name: string;
  category: BrowserViewportPresetCategory;
  width: number;
  height: number;
}

export const BROWSER_VIEWPORT_PRESETS: readonly BrowserViewportPreset[] = [
  { id: 'iphone-se', name: 'iPhone SE', category: 'phone', width: 375, height: 667 },
  { id: 'iphone-15', name: 'iPhone 15', category: 'phone', width: 393, height: 852 },
  { id: 'pixel-8', name: 'Pixel 8', category: 'phone', width: 412, height: 915 },
  { id: 'ipad-mini', name: 'iPad Mini', category: 'tablet', width: 768, height: 1024 },
  { id: 'ipad-pro-11', name: 'iPad Pro 11″', category: 'tablet', width: 834, height: 1194 },
  { id: 'desktop-1280x800', name: '1280 × 800', category: 'desktop', width: 1280, height: 800 },
  { id: 'desktop-1440x900', name: '1440 × 900', category: 'desktop', width: 1440, height: 900 },
] as const;

type SizedBrowserViewport = Exclude<BrowserTabViewport, { mode: 'fit' }>;

export function rotateBrowserViewport<T extends SizedBrowserViewport>(viewport: T): T {
  return { ...viewport, width: viewport.height, height: viewport.width };
}
