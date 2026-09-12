import { backendRequest } from '$lib/client/live/backend-transport';
import type { ContextItem } from '$lib/components/chat/input/context-api';
import { parseIntentFileTarget } from '$lib/utils/workspace-file-image';
import { isAllowedArtifactImageSource } from './preview';

const MAX_IMAGE_BYTES = 8 * 1024 * 1024;
const RASTER_MIME = /^image\/(png|jpeg|jpg|gif|webp)$/;

/** Read only current-workspace raster media, for both tunneled previews and multimodal context. */
export async function readArtifactImage(
  workspaceId: string,
  src: string,
): Promise<{ data: string; mimeType: string }> {
  if (!isAllowedArtifactImageSource(src)) throw new Error('Unsupported artifact image');
  let image: { data: string; mimeType: string };
  if (src.startsWith('data:')) {
    const comma = src.indexOf(',');
    image = { mimeType: src.slice(5, src.indexOf(';')), data: src.slice(comma + 1) };
  } else if (src.startsWith('workspace-asset://')) {
    const match = /^workspace-asset:\/\/([^/]+)\/([^/?#]+)$/.exec(src);
    if (!match || match[1] !== workspaceId || !/^[A-Za-z0-9._-]+$/.test(match[2]))
      throw new Error('Image belongs to another workspace or is invalid');
    image = await backendRequest<{ data: string; mimeType: string }>('note.readAsset', {
      workspaceId,
      asset: match[2],
    });
  } else {
    const file = parseIntentFileTarget(src, workspaceId);
    const extension = file?.path.split('.').pop()?.toLowerCase();
    const mimeType =
      extension === 'jpg' || extension === 'jpeg' ? 'image/jpeg' : 'image/' + extension;
    if (!file || !RASTER_MIME.test(mimeType)) throw new Error('Invalid artifact image path');
    const chunk = await backendRequest<{ content: string; bytesRead: number; size: number }>(
      'file.readChunk',
      { workspaceId, path: file.path, offset: 0, length: MAX_IMAGE_BYTES },
    );
    if (chunk.size > MAX_IMAGE_BYTES || chunk.bytesRead !== chunk.size)
      throw new Error('Artifact image exceeds limit');
    image = { data: chunk.content, mimeType };
  }
  if (
    !RASTER_MIME.test(image.mimeType) ||
    typeof image.data !== 'string' ||
    image.data.length > Math.ceil(MAX_IMAGE_BYTES / 3) * 4 ||
    !/^[A-Za-z0-9+/=\s]+$/.test(image.data)
  )
    throw new Error('Invalid or oversized artifact image');
  return {
    data: image.data.replace(/\s/g, ''),
    mimeType: image.mimeType === 'image/jpg' ? 'image/jpeg' : image.mimeType,
  };
}

export async function artifactImageContextItems(
  workspaceId: string,
  selectionItem: ContextItem,
): Promise<ContextItem[]> {
  const snapshot = selectionItem.metadata?.artifactSelection;
  if (!snapshot) return [];
  const sources = new Set<string>();
  if (snapshot.image?.src) sources.add(snapshot.image.src);
  for (const item of snapshot.items ?? [])
    if (item.type === 'image' && item.src) sources.add(item.src);
  if (sources.size > 4) throw new Error('Select at most four images at a time');
  return Promise.all(
    [...sources].map(async (src, index) => {
      const image = await readArtifactImage(workspaceId, src);
      return {
        id: selectionItem.id + '-image-' + index,
        type: 'file' as const,
        label: selectionItem.label,
        imageData: image.data,
        imageMimeType: image.mimeType,
      };
    }),
  );
}
