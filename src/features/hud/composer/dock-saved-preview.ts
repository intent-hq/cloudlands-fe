import type { DockMediaEdit, DockSavedMedia } from '$shared/dock-media-edit';
import { arrayBufferToBase64 } from '$features/voice/utils/wav-encoder';
import { intentFileMediaUrlToWorkspaceFile } from '$lib/utils/workspace-file-image';
import { fetchDockMediaBytes } from './dock-media-clipboard';
import { renderDockMediaImage } from './dock-media-render';

/**
 * A screenshot's saved edit, drawn from its placed source exactly as Send draws it
 * (crop, blur, numbered marks). The source file stays untouched for further editing.
 */
export async function createDockSavedPreviewUrl(
  workspaceId: string,
  media: DockSavedMedia & { saved: DockMediaEdit },
): Promise<string> {
  const source = media.source;
  const encoded = source.path.split('/').map(encodeURIComponent).join('/');
  const resolved = intentFileMediaUrlToWorkspaceFile(`intent://local/file/${encoded}`, workspaceId);
  if (!resolved || resolved.kind !== 'image') throw new Error('media-source-unavailable');
  const bytes = await fetchDockMediaBytes(resolved.url);
  const pixels = {
    base64: arrayBufferToBase64(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    ),
    mimeType: /\.jpe?g$/i.test(source.path)
      ? 'image/jpeg'
      : /\.webp$/i.test(source.path)
        ? 'image/webp'
        : 'image/png',
  };
  const out = await renderDockMediaImage(source, media.saved, pixels);
  const data = Uint8Array.from(atob(out.data), (c) => c.charCodeAt(0));
  return URL.createObjectURL(new Blob([data], { type: out.mimeType }));
}
