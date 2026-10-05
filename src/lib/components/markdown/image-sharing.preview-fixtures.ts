// Fake artwork and isolated failure seams for the image-sharing catalog scene only.
import { overrideMockIpcHandler } from '$shared/ipc-mock-router';

export const IMAGE_SHARING_HTTPS_URL = 'https://image-sharing.invalid/harbor.svg';
export const IMAGE_SHARING_LINK_URL = 'https://image-sharing.invalid/field-notes';

export const IMAGE_SHARING_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="600" viewBox="0 0 960 600">
<rect width="960" height="600" fill="#eee8da"/>
<circle cx="690" cy="170" r="86" fill="#d99a73"/>
<path d="M0 320 Q220 205 430 325 T960 310 V600 H0Z" fill="#899a91"/>
<path d="M0 410 Q240 310 480 390 T960 395 V600 H0Z" fill="#536b6c"/>
<path d="M0 490 Q260 410 490 485 T960 465 V600 H0Z" fill="#2d484d"/>
<text x="48" y="75" font-family="sans-serif" font-size="30" fill="#2d484d">Harbor study</text>
<text x="48" y="111" font-family="sans-serif" font-size="18" fill="#536b6c">Original artwork · 960 × 600</text>
</svg>`;

/** Raster bytes keep Copy image on the real PNG clipboard path (no SVG decode ambiguity). */
export function createImageSharingRaster(thumbnail = false): string {
  const canvas = document.createElement('canvas');
  canvas.width = thumbnail ? 160 : 960;
  canvas.height = thumbnail ? 100 : 600;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Preview artwork requires a canvas context');
  context.scale(canvas.width / 960, canvas.height / 600);
  context.fillStyle = '#eee8da';
  context.fillRect(0, 0, 960, 600);
  context.fillStyle = '#d99a73';
  context.beginPath();
  context.arc(690, 170, 86, 0, Math.PI * 2);
  context.fill();
  for (const [y, color] of [
    [320, '#899a91'],
    [410, '#536b6c'],
    [490, '#2d484d'],
  ] as const) {
    context.fillStyle = color;
    context.beginPath();
    context.moveTo(0, y);
    context.bezierCurveTo(260, y - 115, 510, y + 110, 960, y - 10);
    context.lineTo(960, 600);
    context.lineTo(0, 600);
    context.fill();
  }
  if (!thumbnail) {
    context.fillStyle = '#2d484d';
    context.font = '30px sans-serif';
    context.fillText('Harbor study', 48, 75);
    context.font = '18px sans-serif';
    context.fillText('Original artwork · 960 × 600', 48, 111);
  }
  return canvas.toDataURL('image/png');
}

export function installImageSharingDownloadFailure(): () => void {
  const originalFetch = globalThis.fetch;
  const fixtureFetch: typeof fetch = (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    if (url === IMAGE_SHARING_HTTPS_URL) {
      return Promise.resolve(new Response(null, { status: 403 }));
    }
    return originalFetch(input, init);
  };
  globalThis.fetch = fixtureFetch;
  return () => {
    if (globalThis.fetch === fixtureFetch) globalThis.fetch = originalFetch;
  };
}

export function installImageSharingClipboardFailure(): () => void {
  const previous = Object.getOwnPropertyDescriptor(navigator, 'clipboard');
  const fixtureClipboard = {
    write: async () => {
      throw new DOMException('Preview clipboard permission denied', 'NotAllowedError');
    },
  };
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: fixtureClipboard });
  return () => {
    if (Object.getOwnPropertyDescriptor(navigator, 'clipboard')?.value !== fixtureClipboard) return;
    if (previous) Object.defineProperty(navigator, 'clipboard', previous);
    else Reflect.deleteProperty(navigator, 'clipboard');
  };
}

export function installImageSharingLinkCapture(onLink: (url: string) => void): () => void {
  return overrideMockIpcHandler('shell:openExternal', (payload) => {
    onLink((payload as { url: string }).url);
    return { success: true };
  });
}
