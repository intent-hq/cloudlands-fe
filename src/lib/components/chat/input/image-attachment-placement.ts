/**
 * Source input compatibility facade. React and new callers inject the shared
 * image placement API directly. Remove this facade after all source send owners
 * inject their transport and protocol gate; until then keep the public defaults.
 */
import {
  placeImageAttachment as placeImage,
  toImageReferenceBlocks as toReferences,
} from '$lib/client/live/image-attachment-placement';
import type {
  ImagePlacementApi,
  WireImageBlock,
} from '$lib/client/live/image-attachment-placement';
import type { AttachmentPlacementOptions } from '$lib/client/live/attachment-upload-types';
import { assertPlacementCurrent, assertUploadActive } from '$lib/client/live/attachment-upload';
export { ImagePlacementError, imageRetryBlocks } from '$lib/client/live/image-attachment-placement';
export type {
  ImagePlacementApi,
  ImageReferenceBlock,
  WireImageBlock,
} from '$lib/client/live/image-attachment-placement';
export { base64DecodedBytes } from '$lib/client/live/attachment-upload';

async function sourcePlacementApi(): Promise<ImagePlacementApi> {
  const [api, source] = await Promise.all([
    import('./context-api'),
    import('./attachment-placement'),
  ]);
  return { ...api, mintIdempotencyKey: source.mintPlacementIdempotencyKey };
}

export async function placeImageAttachment(
  workspaceId: string,
  fileName: string,
  source: { data: string; mimeType?: string; idempotencyKey?: string },
  api?: ImagePlacementApi,
  options: AttachmentPlacementOptions = {},
) {
  assertUploadActive(options);
  return placeImage(workspaceId, fileName, source, api ?? (await sourcePlacementApi()), options);
}

export async function toImageReferenceBlocks(
  workspaceId: string,
  blocks: WireImageBlock[],
  api?: ImagePlacementApi,
  current: () => boolean = () => true,
) {
  assertPlacementCurrent(current);
  return toReferences(workspaceId, blocks, api ?? (await sourcePlacementApi()), current);
}
