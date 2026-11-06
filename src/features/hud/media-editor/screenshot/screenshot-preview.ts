import { renderDockMediaImage } from '$features/hud/composer/dock-media-render';
import { arrayBufferToBase64 } from '$features/voice/utils/wav-encoder';
import type { DockMediaEdit, DockMediaSource } from '$shared/dock-media-edit';

/** Per-editor immutable pixel cache. Preview uses the exact saved-output renderer. */
export function createScreenshotPreviewRenderer() {
  const originals = new Map<string, Promise<{ base64: string; mimeType: string }>>();
  return async (
    source: DockMediaSource,
    edit: DockMediaEdit,
    url: string,
    hiddenTextMarkId: string | null = null,
  ): Promise<string> => {
    const key = JSON.stringify([source.id, source.revision, url]);
    let pixels = originals.get(key);
    if (!pixels) {
      pixels = (async () => {
        const response = await fetch(url);
        if (!response.ok) throw new Error('Screenshot source unavailable');
        const blob = await response.blob();
        return { base64: arrayBufferToBase64(await blob.arrayBuffer()), mimeType: blob.type };
      })();
      originals.set(key, pixels);
      if (originals.size > 2) {
        const oldest = originals.keys().next().value;
        if (oldest !== undefined) originals.delete(oldest);
      }
      void pixels.catch(() => originals.delete(key));
    }
    const image = await renderDockMediaImage(source, edit, await pixels, { hiddenTextMarkId });
    const bytes = Uint8Array.from(atob(image.data), (c) => c.charCodeAt(0));
    return URL.createObjectURL(new Blob([bytes], { type: image.mimeType }));
  };
}
